/**
 * Verification for the profile-patch editor in `install.mjs`.
 *
 * Uses the same `yaml` resolution the installer uses (the harness profile
 * closure), so it also proves that resolution path works on this machine.
 * Run with `node test/install-patch.test.mjs`.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const { editPatch, loadYaml, PACKAGE_NAME, ROW_ID } = await import(
  pathToFileURL(join(dirname(new URL(import.meta.url).pathname), "..", "install.mjs")).href
);

const home = process.env.DSH_HOME ?? join(process.env.HOME, ".dsh");
const yaml = loadYaml(join(home, "profiles", "web"));

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

check("yaml resolved from the profile closure", yaml !== undefined && typeof yaml.parseDocument === "function");
if (yaml === undefined) {
  process.stdout.write("\n0 passed, 1 failed\n");
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), "dsh-balance-patch-"));

/**
 * Write one fixture and return its path.
 * @param name - fixture file name.
 * @param content - fixture content.
 * @returns the absolute path.
 */
function fixture(name, content) {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "cordis.patch.yml");
  writeFileSync(path, content, "utf8");
  return path;
}

process.stdout.write("patch editor\n");
{
  const path = fixture("empty", "[]\n");
  check("empty array is added to", editPatch(path, yaml, false).startsWith("added"));
  const parsed = yaml.parse(readFileSync(path, "utf8"));
  check("result is an array", Array.isArray(parsed));
  check("row carries the package name", parsed[0]?.insert?.[0]?.name === PACKAGE_NAME, JSON.stringify(parsed));
  check("row carries the id", parsed[0]?.insert?.[0]?.id === ROW_ID);
  check("second install is a no-op", editPatch(path, yaml, false).includes("already present"));
  const again = yaml.parse(readFileSync(path, "utf8"));
  check("no duplicate row", again.length === 1 && again[0].insert.length === 1, JSON.stringify(again));
}
{
  const path = fixture("commented", "# my own patch layer\n# keep this comment\n[]\n");
  editPatch(path, yaml, false);
  const text = readFileSync(path, "utf8");
  check("comments survive the edit", text.includes("# keep this comment"));
  check("document stays parseable", Array.isArray(yaml.parse(text)));
  check("row is rendered in block style", text.includes("- insert:\n    - id: deepseek-balance"), JSON.stringify(text));
}
{
  const path = fixture("flow", "[ { insert: [ { id: deepseek-balance, name: dsh-plugin-deepseek-balance } ] } ]\n");
  editPatch(path, yaml, false);
  const text = readFileSync(path, "utf8");
  check("an existing flow-style row is normalized", text.includes("- insert:\n    - id: deepseek-balance"), JSON.stringify(text));
}
{
  const path = fixture(
    "existing-rows",
    "- insert:\n    - id: other-plugin\n      name: other-plugin\n",
  );
  editPatch(path, yaml, false);
  const parsed = yaml.parse(readFileSync(path, "utf8"));
  const names = parsed.flatMap((entry) => (entry.insert ?? []).map((row) => row.name));
  check("unrelated rows survive", names.includes("other-plugin"), names.join(","));
  check("plugin row appended", names.includes(PACKAGE_NAME), names.join(","));
}
{
  const path = fixture("installed", "[]\n");
  editPatch(path, yaml, false);
  check("removal reports the edit", editPatch(path, yaml, true).startsWith("removed"));
  const parsed = yaml.parse(readFileSync(path, "utf8"));
  check("row is gone", parsed.flatMap((entry) => entry.insert ?? []).length === 0, JSON.stringify(parsed));
  check("removal is idempotent", editPatch(path, yaml, true).includes("already absent"));
}
{
  const path = fixture("misplaced", "- insert:\n    - id: unrelated\n      name: unrelated\n");
  // An existing row inside a shared insert list must still be found.
  const first = editPatch(path, yaml, false);
  const second = editPatch(path, yaml, false);
  check("detects its own row", first.startsWith("added") && second.includes("already present"), `${first} / ${second}`);
}

rmSync(sandbox, { recursive: true, force: true });

process.stdout.write(`\n${String(passed)} passed, ${String(failed)} failed\n`);
process.exit(failed === 0 ? 0 : 1);
