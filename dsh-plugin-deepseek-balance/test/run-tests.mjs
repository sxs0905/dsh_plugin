/**
 * Local verification for dsh-plugin-deepseek-balance.
 *
 * Runs with no test framework: `node test/run-tests.mjs`. Every case is
 * hermetic (a local fake balance endpoint), except the optional `--live` case,
 * which reads the real credential from $DSH_HOME and calls the real API.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let passed = 0;
let failed = 0;

/**
 * Record one assertion.
 * @param label - what was checked.
 * @param ok - whether it held.
 * @param detail - optional extra context.
 */
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}\n`);
  }
}

/**
 * Start a fake balance endpoint.
 * @param handler - `(req, res) => void`.
 * @returns the origin plus a close function.
 */
async function startUpstream(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Build the minimal cordis-shaped context the host half needs.
 * @param overrides - per-case replacements.
 * @returns `{ ctx, routes, disposers, resolveCalls }`.
 */
function makeCtx(overrides = {}) {
  const routes = [];
  const disposers = [];
  const effects = [];
  const resolveCalls = [];
  const injectCalls = [];
  const hasCredentialOverride = Object.prototype.hasOwnProperty.call(overrides, "credential");
  const ctx = {
    credentials: {
      resolve: async (ref) => {
        resolveCalls.push(ref);
        if (typeof overrides.resolve === "function") return overrides.resolve(ref);
        return hasCredentialOverride
          ? overrides.credential
          : { value: "sk-test-key", source: "file" };
      },
    },
    webServer: {
      register: (route) => {
        routes.push(route);
        const dispose = () => {
          const at = routes.indexOf(route);
          if (at >= 0) routes.splice(at, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
    },
    effect: (callback) => {
      effects.push(callback);
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    logger: { info: () => {}, warn: () => {} },
    /* Cordis hands an optional service consumer a derived context once the
       service exists; the stub answers for the two seams this plugin uses:
       `settings` (host) and `settingsScope` (browser). */
    inject: (deps, callback) => {
      const wanted = Array.isArray(deps) ? deps : [deps];
      injectCalls.push(wanted);
      if (wanted.includes("settings") && overrides.settings !== undefined) {
        callback({ ...ctx, settings: overrides.settings });
      }
      if (wanted.includes("settingsScope") && overrides.settingsScope !== undefined) {
        callback({ ...ctx, settingsScope: overrides.settingsScope });
      }
    },
  };
  return { ctx, routes, disposers, effects, resolveCalls, injectCalls };
}

/**
 * Invoke one captured route handler with a fake request/response pair.
 * @param route - the registered `WebRoute`.
 * @param options - method, url, and headers.
 * @returns `{ status, headers, body }`.
 */
async function callRoute(route, options = {}) {
  const req = {
    method: options.method ?? "GET",
    url: options.url ?? "/deepseek-balance",
    headers: options.headers ?? {},
  };
  let status = 0;
  let headers = {};
  let body = "";
  const res = {
    writeHead: (code, nextHeaders) => {
      status = code;
      headers = nextHeaders ?? {};
    },
    end: (chunk) => {
      if (typeof chunk === "string") body = chunk;
      else if (Buffer.isBuffer(chunk)) body = chunk.toString("utf8");
    },
  };
  await route.handler(req, res);
  return { status, headers, body };
}

/** The upstream success payload the real API returns. */
const SUCCESS = JSON.stringify({
  is_available: true,
  balance_infos: [
    { currency: "CNY", total_balance: "32.30", granted_balance: "0.00", topped_up_balance: "32.30" },
  ],
});

//#region host half
const plugin = await import(pathToFileURL(join(ROOT, "lib/index.js")).href);

/* Host tests must never touch the real `$DSH_HOME` ledger, so every apply gets
   its own scratch file unless the case passes an explicit path. */
const LEDGER_DIR = mkdtempSync(join(tmpdir(), "dsh-balance-ledger-"));
let ledgerSeq = 0;
/**
 * Apply the plugin with a scratch ledger path by default.
 * @param ctx - the fake cordis context.
 * @param config - the row config, or undefined.
 */
function applyPlugin(ctx, config) {
  ledgerSeq += 1;
  const merged = { ...(config ?? {}) };
  if (Object.prototype.hasOwnProperty.call(merged, "ledgerPath") === false) {
    merged.ledgerPath = join(LEDGER_DIR, `ledger-${String(ledgerSeq)}.json`);
  }
  plugin.apply(ctx, merged);
}

process.stdout.write("host half — exports\n");
check("exports apply", typeof plugin.apply === "function");
check("exports inject", Array.isArray(plugin.inject) && plugin.inject.includes("credentials") && plugin.inject.includes("webServer"));
check("exports name", plugin.name === "deepseek-balance");

process.stdout.write("host half — success path\n");
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 60_000 });
  check("registers one route", routes.length === 1, `got ${String(routes.length)}`);
  check("route path default", routes[0]?.path === "/deepseek-balance");
  check("route kind exact", routes[0]?.kind === "exact");

  const first = await callRoute(routes[0]);
  check("status 200", first.status === 200, `got ${String(first.status)}`);
  check("content-type json", String(first.headers["content-type"]).startsWith("application/json"));
  const payload = JSON.parse(first.body);
  check("ok true", payload.ok === true);
  check("primary total", payload.primary?.total === "32.30", JSON.stringify(payload.primary));
  check("primary currency", payload.primary?.currency === "CNY");
  check("granted parsed", payload.primary?.granted === "0.00");
  check("key source reported", payload.keySource === "file");
  check("key ref reported", payload.keyRef === "DEEPSEEK_API_KEY");
  check("cached false on first read", payload.cached === false);

  const second = await callRoute(routes[0]);
  check("second read served from cache", JSON.parse(second.body).cached === true);

  const forced = await callRoute(routes[0], { url: "/deepseek-balance?force=1" });
  check("force bypasses cache", JSON.parse(forced.body).cached === false);

  await upstream.close();
}

process.stdout.write("host half — cache expiry\n");
{
  let calls = 0;
  const upstream = await startUpstream((_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 20 });
  await callRoute(routes[0]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await callRoute(routes[0]);
  check("re-reads after cache expiry", calls === 2, `upstream calls ${String(calls)}`);
  await upstream.close();
}

process.stdout.write("host half — failure paths\n");
{
  const { ctx, routes } = makeCtx({ credential: undefined });
  applyPlugin(ctx, { baseUrl: "http://127.0.0.1:1" });
  const result = await callRoute(routes[0]);
  const payload = JSON.parse(result.body);
  check("missing credential is 503", result.status === 503, `got ${String(result.status)}`);
  check("missing credential code", payload.error?.code === "no-credential", JSON.stringify(payload.error));
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":"Authentication Fails"}');
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("401 surfaces as http-401", payload.error?.code === "http-401", JSON.stringify(payload.error));
  await upstream.close();
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json");
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("non-JSON surfaces as bad-json", payload.error?.code === "bad-json");
  await upstream.close();
}
{
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: "http://127.0.0.1:1", timeoutMs: 300 });
  const started = Date.now();
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("unreachable host fails fast", payload.ok === false && Date.now() - started < 5000, `${String(Date.now() - started)}ms`);
  check("unreachable host is network error", payload.error?.code === "network", JSON.stringify(payload.error));
}

process.stdout.write("host half — request hygiene\n");
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin });
  const post = await callRoute(routes[0], { method: "POST" });
  check("POST is 405", post.status === 405, `got ${String(post.status)}`);
  const crossSite = await callRoute(routes[0], { headers: { "sec-fetch-site": "cross-site" } });
  check("cross-site request is 403", crossSite.status === 403, `got ${String(crossSite.status)}`);
  const sameOrigin = await callRoute(routes[0], { headers: { "sec-fetch-site": "same-origin" } });
  check("same-origin request is 200", sameOrigin.status === 200, `got ${String(sameOrigin.status)}`);
  const head = await callRoute(routes[0], { method: "HEAD" });
  check("HEAD is 200 with empty body", head.status === 200 && head.body === "");
  check("no-store cache header", head.headers["cache-control"] === "no-store");
  const html = await callRoute(routes[0], { headers: { accept: "text/html" } });
  check("HTML view for browsers", String(html.headers["content-type"]).startsWith("text/html"));
  check("HTML view shows amount", html.body.includes("\u00a532.30"), "expected ¥32.30 in HTML");
  check("HTML view does not leak the key", !html.body.includes("sk-test-key"));
  await upstream.close();
}

process.stdout.write("host half — config\n");
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, routePath: "custom-balance" });
  check("routePath gets a leading slash", routes[0]?.path === "/custom-balance", routes[0]?.path);
  await upstream.close();
}
{
  const { ctx, routes, effects, disposers } = makeCtx();
  applyPlugin(ctx, undefined);
  check("no config still registers", routes.length === 1);
  check("applies one effect per owned resource", effects.length === 3, `got ${String(effects.length)} (route, sampler, ledger flush)`);
  for (const dispose of disposers) dispose();
  check("disposer removes the route", routes.length === 0, `got ${String(routes.length)}`);
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes, resolveCalls } = makeCtx();
  applyPlugin(ctx, { apiKeyRef: "MY_CUSTOM_KEY", baseUrl: upstream.origin });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("honors a custom apiKeyRef", resolveCalls[0] === "MY_CUSTOM_KEY", resolveCalls[0]);
  check("reports the custom apiKeyRef", payload.keyRef === "MY_CUSTOM_KEY");
  await upstream.close();
}

process.stdout.write("host half — multiple accounts\n");
{
  const seen = [];
  const upstream = await startUpstream((req, res) => {
    const auth = String(req.headers.authorization);
    seen.push(auth);
    res.writeHead(200, { "content-type": "application/json" });
    const total = auth.endsWith("sk-a") ? "10.00" : "20.00";
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: total, granted_balance: "0.00", topped_up_balance: total }],
    }));
  });
  const { ctx, routes, resolveCalls } = makeCtx({
    resolve: (ref) => {
      if (ref === "KEY_A") return { value: "sk-a", source: "file" };
      if (ref === "KEY_B") return { value: "sk-b", source: "env" };
      return undefined;
    },
  });
  applyPlugin(ctx, {
    baseUrl: upstream.origin,
    accounts: [
      { id: "main", label: "主账号", apiKeyRef: "KEY_A" },
      { label: "备用", apiKeyRef: "KEY_B" },
    ],
  });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("both accounts are reported", payload.accounts?.length === 2, JSON.stringify(payload.accounts?.length));
  check("aggregate ok", payload.ok === true);
  check("aggregate not partial", payload.partial === false);
  check("labels preserved", payload.accounts[0].label === "主账号" && payload.accounts[1].label === "备用");
  check("explicit id honored", payload.accounts[0].id === "main", payload.accounts[0].id);
  check("id derived from the label", payload.accounts[1].id === "备用", payload.accounts[1].id);
  check(
    "each account reads its own key",
    payload.accounts[0].primary.total === "10.00" && payload.accounts[1].primary.total === "20.00",
    JSON.stringify(payload.accounts.map((account) => account.primary)),
  );
  check("both credentials resolved", resolveCalls.slice().sort().join(",") === "KEY_A,KEY_B", resolveCalls.join(","));
  check("key source is per account", payload.accounts[0].keySource === "file" && payload.accounts[1].keySource === "env");
  check("top level mirrors the first account", payload.keyRef === "KEY_A" && payload.primary.total === "10.00");
  check(
    "upstream saw both keys",
    seen.length === 2 && seen.some((value) => value.endsWith("sk-a")) && seen.some((value) => value.endsWith("sk-b")),
    seen.join(","),
  );
  const second = JSON.parse((await callRoute(routes[0])).body);
  check("multi-account read is cached", second.cached === true);
  check("no key value leaks into the payload", !JSON.stringify(payload).includes("sk-a") && !JSON.stringify(payload).includes("sk-b"));
  await upstream.close();
}
{
  const upstream = await startUpstream((req, res) => {
    if (String(req.headers.authorization).endsWith("sk-bad")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"Authentication Fails"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx({ resolve: (ref) => ({ value: ref === "KEY_BAD" ? "sk-bad" : "sk-ok", source: "file" }) });
  applyPlugin(ctx, {
    baseUrl: upstream.origin,
    accounts: [{ id: "ok", apiKeyRef: "KEY_OK" }, { id: "bad", apiKeyRef: "KEY_BAD" }],
  });
  const result = await callRoute(routes[0]);
  const payload = JSON.parse(result.body);
  check("partial failure still answers 200", result.status === 200, `HTTP ${String(result.status)}`);
  check("partial flag set", payload.partial === true && payload.ok === true);
  check("failing account carries its code", payload.accounts[1].error?.code === "http-401", JSON.stringify(payload.accounts[1].error));
  check("healthy account still reports", payload.accounts[0].ok === true && payload.accounts[0].primary.total === "32.30");
  await upstream.close();
}
{
  const { ctx, routes } = makeCtx({ resolve: () => undefined });
  applyPlugin(ctx, {
    baseUrl: "http://127.0.0.1:1",
    accounts: [{ id: "a", apiKeyRef: "K1" }, { id: "b", apiKeyRef: "K2" }],
  });
  const result = await callRoute(routes[0]);
  const payload = JSON.parse(result.body);
  check("all-failed answers 503", result.status === 503, `HTTP ${String(result.status)}`);
  check("all-failed ok is false", payload.ok === false);
  check("top-level error mirrors the first account", payload.error?.code === "no-credential", JSON.stringify(payload.error));
  check("every account is diagnosed", payload.accounts.every((account) => account.ok === false && account.error?.code === "no-credential"));
}
{
  let calls = 0;
  const upstream = await startUpstream((_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, {
    baseUrl: upstream.origin,
    cacheMs: 60_000,
    accounts: [{ id: "a", apiKeyRef: "KEY_A" }, { id: "b", apiKeyRef: "KEY_B" }],
  });
  await callRoute(routes[0]);
  await callRoute(routes[0], { url: "/deepseek-balance?force=1" });
  check("force refreshes every account", calls === 4, `upstream calls ${String(calls)}`);
  await upstream.close();
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("default is exactly one account", payload.accounts?.length === 1);
  check("default account id", payload.accounts[0].id === "account-1", payload.accounts[0].id);
  check("default key ref", payload.accounts[0].keyRef === "DEEPSEEK_API_KEY");
  const html = (await callRoute(routes[0], { headers: { accept: "text/html" } })).body;
  check("HTML lists the default account", html.includes("DEEPSEEK_API_KEY"));
  await upstream.close();
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, accounts: [{ label: "同名", apiKeyRef: "K1" }, { label: "同名", apiKeyRef: "K2" }] });
  const payload = JSON.parse((await callRoute(routes[0])).body);
  check("duplicate ids are deduped", payload.accounts[0].id !== payload.accounts[1].id, payload.accounts.map((account) => account.id).join(","));
  const html = (await callRoute(routes[0], { headers: { accept: "text/html" } })).body;
  check("HTML renders one section per account", (html.match(/<section>/g) ?? []).length === 2);
  await upstream.close();
}
//#endregion



process.stdout.write("host half — today's spend ledger\n");
/** The local day key, computed the same way the plugin does. */
function todayKey() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/**
 * Start an upstream whose single CNY total is read from a mutable cell.
 * @param state - `{ total }`, updated between reads.
 * @returns the upstream handle.
 */
async function startMutableUpstream(state) {
  return startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: state.total, granted_balance: "0.00", topped_up_balance: state.total }],
    }));
  });
}
{
  const state = { total: "40.00" };
  const upstream = await startMutableUpstream(state);
  const ledgerPath = join(LEDGER_DIR, "spend-basic.json");
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath, accounts: [{ id: "a", apiKeyRef: "K1" }] });

  const baseline = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("the first observation records no spend", baseline.accounts[0].spentToday === "0.00", String(baseline.accounts[0].spentToday));
  check("the first observation stamps today", baseline.accounts[0].spentDate === todayKey(), String(baseline.accounts[0].spentDate));

  state.total = "38.50";
  const second = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("a balance drop accumulates as spend", second.accounts[0].spentToday === "1.50", String(second.accounts[0].spentToday));
  check("the aggregate mirrors the spend", second.spentToday === "1.50" && second.spentDate === todayKey());

  state.total = "50.00";
  const toppedUp = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("a top-up never becomes negative spend", toppedUp.accounts[0].spentToday === "1.50", String(toppedUp.accounts[0].spentToday));

  state.total = "49.00";
  const resumed = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("spend resumes from the topped-up baseline", resumed.accounts[0].spentToday === "2.50", String(resumed.accounts[0].spentToday));
  check("the ledger file was written", existsSync(ledgerPath), ledgerPath);
  const html = (await callRoute(routes[0], { headers: { accept: "text/html" } })).body;
  check("HTML shows today's spend", html.includes("今日消耗"));
  await upstream.close();
}
{
  const state = { total: "10.00" };
  const upstream = await startMutableUpstream(state);
  const ledgerPath = join(LEDGER_DIR, "spend-persist.json");
  const first = makeCtx();
  applyPlugin(first.ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath });
  await callRoute(first.routes[0], { url: "/deepseek-balance?force=1" });
  state.total = "9.00";
  const mid = JSON.parse((await callRoute(first.routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("the first instance accumulates", mid.accounts[0].spentToday === "1.00", String(mid.accounts[0].spentToday));
  for (const dispose of first.disposers) dispose();

  const second = makeCtx();
  applyPlugin(second.ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath });
  state.total = "8.25";
  const after = JSON.parse((await callRoute(second.routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("spend survives a profile restart", after.accounts[0].spentToday === "1.75", String(after.accounts[0].spentToday));
  await upstream.close();
}
{
  const state = { total: "39.00" };
  const upstream = await startMutableUpstream(state);
  const ledgerPath = join(LEDGER_DIR, "spend-rollover.json");
  writeFileSync(ledgerPath, JSON.stringify({
    version: 1,
    accounts: { "a|CNY": { date: "2000-01-01", spentCents: 500, lastTotalCents: 4000 } },
  }), "utf8");
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath, accounts: [{ id: "a", apiKeyRef: "K1" }] });
  const payload = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("a new day resets the accumulator", payload.accounts[0].spentToday === "1.00", String(payload.accounts[0].spentToday));
  await upstream.close();
}
{
  const state = { total: "10.00" };
  const upstream = await startMutableUpstream(state);
  const { ctx, routes } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, trackDailySpend: false });
  await callRoute(routes[0], { url: "/deepseek-balance?force=1" });
  state.total = "9.00";
  const payload = JSON.parse((await callRoute(routes[0], { url: "/deepseek-balance?force=1" })).body);
  check("tracking off omits the spend field", payload.accounts[0].spentToday === undefined && payload.spentToday === undefined);
  await upstream.close();
}
{
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "10.00", granted_balance: "0.00", topped_up_balance: "10.00" },
        { currency: "USD", total_balance: "5.00", granted_balance: "0.00", topped_up_balance: "5.00" },
      ],
    }));
  });
  const multi = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "9.00", granted_balance: "0.00", topped_up_balance: "9.00" },
        { currency: "USD", total_balance: "5.00", granted_balance: "0.00", topped_up_balance: "5.00" },
      ],
    }));
  });
  const ledgerPath = join(LEDGER_DIR, "spend-currency.json");
  const ctx = makeCtx();
  applyPlugin(ctx.ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath });
  await callRoute(ctx.routes[0], { url: "/deepseek-balance?force=1" });
  for (const dispose of ctx.disposers) dispose();
  const moved = makeCtx();
  applyPlugin(moved.ctx, { baseUrl: multi.origin, cacheMs: 0, ledgerPath });
  const payload = JSON.parse((await callRoute(moved.routes[0], { url: "/deepseek-balance?force=1" })).body);
  check(
    "spend is tracked per currency",
    payload.accounts[0].balances[0].spentToday === "1.00" && payload.accounts[0].balances[1].spentToday === "0.00",
    JSON.stringify(payload.accounts[0].balances.map((entry) => entry.spentToday)),
  );
  await upstream.close();
  await multi.close();
}
{
  let calls = 0;
  const upstream = await startUpstream((_req, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, disposers } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, sampleMs: 25 });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const sampled = calls;
  check("the background sampler polls with no client", sampled >= 2, `${String(sampled)} upstream calls`);
  for (const dispose of disposers) dispose();
  /* Let any request the last tick already started settle before snapshotting. */
  await new Promise((resolve) => setTimeout(resolve, 60));
  const settled = calls;
  await new Promise((resolve) => setTimeout(resolve, 120));
  check("disposal stops the sampler", calls === settled, `${String(calls)} vs ${String(settled)} after ${String(sampled)} sampled`);
  await upstream.close();
}


{
  const state = { total: "20.00" };
  const upstream = await startMutableUpstream(state);
  const ledgerPath = join(LEDGER_DIR, "spend-exit.json");
  const before = process.listenerCount("exit");
  const { ctx, routes, disposers } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, ledgerPath });
  check("registers one process-exit flush hook", process.listenerCount("exit") === before + 1, `${String(process.listenerCount("exit"))} vs ${String(before)}`);
  await callRoute(routes[0], { url: "/deepseek-balance?force=1" });
  state.total = "19.00";
  await callRoute(routes[0], { url: "/deepseek-balance?force=1" });
  const immediate = JSON.parse(readFileSync(ledgerPath, "utf8"));
  check("a recorded drop is on disk immediately", immediate.accounts["account-1|CNY"].spentCents === 100, JSON.stringify(immediate.accounts));
  for (const dispose of disposers) dispose();
  check("dispose removes the exit hook", process.listenerCount("exit") === before, `${String(process.listenerCount("exit"))} vs ${String(before)}`);
  const persisted = JSON.parse(readFileSync(ledgerPath, "utf8"));
  check("the ledger survives disposal intact", persisted.accounts["account-1|CNY"].spentCents === 100, JSON.stringify(persisted.accounts));
  check("the persisted document is versioned", persisted.version === 1);
  check("the ledger keeps the last total as the next baseline", persisted.accounts["account-1|CNY"].lastTotalCents === 1900);
  await upstream.close();
}

//#region host half — settings section
process.stdout.write("host half — settings section\n");
const schemastery = (await import("@deepseek-ai/schemastery")).default;
check("schemastery resolves for the settings card", typeof schemastery?.object === "function");
{
  const schema = plugin.buildSettingsSchema(schemastery);
  const json = JSON.stringify(schema.toJSON());
  check("settings schema carries every card field", ["apiKeyRef", "trackDailySpend", "cacheMs", "timeoutMs", "sampleMs"].every((field) => json.includes(field)), json.slice(0, 200));
  check("settings schema defaults match the host defaults", json.includes("15000") && json.includes("10000") && json.includes("300000"), json.slice(0, 400));
  const resolved = schema({ cacheMs: 1500, trackDailySpend: false });
  check(
    "settings schema resolves overrides over defaults",
    resolved.cacheMs === 1500 && resolved.trackDailySpend === false && resolved.apiKeyRef === "DEEPSEEK_API_KEY",
    JSON.stringify(resolved),
  );
}
{
  /* The section is attached only where a settings provider is composed; the
     stub stands in for `ctx.settings`, so the wiring under test is ours. */
  const sections = [];
  const settings = {
    installSection: (owner, ns, schema, entry, hooks) => {
      sections.push({ owner, ns, schema, entry, hooks });
      hooks.setSource(() => schema(entry));
      hooks.onChange();
    },
  };
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const ledgerPath = join(LEDGER_DIR, "settings-live.json");
  const { ctx, routes } = makeCtx({ settings });
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 60_000, sampleMs: 0, ledgerPath });
  /* `apply` imports schemastery before it registers, so settle that turn. */
  for (let tick = 0; tick < 20 && sections.length === 0; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  check("registers one settings section", sections.length === 1, `got ${String(sections.length)}`);
  const section = sections[0];
  check("section namespace is the plugin namespace", section?.ns === "deepseek-balance", String(section?.ns));
  check(
    "section base mirrors the loader row",
    section?.entry?.cacheMs === 60_000 && section?.entry?.sampleMs === 0 && section?.entry?.trackDailySpend === true,
    JSON.stringify(section?.entry),
  );
  const resolveSection = (patch) => section.schema({ ...section.entry, ...patch });

  const first = await callRoute(routes[0]);
  const second = await callRoute(routes[0]);
  check("a reading inside the cache window is reused", JSON.parse(first.body).cached === false && JSON.parse(second.body).cached === true);

  /* A committed override re-applies live: cacheMs 0 must reach upstream again. */
  section.hooks.setSource(() => resolveSection({ cacheMs: 0 }));
  section.hooks.onChange();
  const third = await callRoute(routes[0]);
  check("a live commit drops the server cache", JSON.parse(third.body).cached === false, third.body.slice(0, 120));

  /* Turning the daily-spend ledger off stops deriving it, without a restart. */
  section.hooks.setSource(() => resolveSection({ cacheMs: 0, trackDailySpend: false }));
  section.hooks.onChange();
  const fourth = await callRoute(routes[0]);
  check("a live commit stops deriving today's spend", JSON.parse(fourth.body).spentToday === undefined, fourth.body.slice(0, 160));

  /* Detaching restores the composition layer: the loader row's cache window. */
  section.hooks.setSource(() => section.entry);
  section.hooks.onChange();
  await callRoute(routes[0]);
  const sixth = await callRoute(routes[0]);
  check("detaching restores the loader row's cache window", JSON.parse(sixth.body).cached === true, sixth.body.slice(0, 120));
  await upstream.close();
}
{
  /* A deployment with no settings provider keeps the plugin exactly as it was. */
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(SUCCESS);
  });
  const { ctx, routes, injectCalls } = makeCtx();
  applyPlugin(ctx, { baseUrl: upstream.origin, cacheMs: 0, sampleMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  check("the settings seam is attempted once", injectCalls.filter((deps) => deps.includes("settings")).length === 1, JSON.stringify(injectCalls));
  const result = await callRoute(routes[0]);
  check("the balance route still answers without settings", result.status === 200, `HTTP ${String(result.status)}`);
  await upstream.close();
}

//#region client half
process.stdout.write("client half — bundle contract\n");
const realFetch = globalThis.fetch;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
{
  let entry;
  globalThis.window = { __ModuleLoader__: { load: (value) => { entry = value; } } };
  await import(pathToFileURL(join(ROOT, "lib/client.js")).href);
  check("registers one module", entry !== undefined);
  check("module id matches package name", entry?.id === "dsh-plugin-deepseek-balance", entry?.id);
  check("factory is a function", typeof entry?.factory === "function");

  /* Minimal React hook runtime: cells persist across explicit re-renders, so a
     component that fetches from its effect can be rendered to a settled tree.
     Effects run synchronously and their cleanups are ignored.
     `cells` is swappable (`resetHooks`) so a test can give a component its own
     instance; setters capture the array they were created on, so a component's
     late async settlement can never land in another component's cells. */
  const hookRuntime = { cells: [], cursor: 0 };
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
    useState: (initial) => {
      const cells = hookRuntime.cells;
      const index = hookRuntime.cursor;
      hookRuntime.cursor += 1;
      /* React invokes a function initializer once, on the first render. */
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], (value) => {
        cells[index] = typeof value === "function" ? value(cells[index]) : value;
      }];
    },
    useRef: (initial) => {
      const cells = hookRuntime.cells;
      const index = hookRuntime.cursor;
      hookRuntime.cursor += 1;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect: (callback) => { callback(); },
    useCallback: (callback) => callback,
  };
  const render = (Component, props) => {
    hookRuntime.cursor = 0;
    return Component(props);
  };
  /** Give the next rendered component a fresh hook-cell array. */
  const resetHooks = () => {
    hookRuntime.cells = [];
    hookRuntime.cursor = 0;
    return hookRuntime.cells;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const requested = [];
  const exportsObject = entry.factory((specifier) => {
    requested.push(specifier);
    if (specifier === "react") return reactStub;
    throw new Error(`unexpected require: ${specifier}`);
  });
  check("requires only react", requested.length === 1 && requested[0] === "react", requested.join(", "));
  check("exports apply", typeof exportsObject.apply === "function");
  check("injects slots", exportsObject.inject?.includes("slots"));
  check("injects locale", exportsObject.inject?.includes("locale"));

  const registrations = [];
  const dictionaries = [];
  const fakeClientCtx = {
    effect: (callback) => { callback(); },
    locale: { register: (ns, dict) => { dictionaries.push([ns, dict]); } },
    slots: {
      inject: (name, callback) => { callback(); },
      register: (definition, component) => { registrations.push([definition, component]); },
    },
  };
  exportsObject.apply(fakeClientCtx);
  check("registers two seats", registrations.length === 2, `got ${String(registrations.length)}`);
  const slotNames = registrations.map(([definition]) => definition.name).sort();
  check(
    "seats are the composer dock and the sidebar footer",
    slotNames.join(",") === "conversation.composer.dock,sidebar.footer.action",
    slotNames.join(","),
  );
  check("both seats use the plugin id", registrations.every(([definition]) => definition.id === "deepseek-balance"));
  check("both seats order deterministically", registrations.every(([definition]) => typeof definition.order === "number"));
  const byVariant = {};
  for (const [definition, component] of registrations) {
    const injected = typeof definition.inject === "function" ? definition.inject() : {};
    byVariant[injected.variant] = { definition, component, injected };
  }
  check("dock seat injects variant=dock", byVariant.dock !== undefined && byVariant.dock.injected.variant === "dock");
  check("footer seat injects variant=footer", byVariant.footer !== undefined && byVariant.footer.injected.variant === "footer");
  check("dictionary namespace registered", dictionaries[0]?.[0] === "deepseek-balance");

  const [zhDict, enDict] = [dictionaries[0]?.[1]?.zh, dictionaries[0]?.[1]?.en];
  const zhKeys = Object.keys(zhDict ?? {}).sort().join(",");
  const enKeys = Object.keys(enDict ?? {}).sort().join(",");
  check("zh/en key sets match", zhKeys.length > 0 && zhKeys === enKeys, `${zhKeys} vs ${enKeys}`);

  /* The dock row must share the stats line, which it does by lifting itself by
     the measured offset. The geometry is pure, so it is tested directly. */
  check("exports computeLift", typeof exportsObject.computeLift === "function");
  check("exports measureLift", typeof exportsObject.measureLift === "function");
  check("lift equals the offset to the stats text top", exportsObject.computeLift({ top: 100 }, { top: 76 }, 4) === 20, String(exportsObject.computeLift({ top: 100 }, { top: 76 }, 4)));
  check("lift clamps a row already above the stats line", exportsObject.computeLift({ top: 60 }, { top: 76 }, 4) === 0);
  check("lift tolerates a missing stats padding", exportsObject.computeLift({ top: 100 }, { top: 76 }, Number.NaN) === 24);
  check("lift is zero without a stats rect", exportsObject.computeLift({ top: 100 }, null, 4) === 0);
  check("lift is zero without a root rect", exportsObject.computeLift(null, { top: 76 }, 4) === 0);
  {
    const statsNode = { getBoundingClientRect: () => ({ top: 76 }) };
    const rootNode = { getBoundingClientRect: () => ({ top: 100 }) };
    globalThis.document = { querySelector: (selector) => (selector === "[data-composer-stats]" ? statsNode : null) };
    globalThis.window = { getComputedStyle: () => ({ paddingTop: "4px" }) };
    check("measureLift reads the live DOM", exportsObject.measureLift(rootNode) === 20, String(exportsObject.measureLift(rootNode)));
    globalThis.document = { querySelector: () => null };
    check("measureLift is zero when the stats row is absent", exportsObject.measureLift(rootNode) === 0);
    globalThis.document = { querySelector: () => statsNode };
    check("measureLift is zero without a root node", exportsObject.measureLift(null) === 0);
    check("measureLift survives a minimal DOM", exportsObject.measureLift({}) === 0);
  }
  /* Sharing the line must never mean covering it: the side is chosen from the
     measured free space, and a stats row wide enough to fill the band pushes
     this row onto its own line instead. */
  check("exports chooseSide", typeof exportsObject.chooseSide === "function");
  check("exports measureSide", typeof exportsObject.measureSide === "function");
  check("a roomy right side is preferred", exportsObject.chooseSide(0, 1000, 300, 600, 100) === "right");
  check("the left side is used when the right is tight", exportsObject.chooseSide(0, 1000, 300, 990, 100) === "left");
  check("neither side fitting falls back to its own line", exportsObject.chooseSide(0, 1000, 300, 660, 400) === "none");
  check("an unmeasurable row falls back to its own line", exportsObject.chooseSide(0, 1000, 300, 600, 0) === "none");
  check("non-finite geometry falls back to its own line", exportsObject.chooseSide(0, Number.NaN, 300, 600, 100) === "none");
  {
    const statsNode = { getBoundingClientRect: () => ({ left: 300, right: 600 }) };
    const rootNode = {
      getBoundingClientRect: () => ({ left: 0, right: 1000 }),
      children: [
        { getBoundingClientRect: () => ({ left: 700, right: 780 }) },
        { getBoundingClientRect: () => ({ left: 790, right: 820 }) },
      ],
    };
    const scope = {
      window: { getComputedStyle: () => ({ paddingLeft: "10px", paddingRight: "10px" }) },
      document: { querySelector: () => statsNode },
    };
    check("measureSide reads the live DOM", exportsObject.measureSide(rootNode, scope) === "right", String(exportsObject.measureSide(rootNode, scope)));
    check(
      "measureSide switches to the freer side",
      exportsObject.measureSide(rootNode, {
        ...scope,
        document: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 300, right: 985 }) }) },
      }) === "left",
    );
    check("measureSide falls back with no stats row", exportsObject.measureSide(rootNode, { ...scope, document: { querySelector: () => null } }) === "none");
    check(
      "measureSide falls back without measurable children",
      exportsObject.measureSide({ getBoundingClientRect: () => ({ left: 0, right: 1000 }) }, scope) === "none",
    );
    /* The stats box is a FULL-WIDTH, content-centred flex container, so its own
       rect spans the whole band however short the text is; measuring that rect
       reports "no room on either side" forever, which is what left the row
       overlaid on the stats text. The pills are its children: their union is
       the part this row must stay clear of. */
    const containerNode = {
      getBoundingClientRect: () => ({ left: 0, right: 1000 }),
      children: [
        { getBoundingClientRect: () => ({ left: 300, right: 450 }) },
        { getBoundingClientRect: () => ({ left: 462, right: 600 }) },
      ],
    };
    check(
      "measureSide measures the stats pills, not their full-width box",
      exportsObject.measureSide(rootNode, { ...scope, document: { querySelector: () => containerNode } }) === "right",
      String(exportsObject.measureSide(rootNode, { ...scope, document: { querySelector: () => containerNode } })),
    );
    const fullBandNode = {
      getBoundingClientRect: () => ({ left: 0, right: 1000 }),
      children: [
        { getBoundingClientRect: () => ({ left: 10, right: 500 }) },
        { getBoundingClientRect: () => ({ left: 512, right: 990 }) },
      ],
    };
    check(
      "a stats row filling the band still falls back to its own line",
      exportsObject.measureSide(rootNode, { ...scope, document: { querySelector: () => fullBandNode } }) === "none",
      String(exportsObject.measureSide(rootNode, { ...scope, document: { querySelector: () => fullBandNode } })),
    );
    check(
      "childExtent falls back to null without measurable children",
      exportsObject.childExtent({ getBoundingClientRect: () => ({ left: 0, right: 1000 }) }) === null,
    );
  }
  /* Overlaying takes BOTH a lift and a side with room. A lift alone drops the
     row onto the centred stats text, which is exactly the reported overlap. */
  check("exports shouldOverlay", typeof exportsObject.shouldOverlay === "function");
  check("a lift plus a chosen side overlays", exportsObject.shouldOverlay(20, "right") === true && exportsObject.shouldOverlay(20, "left") === true);
  check("no side means no overlay", exportsObject.shouldOverlay(20, "none") === false);
  check("no lift means no overlay", exportsObject.shouldOverlay(0, "right") === false);
  check("unmeasurable lift means no overlay", exportsObject.shouldOverlay(Number.NaN, "right") === false);

  {
    /* Re-measuring must not compound: the row is already shifted by the lift in
       force, so the applied `margin-top` has to be added back before comparing.
       This is the feedback loop — measure, apply, measure again. */
    const statsNode = { getBoundingClientRect: () => ({ top: 76 }) };
    const naturalTop = 100;
    let applied = 0;
    const rootNode = { getBoundingClientRect: () => ({ top: naturalTop - applied }) };
    const scope = {
      window: {
        getComputedStyle: (node) => (node === rootNode ? { marginTop: `${String(-applied)}px` } : { paddingTop: "4px" }),
      },
      document: { querySelector: () => statsNode },
    };
    const first = exportsObject.measureLift(rootNode, scope);
    applied = first;
    const second = exportsObject.measureLift(rootNode, scope);
    check("the first lift measures the natural gap", first === 20, String(first));
    check("re-measuring an applied lift is stable", second === first, `${String(second)} vs ${String(first)}`);
    check("the applied lift lands the row on the stats text top", naturalTop - applied === 80, String(naturalTop - applied));

    /* The fallback rule adds 2px of its own, which is not part of the lift. */
    const fallbackNode = { getBoundingClientRect: () => ({ top: 102 }) };
    const fallbackScope = {
      window: { getComputedStyle: (node) => (node === fallbackNode ? { marginTop: "2px" } : { paddingTop: "4px" }) },
      document: { querySelector: () => statsNode },
    };
    check("the fallback spacing is discounted", exportsObject.measureLift(fallbackNode, fallbackScope) === 20, String(exportsObject.measureLift(fallbackNode, fallbackScope)));
  }

  /* The lift must survive a composer that settles after mount: the stats row
     does not exist while a session is empty, so a one-shot measurement leaves
     the row on a line of its own for the rest of the page's life. */
  check("exports followLift", typeof exportsObject.followLift === "function");
  check("exports layoutAncestorOf", typeof exportsObject.layoutAncestorOf === "function");
  {
    const observers = [];
    const observerClass = (kind) => class {
      constructor(callback) { this.kind = kind; this.callback = callback; this.disconnected = false; this.observed = null; observers.push(this); }
      observe(node) { this.observed = node; }
      disconnect() { this.disconnected = true; }
    };
    const ResizeObserverStub = observerClass("resize");
    const MutationObserverStub = observerClass("mutation");
    const composer = { display: "flex", parentElement: null };
    const contentsHolder = { display: "contents", parentElement: composer };
    const statsNode = { getBoundingClientRect: () => ({ top: 76 }) };
    const rootNode = { getBoundingClientRect: () => ({ top: 100 }), parentElement: contentsHolder };
    let statsPresent = false;
    const scope = {
      window: {
        getComputedStyle: (node) => ({ display: node.display, paddingTop: "4px" }),
        /* Synchronous stand-in: a scheduled measurement runs inline. */
        requestAnimationFrame: (callback) => { callback(); return 1; },
        cancelAnimationFrame: () => {},
      },
      document: { querySelector: (selector) => (selector === "[data-composer-stats]" && statsPresent ? statsNode : null) },
      MutationObserver: MutationObserverStub,
      ResizeObserver: ResizeObserverStub,
    };
    const lifts = [];
    const control = exportsObject.followLift(rootNode, (value) => lifts.push(value), scope);
    check("layoutAncestorOf skips display:contents holders", exportsObject.layoutAncestorOf(rootNode, scope.window) === composer);
    check("followLift publishes its first measurement", lifts.length === 1 && lifts[0] === 0, JSON.stringify(lifts));
    const resize = observers.find((observer) => observer.kind === "resize");
    const mutation = observers.find((observer) => observer.kind === "mutation");
    check("followLift watches the layout parent", resize?.observed === composer);
    check("followLift watches the composer subtree", mutation?.observed === composer);
    check("followLift has no stats row to watch yet", observers.filter((observer) => observer.kind === "resize").length === 1);

    /* The stats row appears: the row must move onto the shared line. */
    statsPresent = true;
    mutation.callback();
    check("followLift re-measures when the stats row appears", lifts[lifts.length - 1] === 20, JSON.stringify(lifts));
    check("followLift now watches the stats row too", observers.some((observer) => observer.kind === "resize" && observer.observed === statsNode));

    control.dispose();
    check("followLift disconnects every observer", observers.every((observer) => observer.disconnected === true));
    const settled = lifts.length;
    mutation.callback();
    check("followLift stays quiet after dispose", lifts.length === settled, JSON.stringify(lifts));
  }
  {
    /* A host without the observer constructors must still place the row. */
    const composer = { display: "flex", parentElement: null };
    const rootNode = { getBoundingClientRect: () => ({ top: 100 }), parentElement: composer };
    const statsNode = { getBoundingClientRect: () => ({ top: 76 }) };
    const lifts = [];
    const control = exportsObject.followLift(rootNode, (value) => lifts.push(value), {
      window: { getComputedStyle: () => ({ paddingTop: "4px" }) },
      document: { querySelector: () => statsNode },
    });
    check("followLift measures without observer support", lifts.length === 1 && lifts[0] === 20, JSON.stringify(lifts));
    control.dispose();
  }

  /* Render against a stubbed transport; timers are neutered for the test. */
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };
  const translate = (key) => `[${key}]`;
  const balance = (currency, total) => ({ currency, total, granted: "0.00", toppedUp: total });
  const payloadOf = (accounts) => {
    const first = accounts.find((entry) => entry.ok === true);
    return {
      ok: first !== undefined,
      partial: first !== undefined && accounts.some((entry) => entry.ok !== true),
      fetchedAt: new Date().toISOString(),
      cached: false,
      accounts,
      primary: first?.primary ?? null,
      balances: first?.balances ?? [],
      keyRef: accounts[0].keyRef,
      keySource: "file",
    };
  };
  const account = (id, label, total) => ({
    id, label, ok: true, available: true, fetchedAt: new Date().toISOString(), cached: false,
    primary: balance("CNY", total), balances: [balance("CNY", total)], keyRef: `KEY_${id}`, keySource: "file",
  });
  let stubPayload = payloadOf([
    account("main", "主账号", "10.00"),
    {
      id: "backup", label: "备用", ok: false, fetchedAt: new Date().toISOString(), cached: false,
      keyRef: "KEY_B", error: { code: "http-401", message: "Authentication Fails" },
    },
  ]);
  globalThis.fetch = async () => {
    const snapshot = stubPayload;
    return { json: async () => snapshot };
  };

  const dock = byVariant.dock.component;
  const footer = byVariant.footer.component;

  render(dock, { t: translate, variant: "dock" });
  await settle();
  const dockTree = render(dock, { t: translate, variant: "dock" });
  check("dock row uses the stats-strip root class", dockTree?.props?.className === "dsb_dock", dockTree?.props?.className);
  check("dock row declares its lift for the one-line layout", dockTree?.props?.["data-lifted"] === "true" || dockTree?.props?.["data-lifted"] === "false", String(dockTree?.props?.["data-lifted"]));
  check("dock row exposes the lift as a custom property", typeof dockTree?.props?.style?.["--dsb-lift"] === "string", JSON.stringify(dockTree?.props?.style));
  check("dock row declares which side it takes", ["left", "right", "none"].includes(String(dockTree?.props?.["data-side"])), String(dockTree?.props?.["data-side"]));
  check("dock row is right-aligned beside the stats", String(dockTree?.props?.className).includes("dsb_dock"));
  const dockChildren = dockTree?.children ?? [];
  const accountPills = dockChildren.filter((child) => child?.type === "span" && child?.props?.className === "dsb_pill");
  const refreshPills = dockChildren.filter((child) => child?.type === "button");
  const separators = dockChildren.filter((child) => child?.props?.className === "dsb_sep");
  check("dock renders one pill per account", accountPills.length === 2, `got ${String(accountPills.length)}`);
  check("dock renders one separator", separators.length === 1, `got ${String(separators.length)}`);
  check("dock renders one refresh pill", refreshPills.length === 1, `got ${String(refreshPills.length)}`);
  check("dock refresh pill is wired", typeof refreshPills[0]?.props?.onClick === "function");
  check("dock refresh pill has an icon", refreshPills[0]?.children?.[0]?.type === "svg");
  check("dock refresh pill is labelled", refreshPills[0]?.props?.["aria-label"] === "[chip.refresh]");
  const dockText = JSON.stringify(dockChildren);
  check("dock shows the account labels", dockText.includes("主账号") && dockText.includes("备用"));
  check("dock shows the account amount", dockText.includes("¥10.00"));
  check("failing account renders in the error tone", dockText.includes('"data-tone":"error"'));
  check("dock tooltip lists every account", String(dockTree?.props?.title).includes("主账号") && String(dockTree?.props?.title).includes("备用"), dockTree?.props?.title);
  check("dock tooltip carries the failure reason", String(dockTree?.props?.title).includes("Authentication Fails"));

  /* A single default account keeps the generic label and no separator. */
  stubPayload = payloadOf([account("account-1", "", "32.30")]);
  render(dock, { t: translate, variant: "dock" });
  await settle();
  const singleTree = render(dock, { t: translate, variant: "dock" });
  const singleChildren = singleTree?.children ?? [];
  check("single account renders one pill", singleChildren.filter((child) => child?.type === "span" && child?.props?.className === "dsb_pill").length === 1);
  check("single account renders no separator", singleChildren.filter((child) => child?.props?.className === "dsb_sep").length === 0);
  check("single account uses the generic label", JSON.stringify(singleChildren).includes("[chip.label]"));

  /* Today's spend rides along on each account reading. */
  stubPayload = payloadOf([{ ...account("account-1", "", "32.30"), spentToday: "1.23", spentDate: "2026-09-20" }]);
  render(dock, { t: translate, variant: "dock" });
  await settle();
  const spendTree = render(dock, { t: translate, variant: "dock" });
  const spendChildren = spendTree?.children ?? [];
  const marker = spendChildren.flatMap((child) => child?.children ?? []).find((child) => child?.props?.className === "dsb_spend");
  check("pill shows today's spend", marker !== undefined, JSON.stringify(spendChildren));
  check("spend marker renders the amount with a down arrow", JSON.stringify(marker?.children) === JSON.stringify(["\u2193\u00a51.23"]), JSON.stringify(marker?.children));
  check("spend marker explains itself", String(marker?.props?.title).includes("[spend.note]"), marker?.props?.title);
  check("tooltip carries the spend line", String(spendTree?.props?.title).includes("[spend.today]"), spendTree?.props?.title);

  stubPayload = payloadOf([{ ...account("account-1", "", "32.30"), spentToday: "0.00", spentDate: "2026-09-20" }]);
  render(dock, { t: translate, variant: "dock" });
  await settle();
  const quietTree = render(dock, { t: translate, variant: "dock" });
  check("a zero-spend day renders no marker", !JSON.stringify(quietTree?.children).includes("dsb_spend"));
  check("a zero-spend day still explains itself in the tooltip", String(quietTree?.props?.title).includes("[spend.today]"));

  stubPayload = payloadOf([account("account-1", "", "32.30")]);
  render(dock, { t: translate, variant: "dock" });
  await settle();
  const untrackedTree = render(dock, { t: translate, variant: "dock" });
  check("an untracked reading renders no marker", !JSON.stringify(untrackedTree?.children).includes("dsb_spend"));
  check("an untracked reading has no spend tooltip line", !String(untrackedTree?.props?.title).includes("[spend.today]"));

  render(footer, { wide: true, t: translate, variant: "footer" });
  await settle();
  const footerTree = render(footer, { wide: true, t: translate, variant: "footer" });
  check("expanded footer chip is a container", footerTree?.type === "div" && footerTree?.props?.className === "dsb_root", footerTree?.props?.className);
  check("expanded footer chip has a refresh button", footerTree?.children?.some((child) => child?.type === "button"));
  check("expanded footer chip shows the amount", JSON.stringify(footerTree?.children).includes("¥32.30"));
  const railTree = render(footer, { wide: false, t: translate, variant: "footer" });
  check("collapsed rail chip is a single button", railTree?.type === "button" && railTree?.props?.className === "dsb_button");
  check("collapsed rail chip has no nested button", railTree?.children?.every((child) => child?.type !== "button") === true);
  check("collapsed rail chip refreshes on click", typeof railTree?.props?.onClick === "function");

  /* A host half that has not restarted still serves the earlier single-account
     shape; the client must keep rendering it. */
  stubPayload = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    available: true,
    primary: balance("CNY", "28.28"),
    balances: [balance("CNY", "28.28")],
    keyRef: "DEEPSEEK_API_KEY",
    keySource: "file",
    cached: false,
  };
  render(dock, { t: translate, variant: "dock" });
  await settle();
  const legacyTree = render(dock, { t: translate, variant: "dock" });
  const legacyChildren = legacyTree?.children ?? [];
  check("legacy single-account payload still renders one pill", legacyChildren.filter((child) => child?.type === "span" && child?.props?.className === "dsb_pill").length === 1);
  check("legacy payload shows its amount", JSON.stringify(legacyChildren).includes("¥28.28"));
  check("legacy payload renders no separator", legacyChildren.filter((child) => child?.props?.className === "dsb_sep").length === 0);

  /* Settings -> Plugins card: keyed by the settings namespace so the tab pairs
     it with the host section, and staged so a save is the only write. */
  const balanceSettings = { apiKeyRef: "DEEPSEEK_API_KEY", trackDailySpend: true, cacheMs: 15000, timeoutMs: 10000, sampleMs: 300000 };
  const scopeOf = (overrides = {}) => {
    const writes = [];
    let snapshot = {
      status: "ready",
      value: balanceSettings,
      base: balanceSettings,
      user: undefined,
      revision: 4,
      writable: true,
      mode: "host",
      ...overrides,
    };
    const listeners = new Set();
    return {
      writes,
      set: (field, value) => {
        writes.push({ op: "set", field, value });
        snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value }, user: { ...(snapshot.user ?? {}), [field]: value } };
        for (const listener of listeners) listener();
        return Promise.resolve();
      },
      unset: (field) => {
        writes.push({ op: "unset", field });
        return Promise.resolve();
      },
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
  /** Depth-first search for the first node whose props satisfy a predicate. */
  const findNode = (node, predicate) => {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findNode(child, predicate);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    if (predicate(node)) return node;
    return findNode(node.children, predicate);
  };
  const byClass = (root, className) => findNode(root, (node) => node?.props?.className === className);
  const byId = (root, id) => findNode(root, (node) => node?.props?.id === id);

  check("settings card is exported", typeof exportsObject.BalanceSettingsCard === "function");
  check("settings field specs are exported", Array.isArray(exportsObject.SETTINGS_FIELDS) && exportsObject.SETTINGS_FIELDS.length === 5);
  {
    const spec = exportsObject.SETTINGS_FIELDS.find((candidate) => candidate.field === "cacheMs");
    const snapshot = { value: balanceSettings, base: balanceSettings, user: undefined };
    const untouched = exportsObject.settingsFieldState(spec, snapshot, undefined);
    check("an untouched field shows the resolved value", untouched.text === "15000" && untouched.overridden === false && untouched.invalid === false, JSON.stringify(untouched));
    check(
      "a field present in the user layer reads as overridden",
      exportsObject.settingsFieldState(spec, { ...snapshot, user: { cacheMs: 15000 } }, undefined).overridden === true,
    );
    const invalid = exportsObject.settingsFieldState(spec, snapshot, { text: "abc" });
    check("a non-numeric draft is invalid and writes nothing", invalid.invalid === true && invalid.write === undefined, JSON.stringify(invalid));
    const belowMin = exportsObject.settingsFieldState(spec, snapshot, { text: "-1" });
    check("a draft below the minimum is invalid", belowMin.invalid === true && belowMin.invalidLabel === "settings.invalidRange", JSON.stringify(belowMin));
    const valid = exportsObject.settingsFieldState(spec, snapshot, { text: "0" });
    check("a numeric draft plans a number write", valid.write?.kind === "set" && valid.write.value === 0, JSON.stringify(valid));
    const emptied = exportsObject.settingsFieldState(spec, snapshot, { text: "  " });
    check("an emptied control plans a clear", emptied.write?.kind === "clear" && emptied.overridden === false, JSON.stringify(emptied));
    const cleared = exportsObject.settingsFieldState(spec, snapshot, { clear: true });
    check("a reset shows the composition value again", cleared.text === "15000" && cleared.overridden === false && cleared.write?.kind === "clear", JSON.stringify(cleared));
    const toggle = exportsObject.SETTINGS_FIELDS.find((candidate) => candidate.field === "trackDailySpend");
    const off = exportsObject.settingsFieldState(toggle, snapshot, { value: false });
    check("a toggled checkbox plans a boolean write", off.checked === false && off.write?.value === false, JSON.stringify(off));
  }

  const card = exportsObject.BalanceSettingsCard;
  /* Each scope's card is its own instance, like a fiber in a real tree. */

  const scope = scopeOf();
  const cardProps = { t: translate, scope };
  resetHooks();
  let cardTree = render(card, cardProps);
  check("settings card is a list item", cardTree?.type === "li" && cardTree?.props?.className === "dsb_cfg", String(cardTree?.props?.className));
  check("settings card names the plugin in Chinese", JSON.stringify(cardTree).includes("[settings.title]"), JSON.stringify(cardTree).slice(0, 200));
  check("settings card describes itself", JSON.stringify(cardTree).includes("[settings.description]"));
  check("collapsed card hides its fields", byId(cardTree, "dsb-setting-cacheMs") === undefined);

  /** Render the card, opening it when a save collapsed it. */
  const openCard = (props = cardProps) => {
    let tree = render(card, props);
    if (tree !== null && byId(tree, "dsb-setting-cacheMs") === undefined) {
      byClass(tree, "dsb_cfgHead")?.props?.onClick();
      tree = render(card, props);
    }
    return tree;
  };
  cardTree = openCard();
  check("expanding discloses every field", exportsObject.SETTINGS_FIELDS.every((spec) => byId(cardTree, "dsb-setting-" + spec.field) !== undefined));
  const saveButton = () => byClass(render(card, cardProps), "dsb_cfgSave");
  const discardButton = () => byClass(render(card, cardProps), "dsb_cfgDiscard");
  check("save is blocked with nothing staged", saveButton()?.props?.disabled === true);
  check("discard is blocked with nothing staged", discardButton()?.props?.disabled === true);

  byId(cardTree, "dsb-setting-apiKeyRef")?.props?.onChange({ target: { value: "MY_KEY" } });
  cardTree = render(card, cardProps);
  check("a staged edit marks the card unsaved", byClass(cardTree, "dsb_cfgPending") !== undefined);
  check("retyping is not a write", scope.writes.length === 0);
  check("save is enabled by a staged edit", saveButton()?.props?.disabled === false);
  saveButton()?.props?.onClick();
  await settle();
  check("save writes the staged field", scope.writes.length === 1 && scope.writes[0].field === "apiKeyRef" && scope.writes[0].value === "MY_KEY", JSON.stringify(scope.writes));
  cardTree = render(card, cardProps);
  check("a saved card clears its staged edits", byClass(cardTree, "dsb_cfgPending") === undefined);
  check("a saved card collapses again", byId(cardTree, "dsb-setting-cacheMs") === undefined);

  cardTree = openCard();
  byId(cardTree, "dsb-setting-cacheMs")?.props?.onChange({ target: { value: "abc" } });
  cardTree = render(card, cardProps);
  check("an invalid draft blocks the save", saveButton()?.props?.disabled === true);
  check("an invalid draft explains itself", JSON.stringify(cardTree).includes("[settings.invalidNumber]"));
  byId(cardTree, "dsb-setting-cacheMs")?.props?.onChange({ target: { value: "30000" } });
  cardTree = render(card, cardProps);
  saveButton()?.props?.onClick();
  await settle();
  check("a numeric draft is written as a number", scope.writes.at(-1)?.field === "cacheMs" && scope.writes.at(-1)?.value === 30000, JSON.stringify(scope.writes));
  cardTree = openCard();
  byId(cardTree, "dsb-setting-trackDailySpend")?.props?.onChange({ target: { checked: false } });
  cardTree = render(card, cardProps);
  saveButton()?.props?.onClick();
  await settle();
  check("the toggle writes a boolean", scope.writes.at(-1)?.field === "trackDailySpend" && scope.writes.at(-1)?.value === false, JSON.stringify(scope.writes));
  cardTree = openCard();
  byId(cardTree, "dsb-setting-apiKeyRef")?.props?.onChange({ target: { value: "OTHER" } });
  cardTree = render(card, cardProps);
  discardButton()?.props?.onClick();
  cardTree = render(card, cardProps);
  check("discard drops staged edits", byClass(cardTree, "dsb_cfgPending") === undefined);
  check("discard writes nothing", scope.writes.length === 3, JSON.stringify(scope.writes));

  /* A field the user already overrode offers its reset. */
  const overriddenScope = scopeOf({ user: { cacheMs: 30000 }, value: { ...balanceSettings, cacheMs: 30000 } });
  const overriddenProps = { t: translate, scope: overriddenScope };
  resetHooks();
  const overriddenTree = openCard(overriddenProps);
  check("an overridden field is badged", JSON.stringify(overriddenTree).includes("[settings.overridden]"));
  findNode(overriddenTree, (node) => node?.props?.className === "dsb_cfgReset")?.props?.onClick();
  const resetTree = render(card, overriddenProps);
  byClass(resetTree, "dsb_cfgSave")?.props?.onClick();
  await settle();
  check("resetting a field stages a clear", overriddenScope.writes.length === 1 && overriddenScope.writes[0].op === "unset" && overriddenScope.writes[0].field === "cacheMs", JSON.stringify(overriddenScope.writes));

  /* A read-only document, and an unavailable namespace. */
  const readOnlyScope = scopeOf({ writable: false });
  resetHooks();
  const readOnlyTree = openCard({ t: translate, scope: readOnlyScope });
  check("a read-only document says so", JSON.stringify(readOnlyTree).includes("[settings.readOnly]"));
  check("a read-only document blocks the save", byId(readOnlyTree, "dsb-setting-cacheMs")?.props?.disabled === true);
  resetHooks();
  check("an unserved namespace renders no card", render(card, { t: translate, scope: scopeOf({ status: "unavailable" }) }) === null);

  /* The card registers under the namespace key, with this plugin's dictionary. */
  {
    const registrations = [];
    const settingsCtx = {
      slots: {
        inject: (name, callback) => { callback(); },
        register: (definition, component) => { registrations.push([definition, component]); },
      },
    };
    const fakeCtx = {
      effect: (callback) => { callback(); },
      locale: { register: () => {} },
      slots: settingsCtx.slots,
      inject: (deps, callback) => {
        if (Array.isArray(deps) && deps.includes("settingsScope")) {
          callback({ ...fakeCtx, settingsScope: { bind: (spec) => ({ spec }) } });
        }
      },
    };
    exportsObject.apply(fakeCtx);
    const registered = registrations.find(([definition]) => definition.name === "settings.plugin.item");
    check("apply registers the settings card", registered !== undefined, JSON.stringify(registrations.map(([definition]) => definition.name)));
    check("the card is keyed by the settings namespace", registered?.[0]?.key === "deepseek-balance", String(registered?.[0]?.key));
    check("the card binds this plugin's dictionary", registered?.[0]?.locale === "deepseek-balance", String(registered?.[0]?.locale));
    const face = registered?.[0]?.inject?.();
    check("the card injects its bound scope", face?.scope?.spec?.namespace === "deepseek-balance", JSON.stringify(face?.scope));
  }

  delete globalThis.document;
  delete globalThis.window;
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
}
globalThis.fetch = realFetch;
//#endregion
//#endregion

if (process.argv.includes("--live")) {
  process.stdout.write("live — real credential and real API\n");
  const home = process.env.DSH_HOME ?? join(process.env.HOME, ".dsh");
  const requireFromProfile = createRequire(join(home, "profiles", "anchor.cjs"));
  let yamlModule = null;
  try {
    yamlModule = requireFromProfile("yaml");
  } catch (error) {
    check("yaml parser available for the live case", false, String(error?.message ?? error));
  }
  if (yamlModule !== null) {
    const credentials = yamlModule.parse(await readFile(join(home, ".credentials.yaml"), "utf8"));
    const key = credentials?.refs?.DEEPSEEK_API_KEY;
    check("real credential present", typeof key === "string" && key.length > 0);
    const { ctx, routes } = makeCtx({ credential: { value: key, source: "file" } });
    applyPlugin(ctx, {});
    const result = await callRoute(routes[0]);
    const payload = JSON.parse(result.body);
    check("real API answered", payload.ok === true, JSON.stringify(payload.error));
    if (payload.ok === true) {
      process.stdout.write(`       balance: ${JSON.stringify(payload.balances)}\n`);
    }
  }
}

process.stdout.write(`\n${String(passed)} passed, ${String(failed)} failed\n`);
process.exit(failed === 0 ? 0 : 1);
