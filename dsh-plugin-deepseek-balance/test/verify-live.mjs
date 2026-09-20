/**
 * Verify the plugin against a RUNNING dsh web instance, without restarting it.
 *
 * It mints the same authority-bound browser cookie the harness issues (HMAC
 * over the `client-connection/browser-session` grant record in
 * `$DSH_HOME/.credentials.yaml`), fetches the boot index, and reports whether
 * this package appears in `globalThis.__DSH_BOOT__` and whether its bundle is
 * actually served.
 *
 *   node test/verify-live.mjs
 *   node test/verify-live.mjs --url http://127.0.0.1:3080
 *
 * Read-only: it never writes to the profile and never starts a server.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const urlFlagAt = process.argv.indexOf("--url");
const baseUrl = urlFlagAt >= 0 && process.argv[urlFlagAt + 1] !== undefined
  ? process.argv[urlFlagAt + 1]
  : (process.env.DSH_WEB_URL ?? "http://127.0.0.1:3080");
const target = new URL(baseUrl);
const authority = target.host;

const home = process.env.DSH_HOME ?? join(process.env.HOME, ".dsh");
const requireFromProfile = createRequire(join(home, "profiles", "anchor.cjs"));

let passed = 0;
let failed = 0;
/**
 * Record one assertion.
 * @param label - what was checked.
 * @param ok - whether it held.
 * @param detail - optional context.
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

//#region cookie
/** base64url without padding, as the harness encodes cookie material. */
function base64Url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

const yaml = requireFromProfile("yaml");
const credentials = yaml.parse(readFileSync(join(home, ".credentials.yaml"), "utf8"));
const secretBase64 = credentials?.records?.["client-connection/browser-session"]?.payload?.secret;
check("browser-session secret is present", typeof secretBase64 === "string");
const secret = Buffer.from(secretBase64 ?? "", "base64url");
check("secret decodes to 32 bytes", secret.byteLength === 32, `${String(secret.byteLength)} bytes`);

const cookieName = "dsh-auth-" + base64Url(createHash("sha256").update(authority).digest());
const issuedAt = Date.now();
const body = base64Url(Buffer.from(JSON.stringify({
  version: 1,
  authority,
  issuedAt,
  expiresAt: issuedAt + 24 * 60 * 60 * 1000,
}), "utf8"));
const cookie = `${cookieName}=v1.${body}.${base64Url(createHmac("sha256", secret).update(body).digest())}`;
//#endregion

process.stdout.write(`live instance — ${baseUrl}\n`);

const indexResponse = await fetch(new URL("/", target), { headers: { cookie } });
check("boot index is authorized", indexResponse.status === 200, `HTTP ${String(indexResponse.status)}`);
const html = await indexResponse.text();

const graphMatch = /globalThis\["__DSH_BOOT__"\] = (\{.*?\})<\/script>/su.exec(html);
check("boot graph is injected", graphMatch !== null);
const graph = graphMatch === null ? null : JSON.parse(graphMatch[1]);
const entry = graph?.entries?.find((candidate) => candidate.id === "dsh-plugin-deepseek-balance");

process.stdout.write(`  ${String(graph?.entries?.length ?? 0)} client modules in the boot graph\n`);
check("plugin is in the client boot graph", entry !== undefined);
if (entry !== undefined) {
  process.stdout.write(`  entry: ${JSON.stringify(entry)}\n`);
  const batch = graph.batches?.find((candidate) => candidate.phase === "application" && candidate.url.includes("dsh-plugin-deepseek-balance"));
  check("plugin has an application batch url", batch !== undefined);
  if (batch !== undefined) {
    const response = await fetch(new URL(batch.url, target), { headers: { cookie } });
    const source = await response.text();
    check("bundle is served", response.status === 200, `HTTP ${String(response.status)} ${batch.url}`);
    check("bundle carries the module-loader wrapper", source.includes("__ModuleLoader__.load"));
    check("bundle id matches the package name", source.includes('"dsh-plugin-deepseek-balance"'));
    check("bundle registers the sidebar footer slot", source.includes("sidebar.footer.action"));
    check("bundle registers the composer dock slot", source.includes("conversation.composer.dock"));
    check("bundle mirrors the chat stats-strip classes", source.includes("dsb_dock") && source.includes("dsb_pill"));
    check("bundle measures the stats row to share its line", source.includes("data-composer-stats") && source.includes("--dsb-lift"));
    check("bundle renders an explicit refresh control", source.includes("dsb_refresh"));
    check("bundle registers the settings card", source.includes("settings.plugin.item") && source.includes("settingsScope"));
    check("bundle carries the settings dictionary", source.includes("settings.title") && source.includes("settings.description"));
  }
}

const balanceResponse = await fetch(new URL("/deepseek-balance", target));
check("balance route answers", balanceResponse.status === 200, `HTTP ${String(balanceResponse.status)}`);
const payload = await balanceResponse.json().catch(() => null);
check("balance payload is ok", payload?.ok === true, JSON.stringify(payload?.error));
const accounts = Array.isArray(payload?.accounts)
  ? payload.accounts
  /* The multi-account host half is not hot-reloaded: a profile still running
     the previous host build answers with the single-account shape. */
  : (payload?.primary !== undefined && payload?.primary !== null ? [payload] : []);
check("payload carries at least one account reading", accounts.length >= 1, JSON.stringify(Object.keys(payload ?? {})));
process.stdout.write(`  shape: ${Array.isArray(payload?.accounts) ? "multi-account" : "legacy single-account"}\n`);
for (const entry of accounts) {
  const name = entry.label && entry.label.length > 0 ? entry.label : entry.keyRef;
  process.stdout.write(`  ${String(name)}: ok=${String(entry.ok)} ${JSON.stringify(entry.balances)} (key ${String(entry.keyRef)}/${String(entry.keySource)})\n`);
}
check("balance payload never carries the key", !JSON.stringify(payload ?? {}).includes("sk-"));

process.stdout.write(`\n${String(passed)} passed, ${String(failed)} failed\n`);
process.exit(failed === 0 ? 0 : 1);
