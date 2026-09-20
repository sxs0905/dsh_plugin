/**
 * dsh-plugin-deepseek-balance — host half.
 *
 * Resolves one or more DeepSeek API keys through the harness credential seam,
 * queries the official balance endpoint (`GET {baseUrl}/user/balance`) for
 * each, caches every reading briefly, and publishes them to the browser:
 *
 *   - `GET {routePath}` (default `/deepseek-balance`) — JSON for the client
 *     chips and for `curl`, or a small HTML card when a browser asks for HTML.
 *   - the browser half in `lib/client.js` — a live strip in the composer dock
 *     (next to the chat stats pills) and a chip in the sidebar footer.
 *
 * Default behavior is one account behind `DEEPSEEK_API_KEY`. Configure
 * `accounts: [{ label, apiKeyRef }]` to watch several keys at once.
 *
 * Today's spend is *derived*, because DeepSeek publishes no usage or billing
 * API: every fresh reading is folded into a small persisted ledger that
 * accumulates the balance DROPS observed during the local day. A rise (top-up
 * or new grant) is never counted as spend. The figure therefore covers what
 * the plugin actually observed — an optional background sampler closes the
 * gaps while no browser is polling.
 *
 * The host half deliberately imports nothing outside `node:` builtins so the
 * package keeps working however the profile links it (pnpm `link:`, a copied
 * directory, or the packaged dsh executable).
 *
 * @module dsh-plugin-deepseek-balance
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Cordis plugin name. */
export const name = "deepseek-balance";

/**
 * Required services:
 *   - `credentials` — resolves the API key references without exposing values.
 *   - `webServer`   — the browser HTTP carrier that owns route registration.
 */
export const inject = ["credentials", "webServer"];

/** Default credential reference; the same key the LLM routes use. */
const DEFAULT_KEY_REF = "DEEPSEEK_API_KEY";
/** Default API origin, without a trailing slash. */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default browser/CLI route path. */
const DEFAULT_ROUTE_PATH = "/deepseek-balance";
/** Default cache lifetime in milliseconds; a `force` read bypasses it. */
const DEFAULT_CACHE_MS = 15_000;
/** Default upstream request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Largest upstream error body echoed to the browser. */
const MAX_ERROR_BYTES = 500;
/** Upper bound on configured accounts, so one row cannot fan out unbounded. */
const MAX_ACCOUNTS = 20;
/** Default interval of the no-browser background sampler; 0 disables it. */
const DEFAULT_SAMPLE_MS = 300_000;
/** Minimum spacing between ledger writes, so a fast poll loop cannot thrash the disk. */
const LEDGER_WRITE_INTERVAL_MS = 5_000;
/** Ledger filename inside the harness home. */
const LEDGER_FILENAME = "deepseek-balance-ledger.json";
/** Settings namespace this plugin owns; the browser card registers under it. */
const SETTINGS_NAMESPACE = "deepseek-balance";

/**
 * Coerce one config number, falling back when it is absent or unusable.
 * @param value - candidate value.
 * @param fallback - value used when the candidate is not a positive finite number.
 * @returns the candidate or the fallback.
 */
function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Normalize one entry of `accounts` into `{ id, label, apiKeyRef }`.
 * @param entry - the raw entry (a string is read as an `apiKeyRef`).
 * @param index - position, used to derive a stable fallback id.
 * @param used - ids already taken, mutated as ids are claimed.
 * @returns the normalized account.
 */
function normalizeAccount(entry, index, used) {
  const source = typeof entry === "string" ? { apiKeyRef: entry } : (entry !== null && typeof entry === "object" ? entry : {});
  const apiKeyRef = typeof source.apiKeyRef === "string" && source.apiKeyRef.length > 0
    ? source.apiKeyRef
    : DEFAULT_KEY_REF;
  const label = typeof source.label === "string" ? source.label : "";
  const idBase = typeof source.id === "string" && source.id.length > 0
    ? source.id
    : (label.length > 0 ? label : `account-${String(index + 1)}`);
  let id = idBase;
  let suffix = 2;
  while (used.has(id)) {
    id = `${idBase}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(id);
  return { id, label, apiKeyRef };
}

/**
 * Merge user config over the defaults and reject unusable values.
 * @param raw - the row's `config` object, or undefined.
 * @returns the normalized config.
 */
function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === "object" ? raw : {};
  const routePath = typeof config.routePath === "string" && config.routePath.length > 0
    ? (config.routePath.startsWith("/") ? config.routePath : `/${config.routePath}`)
    : DEFAULT_ROUTE_PATH;
  const baseUrl = typeof config.baseUrl === "string" && config.baseUrl.length > 0
    ? config.baseUrl.replace(/\/+$/, "")
    : DEFAULT_BASE_URL;
  const used = new Set();
  const configured = Array.isArray(config.accounts)
    ? config.accounts.slice(0, MAX_ACCOUNTS).map((entry, index) => normalizeAccount(entry, index, used))
    : [];
  /* No `accounts` keeps the historical single-key behavior, including the
     `apiKeyRef` override. */
  const accounts = configured.length > 0
    ? configured
    : [normalizeAccount({ apiKeyRef: config.apiKeyRef }, 0, used)];
  const tracking = config.trackDailySpend !== false;
  const configuredLedger = typeof config.ledgerPath === "string" && config.ledgerPath.length > 0
    ? config.ledgerPath
    : undefined;
  return {
    accounts,
    baseUrl,
    routePath,
    /* `cacheMs: 0` disables caching entirely; anything else must be positive. */
    cacheMs: typeof config.cacheMs === "number" && Number.isFinite(config.cacheMs) && config.cacheMs >= 0
      ? config.cacheMs
      : DEFAULT_CACHE_MS,
    timeoutMs: positiveNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS),
    allowHtml: config.allowHtml !== false,
    /* Today's spend needs samples even while no browser is polling. */
    sampleMs: typeof config.sampleMs === "number" && Number.isFinite(config.sampleMs) && config.sampleMs >= 0
      ? config.sampleMs
      : DEFAULT_SAMPLE_MS,
    ledgerPath: tracking === false ? null : (configuredLedger ?? join(resolveHarnessHome(), LEDGER_FILENAME)),
  };
}

/**
 * The composition layer the Plugins settings panel shows for this plugin: the
 * values the loader row configured, in the shape the namespace schema declares.
 * A user override in the panel is layered over this and re-resolved live.
 * @param config - the normalized effective configuration.
 * @returns the namespace's base value.
 */
function settingsEntryOf(config) {
  return {
    /* With several `accounts` configured the reference below is unused, so the
       panel shows the historical default rather than naming one of them. */
    apiKeyRef: config.accounts.length === 1 ? config.accounts[0].apiKeyRef : DEFAULT_KEY_REF,
    trackDailySpend: config.ledgerPath !== null,
    cacheMs: config.cacheMs,
    timeoutMs: config.timeoutMs,
    sampleMs: config.sampleMs,
  };
}

/**
 * Build this plugin's user-editable settings schema.
 *
 * The module arrives as an argument so the host half keeps loading (and the
 * balance keeps working) on deployments where `@deepseek-ai/schemastery` is not
 * resolvable: only the configuration card is lost there.
 * @param z - the schemastery module.
 * @returns the namespace schema.
 */
export function buildSettingsSchema(z) {
  return z.object({
    apiKeyRef: z.string().default(DEFAULT_KEY_REF),
    trackDailySpend: z.boolean().default(true),
    cacheMs: z.number().step(1).min(0).default(DEFAULT_CACHE_MS),
    timeoutMs: z.number().step(1).min(1000).default(DEFAULT_TIMEOUT_MS),
    sampleMs: z.number().step(1).min(0).default(DEFAULT_SAMPLE_MS),
  });
}

/**
 * Attach this plugin's settings section to a settings provider, wiring every
 * resolved section (attach, detach, and each commit) back into the running
 * plugin.
 *
 * Split out of {@link apply} so the wiring is testable with a stub schema
 * factory: the real schema needs `@deepseek-ai/schemastery`.
 * @param owner - this plugin's context, whose unload restores the base layer.
 * @param ctx - a context carrying the `settings` provider.
 * @param entry - the composition layer (`settingsEntryOf`).
 * @param onChange - receives each resolved section.
 * @param makeSchema - builds the namespace schema.
 * @returns the active value source, or null when no schema could be built.
 */
export function installSettingsSection(owner, ctx, entry, onChange, makeSchema) {
  let schema;
  try {
    schema = makeSchema();
  } catch (error) {
    owner.logger?.warn?.("deepseek-balance: settings schema failed (%s)", String(error?.message ?? error));
    return null;
  }
  if (schema === null || schema === undefined) return null;
  let source = () => entry;
  ctx.settings.installSection(owner, SETTINGS_NAMESPACE, schema, entry, {
    setSource: (current) => {
      source = current;
    },
    onChange: () => {
      onChange(source());
    },
  });
  return source;
}

/**
 * Load the schemastery module for the settings schema. Deliberately dynamic: a
 * `link:` install from a checkout without `node_modules` cannot resolve it, and
 * that must cost the panel card only — never the plugin.
 * @returns the module, or null when it cannot be imported.
 */
async function loadSchemastery() {
  try {
    const loaded = await import("@deepseek-ai/schemastery");
    return loaded?.default ?? loaded ?? null;
  } catch {
    return null;
  }
}

/**
 * The harness home whose ledger file this plugin owns.
 * @returns the absolute harness home path.
 */
function resolveHarnessHome() {
  const configured = process.env.DSH_HOME;
  return typeof configured === "string" && configured.length > 0 ? configured : join(homedir(), ".dsh");
}

/**
 * The local calendar day a moment belongs to, as `YYYY-MM-DD`.
 * @param now - the moment to classify.
 * @returns the local date key.
 */
function localDateKey(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Convert an upstream decimal string to integer hundredths, so accumulation
 * never drifts in binary floating point.
 * @param value - a decimal string such as `"26.96"`.
 * @returns the amount in hundredths, or undefined when unparseable.
 */
function toCents(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

/**
 * Render integer hundredths back as an upstream-style decimal string.
 * @param cents - the amount in hundredths.
 * @returns a two-decimal string.
 */
function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Render one upstream amount as a decimal string, defaulting to `"0.00"`.
 * @param value - the upstream field.
 * @returns a non-empty decimal string.
 */
function decimal(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "0.00";
}

/**
 * Normalize the official balance payload into the shape the browser consumes.
 * The upstream schema is `{ is_available, balance_infos: [{ currency,
 * total_balance, granted_balance, topped_up_balance }] }`, with amounts as
 * decimal strings.
 * @param account - the account this reading belongs to.
 * @param payload - parsed upstream JSON.
 * @param context - facts about how the value was obtained.
 * @returns the normalized reading (never throws on a partial payload).
 */
function normalizePayload(account, payload, context) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  const balances = infos.map((info) => ({
    currency: typeof info?.currency === "string" ? info.currency : "",
    total: decimal(info?.total_balance),
    granted: decimal(info?.granted_balance),
    toppedUp: decimal(info?.topped_up_balance),
  }));
  return {
    id: account.id,
    label: account.label,
    ok: true,
    fetchedAt: new Date().toISOString(),
    cached: false,
    available: payload?.is_available !== false,
    primary: balances.length > 0 ? balances[0] : null,
    balances,
    keyRef: account.apiKeyRef,
    keySource: context.keySource,
  };
}

/**
 * Build one account's failure reading.
 * @param account - the account this reading belongs to.
 * @param code - stable machine code for the client.
 * @param message - human-readable detail (never contains the API key).
 * @returns the failure reading.
 */
function failure(account, code, message) {
  return {
    id: account.id,
    label: account.label,
    ok: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    keyRef: account.apiKeyRef,
    error: { code, message },
  };
}

/**
 * The persisted daily-spend ledger: one entry per `(account, currency)`
 * holding the local day it belongs to, the hundredths accumulated that day,
 * and the last observed total used as the next baseline.
 *
 * The fold is deliberately one-sided: only a DROP in the total counts as
 * spend, so a top-up or a fresh grant (a rise) can never be mistaken for
 * negative consumption, and a later drop is still attributed correctly.
 *
 * The write is throttled and atomic (scratch file plus rename) so a 30s client
 * poll cannot thrash the disk, and a crash cannot leave a torn document.
 * @param ledgerPath - absolute file path, or null to disable tracking.
 * @param logger - optional cordis logger for non-fatal diagnostics.
 * @returns `{ observe, flush }`.
 */
function createLedger(ledgerPath, logger) {
  let state = { version: 1, accounts: {} };
  let dirty = false;
  let lastWriteAt = 0;

  /** Replace the in-memory state with the persisted document, when readable. */
  function load() {
    if (ledgerPath === null) return;
    try {
      const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
      const accounts = parsed?.accounts;
      if (accounts !== null && typeof accounts === "object" && Array.isArray(accounts) === false) {
        state = { version: 1, accounts };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logger?.warn?.("deepseek-balance: ignoring an unreadable ledger at %s (%s)", ledgerPath, String(error?.message ?? error));
      }
    }
  }

  /**
   * Persist the ledger.
   * @param force - write even when the throttle window has not elapsed; the
   *   caller sets it for a recorded drop, for disposal, and for process exit.
   */
  function flush(force) {
    if (ledgerPath === null || dirty !== true) return;
    const now = Date.now();
    if (force !== true && now - lastWriteAt < LEDGER_WRITE_INTERVAL_MS) return;
    try {
      mkdirSync(dirname(ledgerPath), { recursive: true });
      const scratch = `${ledgerPath}.tmp`;
      writeFileSync(scratch, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(scratch, ledgerPath);
      dirty = false;
      lastWriteAt = now;
    } catch (error) {
      logger?.warn?.("deepseek-balance: cannot persist the ledger to %s (%s)", ledgerPath, String(error?.message ?? error));
    }
  }

  /**
   * Fold one fresh reading into the ledger: roll the day over, add any drop
   * from the previous total, then make this total the next baseline.
   * @param accountId - the configured account id.
   * @param balances - the reading's balance rows.
   * @param now - the observation instant.
   * @returns today's spend in hundredths per currency.
   */
  function observe(accountId, balances, now) {
    const spent = new Map();
    if (ledgerPath === null) return spent;
    const date = localDateKey(now ?? new Date());
    let changed = false;
    /* A recorded drop is the whole point of the ledger, so it is persisted
       immediately. Only baseline-only updates ride the throttle: losing one of
       those is self-healing (the next read re-derives the drop from the last
       flushed baseline), while losing a drop that a top-up then hid would not be. */
    let dropped = false;
    for (const balance of balances ?? []) {
      const totalCents = toCents(balance.total);
      if (totalCents === undefined) continue;
      const key = `${accountId}|${balance.currency}`;
      const stored = state.accounts[key];
      const isNew = stored === null || typeof stored !== "object";
      /* A fresh baseline is itself worth persisting: without it a restart
         before the first drop would re-baseline lower and lose that drop. */
      const entry = isNew ? { date, spentCents: 0, lastTotalCents: totalCents } : stored;
      if (isNew) changed = true;
      if (entry.date !== date) {
        entry.date = date;
        entry.spentCents = 0;
        changed = true;
      }
      const previous = Number.isFinite(entry.lastTotalCents) ? entry.lastTotalCents : totalCents;
      const drop = previous - totalCents;
      if (drop > 0) {
        entry.spentCents = (Number.isFinite(entry.spentCents) ? entry.spentCents : 0) + drop;
        changed = true;
        dropped = true;
      }
      if (previous !== totalCents || Number.isFinite(entry.lastTotalCents) === false) {
        entry.lastTotalCents = totalCents;
        changed = true;
      }
      state.accounts[key] = entry;
      spent.set(balance.currency, entry.spentCents);
    }
    if (changed) {
      dirty = true;
      flush(dropped);
    }
    return spent;
  }

  load();
  return { observe, flush };
}

/**
 * Plugin body: own a cached reading per account and one HTTP route.
 * @param ctx - cordis context carrying `credentials` and `webServer`.
 * @param rawConfig - the row's `config` object.
 */
export function apply(ctx, rawConfig) {
  const loaderConfig = rawConfig !== null && typeof rawConfig === "object" ? rawConfig : {};
  /* `let`: the settings panel re-resolves this live, and every reader below
     closes over the binding, so a commit is visible without a restart. */
  let config = normalizeConfig(loaderConfig);
  let ledger = createLedger(config.ledgerPath, ctx.logger);
  /** id -> last successful reading. */
  const cache = new Map();
  /** id -> in-flight read shared by concurrent callers. */
  const inflight = new Map();

  /**
   * Read one account, honoring the cache unless `force` is set. Concurrent
   * callers share one upstream request.
   * @param account - the configured account.
   * @param force - bypass the cache and read upstream again.
   * @returns the normalized reading (success or failure).
   */
  async function queryAccount(account, force) {
    if (force !== true) {
      const hit = cache.get(account.id);
      if (hit !== undefined && Date.now() - hit.at < config.cacheMs) {
        return { ...hit.reading, cached: true };
      }
      const pending = inflight.get(account.id);
      if (pending !== undefined) return pending;
    }
    const read = readUpstream(account).then((reading) => {
      if (reading.ok === true) cache.set(account.id, { reading, at: Date.now() });
      return reading;
    }).finally(() => {
      if (inflight.get(account.id) === read) inflight.delete(account.id);
    });
    if (force !== true) inflight.set(account.id, read);
    return read;
  }

  /**
   * Resolve one account's key and call the official balance endpoint once.
   * @param account - the configured account.
   * @returns the normalized reading.
   */
  async function readUpstream(account) {
    let resolved;
    try {
      resolved = await ctx.credentials.resolve(account.apiKeyRef);
    } catch (error) {
      return failure(account, "credential-error", String(error?.message ?? error));
    }
    if (resolved === undefined || typeof resolved.value !== "string" || resolved.value.length === 0) {
      return failure(
        account,
        "no-credential",
        `credential "${account.apiKeyRef}" is not configured (set it on the Models settings page or in $DSH_HOME/.credentials.yaml)`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(new URL("/user/balance", config.baseUrl), {
        method: "GET",
        headers: {
          authorization: `Bearer ${resolved.value}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        return failure(account, `http-${String(response.status)}`, text.slice(0, MAX_ERROR_BYTES));
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return failure(account, "bad-json", `upstream returned non-JSON (${String(text.length)} bytes)`);
      }
      const reading = normalizePayload(account, payload, { keySource: resolved.source });
      const observedAt = new Date();
      const spent = ledger.observe(account.id, reading.balances, observedAt);
      if (config.ledgerPath !== null) {
        for (const balance of reading.balances) {
          const cents = spent.get(balance.currency);
          if (cents !== undefined) balance.spentToday = fromCents(cents);
        }
        reading.spentToday = reading.balances.length > 0 ? reading.balances[0].spentToday : undefined;
        reading.spentDate = localDateKey(observedAt);
      }
      return reading;
    } catch (error) {
      if (error?.name === "AbortError") {
        return failure(account, "timeout", `no answer within ${String(config.timeoutMs)}ms`);
      }
      return failure(account, "network", String(error?.message ?? error));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read every configured account in parallel and fold them into one payload.
   * `ok` means at least one account answered; `partial` means at least one
   * failed while another succeeded. The top-level `primary`/`balances`/`keyRef`
   * mirror the first successful account so single-account consumers and older
   * clients keep working unchanged.
   * @param force - bypass every account's cache.
   * @returns the aggregate payload.
   */
  async function query(force) {
    const accounts = await Promise.all(config.accounts.map((account) => queryAccount(account, force)));
    const succeeded = accounts.filter((account) => account.ok === true);
    const first = succeeded.length > 0 ? succeeded[0] : undefined;
    const payload = {
      ok: succeeded.length > 0,
      partial: succeeded.length > 0 && succeeded.length < accounts.length,
      fetchedAt: new Date().toISOString(),
      cached: accounts.length > 0 && accounts.every((account) => account.cached === true),
      accounts,
      primary: first === undefined ? null : first.primary,
      balances: first === undefined ? [] : first.balances,
      keyRef: first === undefined ? config.accounts[0]?.apiKeyRef : first.keyRef,
      keySource: first === undefined ? undefined : first.keySource,
      spentToday: first === undefined ? undefined : first.spentToday,
      spentDate: first === undefined ? undefined : first.spentDate,
    };
    if (succeeded.length === 0) {
      payload.error = accounts[0]?.error ?? { code: "no-accounts", message: "no accounts configured" };
    }
    return payload;
  }

  const disposeRoute = ctx.webServer.register({
    kind: "exact",
    path: config.routePath,
    /**
     * Answer the balance route. `?force=1` bypasses every cache; a browser
     * navigation (Accept: text/html) gets a small card instead of JSON.
     * @param req - the HTTP request.
     * @param res - the HTTP response, owned for its whole lifecycle.
     */
    handler: async (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
        res.end("method not allowed");
        return;
      }
      /* Defense in depth on top of the harness trust fence: a page on another
         origin must not be able to drive this route even though it cannot read
         the response without CORS. */
      const fetchSite = req.headers["sec-fetch-site"];
      if (typeof fetchSite === "string" && fetchSite.toLowerCase() === "cross-site") {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("cross-site request refused");
        return;
      }
      let force = false;
      try {
        const url = new URL(req.url ?? config.routePath, "http://127.0.0.1");
        force = url.searchParams.get("force") === "1";
      } catch {
        force = false;
      }
      const result = await query(force);
      const wantsHtml = config.allowHtml
        && typeof req.headers.accept === "string"
        && req.headers.accept.includes("text/html");
      const body = wantsHtml ? renderHtml(result, config) : JSON.stringify(result, null, 2);
      const type = wantsHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8";
      res.writeHead(result.ok === true ? 200 : 503, {
        "content-type": type,
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    },
  });
  ctx.effect(() => disposeRoute, "deepseek-balance: route");

  /** No-browser sampler for the current `sampleMs`, or null when disabled. */
  let sampler = null;
  /** (Re)start the background sampler for the effective `sampleMs`. */
  function restartSampler() {
    if (sampler !== null) {
      clearInterval(sampler);
      sampler = null;
    }
    if (!(config.sampleMs > 0)) return;
    sampler = setInterval(() => {
      query(false).catch((error) => {
        ctx.logger?.warn?.("deepseek-balance: background sample failed (%s)", String(error?.message ?? error));
      });
    }, config.sampleMs);
    sampler.unref?.();
  }
  ctx.effect(() => () => {
    if (sampler !== null) {
      clearInterval(sampler);
      sampler = null;
    }
  }, "deepseek-balance: background sampler");
  restartSampler();

  /**
   * Re-resolve the effective configuration after a settings commit, or after
   * the detach that restores the loader row, and rebuild whatever captured the
   * old values: the daily-spend ledger and the sampler cadence. Everything else
   * (`cacheMs`, `timeoutMs`, `accounts`, `apiKeyRef`, `baseUrl`, `allowHtml`)
   * is read through `config` at use time and needs no rebuild.
   * @param merged - loader config overlaid with the resolved settings section.
   */
  function applySettings(merged) {
    const previous = config;
    config = normalizeConfig(merged);
    /* Readings carry `spentToday` derived from the old ledger, and an account
       whose reference changed must not serve the previous key's reading. */
    const accountsChanged = JSON.stringify(previous.accounts) !== JSON.stringify(config.accounts);
    if (previous.ledgerPath !== config.ledgerPath) {
      ledger.flush(true);
      ledger = createLedger(config.ledgerPath, ctx.logger);
    }
    if (accountsChanged || previous.ledgerPath !== config.ledgerPath) cache.clear();
    if (previous.sampleMs !== config.sampleMs) restartSampler();
    ctx.logger?.info?.(
      "deepseek-balance: settings applied (cache %dms, sample %dms, ledger %s)",
      config.cacheMs,
      config.sampleMs,
      config.ledgerPath ?? "off",
    );
  }

  /* The plugin card in Settings -> Plugins is optional and lives behind two
     seams: a composed settings provider and a resolvable schemastery. Both are
     checked before anything registers, so a deployment with neither keeps the
     balance UI exactly as it is today. */
  ctx.inject?.(["settings"], (settingsCtx) => {
    loadSchemastery().then((z) => {
      if (z === null) {
        ctx.logger?.warn?.("deepseek-balance: @deepseek-ai/schemastery is unavailable; the settings card is skipped");
        return;
      }
      installSettingsSection(
        ctx,
        settingsCtx,
        settingsEntryOf(config),
        (section) => applySettings({ ...loaderConfig, ...section }),
        () => buildSettingsSchema(z),
      );
    }).catch((error) => {
      ctx.logger?.warn?.("deepseek-balance: settings section unavailable (%s)", String(error?.message ?? error));
    });
  });

  ctx.effect(() => {
    /* Two shutdown paths: unloading the fiber (profile reload) disposes the
       effect, and a process exit — including Ctrl-C — runs the `exit` hook.
       Both force the throttled write out, so at most the current window is at risk. */
    const onExit = () => ledger.flush(true);
    process.once("exit", onExit);
    return () => {
      process.off("exit", onExit);
      ledger.flush(true);
    };
  }, "deepseek-balance: ledger flush");

  ctx.logger?.info?.(
    "deepseek-balance: serving %s for %d account(s) [%s] (cache %dms, sample %dms, ledger %s)",
    config.routePath,
    config.accounts.length,
    config.accounts.map((account) => account.apiKeyRef).join(", "),
    config.cacheMs,
    config.sampleMs,
    config.ledgerPath ?? "off",
  );
}

/**
 * Format one amount for display.
 * @param currency - ISO currency code from upstream.
 * @param amount - decimal string.
 * @returns a display string such as `¥32.30`.
 */
function formatAmount(currency, amount) {
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  return symbol.length > 0 ? `${symbol}${amount}` : `${amount} ${currency}`.trim();
}

/**
 * Render the standalone HTML card used for a browser navigation.
 * @param result - the aggregate payload.
 * @param config - the normalized plugin config.
 * @returns a complete HTML document.
 */
function renderHtml(result, config) {
  const summary = result.ok === true && result.primary !== null
    ? escapeHtml(formatAmount(result.primary.currency, result.primary.total))
    : "unavailable";
  const sections = (result.accounts ?? []).map((account) => {
    const name = escapeHtml(account.label.length > 0 ? account.label : account.keyRef);
    if (account.ok !== true) {
      return `<section><h2>${name}</h2><p class="meta error">${escapeHtml(account.error?.code ?? "error")}: ${escapeHtml(account.error?.message ?? "")}</p></section>`;
    }
    const rows = (account.balances ?? []).map((balance) => `
      <tr>
        <td>${escapeHtml(balance.currency)}</td>
        <td class="amount">${escapeHtml(formatAmount(balance.currency, balance.total))}</td>
        <td>${escapeHtml(balance.granted)}</td>
        <td>${escapeHtml(balance.toppedUp)}</td>
      </tr>`).join("");
    return `<section>
      <h2>${name}</h2>
      ${account.available === false ? `<p class="meta error">${"unavailable"}</p>` : ""}
      <table>
        <thead><tr><th>币种 currency</th><th>总余额 total</th><th>赠金 granted</th><th>充值 topped up</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${account.spentToday === undefined ? "" : `<p class="meta">今日消耗 spent today: ${escapeHtml(account.spentToday)} ${escapeHtml(account.primary?.currency ?? "")}（自 ${escapeHtml(account.spentDate ?? "?")} 起按观测到的余额下降累计，非官方账单）</p>`}
      <p class="meta">${escapeHtml(account.keyRef)}/${escapeHtml(account.keySource ?? "?")} · ${escapeHtml(account.fetchedAt)}${account.cached === true ? " (cached)" : ""}</p>
    </section>`;
  }).join("");
  const detail = result.ok === true
    ? ""
    : `<p class="meta error">${escapeHtml(result.error?.code ?? "error")}: ${escapeHtml(result.error?.message ?? "")}</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek 余额</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 16px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; justify-content: center; }
  main { width: min(620px, 100%); }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; opacity: .7; }
  .total { font-size: 44px; font-weight: 650; letter-spacing: -.02em; margin: 0 0 20px; }
  section { margin-top: 22px; }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 6px; opacity: .8; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(128,128,128,.25); }
  th { font-weight: 500; opacity: .6; font-size: 12px; }
  td.amount { font-variant-numeric: tabular-nums; font-weight: 600; }
  .meta { opacity: .6; font-size: 12px; margin: 6px 0 0; }
  .meta.error { opacity: 1; color: #c0392b; }
  form { margin-top: 24px; }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>DeepSeek 余额 / balance</h1>
  <p class="total">${summary}</p>
  ${sections}
  ${detail}
  <form method="get"><input type="hidden" name="force" value="1"><button type="submit">刷新 Refresh</button></form>
</main>
</body>
</html>`;
}

/**
 * Escape one string for HTML text/attribute context.
 * @param value - raw value.
 * @returns the escaped string.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
