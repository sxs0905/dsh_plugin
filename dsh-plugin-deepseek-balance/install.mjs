#!/usr/bin/env node
/**
 * Install (or remove) dsh-plugin-deepseek-balance in a DSH profile.
 *
 *   node install.mjs                 # dev install (pnpm `link:` to this directory)
 *   node install.mjs --copy          # install a real copy of this directory
 *   node install.mjs --tarball       # `npm pack`, then install that artifact
 *   node install.mjs --profile tui   # pick another profile
 *   node install.mjs --remove        # uninstall
 *
 * What it does:
 *   1. `dsh plugin --profile <p> add <spec>` so pnpm materializes the package
 *      into the profile's node_modules (`--tarball` packs first).
 *   2. Inserts one loader row (`{ id, name }`) into the profile's
 *      `cordis.patch.yml`, preserving that file's comments.
 *
 * Choosing a spec:
 *   - default  `link:` — edits in this directory are live (client HMR polls the
 *              client bundle), which requires the host half to import nothing
 *              outside `node:` builtins.
 *   - `--copy` `file:<dir>` — a real directory, decoupled from this checkout.
 *   - `--tarball` `file:<pkg>.tgz` — the distributable artifact: what a release
 *              installs, and the safest choice (bare imports resolve normally).
 *
 * Idempotent: an existing row or dependency is left untouched.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "dsh-plugin-deepseek-balance";
const ROW_ID = "deepseek-balance";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Parse `--profile <name>` / `--remove` / `--copy` / `--tarball` / `--help`.
 * @returns the parsed options.
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let profile = process.env.DSH_PROFILE ?? "web";
  let remove = false;
  let copy = false;
  let tarball = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile" || arg === "-p") {
      profile = argv[index + 1];
      index += 1;
    } else if (arg === "--remove" || arg === "--uninstall") {
      remove = true;
    } else if (arg === "--copy") {
      copy = true;
    } else if (arg === "--tarball" || arg === "--pack") {
      tarball = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("usage: node install.mjs [--profile <name>] [--copy | --tarball] [--remove]\n");
      process.exit(0);
    } else {
      process.stderr.write(`install.mjs: unknown argument "${arg}"\n`);
      process.exit(2);
    }
  }
  if (copy && tarball) {
    process.stderr.write("install.mjs: --copy and --tarball are mutually exclusive\n");
    process.exit(2);
  }
  return { profile, remove, copy, tarball };
}

/**
 * Pack this directory into a distributable tarball and return its path.
 *
 * The npm cache is redirected to a scratch directory: npm writes `_logs` under
 * its cache, and the default `$HOME/.npm` can sit outside what a sandbox allows.
 * @returns the absolute `.tgz` path.
 */
function packTarball() {
  const cache = mkdtempSync(join(tmpdir(), "dsh-balance-pack-"));
  try {
    const result = spawnSync("npm", ["pack", "--silent", "--pack-destination", HERE, "--cache", cache], {
      cwd: HERE,
      encoding: "utf8",
    });
    if (result.error !== undefined) throw new Error(`npm pack failed: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`npm pack failed (exit ${String(result.status)}): ${(result.stderr ?? "").trim()}`);
    }
    const filename = (result.stdout ?? "").trim().split("\n").pop().trim();
    if (!filename.endsWith(".tgz")) {
      throw new Error(`npm pack printed no tarball name: ${JSON.stringify(result.stdout)}`);
    }
    return join(HERE, filename);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

/**
 * Resolve how to invoke the DSH CLI: `DSH_BIN`, then `dsh` on PATH, then the
 * installed package's bin through the current Node.
 * @returns `{ command, prefixArgs }`.
 */
function resolveDsh() {
  if (typeof process.env.DSH_BIN === "string" && process.env.DSH_BIN.length > 0) {
    return { command: process.env.DSH_BIN, prefixArgs: [] };
  }
  const probe = spawnSync("dsh", ["--version"], { encoding: "utf8" });
  if (probe.error === undefined && probe.status === 0) {
    return { command: "dsh", prefixArgs: [] };
  }
  const requireFromHere = createRequire(import.meta.url);
  try {
    const manifest = requireFromHere.resolve("@deepseek-ai/dsh/package.json");
    return { command: process.execPath, prefixArgs: [join(dirname(manifest), "lib", "bin.js")] };
  } catch {
    return undefined;
  }
}

/**
 * Load the `yaml` package from the harness profile closure.
 * @param profileDir - the profile directory, used as the resolution anchor.
 * @returns the yaml module, or undefined when it cannot be resolved.
 */
function loadYaml(profileDir) {
  const anchor = join(dirname(profileDir), "anchor.cjs");
  const requireFromProfile = createRequire(anchor);
  try {
    return requireFromProfile("yaml");
  } catch {
    return undefined;
  }
}

/**
 * Force block style on every collection in a document so the user's patch
 * file stays readable (the yaml printer inherits flow style from `[]`).
 * @param node - a YAML node (seq, map, pair, or scalar).
 */
function forceBlockStyle(node) {
  if (node === null || typeof node !== "object") return;
  if ("flow" in node) node.flow = false;
  if (Array.isArray(node.items)) for (const item of node.items) forceBlockStyle(item);
  if (node.value !== undefined) forceBlockStyle(node.value);
}

/**
 * Insert or remove the plugin row in the profile patch file.
 * @param patchPath - absolute `cordis.patch.yml` path.
 * @param yaml - the yaml module.
 * @param remove - whether to remove an existing row.
 * @returns a human-readable summary of what changed.
 */
function editPatch(patchPath, yaml, remove) {
  if (!existsSync(patchPath)) {
    if (remove) return "no patch file — nothing to remove";
    writeFileSync(patchPath, `- insert:\n    - id: ${ROW_ID}\n      name: ${PACKAGE_NAME}\n`, "utf8");
    return "created cordis.patch.yml with the plugin row";
  }
  const source = readFileSync(patchPath, "utf8");
  const document = yaml.parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`cannot parse ${patchPath}: ${document.errors[0].message}`);
  }
  if (document.contents === null || document.contents === undefined) {
    document.contents = document.createNode([]);
  }
  if (document.contents.items === undefined) {
    throw new Error(`${patchPath} is not a top-level YAML array`);
  }

  const rows = document.contents.items;
  /** Locate an existing insert list that already names this plugin. */
  function findExisting() {
    for (const entry of rows) {
      const value = typeof entry?.toJSON === "function" ? entry.toJSON() : entry;
      const inserted = Array.isArray(value?.insert) ? value.insert : [];
      for (const row of inserted) {
        if (row?.name === PACKAGE_NAME || row?.id === ROW_ID) return { entry, row };
      }
    }
    return undefined;
  }

  const existing = findExisting();
  let summary;
  if (remove) {
    if (existing === undefined) summary = "plugin row already absent";
    else {
      const value = existing.entry.toJSON();
      const remaining = value.insert.filter((row) => row?.name !== PACKAGE_NAME && row?.id !== ROW_ID);
      const at = rows.indexOf(existing.entry);
      if (remaining.length === 0) rows.splice(at, 1);
      else existing.entry.set("insert", remaining);
      summary = "removed the plugin row from cordis.patch.yml";
    }
  } else if (existing !== undefined) {
    summary = "plugin row already present";
  } else {
    document.add({ insert: [{ id: ROW_ID, name: PACKAGE_NAME }] });
    summary = "added the plugin row to cordis.patch.yml";
  }

  forceBlockStyle(document.contents);
  const rendered = document.toString();
  if (rendered !== source) writeFileSync(patchPath, rendered, "utf8");
  return summary;
}

/**
 * Run the install/uninstall end to end.
 * @param options - parsed CLI options.
 */
function main(options) {
  const { profile: profileName, remove: removing } = options;
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? "", ".dsh");
  const profileDir = join(home, "profiles", profileName);
  const patchPath = join(profileDir, "cordis.patch.yml");

  if (!existsSync(profileDir)) {
    process.stderr.write(`install.mjs: profile directory not found: ${profileDir}\n`);
    process.exit(1);
  }

  const dsh = resolveDsh();
  if (dsh === undefined) {
    process.stderr.write("install.mjs: cannot find the dsh CLI; set DSH_BIN=/path/to/dsh\n");
    process.exit(1);
  }

  let spec;
  let artifact;
  if (removing) {
    spec = undefined;
  } else if (options.tarball === true) {
    artifact = packTarball();
    process.stdout.write(`packed ${artifact}\n`);
    spec = `file:${artifact}`;
  } else if (options.copy === true) {
    spec = `file:${resolve(HERE)}`;
  } else {
    spec = resolve(HERE);
  }

  /* pnpm keeps an existing `link:` resolution when only the specifier string
     changes, so a dev install must be removed before a directory/tarball
     install or `node_modules` keeps pointing at this checkout. */
  if (!removing && (options.tarball === true || options.copy === true)) {
    spawnSync(dsh.command, [...dsh.prefixArgs, "plugin", "--profile", profileName, "remove", PACKAGE_NAME], {
      stdio: "ignore",
    });
  }

  const pnpmArgs = removing ? ["remove", PACKAGE_NAME] : ["add", spec];
  process.stdout.write(`> ${dsh.command} ${[...dsh.prefixArgs, "plugin", "--profile", profileName, ...pnpmArgs].join(" ")}\n`);
  const result = spawnSync(dsh.command, [...dsh.prefixArgs, "plugin", "--profile", profileName, ...pnpmArgs], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.stderr.write(`install.mjs: plugin ${removing ? "removal" : "install"} failed (exit ${String(result.status ?? "?")})\n`);
    process.exit(result.status ?? 1);
  }

  const yaml = loadYaml(profileDir);
  if (yaml === undefined) {
    process.stderr.write("install.mjs: could not load `yaml`; please add this row to " + patchPath + " by hand:\n");
    process.stderr.write(`  - insert:\n      - id: ${ROW_ID}\n        name: ${PACKAGE_NAME}\n`);
    process.exit(1);
  }

  process.stdout.write(`${editPatch(patchPath, yaml, removing)}\n`);
  if (removing) {
    process.stdout.write("Done. Refresh the browser (the row is gone from the tree).\n");
  } else {
    const webUrl = process.env.DSH_WEB_URL ?? "http://127.0.0.1:3080";
    process.stdout.write(
      "Done.\n"
      + (artifact === undefined ? "" : `  - Artifact: ${artifact}\n`)
      + "  - The loader row is applied live, but the HOST half is not re-imported:\n"
      + "    restart the profile (`dsh web`) for host-side changes to take effect.\n"
      + "  - Refresh the browser to load the new client bundle.\n"
      + `  - Endpoint: ${webUrl}/deepseek-balance (add ?force=1 to bypass the cache).\n`,
    );
  }
}

export { editPatch, loadYaml, parseArgs, PACKAGE_NAME, ROW_ID };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(parseArgs());
}
