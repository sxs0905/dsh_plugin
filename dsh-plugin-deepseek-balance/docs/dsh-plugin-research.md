# Writing a third-party DSH plugin (host code + web GUI surface)

**Environment investigated (read-only, plus a workspace-only probe profile):**

| Thing | Path |
|---|---|
| DSH CLI package | `/Users/han/.nvm/versions/node/v26.7.0/lib/node_modules/@deepseek-ai/dsh/` |
| Bundled plugin packages (240) | `/Users/han/.nvm/versions/node/v26.7.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` |
| User home | `/Users/han/.dsh/` |
| Web profile | `/Users/han/.dsh/profiles/web/` |
| Web shell dist (built) | `…/@deepseek-ai/dsh-web-frontend/dist/assets/index-BKQ_L1z6.js` |
| Installation dependency closure | `/Users/han/.dsh/profiles/node_modules/` (symlinks into the dsh installation) |

Installed versions: `@deepseek-ai/dsh@0.1.5-rc.2`, Node `v26.7.0`, pnpm `11.21.0`.

Throughout, `$PKG` = `/Users/han/.nvm/versions/node/v26.7.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`.

**Evidence quality convention used in this document:**
- ✅ **Verified** — read from a real installed file, or executed/proven by a command in this session (command output shown).
- ⚠️ **Inferred** — consistent with the code but not directly executed; flagged inline.

---

## 0. The 10 most important facts

1. **A third-party plugin is an npm package that is BOTH a profile bundle and (optionally) a client plugin.** Two independent `package.json` declarations do the work: `dsh.bundle.patch` (makes it a profile layer) and `dsh.client.platform === 'web'` + `exports["./client"]` (makes it a browser plugin). Exact type contract in `$PKG/dsh-package-manifest/lib/types/types.d.ts`. ✅
2. **`dsh plugin --profile web add <path-or-pkg>` is a thin `pnpm` forwarder plus a reconcile step.** It runs `pnpm add <abs-path>` in the profile dir, then, if the installed package declares `dsh.bundle.patch`, appends its **real package name** to `dsh.profile.bundles`. Verified end-to-end in this session against a probe profile. ✅
3. **One row serves both halves.** A single `cordis.patch.yml` row `{ id: <any>, name: <your-package> }` mounts `lib/index.js` on the host *and* registers the browser bundle, because the host scans that row's resolved `package.json` for `dsh.client`. ✅
4. **The browser bundle is hand-writable lazy CJS** — `window.__ModuleLoader__.load({ id, factory })`. The `clientBundle` tsdown preset is *not published*, so third parties must emit this format themselves (this is the single biggest documented blocker). ✅
5. **`require()` inside a client bundle resolves only 8 seed words plus boot-graph rows.** The seed table is literal in the shell: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`. ✅ (`dsh-client-ui-slots` / `-primitives` / `-dockkit` are **not installed packages** — they are compiled into the shell.)
6. **UI surfaces are registered through `ctx.slots.inject(name, cb)` → `ctx.slots.register(options, Component)`.** The enforced option set is `{ name (required), key (keyed slots), id (list slots), select (chain slots), order, label, priority, inject, children, store, locale, registrant }` — `priority` defaults to 0 and **the lowest priority renders**. 61 real slots are catalogued in §3.4; `sidebar.footer.action` and `settings.section` are the best third-party seats (both `list`/`root`, `replaceRisk: none`). ✅
7. **A third-party plugin cannot add a new `ctx.remote.*` namespace.** Remote capabilities are a *closed, inlined array* in `dsh-api-remotes/lib/client.js`, produced by the unshipped `@deepseek-ai/dsh-typert-generator`. **The pragmatic client→host channel is a plain HTTP route on `ctx.webServer` + same-origin `fetch`.** ✅
8. **Host module edits do NOT hot-reload by default.** `patchReload: live` watches exactly two YAML files with the Cordis HMR service in *watch-only* mode (`root: []`); the `hmr` row in `dsh-base` is `disabled: true`. Editing your `lib/index.js` needs a **restart** unless you enable that row. ✅
9. **Editing a client bundle DOES live-reload.** `dsh-client-hmr` stat-polls every graph row's built `lib/client.js` every 500 ms and pushes a `rebuilt` frame over SSE `/plugins/events`; the browser calls `modules.invalidate(id, rev)` and refreshes the fiber. So you can iterate on your browser half with **no build watcher at all**. ✅
10. **All official developer docs referenced by the READMEs are missing from this installation.** The only substantive shipped authoring docs are two `SKILL.md` files under `dsh-agent-presets/presets/cordis/skills/` (both written for the *runtime dynamic* plugin path, i.e. `cordis_define`/`cordis_run`, not for published packages). ✅

---

## 1. Third-party plugin package layout, discovery, and installation

### 1.1 The authoritative `package.json.dsh` type contract ✅

`$PKG/dsh-package-manifest/lib/types/types.d.ts` — this is the exhaustive field list (its `src/types.ts` is not shipped, but these `.d.ts` files are):

```ts
/** The `dsh` property of an npm manifest; a package may declare several roles. */
export interface DshManifest {
    /** Bundle metadata consumed by the profile launcher. */
    bundle?: DshBundleManifest;
    /** Profile metadata consumed by the profile launcher. */
    profile?: DshProfileManifest;
    /** Client module loading and build metadata. */
    client?: DshClientManifest;
    /** Config directories consumed by the experimental deployment-image packer. */
    configTrees?: DshConfigTreeDeclaration[];
    /** Adjacent Session migration metadata consumed by the workspace catalog generator. */
    sessionFormatMigration?: DshSessionFormatMigrationManifest;
    /** @internal Launcher-generated module proxy metadata, not an author configuration entry. */
    moduleFallback?: DshModuleFallbackManifest;
}
/** The configuration layer exported by a bundle package. */
export interface DshBundleManifest {
    /** Patch file path relative to the declaring package root. */
    patch: string;
}
/** The bundle composition declared by a profile directory. */
export interface DshProfileManifest {
    /** Ordered bundle layer list, using installed package names. */
    bundles?: string[];
    /** User patch lifecycle; omitted means `live` for custom profiles. */
    patchReload?: ProfilePatchReload;
}
export type ProfilePatchReload = 'live' | 'startup';
/** Client module declaration read by client-modules and the client build. */
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /**
     * Exact module-table requests beyond the implicit client baseline, including
     * subpaths such as `<pkg>/client`; absent means baseline externals only.
     * Type-only imports are erased and create no module request.
     */
    external?: string[];
}
```

Two footnotes that matter:
- `dsh.client.inject` is **NOT Cordis service injection** — it is a *package-name* list that only orders bundle arrival (`client-modules` registers those dependency factories first). Cordis *service* injection for the browser half is the `inject` **export of the client bundle**.
- `configTrees`, `sessionFormatMigration`, `moduleFallback` are not author-facing. `moduleFallback` is launcher-written.

### 1.2 A real bundle's package.json (the shape to copy) ✅

`$PKG/dsh-web-app/package.json`:

```json
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./startup": { "types": "./lib/types/startup.d.ts", "default": "./lib/startup.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

All six shipped bundles (`dsh-base`, `dsh-web-app`, `dsh-headless`, `dsh-sdk-app`, `dsh-sdk-minimal`, `dsh-acp-app`) declare exactly `dsh.bundle.patch`. **No shipped package declares `dsh.profile`** — that field is authored by users in their own profile directory. ✅

A real *dual-face* client package (node half + browser half) — `$PKG/dsh-client-ui-goal/package.json`:

```json
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-chat",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-session"
      ],
      "platform": "web"
    }
  }
```

and `$PKG/dsh-client-ui-goal/lib/index.js` in full (11 lines) — this empty host half is the canonical pattern for a browser-only package, and it proves the node half is optional in practice:

```js
//#region lib/types/index.js
/**
* Goal surface plugin, node half. Pure UI plugin: the empty apply exists so
* the plugin appears in the host cordis.yml / Loader; the browser half
* ships via exports["./client"], discovered through the package.json
* dsh.client declaration.
*/
/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {}
//#endregion
export { apply };
```

### 1.3 How the cordis loader discovers a plugin

The loader is `@deepseek-ai/cordis-plugin-loader`. Entry options (`$PKG/cordis-plugin-loader/README.md`): `id`, `name`, `config`, `group`, `disabled`, `inject`.

The composed tree over an **empty root** is, in order (`dsh/README.md`, `dsh-app-boot/README.md`):
1. each bundle's patch in `dsh.profile.bundles` order,
2. the profile's `cordis.patch.yml`,
3. `$DSH_HOME/cordis.patch.yml` (**outranks** the profile layer),
4. `--patch` overlays,
5. then a telemetry switch patch.

Bundle resolution is **installation-first, then profile-local** — `$PKG/dsh-app-boot/lib/index.js:826`:

```js
function resolveBundleDir(binName, packageName, installAnchor, profileDir) {
	for (const anchor of [installAnchor, join(profileDir, "package.json")]) {
		const dir = packageDirFromAnchor(anchor, packageName);
		if (dir !== void 0) return dir;
	}
	throw new Error(`${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)} from the dsh installation or ${profileDir}; run 'dsh plugin --profile ${basename(profileDir)} install' if its dependency is not installed`);
}
```

A listed bundle with no `dsh.bundle` **fails boot loudly** (`loadProfileDirectory`, `…/index.js:851-852`):
```js
const declared = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).dsh?.bundle?.patch;
if (declared === void 0) throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`);
```

Inserted row `name` values may be `"absolute filesystem paths, file URLs, or package specifiers"`; patch loading converts absolute and patch-relative `./`/`../` paths inside `insert` rows to file URLs, while id assertions and `config` values stay literal (`dsh-app-boot/README.md`).

### 1.4 `dsh plugin --profile web add …` — verified walkthrough ✅

The command is defined in `dsh/lib/bin.js`:
```js
const plugin = program.command("plugin").description("manage a profile's plugins by forwarding the remaining arguments to pnpm in the profile directory");
plugin.requiredOption("--profile <name>", "the profile whose plugins to manage (initialized on first use)").allowUnknownOption().argument("[args...]", "pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)").action(...)
```

and implemented in `dsh/lib/plugin-Ddi42qoW.js`. The reconcile logic is the important part:

```js
for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir);
    if (isBundle && !plugins.includes(packageName)) {
        plugins.push(packageName);
        changed = true;
    } else if (!isBundle && !beforeDeps.has(packageName)) process.stderr.write(`${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer (a later update that gains one activates it automatically)\n`);
}
```
with
```js
function exportsPatch(packageName, profileDir) {
	let dir;
	try { dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir); } catch { return false; }
	return readProfileManifest(NAME, dir).dsh?.bundle?.patch !== void 0;
}
```

Relative path specs are re-anchored to the invoking directory before pnpm sees them (`anchorPathSpec`, because pnpm runs with `cwd = profile dir`); absolute paths, registry names, `git+…` and `github:` specs pass through.

**Actually executed in this session** against a workspace-only probe home (`DSH_HOME=/Users/han/Documents/payment/code/.dsh-probe`), installing the skeleton from §6:

```
$ dsh plugin --profile web add /Users/han/Documents/payment/code/dsh-plugin-skeleton
dependencies:
+ dsh-plugin-hello link:/Users/han/Documents/payment/code/dsh-plugin-skeleton
Done in 278ms using pnpm v11.21.0
```
Profile manifest **after** (idempotent reconcile appended the true package name to the layer list):
```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": { "dsh-plugin-hello": "link:/Users/han/Documents/payment/code/dsh-plugin-skeleton" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-hello"],
      "patchReload": "live"
    }
  }
}
```
And `dsh web --dump-config` (boot-free) proved the bundle's own patch is applied **as a layer** with provenance:
```
# == dsh-plugin-hello
- id: example-hello
  name: dsh-plugin-hello
  config:
    greeting: Hello from the DSH host
```
✅ All of the above is real captured output.

#### ⚠️ Use an explicit `file:` prefix — `link:` breaks peer-dependency resolution ✅

A bare absolute path makes pnpm record a **`link:`** dependency, i.e. a symlink to your checkout. Node resolves symlinks to their **realpath** by default, so the plugin's own `node_modules` lookup walks up from *your checkout* — outside the profile tree — and **never reaches the installation closure**. Verified:

```
$ node --input-type=module -e "await import('/Users/han/Documents/payment/code/dsh-plugin-skeleton/lib/index.js')"
FAIL: ERR_MODULE_NOT_FOUND          # @deepseek-ai/schemastery unreachable
```

With an explicit `file:` spec pnpm hard-links a **real directory** into the profile, so the realpath *is* inside the profile and `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` (the installation closure, projected by `healProfilesModuleFallback` **at boot**) becomes reachable by ordinary parent-walk:

```
$ dsh plugin --profile web add file:/Users/han/Documents/payment/code/dsh-plugin-skeleton
Packages: +1
… Packages are hard linked from the content-addressable store to the virtual store.
--- installed shape ---
drwxr-xr-x  dsh-plugin-hello        # real directory, NOT a symlink
--- then, once the closure exists ---
$ node --input-type=module -e "await import('…/profiles/web/node_modules/dsh-plugin-hello/lib/index.js')"
OK — exports: Config, apply, inject, name
$ createRequire('…/dsh-plugin-hello/package.json').resolve('@deepseek-ai/schemastery')
/Users/han/.nvm/…/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.cjs
```

Two consequences worth internalising:
- **`dsh plugin --profile web add file:/abs/path/to/plugin`** is the correct install command; `add /abs/path` silently produces a `link:` dep that will fail at boot with an unresolved import.
- The closure at `$DSH_HOME/profiles/node_modules` is (re)projected by `healProfilesModuleFallback`, which runs in `composeProfile` — i.e. **at boot**, not in `--dump-config`. A fresh `$DSH_HOME` therefore cannot resolve plugin peer deps until the first real boot.
- pnpm's `autoInstallPeers: false` (from the profile's `pnpm-workspace.yaml`) means your `peerDependencies` are **not** installed — resolution relies entirely on that closure. Only import packages that exist in the dsh installation.

### 1.5 The profile files, verbatim ✅

`/Users/han/.dsh/profiles/web/package.json`:
```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
      "patchReload": "live"
    }
  }
}
```

`/Users/han/.dsh/profiles/web/cordis.yml` (the empty root — **always rewritten at boot**):
```yaml
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
```

`/Users/han/.dsh/profiles/web/cordis.patch.yml`:
```yaml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
[]
```

`/Users/han/.dsh/profiles/web/pnpm-workspace.yaml` (written at init; this is what makes out-of-tree plugins installable):
```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

**The profile root file `cordis.yml` is regenerated on every boot and every dump** — `dsh/lib/profile-boot-Dk-7KqJc.js:209`:
```js
function prepareProfile(name, userLayer = true, fromDefaultProfile) {
	if (fromDefaultProfile !== void 0) initializeProfileFromDefault(name, fromDefaultProfile);
	const profile = loadProfile(NAME, name, INSTALL_ANCHOR, void 0, { userLayer });
	writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
	return profile;
}
```
(The doc comment explains why: the Loader's tree write-back could otherwise bake composed rows into this file and duplicate every bundle insert on the next boot.) This is also why a *sandboxed* `dsh web --dump-config` against the real `~/.dsh` fails with `EPERM … cordis.yml` — it must write there. Redirecting `DSH_HOME` to a writable directory is the workaround used for all probe verification here.

### 1.6 Two supported integration shapes

| | **A. Bundle** (best for distribution) | **B. Plain package + user patch** (best for iteration) |
|---|---|---|
| `dsh.bundle.patch` | required | absent |
| Install | `dsh plugin --profile web add file:<abs>` auto-adds to `bundles` | `dsh plugin --profile web add file:<abs>` installs it and prints the "declares no dsh.bundle" warning |
| Wiring | your own `cordis.patch.yml` inserts your row(s) | you hand-edit `~/.dsh/profiles/web/cordis.patch.yml` with an `insert` naming your package |
| New row appears | **restart** — `dsh.profile.bundles` lives in `package.json`, which is *not* watched | **live, no restart** — the profile's `cordis.patch.yml` *is* watched, and `entry.update` creates+imports the new entry (§4.2) |
| Editing your own patch layer | **restart** (a bundle's `cordis.patch.yml` is composed at boot, not watched) | **live** (same watched file) |
| Risk | your patch is a layer; later layers can override by `id` | user owns the wiring |
| Double-mount hazard | — | never also add `dsh.bundle.patch`: two row ids for one package trips `client-modules: package … resolves from multiple active Loader sources` |

So the two shapes differ not just in ownership but in **reload ergonomics**: shape B gives you live row insertion and live config edits (because the file it writes is one of the two watched YAML files), while shape A needs a restart to change the layer list. A common pattern is to develop with shape B and publish shape A.

⚠️ Shape B's live application is **inferred from the code path** (`profile-boot` → `watchUserPatches` → Include `internal/update` → `root.update(data)`), not observed by booting in this session. Keep a restart as the fallback.

Shape B works but is user-managed and does not survive a profile re-create; shape A is what the CLI's reconcile is designed for.

---

## 2. Host plugin API (cordis)

### 2.1 The plugin module surface

Cordis accepts a **function**, a **class**, or an **object with `apply`** (`$PKG/cordis/lib/types/registry.d.ts:47-93`):

```ts
export type Plugin<T = any> = Plugin.Function<T> | Plugin.Constructor<T> | Plugin.Object<T>;
export declare namespace Plugin {
    interface Base<T = any> {
        /** Display name used for fiber diagnostics and logger names. */
        name?: string;
        /** Standard-schema validator applied to config before the plugin starts. */
        Config?: StandardSchemaV1<any, T>;
        /** Services the plugin requires; it only loads while all are available. */
        inject?: Inject;
        /** Service name(s) the plugin provides (read by `Service` and by loaders). */
        provide?: string | string[];
        intercept?: Dict<boolean>;
    }
    interface Function<T = any> extends Base<T> { (ctx: Context, config: T): any; }
    interface Object<T = any> extends Base<T> { apply(ctx: Context, config: T): any; }
}
```

`inject` is read **off the module namespace object** (`plugin.inject`), not from an options object — `$PKG/cordis/lib/index.js:1618-1640`:
```js
plugin(plugin, config, getOuterStack = buildOuterStack()) {
	const callback = this.resolve(plugin);
	if (!callback) throw new Error("invalid plugin, expect function or object with an \"apply\" method, received " + typeof plugin);
	...
	let name = plugin.name;
	if (name === "apply") name = void 0;
	runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config };
	const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
```
and `Inject.resolve` (`index.js:1490-1498`) maps an array to `{name: null}`. `Config` is any Standard Schema; the convention in-tree is schemastery (`import z from "@deepseek-ai/schemastery"`).

### 2.2 Exported shape of real, simple `lib/index.js` files ✅

| Package | Final export statement |
|---|---|
| `dsh-tool-todo` | `export { Config, apply, inject, name };` |
| `dsh-tool-bash` | `export { Config, apply, inject, name };` |
| `dsh-tool-ask-user` | `export { apply, inject, name };` (no Config) |
| `dsh-command-goal` | `export { apply, inject, name };` |
| `dsh-command-compact` | `export { apply, inject, name };` |
| `dsh-shell-env` | `export { Config, ShellEnvRegistry, apply, inject, name };` |
| `dsh-commands` (the registry itself) | `export { CommandId, CommandRuntime, CommandRuntime as default, name, parseCommand };` |
| `dsh-client-ui-goal/lib/index.js` | `export { apply };` — empty host half |

So the **only mandatory export is `apply`**; `name`, `inject`, `Config` are conventional and strongly recommended.

### 2.3 `inject` vs `ctx.get` vs `provide`/`set`

- **`ctx.get(name)`** — optional read, no injection needed. `$PKG/cordis/lib/types/reflect.d.ts`: *"Read a service from the store without the inject requirement."*
- **`inject: ['x']`** — hard dependency: the fiber waits until `x` exists, and is re-activated when it appears. Direct `ctx.x` access without declaring it throws `cannot get property "x" without inject`.
- **`ctx.provide(name, value)`** — register a *new* service owned by the current fiber; returns a disposer, auto-disposed with the fiber. *"Throws if the name is already provided in this scope."*
- **`ctx.set(name, value)`** — *"Overwrite a provided service's value. Only the fiber that provided the service may set it; setting an unprovided name throws."* Runtime (`cordis/lib/index.js:781-788`): `cannot set property "${name}" without provide` / `cannot set property "${name}" in multiple fibers`.

⚠️ **Honest finding:** a repo-wide grep found **no shipped host plugin calling `ctx.set(...)`**. Service registration in practice is either `class X extends Service { constructor(ctx){ super(ctx, "name") } }` or `ctx.provide(name, value)`. **Do not use `ctx.set` to publish a new service** — use `Service` subclassing or `ctx.provide`.

Real hybrid example — `dsh-tool-bash` declares `inject = ["tools","shell","systemPrompt","shellEnv"]` yet still does optional lookups: `ctx.get("sandboxPolicy")` (l.223), `ctx.get("approval")` (l.247), `ctx.get("jobs")` (l.405).

### 2.4 Registering an agent-callable tool ✅

Service: **`ctx.tools`** (`ToolRuntime extends Service`). Method: `register(definition: ToolDefinition): () => void`. There is no `ctx.tool(...)`.

Complete real example — `$PKG/dsh-tool-todo/lib/index.js` (abridged only in the middle; everything shown is verbatim):

```js
import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "tool-todo";
const inject = ["tools", "sessionProjections"];

/** Schemastery configuration for the todo tool consumer. */
const Config = z.object({ allowParallelInProgress: z.boolean().required() });

function apply(ctx, config) {
	const allowParallel = config.allowParallelInProgress;
	ctx.sessionProjections.register({ /* … projection … */ });
	ctx.tools.register(defineTool({
		name: "todo_write",
		description: describe(allowParallel),
		parameters: { todos: {
			type: "array",
			required: true,
			description: "The COMPLETE task list, replacing any previous list.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					content: { type: "string", required: true, description: "…" },
					status:  { type: "string", required: true, enum: [...STATUSES], description: "…" }
				}
			}
		} },
		output: {
			schema: { type: "object", additionalProperties: false, properties: { /* … */ } },
			render: (_args, value) => [{
				type: "text",
				text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`
			}]
		},
		execute(args, exec) {
			const todos = toTodoList(args.todos, allowParallel);
			if (!exec.agent) throw new Error("todo_write requires an owning agent session");
			exec.agent.session.append("todo/write", { todos });
			return Promise.resolve({ /* … */ });
		},
		presentCall: (args) => ({ card: "generic", title: "Update todo list", kind: "other", rawInput: args.todos })
	}));
}
export { Config, apply, inject, name };
```

Key contract points:
- `output` is **mandatory** and is `{ schema, render(args, value) → ContentBlock[], presentationMeta? }`.
- The **parameter DSL is its own thing** (`@deepseek-ai/dsh-tools/schema`) — *not* schemastery, not TypeBox, not zod. Nodes: `string | number | integer | boolean | null | array | object | json | oneOf`. `requiredness` is a per-property `required: true`; the parameter map is an implicit **open** object root. An explicit `{type:'object'}` node **must** carry `additionalProperties: boolean`.
- `ctx.tools.register` accepts a raw object literal too (no `defineTool`), e.g. `$PKG/dsh-subagent-in-process-driver/lib/index.js:55`.
- Tool plugins conventionally also call `ctx.systemPrompt.section({ name, order: ctx.systemPrompt.getSectionOrder("TOOL_BASH"), text })` for prompt guidance.

### 2.5 Registering a slash command ✅

Service: **`ctx.commands`**. Complete real example — `$PKG/dsh-command-feedback/lib/index.js` (this one also demonstrates the Remote pattern, §3.5):

```js
import { getOrCreateAnonymousUserId } from "@deepseek-ai/dsh-anonymous-user-id";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

const name = "command-feedback";
const inject = ["commands"];
const USAGE = "Usage: /feedback <text>";

function executeFeedbackCommand(invocation) {
	if (invocation.rawInput.trim().length === 0) return { kind: "error", text: `Feedback text is required. ${USAGE}` };
	recordFeedback(invocation.agent.session, { text: invocation.rawInput });
	return { kind: "success", text: `Feedback recorded for session ${invocation.agent.session.id}\nAnonymous user: ${getOrCreateAnonymousUserId()}.` };
}

function apply(ctx) {
	ctx.plugin(SessionFeedbackService);
	ctx.commands.register({
		name: "feedback",
		description: "record feedback about this session",
		input: { hint: "<text>" },
		recordInput: false,
		handler: executeFeedbackCommand
	});
}
export { FEEDBACK_CATEGORIES, SessionFeedbackService, apply, inject, name, recordFeedback };
```

`CommandDefinition` (`$PKG/dsh-commands/lib/types/index.d.ts:36-52`): `name` (lowercase, no slash), `description`, `input?: { hint: string; attachments?: boolean }`, `recordInput?` (default `true`), `handler(invocation)`.
`CommandInvocation`: `{ commandId, agent, rawInput, attachments, signal }` — **there is no typed argument schema**; the handler parses `rawInput` itself. Name grammar is enforced at registration: `/^[a-z][a-z0-9_-]*$/u`.
`CommandResult`: `{ kind: 'success'; text?: string; sourceEventSeq? } | { kind: 'error'; text: string }`.
`/goal` (`$PKG/dsh-command-goal`) shows `inject = ["commands", "goals"]` and `input: { hint: "[<objective>|clear|edit <objective>|pause|resume]", attachments: true }`.

### 2.6 Registering an HTTP route ✅

Service: **`ctx.webServer`** (note the capital S), provided by `dsh-host-webserver`. The class is `WebServer extends Service`, `super(ctx, "webServer")` at `$PKG/dsh-host-webserver/lib/index.js:157`.

Exact discovered contract (`$PKG/dsh-host-webserver/lib/types/index.d.ts`):

```ts
export type WebRouteKind = 'exact' | 'prefix';
export interface WebRoute {
    kind: WebRouteKind;
    /** Absolute pathname, no trailing slash. */
    path: string;
    /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface WebUpgradeRoute {
    path: string;
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}
export declare class WebServer extends Service {
    /** The listening port (the OS-assigned value when config.port is 0). */
    get port(): number;
    get host(): Config['host'];
    register(route: WebRoute): () => void;
    registerUpgrade(route: WebUpgradeRoute): () => void;
    registerFallback(handler: WebRoute['handler']): () => void;
    tapIndex(transform: (html: string) => string): () => void;
    applyIndexTaps(html: string): string;
    collectIndexInjections(): IndexInjection[];
    renderIndex(html: string): string;
}
```
plus an event: `'webserver/index-inject'(table: IndexInjection[]): void` (`@mode emit`).

Important details:
- **Registration carries no method and no content type.** Method checks, headers, and body are the handler's job.
- Matching is **exact table → longest prefix → single fallback**. A duplicate `(kind, path)` **throws** (composition-level contract). `registerFallback` has exactly one seat (the SPA dist server owns it in the shipped web composition) — a second registration throws.
- `/api` is **not** a gateway mount; it is a plain **prefix route registered by `dsh-client-connection`** (`$PKG/dsh-client-connection/lib/index.js:12, 768-781`), which also applies the trust fence. `/api/remote.mux` is an exact **upgrade** route registered by `dsh-api-gateway`.
- The server has **no TLS, auth, or origin policy of its own**; `host` is only `'127.0.0.1' | '0.0.0.0'` (config in `$PKG/dsh-web-app/cordis.patch.yml` → `host: !!js ctx.webStartup.host ?? '127.0.0.1'`, `port: … ?? 3080`, `compression: gzip`).

Real registrations to copy:

`$PKG/dsh-host-open-in-app/lib/index.js:1324` (a tiny JSON GET):
```js
ctx.effect(() => ctx.webServer.register({
	kind: "exact",
	path: OPEN_IN_APP_APPS_ROUTE,
	handler: async (req, res) => {
		if (rejected(req, res)) return;
		if (req.method !== "GET") { sendMethodNotAllowed(res, "GET"); return; }
		sendJson(res, 200, { apps: [...(await availability()).keys()] });
	}
}), `open-in-app: GET ${OPEN_IN_APP_APPS_ROUTE}`);
```
`$PKG/dsh-client-modules/lib/index.js:481` (prefix mount for plugin bundles):
```js
webCtx.effect(() => webCtx.webServer.register({
	kind: "prefix",
	path: "/plugins",
	handler: this.serveBundle
}), "client-modules: bundle route");
```
`$PKG/dsh-client-hmr/lib/index.js:115-143` (SSE):
```js
const connect = (res) => {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" });
	…
};
ctx.effect(() => {
	const disposeRoute = ctx.webServer.register({
		kind: "exact",
		path: EVENTS_ENDPOINT,       // "/plugins/events"
		handler: (req, res) => { … connect(res); }
	});
	…
```

### 2.7 `ctx.effect`, `ctx.on`, `ctx.logger`

- `ctx.effect(execute, label?)` — *"Disposers run in reverse registration order when the owning fiber unloads; they may be async."* The body may return a disposer, a promise of one, or an (async) iterable yielding several (generator effects). **Every contribution must be owned this way** — that is what makes HMR/unload clean.
- `ctx.on(name, listener, options?)` — returns a disposer. `options` is `{ prepend?, global? }`. **Waterfall events must call and return `next()`**; e.g. `$PKG/dsh-tool-jobs/lib/index.js:179`:
  ```js
  ctx.on("tools/pre-execute", (exec, next) => { …; return next(); }, { prepend: true });
  ```
- `ctx.logger` — callable and has `.error/.info/.warn/.debug`: `ctx.logger(name?)` for a named logger.

### 2.8 Service inventory — what you can `inject`

Extracted mechanically from every `interface Context { … }` declaration merge under `$PKG/*/lib/types/**/*.d.ts` (98 names). This is the practical answer to "what can my plugin depend on?" Names marked **(client)** come from client packages' declarations and only exist in the browser context.

**Host-side (usable from your `lib/index.js` via `inject` / `ctx.get`):**

```
agentDefaultModel  agentLoop  agentPresets  agents  approval  attachments  authorization
clientModules  codeRuntime  commands  compaction  connection  cordisInspect  credentials
credentialsController  deepseekLlmApiExtensions  directoryPicker  directoryPickerController
dynamicCordisRunner  error  fileReferences  fs  goals  hmr  invariants  jobs  llm  loader
logger  messageFeedback  permissionPresets  planMode  reflect  registry  sandbox
sandboxPolicy  sessionController  sessionFeedback  sessionFileReferences  sessionId
sessionLogDownload  sessionPersistence  sessionProjectionCache  sessionProjections
sessionQuery  sessionReferenceResolver  sessionSkillCatalog  sessionTelemetry  sessionTitle
sessions  settings  settingsController  shell  shellEnv  skills  spillStore  storage
storageDomain  subagentModelSelection  subagents  subprocess  systemPrompt  terminals
tokenMeter  toolResultPruner  tools  typert  typertGateway  userQuestions  version  web
webServer  webhookRuntime  workflowEngine  workspaceController  workspaceFiles
workspaceRegistry
```

**Browser-side (usable from your `lib/client.js` via the exported `inject` array / `ctx.get`):**

```
chatFileMentions  commandUi  documentPreviews  fileUpload  fileUploads  locale
modelDirectories  modules  remote  resources  settingsSchema  settingsScope  sidebarRight
sidebarRightTabs  slots  theme  uiRenderer  uiSession  uiWorkspace
(cordisInspect, dynamicCordisRunner and clientModules exist on both faces)
```

Notable: **`slots` is provided by `dsh-client-ui-renderer`** and **`remote` by `dsh-api-gateway`/`dsh-api-remotes`** — both are unconditional rows in the web bundle, so `inject: ['slots']` and `inject: ['remote', 'remote.<ns>']` are safe in the web profile.

### 2.9 The two other registerable host surfaces (for completeness)

- **`ctx.systemPrompt.section({ name, order, text })`** — contribute prompt text; `ctx.systemPrompt.getSectionOrder("TOOL_BASH")` gives a conventional slot. Prompts can be a function of `{ scope }` for conditional text.
- **`ctx.settings.register(ns, Schema, { base })`** — expose a settings namespace that the web **Plugins** settings page renders:
  ```js
  const scope = ctx.settings.register('ui-theme', ThemeSchema, { base: config })
  const theme = scope.get()               // deep-frozen resolved snapshot
  scope.update({ density: 'compact' })    // merges into the user section and persists
  ```
  (`$PKG/dsh-settings/README.md`.) Note `dsh-client-ui-settings-plugins/README.md`: *"Only host-plane plugins appear"* — a plugin mounted inside an agent preset cannot register a settings namespace.

---

## 3. Client (browser) UI plugin contract

### 3.1 How `dsh.client` is consumed by the host ✅

`dsh-client-modules` is the dual-face package that does it. Host half (`$PKG/dsh-client-modules/lib/index.js`, ~880 lines): it reconciles the **live Loader entries** into a table and serves bundles; browser half (`lib/client.js`): the lazy-CJS module table.

Validation + discovery (`index.js:139-166, 637-667`):

```js
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	const decl = value;
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return { platform: decl.platform, … };
}

resolveMeta(loaderName, baseUrl) {
	…
	const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
	if (decl === void 0 || decl.platform !== "web") { this.pkgMeta.set(sourceKey, null); return null; }
	const clientRel = clientExportOf(packageName, pkg.exports);
	if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
	const resolved = {
		packageName,
		meta: {
			clientPath: join(dirname(pkgPath), clientRel),
			…decl.inject !== void 0 ? { inject: decl.inject } : {},
			external: decl.external ?? [],
			immediately: decl.immediately === true
		}
	};
```
and the graph row's **id is the package name** (`reconcilePackage` → `graphRow(packageName, rev, source.meta)`), the lock key being `packageName`.

`locatePkgJson` resolves the row's `name` through the *same Loader module resolution that imported the host half*, then walks up to the nearest ancestor manifest whose `name` matches. Consequence: **a row named by an absolute path or `file:` URL also works**, because the path-like branch uses `nearestPackage(moduleUrl)`.

Bundles are served under a prefix route: `/plugins/…`, and the host composes "combo" URLs `/plugins/??<id>/client.js,<id2>/client.js&rev=<sha1-12>`; `<id>/client` and the bare `<id>` normalize to the same exports (`stripClientSuffix`). Bundle responses are immutable-cached and revision-addressed.

The declaration is delivered to the page as `window.__DSH_BOOT__` via the `webserver/index-inject` event. **Verified in the probe profile**: the algorithm resolves my skeleton's package dir, sees `platform === 'web'`, resolves `exports["./client"]` to `lib/client.js`, and the served URL is `/plugins/dsh-plugin-hello/client.js`.

`dsh.client.immediately: true` (used by 7 packages incl. `client-modules`, `client-connection`, `client-ui-renderer`) puts the row in the **phase-one registration barrier** — the shell prefetches it before running the rest of the plugin boot.

### 3.2 The exact browser bundle contract ✅

Every one of the ~57 shipped `lib/client.js` files begins identically:

```js
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-goal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		…
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

Semantics, from `$PKG/dsh-client-modules/lib/client.js` (`ClientModuleSystem`):
- **Executing the file only registers the factory.** All module-body side effects (including CSS injection) live in the factory closure and run at *materialization*.
- Materialization is memoized in `loadCache`; `require` is synchronous and recursive; **require cycles throw** (`factory-form CJS cannot deliver partial exports`).
- `require(spec)` resolution order: **platform seed → memoized record → registered factory**. Anything else throws:
  > `client-modules: require("<spec>") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`
- `import(spec)` adds the **boot-graph row** branch (fetch the bundle, register its factory) before materializing.
- Errors if the script does not register the expected id:
  > `client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`

**The seed table, verbatim from the built shell** (`dsh-web-frontend/dist/assets/index-BKQ_L1z6.js`):
```js
function by(){return{
  react: ec,
  "react/jsx-runtime": ic,
  "react-dom": cc,
  "react-dom/client": fc,
  "@deepseek-ai/cordis": Ha,
  "@deepseek-ai/dsh-client-store": Hc,
  "@deepseek-ai/dsh-client-ui-slots": Ac,
  "@deepseek-ai/dsh-client-ui-primitives": Zg,
  "@deepseek-ai/dsh-client-ui-dockkit": Ey
}}
```
and the kernel's boot, verbatim from the same file:
```js
this.modules = r.create({ boot: t.__DSH_BOOT__, staticModules: by(), …this.seams }),
…
this.ctx.plugin(Ba);                            // the shell kernel plugin
const i = t.loader; i.internal = this.modules;  // module system replaces "how code arrives"
const s = this.manifest.plugins.map(a => a.id);
this.page.setTotal(s.length), await r,
await Promise.all(s.map(async a => { this.page.setState(a,"loading"); const c = await i.create({ name: a }); … })),
await i.await(), this.assertEntriesActive(t)
```
So: **each boot-graph plugin id becomes a client cordis entry by name**, and its `exports.inject` / `exports.apply` are what cordis consumes. Other globals the shell provides: `window.__DSH_BOOT_READY__`, `window.__DSH_TRANSPORT__`.

**Build tooling caveat** — `$PKG/dsh-client-ui-settings-plugins/README.md`:
> "**A card still needs a browser bundle** — the browser half must be a `dsh.client` package built in the client module system's lazy-CJS factory format, and the `clientBundle` preset that emits it lives in `../../../packages/client/tsdown.client.ts` rather than a published package, so a plugin outside this repository has to reproduce that build itself."

For a hand-written plugin this is not a real obstacle: emit the `window.__ModuleLoader__.load({...})` wrapper yourself (§6).

### 3.3 What `require` can and cannot reach

| Want | Reachable? | How |
|---|---|---|
| `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` | ✅ seed | `require('react')` |
| `@deepseek-ai/cordis` | ✅ seed | `require('@deepseek-ai/cordis')` |
| `@deepseek-ai/dsh-client-ui-slots` | ✅ seed | but you rarely need it — `ctx.slots` is the runtime service |
| `@deepseek-ai/dsh-client-ui-primitives` | ✅ seed | shared UI kit; no `.d.ts`/README shipped |
| `@deepseek-ai/dsh-client-ui-dockkit` | ✅ seed | docking surfaces |
| `@deepseek-ai/dsh-client-store` | ✅ seed | observable store |
| another `dsh.client` package | ✅ if it is a boot-graph row | declare it in `dsh.client.inject` and/or `dsh.client.external`, then `require('<pkg>')` |
| anything else (e.g. `clsx`, `date-fns`) | ❌ | bundle it into your `lib/client.js`, or vendor the code inline |

`dsh.client.external` exists for exact non-baseline module requests; composition rejects malformed requests, missing suppliers, self-requests, and synchronous cycles.

### 3.4 UI slots — verified contract

`ctx.slots` is provided by **`dsh-client-ui-renderer`**, not by `ui-slots` (which owns only the pure registration core `SlotCore`). `$PKG/dsh-client-ui-renderer/lib/client.js`:

```js
		var SlotRegistry = class extends _deepseek_ai_cordis.Service {
			_core = new _deepseek_ai_dsh_client_ui_slots.SlotCore();
			…
			constructor(ctx) {
				super(ctx, "slots");
				this._core.onMutate((key) => { ctx.emit("slots/changed", key); });
			}
```
with `register` installed as a *prototype* method so the effect is owned by the **caller's** fiber:
```js
		SlotRegistry.prototype.register = function register(rawOptions, component) {
			const options = rawOptions;
			return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
		};
```

**`register(options, Component)` — the complete, enforced option set** (from `SlotCore.register` in the shell bundle):

| option | required when | meaning |
|---|---|---|
| `name` | always | the declared slot key |
| `key` | `kind: 'keyed'` | dispatch key; duplicate `(key, priority)` throws |
| `id` | `kind: 'list'` | list-item identity; duplicate `(id, priority)` throws |
| `select` | `kind: 'chain'` | `(ownerProps) => value \| null`; first non-null wins |
| `order` | — | sort within a priority band (list: priority then order) |
| `priority` | — | default `0`; **lowest renders** — raise it to sit behind another entry |
| `label` | — | list metadata; read back via `ctx.slots.entriesOfSlot(key)` + `resolveSlotLabel` |
| `inject` | — | `(scopeKey?, actions?) => props` — see the prop contract below |
| `children` | — | declares descendant slots; kinds `single\|keyed\|list\|chain`, scopes `root\|session\|session-maybe` |
| `store` | — | a store handle bound to the slot's scope (one handle, one scope) |
| `locale` | — | a registered locale namespace; makes `t` appear in props |
| `registrant` | — | diagnostic name used in collision messages |

Collision, child-name and store-scope violations throw at registration; `single` allows exactly one entry per priority band, and a child slot name may be declared only once globally.

**`inject(key, callback)`** — waits for the declaration, then runs `callback` (which returns one disposer *or* an iterable of disposers, so `function* () { yield …; yield …; }` works). Its doc comment is the contract:

> "Install an effect for each declaration lifetime of a slot. The callback runs synchronously when the declaration already exists; otherwise it runs inside the declaring `register()` call after the declaration is committed. Collapse disposes the effect and a later declaration runs it again. … The controller belongs to the caller's fiber, so plugin unload cancels a pending wait and removes any active contribution."

**What your component receives** — merge order is **kit → entry `inject` → slot-level inject → contextual hooks → ownerProps (owner wins)**:

```js
			return (0, react_jsx_runtime.jsx)(Comp, {
				...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps
			});
```
- **kit / standard props.** Root scope: `useResource`, `useWorkspaces`, `usePanelInfo`, `useSessions`, `useSessionPendingInteraction`. Session scope adds: `useChat`, `useConversation`, `useInput`, `inputActions`, `useSession`, `sessionId`, `useProjection`, `useTrajectory`. Hook keys are name-mangled: `standardHookPropName(name)` = `` `use${name[0].toUpperCase()}${name.slice(1)}` `` — so `hooks: { sessions }` becomes the prop **`useSessions`**.
- **`inject` is called positionally by scope**: session → `inject(sessionId, actions?)`; `session-maybe` → `inject(sessionId | undefined, actions?)`; root → `inject(actions?)`. Inside the returned face, `hooks` / `keyedHooks` keys become `use<Name>` props, and all other keys are spread verbatim. A **function-valued** hook is a contextual factory called per render as `factory(standard, hookContext)`.
- **`children` gives you `renderSlot`** (and `renderSlotChain` if any child is a `chain`); session children also add `SessionProvider`.

**Real registration calls — copy these shapes:**

```js
// list item in a session header bar (simplest useful third-party shape)
ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
  name: "conversation.session.header.actions", id: "job-list", order: 20, locale: "job"
}, JobListAction));                      // component: function JobListAction({ sessionId, useSessions, t })

// id-less single slot
ctx.slots.inject("conversation.approval.detail", () => ctx.slots.register({ name: "conversation.approval.detail" }, ApprovalCommand));
// minimal list registration (brand marks)
yield ctx.slots.register({ name: "sidebar.brand.mark" }, OfficialBrandMark);

// list item + a full inject face (sidebar footer action)
ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
  name: "sidebar.footer.action", id: "cordis-panel", locale: NS,
  inject: () => ({ hooks: { inventory, activeRuns: runner.activeRuns, … }, onRefresh: () => { inventory.refresh(); } })
}, CordisPanel));

// full settings page (list slot; id + order + label)
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section", id: "agent-presets", order: 20,
  label: () => ctx.locale.bind("settings.agentPreset")("nav"), locale: "settings.agentPreset",
  inject: sectionInjected
}, AgentPresetSection));

// chain entry with priority + select (approval panel claims the composer)
ctx.slots.inject("conversation.composer", () => ctx.slots.register({
  name: "conversation.composer", priority: 1,
  select: ({ pendingInteraction }) => pendingInteraction instanceof PendingApproval ? pendingInteraction : null,
  locale: NS,
  children: { "conversation.approval.detail": { kind: "single", scope: "session" } }
}, ApprovalPanel));

// keyed registration (one per tool name)
ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
  name: "conversation.chat.node", key: "command-input", locale: NS
}, GoalCommandInputView));
```

Ordered metadata observed for the busiest list slots: `settings.section` → `general`(0), `models`(10), `plugins`(15), `agent-presets`(20); `settings.general.item` → `permission`(-20), `language`(0), `appearance`(10), `font-size`(11), `transcript-view`(12), `composer-enter`(20); `conversation.input.dock` → `todo`(0), `goal`(10), `queue`(20); `conversation.session.header.actions` → `agent-preset`(-10), `schedule-catalog`(10), `job-list`(20); chain `priority` on `conversation.composer` → subagent(-10), approval(1).

**Is `dsh-client-ui-primitives` required? No.** The renderer README: *"Business plugins stay plain React components…"*; `dsh-client-ui-directory-picker-native` registers two components importing only `require("react")`; the `root` occupant `AppFrame` needs only `react`, `react/jsx-runtime` and `dsh-client-store`. Plain `React.createElement` is fine.

#### The authoritative slot catalog (61 slots) ✅

This is shipped inside the web bundle as the AI-facing `CLIENT_SLOT_API` catalog (`$PKG/dsh-cordis-client-runner/lib/client.js`, "Every slot the shipped web bundle declares, sorted by key"), and it agrees exactly with a runtime grep of all installed `lib/client.js` files. `replaceRisk: shadows-shipped-ui` means an existing occupant exists and replacing it removes the descendant slots it declares — **prefer the `none` entries.**

| slot | kind | scope | risk |
|---|---|---|---|
| `root` | single | root | shadows |
| `sidebar` | single | root | shadows |
| `main` | keyed | root | shadows |
| `rightbar` | single | root | shadows |
| `shell.overlay` | list | root | none |
| `sidebar.brand.mark` | single | root | shadows |
| `sidebar.brand.name` | single | root | shadows |
| `sidebar.panellist` | list | root | none |
| `sidebar.workspaces` | single | root | shadows |
| `sidebar.settings` | single | root | shadows |
| **`sidebar.footer.action`** | **list** | **root** | **none** |
| `main.conversation` | single | session-maybe | shadows |
| `conversation.session` | single | session | shadows |
| `conversation.session.header` | single | session | shadows |
| `conversation.session.header.lineage` | single | session | shadows |
| `conversation.session.header.actions` | list | session | none |
| `conversation.session.header.utilities` | list | session | none |
| `conversation.session.header.corner` | single | session | shadows |
| `conversation.view` | list | session | none |
| `conversation.composer` | chain | session | none |
| `conversation.hero.workspace` | single | root | shadows |
| `conversation.hero.brand.mark` | single | root | none |
| `conversation.hero.agentPreset` | single | root | shadows |
| `conversation.input.dock` | list | session | none |
| `conversation.input.overlay` | list | session | none |
| `conversation.composer.dock` | list | session | none |
| `conversation.input.left` | list | session | none |
| `conversation.input.right` | list | session | none |
| `conversation.composer.bar` | single | session-maybe | shadows |
| `conversation.input.attachments` | single | session-maybe | shadows |
| `conversation.input.plan` | single | session | shadows |
| `conversation.input.model` | single | session | shadows |
| `conversation.chat.node` | keyed | session | shadows |
| `conversation.message.images` | single | session | shadows |
| `conversation.chat.commandview` | keyed | session | none |
| `conversation.chat.turnTail` | chain | session | none |
| `conversation.chat.assistant-actions` | list | session | none |
| `conversation.trajectory.images` | single | session | shadows |
| `conversation.approval.detail` | single | session | shadows |
| `rightbar.session` | single | session | shadows |
| `sidebar.right.pane.tab` | keyed | session | none |
| `sidebar.right.pane.tab.title` | keyed | session | none |
| `sidebar.right.tab.guide` | chain | session | none |
| `sidebar.right.tab.menu.item` | list | session | none |
| `sidebar.right.tab.document` | keyed | session | none |
| `tool.call.toolview` | keyed | session | shadows |
| `tool.call.images` | single | session | shadows |
| `tool.view.cordis` | keyed | session | none |
| `settings.trigger` | single | root | shadows |
| `settings.header` | single | root | shadows |
| `settings.action` | list | root | none |
| `settings.close` | single | root | shadows |
| **`settings.section`** | **list** | **root** | **none** |
| `settings.plugins.tab` | list | root | none |
| `settings.onboarding` | list | root | none |
| `settings.general.item` | list | root | none |
| `settings.models.provider-card` | keyed | root | none |
| `settings.models.footer` | list | root | none |
| `settings.plugin.item` | keyed | root | none |
| `conversation.hero.workspace.directoryFlow` | single | root | shadows |
| `sidebar.workspaces.directoryFlow` | single | root | shadows |

There is **no `conversation.chat.tail`** and no `session.header.*` — the real names are `conversation.chat.turnTail` and `conversation.session.header.*`.

Other `ctx.slots` members worth knowing: `provideRoot({ hooks, keyedHooks, props })` (domain data available to every component), `entriesOfSlot(key)` (shadowing winners per cell — how you read list metadata), `snapshot(root?)`, `subscribe(key, fn)`, `spec(key)`, `getVersion(key)`, `installScope(scope, adapter)`, `renderSlot(key, owner)` (**only** `'root'`), `onEntryError(fn)`. A crashed entry is retired from its cell and renders as `<div data-slot-error="…">`; `SlotAssemblyError` is rethrown rather than contained.

⚠️ **Caveat:** `dsh-client-ui-slots` is not installed standalone, so the quotes above come from the **minified shell bundle** (namespaced object `Ac` at line 56 of `dist/assets/index-BKQ_L1z6.js`). String literals, error messages, and structure are verbatim; identifier names are mangled. The TypeScript type surface (`SlotMap`, `GlobalStandardProps`, `SessionStandardProps`, `InjectFace`, `HostObservable`, `SlotHookFactory`, …) is visible only as *imported names* in consumers' shipped `.d.ts`, so their definitions are unavailable here.

### 3.5 How a client plugin talks to host code

#### The Remote pattern (product-grade, **closed to third parties**) ✅

Host side: a service extends `TypertRemoteService` and decorates methods with `@Remote`, e.g. `$PKG/dsh-command-feedback/lib/index.js`:

```js
let SessionFeedbackService = (() => {
	let _classSuper = TypertRemoteService;
	…
	return class SessionFeedbackService extends _classSuper {
		static { _record_decorators = [Remote("record")]; __esDecorate(this, null, _record_decorators, { kind: "method", name: "record", … }, null, _instanceExtraInitializers); … }
		static inject = ["sessions"];
		constructor(ctx) { super(ctx, "sessionFeedback"); __runInitializers(this, _instanceExtraInitializers); }
		record(request) { … }
	};
})();
```

Endpoint identity is `<namespace>/<method>` and it rides HTTP:
- **Unary**: `POST /api/<namespace>/<method>` with envelope `{ type: "client-request", rpcId, method: "<namespace>/<method>", payload }`; response `{ type: "server-response", rpcId, result }` where `result` is `{ok:true,value}` | `{ok:false,error:{code,message,details}}`.
- **Streams & forwarded events**: one WebSocket at `/api/remote.mux` (JSON frames `open`/`item`/`end`/`error`/`cancel`; heartbeat ping/pong, default 2000 ms).

Client side: `ctx.remote.<namespace>.<method>(...)` → `Promise<RemoteResult<T>>` (**never rejects for a carrier problem**), `ctx.remote.$on(event, listener)`, `ctx.remote.$stream(options)`, `ctx.remote.$host` (`{ home, isLoopback }`). Namespaces are traced child services, so plugins declare `inject: ["remote", "remote.workspace"]`.

Real client call sites: `$PKG/dsh-client-ui-settings-general/lib/client.js` → `await this.ctx.remote.settings.openSettingsDocument()`; `$PKG/dsh-client-ui-goal/lib/client.js` → `ctx.remote.goals.get(sessionId)`, `ctx.remote.$on("goal/activation-changed", …)`.

**Why a third party cannot add one:**

1. The client contribution is **generated** by `@deepseek-ai/dsh-typert-generator`, which is **not installed** (`ls -d $PKG/*typert*` → only `-loader`, `-protocol`, `-registry`). The generated artifact is real data, e.g. `$PKG/dsh-command-feedback/lib/typert.remote-client.js`:
   ```js
   /* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */
   import { z } from 'zod'
   export const TYPERT_REMOTE = {
     package: '@deepseek-ai/dsh-command-feedback',
     descriptors: [ { id: '…#sessionFeedback/record', service: 'sessionFeedback', namespace: 'sessionFeedback',
       method: 'record', invocation: { kind: 'direct' }, parameters: [ … codec: { mode:'strict', … } ], result: { mode:'strict', … } } ],
   }
   ```
2. Those contributions are **statically inlined into `dsh-api-remotes/lib/client.js`** and mounted in a hardcoded loop (`…/lib/client.js:9632-9667`):
   ```js
   const inject = ["remote"];
   async function apply(ctx) {
     const disposers = [];
     try {
       for (const contribution of [ TYPERT_REMOTE$14, … TYPERT_REMOTE ])
         disposers.push(await ctx.remote.$mount(contribution));
     } catch (error) { … }
   ```
   `dsh-api-remotes/README.md`: *"The capability set is fixed by explicit build-time value imports; the Client does not discover the Host's active Remote definitions at runtime."* And `dsh-api-gateway/README.md`: *"Only strict generated contributions can mount on the Client face."*
3. Even the host-side `@Remote` decorator cannot be written by hand in plain JS here — Node v26.7.0 does **not** parse the decorator syntax (verified: `new vm.Script('class A { @d m(){} }')` → `Invalid or unexpected token`). The compiled packages carry the TypeScript `__esDecorate`/`__runInitializers` helpers, and `dsh-typert-protocol` exports no non-decorator "mark" function.

**What a third-party client plugin *can* use from `ctx.remote`:** only the namespaces some shipped package already mounted (`settings`, `credentials`, `workspace`, `session`, `sessionFeedback`, `goal`, `pluginInventory`, `dynamicCordisRunner`, `commands`, `fileReferences`, `sessionReferences`, …).

#### The practical third-party channel: your own route + same-origin `fetch` ✅

Register an exact route on `ctx.webServer` in the host half (§2.6) and call it from the browser half. Same origin, so no CORS concerns. The route is **unauthenticated by default** — the webserver has no auth policy at all. If it must not answer cross-site or non-loopback callers, do what `dsh-host-open-in-app` does:

```js
/** Answer an untrusted/unauthenticated request; true when it was rejected. */
const rejected = (req, res) => {
	const rejection = connectionOf(ctx).requestRejection(req);
	if (rejection === void 0) return false;
	res.statusCode = rejection;
	res.end();
	return true;
};
```
The shared fence itself — `$PKG/dsh-client-connection/lib/index.js` (verbatim):

```js
function isTrustedApiRequest(request, trustedHosts) {
	const host = header$1(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header$1(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header$1(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
…
	/** Apply the configured Host/Origin fence, then browser authentication. */
	requestRejection(request) {
		if (!isTrustedApiRequest(request, this.trustedHosts)) return 403;
		return this.browserAuth.isAuthenticated(request) ? void 0 : 401;
	}
```
So: `403` unless the `Host` header is loopback/`trustedHosts` **and** `sec-fetch-site !== 'cross-site'` **and** `Origin` (if present) matches the host; then `401` unless the browser-auth cookie is valid. `trustedHosts` comes from `connection` config (`dsh-web-app/cordis.patch.yml`: `trustedHosts: !!js ctx.webRuntime.trustedHosts`). `BrowserAuth` exchanges a process launch token (`?token=…` on `GET /`) for a signed, authority-bound cookie.

There is **no per-route or per-Remote "trusted"/"local-only" flag** — every `/api` caller passes the same fence. The only client-visible locality signal is `ctx.remote.$host.isLoopback`. (`dsh-authorization` is unrelated: it is the human-guided credential-flow seam, `ctx.authorization.registerFlow({key,label,methods,run})`, and grants nothing on routes.)

⚠️ If you inject `connection` you add a hard dependency on `dsh-client-connection`; the fully dependency-light alternative is to do no auth (acceptable for loopback-only deployments, which is the shipped default).

**Also usable from `ctx.remote`:** the forwarded-event allowlist `API_REMOTE_FORWARDED_EVENTS` in `$PKG/dsh-api-remotes/lib/index.js:17-94` is the legal key set of `ctx.remote.$on(...)`. It currently contains 19 events: `agent-preset/selected`, `approval/request` (waterfall), `api-session/activity|added|error|removed|status`, `commands/change`, `credentials/reference-updated`, `goal/activation-changed`, `cordis/request-run`, `cordis/request-run-resolved`, `cordis/dynamic-package`, `cordis/dynamic-retract`, `cordis/inspect-query`, `cordis/inspect-query-resolved`, `llm/adapters-updated`, `settings/document-updated`, `user-questions/request` (waterfall). Adding one requires an entry in that array (an in-box edit).

---

## 4. Boot, live reload, HMR

### 4.1 Boot sequence (web profile)

1. `dsh web` → `runProfile` → `composeProfile` (`dsh/lib/profile-boot-Dk-7KqJc.js`):
   `prepareProfile` (**rewrites `profiles/web/cordis.yml`**) → `healProfilesModuleFallback` (projects installation-closure symlinks) → compose `[bundlePatches, profile.patches, homePatches, overlays]`.
2. `boot(...)` mounts the root `cordis:include` over the composed YAML and **awaits every fiber**; a failure names the plugin and the stage (`plugin tree failed to load`), exits nonzero.
3. `dsh-client-modules` activates, reconciles the graph, and (on the webserver row) registers the `/plugins` prefix route and pushes `window.__DSH_BOOT__` rows into `webserver/index-inject`.
4. `dsh-host-frontend-static` claims the fallback seat; every index response goes through `ctx.webServer.renderIndex`, injecting the module-loader facade, combo preloads, the bootstrap combos, and the boot graph.
5. Browser: shells boot → `__ModuleLoader__.create(...)` → `ctx.plugin(shellKernel)` → for each boot-graph plugin id, `loader.create({ name: id })` → `loader.await()` → `ctx.uiRenderer.mount(container)`.

### 4.2 `patchReload: live` — what it actually reloads ✅

The web profile ships `patchReload: "live"`. What that installs is **config-tree watching only**:

- `dsh/lib/profile-boot-Dk-7KqJc.js:321-338` creates a `@deepseek-ai/cordis-plugin-hmr` instance with **`config: { root: [] }`** and calls `watchUserPatches` **twice** — once for `$DSH_HOME/profiles/web/cordis.patch.yml`, once for `$DSH_HOME/cordis.patch.yml`. So exactly **two files** are watched, and **no plugin module directories**.
- `watchUserPatches` (`$PKG/dsh-app-boot/lib/index.js:1109-1129`) re-applies the patch layer transactionally:
  ```js
  const register = hmr.registerConfig(filename, async () => {
      const { patches: _previousPatches, ...includeConfig } = entry.options.config;
      const patches = compose(loadOptionalPatches(binName, filename) ?? []);
      await entry.update({ config: { ...includeConfig, patches } });
  });
  ```
- A valid edit **recomposes the tree live**; a rejected edit leaves the last good app running (`dsh-app-boot/README.md`).
- The `dsh-base` patch declares the module-reload row **disabled** with an explanatory comment:
  ```yaml
  # Module reload is opt-in per profile. `patchReload: live` config watching
  # uses the launcher's watch-only fallback and does not require this row.
  - id: hmr
    name: '@deepseek-ai/cordis-plugin-hmr'
    disabled: true
    config:
      root: ['.']
  ```

**Consequence table:**

| You changed… | Effect | Action needed |
|---|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` (insert/remove/config a row) | ✅ live recompose in ~instant | none |
| `~/.dsh/cordis.patch.yml` | ✅ live | none |
| a bundle's own `cordis.patch.yml` (e.g. yours) | ❌ not watched | re-run `dsh plugin` reconcile (no-op) or edit the profile patch; simplest is a restart or a copy of the row in the profile patch |
| **your `lib/index.js`** (host code) | ❌ **restart required** by default | restart `dsh web`, or enable the disabled `hmr` row with a `root` pointing at your package |
| **your `lib/client.js`** (browser bundle) | ✅ **live swap without any build watcher** | none |
| your TypeScript/build sources | ❌ nothing watches them | run your own build watcher (the shipped one is `pnpm run dev:web`) |

### 4.3 Client-bundle HMR (`dsh-client-hmr`) — verified in source ✅

Node half (`$PKG/dsh-client-hmr/lib/index.js`):
```js
const name = "client-hmr";
const inject = ["clientModules", "webServer"];
const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });
…
const rehash = (id, watch, current) => {
    try { ctx.clientModules.rebuilt(id); }
    catch (error) { if (error.code === "ENOENT") { watch.dirty = true; return; } ctx.logger.warn(error); }
    watch.mtimeMs = current.mtimeMs; watch.size = current.size; watch.dirty = false;
};
…
ctx.effect(() => {
    syncWatches();
    const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
    const timer = setInterval(pollWatches, pollIntervalMs);
    timer.unref();
    return () => { unsubscribe(); clearInterval(timer); watched.clear(); };
}, "client-hmr: bundle watches");
```
and an SSE route at `/plugins/events` broadcasting `{type:"graph", graph}` / `{type:"rebuilt", id, rev}` frames.

Browser half (`lib/client.js`) opens `new EventSource("/plugins/events")` and on a `rebuilt` frame:
```js
async function reload(id, rev) {
    const entry = findEntry(loader, id);
    …
    modLoader.invalidate(id, rev);
    await modLoader.prefetch(id);
    const oldFiber = entry.fiber;
    if (oldFiber !== void 0) { const runtime = oldFiber.runtime; if (runtime !== null) entry.ctx.registry.delete(runtime.callback); while (oldFiber.inertia !== void 0) await oldFiber.inertia; delete entry.fiber; }
    removeOwnedStyles(id);
    await entry.refresh();
    await entry.fiber?.await();
}
```

**So, unlike the README's framing ("stays idle without a rebuild watcher"), the poll is on the built artifact itself.** Writing `lib/client.js` directly triggers a reload within ~500 ms. This is the single most useful fact for a third-party plugin author. Caveats: it re-executes the bundle and remounts the plugin (**component state is lost**), there is **no rollback** on failure (the entry is left fiberless; the next rebuilt frame retries), and a reload does **not** replace the boot graph — so adding a *new* client package still needs a page reload.

### 4.4 `cordis-plugin-hmr` (host module reload)

`$PKG/cordis-plugin-hmr/README.md`: *"Hot module replacement for loader-managed Cordis plugins. The HMR plugin watches source files, traces Node's module graph, clears affected module caches, and reloads only the plugin entries that depend on changed application files. Changes to framework-level dependencies fall back to `loader.exit()`, letting the host process restart."* Config: `base`, `root` (chokidar roots, default `['.']`), `ignored`, `debounce`. Events: `hmr/change`, `hmr/reload`. Requires Node's internal module loader.

To use it for your own package, add to the profile patch (the row already exists, disabled, from `dsh-base`):
```yaml
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  disabled: false
  config:
    root: ['/Users/han/Documents/payment/code/dsh-plugin-skeleton']
```
⚠️ Not executed here. This makes the launcher mount a *watching* HMR instance in addition to its `root: []` config-watcher; the interaction between the two instances was not tested.

---

## 5. Official documentation shipped in this installation

**There is no "how to write a plugin" README.** 240 packages, 473 `.md` files, and only three non-README `.md` files exist. Every `../../docs/…`, `.agents/notes/…`, `reference/README.md`, `packages/client/tsdown.client.ts` link in the READMEs is **dead in this installation** — the dsh package ships only `lib/*.js`, `LICENSE`, `package.json`, `README.md`, `README.zh.md`, `README.i18n.yaml`.

| Document | Path | Authority |
|---|---|---|
| **Cordis plugin-development skill** (420 lines) | `$PKG/dsh-agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md` | The richest shipped DSL doc: `apply`/`ctx.get`/`inject`, `ctx.effect`/`ctx.on`, timers, slots, themes, `harness.handle`/`host.call`, a failure table. **But written for the runtime *dynamic* plugin path** (`cordis_define`/`cordis_run`), where code is a plain-JS function body returning a plugin — no `import`, no JSX, no `require`. |
| **Editing cordis compositions skill** (165 lines) | `$PKG/dsh-agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md` | Plugin **rows**, host vs preset plane, isolate realms, mount-validation failure messages, and the only place that documents installing bundles (`dsh plugin --profile <name> add …`). |
| `dsh-client-modules/README.md` | `$PKG/dsh-client-modules/` | **Authoritative** for `dsh.client`, the `/plugins` route, lazy-CJS, `dsh.client.external`, `immediately`, and boot-manifest injection. |
| `dsh-app-boot/README.md` | `$PKG/dsh-app-boot/` | **Authoritative** for profiles, bundles, patch precedence, `patchReload`, `--dump-config`. |
| `dsh-package-manifest/README.md` + `lib/types/types.d.ts` | `$PKG/dsh-package-manifest/` | **Authoritative** for the `dsh` manifest fields. |
| `dsh-host-webserver/README.md` | `$PKG/dsh-host-webserver/` | Routes, upgrade routes, fallback seat, index injection; explicit "no TLS/auth/origin policy". |
| `dsh-api-gateway/README.md`, `dsh-api-remotes/README.md` | `$PKG/…` | The Remote substrate, `$mount`, `$on`, `RemoteResult`, and the fixed-capability-set limitation. |
| `dsh-client-hmr/README.md` | `$PKG/dsh-client-hmr/` | The reload chain, `pollIntervalMs`, failure policy (no rollback). |
| `dsh-tools/README.md`, `dsh-commands/README.md` | `$PKG/…` | Canonical `defineTool` example; command registration and result contract. |
| `dsh-client-ui-settings-plugins/README.md` | `$PKG/…` | **The explicit statement that the client build preset is unpublished.** |
| `cordis/README.md`, `cordis-plugin-loader/README.md`, `cordis-plugin-include/README.md`, `cordis-plugin-group/README.md`, `cordis-plugin-hmr/README.md` | `$PKG/…` | Framework DSL and loader entry options. |
| `dsh-base/README.md` + `cordis.patch.yml`, `dsh-web-app/README.md` + `cordis.patch.yml` | `$PKG/…` | The canonical worked examples of a bundle patch layer (the READMEs explicitly call the YAML "the bundle substance"). |
| `schemastery/README.md` | `$PKG/schemastery/` | `Config` schema DSL (upstream-generic; no DSH specifics). |

---

## 6. Minimal working plugin skeleton

Files created and verified in this session at `/Users/han/Documents/payment/code/dsh-plugin-skeleton/` (copied verbatim below). It is a **dual-face bundle**: one row gives it host code (an HTTP route) *and* a browser plugin (two UI seats).

### 6.1 `package.json`

```json
{
  "name": "dsh-plugin-hello",
  "version": "0.1.0",
  "private": true,
  "description": "Minimal third-party DSH plugin: one host row (HTTP route) and two browser UI surfaces.",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/schemastery": "^3.18.2"
  }
}
```

### 6.2 `cordis.patch.yml`

```yaml
# The bundle patch for dsh-plugin-hello.
#
# A bundle patch is a top-level YAML array of loader patch entries. This one is
# a single `insert` over whatever layers came before it (dsh-base, dsh-web-app).
# `name` is this package's own name, so the SAME row supplies both halves:
#   - Node half      -> package.json "main" / exports["."]  -> lib/index.js
#   - browser half   -> exports["./client"] discovered through package.json dsh.client
- insert:
    - id: example-hello
      name: 'dsh-plugin-hello'
      config:
        greeting: 'Hello from the DSH host'
```

### 6.3 `lib/index.js` (host half, ~55 lines, one external import)

```js
// Host half of dsh-plugin-hello.
//
// Loaded by the cordis Loader as the profile row `example-hello`, whose `name`
// is this package. `apply` runs host-side, with the row's `config` already
// validated against the exported `Config` schema.
//
// Real precedents for this exact export shape:
//   @deepseek-ai/dsh-tool-todo/lib/index.js       -> export { Config, apply, inject, name }
//   @deepseek-ai/dsh-command-feedback/lib/index.js -> export { apply, inject, name }
import z from '@deepseek-ai/schemastery';

/** Loader entry label; also the row name reported in boot diagnostics. */
export const name = 'example-hello';

/**
 * Hard service dependencies. The Loader waits until `webServer` exists before
 * calling `apply`, and disposes this plugin when it goes away. `webServer` is
 * provided by the `webserver` row of the web bundle (dsh-host-webserver).
 */
export const inject = ['webServer'];

/**
 * Schemastery schema for this row's `config` block. The Loader validates and
 * applies defaults before `apply(ctx, config)` runs.
 */
export const Config = z.object({
  greeting: z.string().default('Hello from the DSH host'),
});

/** Absolute pathname of the route this plugin owns. */
const HELLO_ROUTE = '/api/example-hello/hello';

/**
 * Register the plugin's host-side HTTP endpoint.
 *
 * `ctx.effect(fn, label)` owns the returned disposer, so the route is removed
 * when this plugin's fiber unloads (HMR, patch removal, shutdown).
 */
export function apply(ctx, config) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: HELLO_ROUTE,
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET');
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ greeting: config.greeting, at: new Date().toISOString() }));
        },
      }),
    `example-hello: GET ${HELLO_ROUTE}`,
  );
}
```

### 6.4 `lib/client.js` (browser half — the hand-written lazy-CJS bundle)

```js
// Browser half of dsh-plugin-hello.
//
// This is the *built bundle* the host serves at /plugins/dsh-plugin-hello/client.js.
// The host (dsh-client-modules) finds it through package.json:
//   dsh.client.platform === 'web'   and   exports["./client"]
//
// The bundle is lazy CJS, not ESM. Executing the file only registers a factory;
// the factory body runs at first materialization. `require` can resolve ONLY:
//   - the shell's static seed table (react, react/jsx-runtime, react-dom,
//     react-dom/client, @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
//     @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
//     @deepseek-ai/dsh-client-ui-dockkit)
//   - another package that is a row in the boot graph (window.__DSH_BOOT__)
//   - an already-materialized module
// Anything else throws at materialization time. This bundle needs only `react`.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-hello',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    /** Must match the host half's route. */
    const HELLO_ROUTE = '/api/example-hello/hello';

    /** Shared host-fetch hook: same-origin call to the route the host half owns. */
    function useHostGreeting() {
      const [state, setState] = React.useState({ status: 'idle' });
      const load = React.useCallback(() => {
        setState({ status: 'loading' });
        fetch(HELLO_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) =>
            response.ok
              ? response.json()
              : Promise.reject(new Error(`HTTP ${String(response.status)}`)),
          )
          .then((body) => setState({ status: 'ready', text: `${body.greeting} @ ${body.at}` }))
          .catch((error) => setState({ status: 'failed', text: String(error) }));
      }, []);
      React.useEffect(() => {
        load();
      }, [load]);
      return { state, reload: load };
    }

    /** Small additive action in the sidebar footer seat. */
    function HelloFooterAction() {
      const { state, reload } = useHostGreeting();
      const label =
        state.status === 'ready'
          ? state.text
          : state.status === 'failed'
            ? `failed: ${state.text}`
            : state.status === 'loading'
              ? 'talking to host…'
              : 'host';
      return React.createElement(
        'button',
        { type: 'button', onClick: reload, title: 'dsh-plugin-hello: GET /api/example-hello/hello' },
        label,
      );
    }

    /** Full page in Settings, contributed by this plugin. */
    function HelloSettingsSection() {
      const { state, reload } = useHostGreeting();
      return React.createElement(
        'section',
        null,
        React.createElement('h2', null, 'Hello plugin'),
        React.createElement(
          'p',
          null,
          state.status === 'ready' ? state.text : `${state.status}${state.text ? `: ${state.text}` : ''}`,
        ),
        React.createElement('button', { type: 'button', onClick: reload }, 'Ask the host again'),
      );
    }

    /**
     * Client-side cordis services this plugin needs. These are *client* service
     * names, not package names (the package-name list lives in package.json
     * `dsh.client.inject`, which only orders bundle arrival).
     */
    const inject = ['slots'];

    /** Client plugin body. `slots.inject` waits for the slot declaration. */
    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'example-hello' }, HelloFooterAction),
      );
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'example-hello', order: 90, label: () => 'Hello plugin' },
          HelloSettingsSection,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.HelloFooterAction = HelloFooterAction;
    exports.HelloSettingsSection = HelloSettingsSection;
    return module.exports;
  },
});
```

### 6.5 Install and iterate

```sh
# from the plugin checkout's parent directory.
# NOTE the explicit file: prefix — a bare /abs/path installs as `link:` and cannot resolve
# @deepseek-ai/* peers (Node follows the symlink out of the profile tree). See §1.4.
dsh plugin --profile web add file:/abs/path/to/dsh-plugin-skeleton   # verified: adds dep + bundle layer
dsh web                                                              # restart to pick up host code
```
- Edit `lib/client.js` → the browser swaps it within ~500 ms (**no rebuild step**).
- Edit `lib/index.js` → restart `dsh web` (or enable the `hmr` row, §4.4).
- Inspect without booting: `dsh web --dump-config` (needs a writable `$DSH_HOME`).

### 6.6 Verification actually performed ✅

| Check | Command | Result |
|---|---|---|
| Host half exports the right shape | `node --input-type=module -e "import('./lib/index.js')"` | `exports: Config, apply, inject, name`; `inject = ["webServer"]`; `Config` default `"Hello from the DSH host"` |
| Route registers and answers correctly | drove `apply()` with a fake ctx + `ServerResponse` double | `{"kind":"exact","path":"/api/example-hello/hello"}`; `GET → 200` + `content-type`/`cache-control` + JSON body; `POST → 405` + `allow: GET` |
| Browser bundle is valid lazy CJS | ran `lib/client.js` in a `vm` context with the real `window.__ModuleLoader__.load` signature, then materialized with a **seed-enforced** `require` | `registered id = "dsh-plugin-hello"`, `factory arity = 1`, `exports = HelloFooterAction, HelloSettingsSection, apply, inject`, **`unseeded requires = NONE`**, slot calls captured for `sidebar.footer.action` and `settings.section` |
| Bundle patch composes as a layer | `dsh web --dump-config --patch …/cordis.patch.yml` | exit 0; provenance `# == …/cordis.patch.yml` immediately above the `example-hello` row |
| Install path + reconcile | `DSH_HOME=… dsh plugin --profile web add …/dsh-plugin-skeleton` | exit 0; `+ dsh-plugin-hello link:…`; package appended to `dsh.profile.bundles` |
| Client discovery algorithm | replicated `packageDirFromAnchor` + `resolveMeta` + `nearestPackage` against the probe profile | `packageDirFromAnchor → …/node_modules/dsh-plugin-hello` (symlink); `dsh.client → {"platform":"web"}`; `exports["./client"] → ./lib/client.js`; served URL `/plugins/dsh-plugin-hello/client.js`; `nearestPackage` finds the manifest |
| Decorator syntax availability | `vm.Script('class A { @d m(){} }')` | **fails** on Node v26.7.0 → the `@Remote` decorator cannot be hand-written |

**Not verified:** the plugin was never actually booted into the running GUI. Doing so would have bound a second HTTP server (the live GUI already owns `127.0.0.1:3080`) and installed into the real `~/.dsh`, both out of scope for this session. Slot *rendering*, prop composition in a live page, and React version/identity at the outlet are the parts most likely to need a small live adjustment.

---

## 7. Uncertain, unverified, or likely to bite

**Resolved during this research (previously uncertain):**
- ✅ The skeleton's two slot registrations are **correct**: `sidebar.footer.action` and `settings.section` are both `kind: 'list'`, `scope: 'root'`, `replaceRisk: none`, so `{ name, id, order, label }` is a legal option set, and `label` is a real option (§3.4). `settings.section` does **not** require a locale-bound `label`.
- ✅ The `ctx.slots` option set, `inject` semantics, and prop-composition order are now verified from the shell bundle and real call sites (§3.4).
- ✅ A brand-new client package **does** appear without any registry rebuild — but see item 4 below for the page-reload question.

**Still open / hazards, in priority order:**

1. **Install with `file:`, never a bare path.** `dsh plugin --profile web add /abs/path` records a `link:` dependency; Node resolves the symlink to your checkout's realpath, so your plugin cannot resolve `@deepseek-ai/*` peers and boot fails with `ERR_MODULE_NOT_FOUND`. Use `file:/abs/path`. (§1.4) If you prefer a checkout-style workflow, either accept restarts and copy, or add a `node_modules/@deepseek-ai` symlink shim inside your package.
2. **Only import packages that exist in the dsh installation.** The profile sets `autoInstallPeers: false`, so `peerDependencies` are *not* installed; resolution depends entirely on the closure that `healProfilesModuleFallback` projects into `$DSH_HOME/profiles/node_modules` **at boot**. A fresh `$DSH_HOME` (or a `--dump-config` run) cannot resolve them. Vendoring is the alternative for anything else.
3. **Editing host code needs a restart.** Nothing watches your `lib/index.js` under the shipped web profile (§4.2). Client-bundle edits *do* live-reload (§4.3).
4. **Whether adding a brand-new client package needs a page reload is unconfirmed.** `rebuilt` frames do not replace the boot graph, so the first appearance of a new package almost certainly does. Assume yes.
5. **Enabling the `hmr` row for host-side module reload was not tested**, and in that configuration two HMR instances coexist (the launcher's `root: []` config-watcher plus your row's roots).
6. **`dsh.client.immediately` is undocumented in prose.** Semantics inferred from the shell's `prefetchImmediateTier()` (phase-one registration barrier). Leave it false/absent for a normal plugin.
7. **The `clientBundle` build preset is unpublished**, so any real project must reproduce the lazy-CJS wrapper (and, if it uses TS/JSX, compile before wrapping). The skeleton sidesteps this by being plain JS.
8. **`@deepseek-ai/dsh-typert-generator` is absent**, so `ctx.remote` namespaces are effectively closed to third parties. If the plugin needs a typed host RPC surface, plan on (a) a plain route, or (b) vendoring a hand-written `TYPERT`/`TYPERT_REMOTE` pair *and* patching `dsh-api-remotes` — (b) is fragile and not recommended.
9. **Route auth is opt-in.** The webserver applies no policy; without `ctx.connection.requestRejection(req)` your route answers any caller that can reach the port. Fine for the shipped loopback default, not fine if `host` is `0.0.0.0` or `trustedHosts` is widened.
10. **A bundle's own `cordis.patch.yml` is composed at boot, not watched.** Changing *your* patch layer needs a restart (or the same edit mirrored into the profile's watched `cordis.patch.yml`).
11. **`ctx.set` is effectively unusable for new services** — no shipped plugin uses it, and it throws unless the name was already `provide`d by the same fiber.
12. **Package-name uniqueness for rows.** `dsh-client-modules` throws if one client package resolves from multiple active Loader sources; do not mount the same package twice under two rows.
13. **React identity.** `react` / `react/jsx-runtime` come from the shell seed table, so the shell's React is what your component uses — do not bundle a second React copy.
14. **`private: true` in the skeleton** prevents accidental npm publish; drop it if you intend to publish, and then `files` matters. The name `dsh-plugin-hello` is unscoped — prefer a scope you control if publishing.
15. **Slot `priority` is a footgun.** The **lowest** priority renders; using `priority` (rather than `order`) to "push yourself later" silently puts you *in front*. Use `order` for ordering within a band.
16. **`replaceRisk: shadows-shipped-ui` slots** (e.g. `root`, `sidebar`, `conversation.chat.node`, `tool.call.toolview`, `settings.header`) replace an existing occupant and remove the descendant slots it declares. Stay on the `none` entries unless you intend that.

---

## Appendix — raw evidence produced in this session

| Artifact | Path |
|---|---|
| Minimal plugin skeleton (package.json, cordis.patch.yml, lib/index.js, lib/client.js) | `/Users/han/Documents/payment/code/dsh-plugin-skeleton/` |
| Workspace-only probe `$DSH_HOME` used for all boot-free verification (contains the plugin installed via `file:`) | `/Users/han/Documents/payment/code/.dsh-probe/` |
| Composed web tree without the plugin (539 rows) | `/tmp/dump1.txt` |
| Composed web tree with the skeleton's patch passed as `--patch` | `/tmp/dump2.txt` |
| Composed probe-profile tree with the plugin installed as a bundle | `/tmp/dump3.txt` |

---

## Appendix B — audit of a concurrently-built real plugin (`dsh-plugin-deepseek-balance`)

While this research ran, a sibling effort produced `/Users/han/Documents/payment/code/dsh-plugin-deepseek-balance/` (a plugin that shows the DeepSeek account balance in the sidebar and over a local HTTP route). I audited it read-only against the contracts in this report. **Verdict: the design is correct on every contract this research independently established.**

**Confirmed correct:**
- `lib/client.js` uses the exact lazy-CJS wrapper `window.__ModuleLoader__.load({ id: "dsh-plugin-deepseek-balance", factory: (require) => … })`; the `id` **equals the package name** — required, since the boot-graph row id is the package name.
- Its only `require` is `require("react")`, a **seed** word — so no `dsh.client.external` entry is needed, exactly as documented in §3.3.
- It registers into **`sidebar.footer.action`** with `{ name, id: "deepseek-balance", order: 20, locale: NS }`. That is a `list`/`root`/`replaceRisk: none` slot and `id` is required for `list` — a legal, minimal, non-shadowing registration (§3.4).
- Client `inject = ["slots", "locale"]` — both are real client services in the web roster (`slots` from `dsh-client-ui-renderer`, `locale` from `dsh-client-locale`).
- Host half exports the conventional surface — `export const name`, `export const inject = ["credentials", "webServer"]`, `export function apply(ctx, rawConfig)` — and `credentials`/`webServer` are real host services (§2.8).
- The route uses `ctx.webServer.register({ kind: "exact", path, handler })` and owns its own method check (`405` + `allow`) and headers — matching the webserver contract, which carries no method/content-type metadata (§2.6).
- It **avoids the unusable `@Remote` / Typert path** and uses a plain route + same-origin `fetch`, which is the pragmatic channel this research recommends (§3.5).
- **`lib/index.js` has zero `import` statements.** That is a decisive detail: the plugin's host half resolves no peer dependencies, so the bare-path `link:` install (below) is harmless *for this plugin as written*.
- `install.mjs` writes `{ insert: [{ id, name }] }` into the profile's **watched** `cordis.patch.yml`, and its own success message correctly says a `patchReload: live` profile applies the row without a restart.
- The installer's YAML editing resolves `yaml` from the profile anchor; verified that `createRequire("/Users/han/.dsh/profiles/web/package.json").resolve("yaml")` succeeds via the installation closure at `~/.dsh/profiles/node_modules`.

**Risks worth acting on:**
1. **`dsh.bundle.patch` is absent** (the `dsh` field declares only `client`). Installing with `dsh plugin --profile web add <dir>` therefore prints `warning: dsh-plugin-deepseek-balance declares no dsh.bundle — installed as a plain dependency, not a profile layer`, and the CLI will not reconcile a layer. That is *consistent* with `install.mjs` owning the row (shape B, §1.6) — but the two mechanisms are mutually exclusive: **if `dsh.bundle.patch` is ever added while `install.mjs` still edits the profile patch, the plugin would mount under two row ids**, which fails as `client-modules: package … resolves from multiple active Loader sources` (and a duplicate route registration throws in `webServer.register`). Pick one.
2. **The bare-path install is a latent trap.** `install.mjs` calls `dsh plugin … add resolve(HERE)`, which pnpm records as `link:` — harmless today because `lib/index.js` imports nothing, but the moment a `Config` (schemastery) or a `defineTool` (`@deepseek-ai/dsh-tools`) is added, boot fails with `ERR_MODULE_NOT_FOUND` (§1.4). Cheap pre-emption: change `resolve(HERE)` to `` `file:${resolve(HERE)}` ``.
3. **Neither `install.mjs` nor `dsh plugin` can be run by the web agent.** Both write under `~/.dsh` (and shell out to pnpm), which is outside the session workspace and denied by the sandbox. The **user** must run the install; the agent should hand over the exact command rather than attempting it.
4. **Live application of a *new* host module is inferred, not observed.** `patchReload: live` re-applies the patch through the root Include's `internal/update` → `root.update(data)`, which creates and imports the new entry; on that reasoning the row loads without a restart. It was not possible to confirm empirically here (booting would have bound a second server on 3080). Keep the "otherwise restart" fallback.
5. **The route is unauthenticated** (no `ctx.connection.requestRejection`). Acceptable for the shipped loopback default; given the route exposes account balance and supports HTML navigation (`allowHtml`), add the fence if `host` ever becomes `0.0.0.0` or `trustedHosts` widens (§3.5).
6. The plugin's `test/install-patch.test.mjs` covers the patch editor well; one worth adding is a composition assertion — run `dsh --dump-config` and require the row's provenance line, which is exactly how the skeleton's wiring was proven above (§1.4, `/tmp/dump3.txt`).
