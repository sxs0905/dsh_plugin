# dsh-plugin-deepseek-balance

一个 DeepSeek Harness (DSH) 插件：在 Web GUI 里实时显示 DeepSeek 账户余额（可同时监控多个 API key），并额外提供一个本地 HTTP 接口，方便浏览器或 `curl` 直接查看。

余额同时出现在**两个位置**，共用一个读数、各带手动刷新；配置项在「设置 → 插件」里也有一张自己的卡片：

```
① 输入框上方统计栏 —— 与「3 轮 137 步 · 265 tok/s   16.4M tok · 缓存命中 99%」
   同一行的空侧，不换行（右侧优先，右侧不够就用左侧）：
   3 轮 137 步 · 265 tok/s   16.4M tok · 缓存命中 99%      ● 余额 ¥28.28 ↓¥1.23 ⟳
                                                          ↑ 每个账户一个 pill，
                                                            配色/字号/间距与 StatsPills 一致

② 侧边栏底部（始终可见；侧边栏收起成窄栏时自动变成单行金额按钮）
   ● 余额           ¥28.28  ↓¥1.23  +1  ⟳
      ↑ 绿点=正常，黄点=账户不可用，红点=读取失败；+1 表示另有账户

③ 设置 → 插件 → 插件配置（中文名 + 描述 + 可直接编辑的配置项，改完即生效）
   ▸ deepseek 账户余额
     在输入框上方统计栏与侧边栏底部显示 DeepSeek 账户余额，并按观测到的余额下降推导今日消耗。
```

**怎么做到同一行的**：`conversation.composer.dock` 是 list slot，每个注册项是纵向堆叠的独立块，所以直接注册必然换行。这里量出本行 top 与统计行（`[data-composer-stats]`）文字顶部的差值，用负 `margin-top` 拉到统计行的水平带上，并锁定与该行相同的 `line-height`，于是两行并成一行。度量是**顺序无关**的（用两者 rect 之差，而不是假定谁在前）。

**水平方向按测量选边，绝不压上去**：统计行本身是整行元素、内容居中，token 数越长它越宽。所以每次度量都会顺带算一次可用空间 —— 内容带宽度（本行 rect 减去左右 padding）扣掉统计行**内容**占用的部分，得到左右两侧余量；右侧放得下本行（含 16px 间距）就用右侧，否则用左侧，**两侧都不够就退回居中独立一行**（`data-side="none"`），而不是叠在统计文字上。注意 `[data-composer-stats]` 是整行容器（`width:100%` + `justify-content:center`），量它自己的 rect 永远等于整条内容带、左右余量都是 0；要量的是它两枚 pill 子元素的并集（`childExtent`）。叠加还必须同时满足「量到抬升量」和「量到可用侧边」（`shouldOverlay`），否则本行保持独立一行 —— 少任何一个条件，本行都会居中压在统计文字上。这一步跟随 `followLift` 的同一批触发器重算，所以统计行变宽会即时改选边。叠加状态下若只有一个账户，会省略「余额」二字以争取宽度，文案仍在 tooltip 里。

**为什么要持续度量**：统计行在空会话（或统计投影还没到）时**并不存在**，只量一次的实现在那一刻只能拿到 0，本行就会永久停在自己的那一行上 —— 这正是「输入框上方的余额被换行」的成因。所以度量是自愈的：挂载时同步量一次，之后每次渲染、统计行出现或消失（MutationObserver）、统计行与 composer 尺寸变化（ResizeObserver）、窗口缩放、字体加载，以及几次延迟补测（120 / 500 / 1500 ms）都会重测。每次测量还会先把自己当前的 `margin-top` 加回去，否则「在已抬升的基础上再量」会让每次重测都继续把这一行往上推。

- **多 key**：默认只查 `DEEPSEEK_API_KEY`（行为与之前完全一致）；配置 `accounts` 后并行查询多个 key，每个账户独立显示、独立报错，一个失败不影响其它。
- **今日消耗**：每个账户额外显示 `↓¥1.23` —— 按观测到的余额下降累计（DeepSeek 没有用量/账单接口，所以这是推导值，不是官方账单，详见下文）。
- **手动刷新**：每个位置都有 `⟳` 按钮，点击即走 `?force=1` 跳过服务端缓存；读取中按钮转圈并禁用。窄栏模式下位置不够，金额本身即刷新按钮。
- **实时**：客户端每 30 秒拉取一次（页面隐藏时暂停，重新可见时立即刷新）。
- **准确**：数据来自 DeepSeek 官方接口 `GET https://api.deepseek.com/user/balance`，是账户真实余额，不是本地估算。
- **安全**：API Key 只通过 harness 的凭据服务在**服务端**解析，绝不会下发到浏览器；页面/接口都不返回密钥。

## 数据来源

官方文档：[Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <DEEPSEEK_API_KEY>
```

```json
{
  "is_available": true,
  "balance_infos": [
    { "currency": "CNY", "total_balance": "31.71", "granted_balance": "0.00", "topped_up_balance": "31.71" }
  ]
}
```

金额是**字符串**；`balance_infos` 是数组，理论上可能返回多个币种（CNY / USD），插件会把每一项都展示出来。赠金优先扣减，`total = granted + topped_up`。

## 打包与安装

### 打包

```sh
npm run pack          # 等价于 npm pack，产出 dsh-plugin-deepseek-balance-1.2.0.tgz
```

产物只含运行期文件（`lib/index.js`、`lib/client.js`、`package.json`、`README.md`、`docs/`），约 76 KB：

```
package/lib/client.js
package/lib/index.js
package/package.json
package/README.md
package/docs/deepseek-balance-api.md
package/docs/dsh-plugin-research.md
```

### 安装

> 新机器 / 重装 DSH / 删掉 `~/.dsh` 之后的完整步骤（含前置条件、profile 初始化、验证与排错）见下文 **[重装 DSH 之后：从本仓库源码重新安装](#重装-dsh-之后从本仓库源码重新安装详细步骤)**；下面只是命令速查。

```sh
cd dsh-plugin-deepseek-balance
node install.mjs --tarball       # 打包 + 安装产物（推荐，等同发布安装）
node install.mjs --copy          # 安装本目录的真实副本
node install.mjs                 # 开发模式：pnpm link 到本目录
node install.mjs --profile tui   # 指定其它 profile
```

三种方式的区别：

| 方式 | 依赖记录 | 特点 |
|---|---|---|
| `--tarball` | `file:...tgz` | **推荐**。和发布安装完全一致；`node_modules` 里是 profile 内的真实目录（`node_modules/.pnpm/...`），与源码目录解耦，裸导入也能正常解析 |
| `--copy` | `file:<目录>` | 真实目录副本，同样与源码解耦 |
| 默认 | `link:<目录>` | 开发用：改 `lib/client.js` 会被客户端 HMR 轮询到并热更新。代价是 Node 会解析到本仓库真实路径，host 半因此不能 import 第三方包（当前满足），否则用 `--tarball` |

`--tarball` / `--copy` 会先 `pnpm remove` 再 `add`：pnpm 在只改说明符时会沿用旧的 `link:` 解析，不先移除的话 `node_modules` 仍指向本仓库（这个坑已实测并绕开）。

脚本做两件事：

1. `dsh plugin --profile web add <spec>`，由 pnpm 把包物化进 profile 的 `node_modules`；
2. 往 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加一行 loader 行（保留原文件注释，输出块状 YAML）：

```yaml
- insert:
    - id: deepseek-balance
      name: dsh-plugin-deepseek-balance
```

脚本是幂等的：重复执行不会重复添加，也不会重复打包出错。

### 装完之后

`web` profile 的 `patchReload` 是 `live`，所以这一行会被热加载，**新行本身无需重启即刻生效**（实测：端点立即可用，客户端模块也立刻进入了 boot graph）。但两点必须注意：

- **已经打开的页面需要刷新一次浏览器** —— boot graph 只在页面加载时读取，新模块不会推给运行中的页面；
- **改 `lib/index.js`（host 半）必须重启 profile** —— `patchReload: live` 只监听 `cordis.patch.yml` 的**配置**变化，不会重新 import 已加载过的模块（实测：只改配置时行会被实时重应用，host 代码仍是旧的）。客户端 bundle 相反，改 `lib/client.js` 会被 HMR 热更新。

### 卸载

```sh
node install.mjs --remove
```

## 重装 DSH 之后：从本仓库源码重新安装（详细步骤）

换机器、升级/重装 `@deepseek-ai/dsh`、或者删掉 `~/.dsh` 之后，按这一节把插件装回去。下面把源码目录记作 `$PLUGIN`（即本仓库里的 `dsh-plugin-deepseek-balance/`），所有 `node install.mjs` 命令都在该目录里执行。

### TL;DR

```sh
# 0) 前置检查：node、pnpm、npm，以及全局的 dsh
node -v            # DSH 要求 ^22.19.0 或 >=24.0.0
pnpm -v            # install.mjs 通过 `dsh plugin` 调用 pnpm
dsh --version

# 1) 先启动一次 profile：生成 profiles/web/ 和依赖闭包（install.mjs 需要其中的 yaml）
dsh web            # 看到打印的 http://127.0.0.1:3080/?token=… 后 Ctrl-C 即可

# 2) 从源码打包并安装插件（= pnpm add + 写入 loader 行）
cd $PLUGIN
node install.mjs --tarball

# 3) 重启 profile：host 半不会被热重载
dsh web

# 4) 刷新浏览器，确认余额出现，且「设置 → 插件 → 插件配置」里有「deepseek 账户余额」
```

### 第 0 步：前置条件

| 依赖 | 要求 | 检查 |
|---|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0`（DSH 本体要求；本插件自身只需 >=18） | `node -v` |
| `dsh` | 全局安装的 `@deepseek-ai/dsh` | `dsh --version` |
| pnpm | `install.mjs` 走 `dsh plugin … add`，最终由 pnpm 物化依赖 | `pnpm -v` |
| npm | `--tarball` 模式用 `npm pack` 打包 | `npm -v` |

安装/升级 DSH 本体（两选一，`:latest` 或指定版本）：

```sh
npm install -g @deepseek-ai/dsh
# 或（pnpm 全局安装，需要放行的三个原生构建包）
pnpm add -g --allow-build=@deepseek-ai/dsh-subprocess-local --allow-build=koffi --allow-build=node-pty @deepseek-ai/dsh
```

`dsh` 不在 PATH 时，`install.mjs` 支持显式指定：

```sh
DSH_BIN=/path/to/dsh node install.mjs --tarball
```

### 第 1 步：让 profile 存在（并装好依赖闭包）

`install.mjs` 会往 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 写 loader 行，并用 profile 闭包里的 `yaml` 解析该文件，所以**目标 profile 必须先存在、且至少启动过一次**：

```sh
dsh web                    # 默认 profile；等价于 dsh --profile web
# 其它 profile：dsh --profile tui（或 dsh plugin --profile tui …）
```

- 首次启动会在 `$DSH_HOME`（默认 `~/.dsh`）下生成 `profiles/web/`，并**在启动过程中**把依赖闭包装进 `profiles/node_modules/`（含 `yaml`）。看到终端打印的 `http://127.0.0.1:3080/?token=…` 就说明起来了，按 Ctrl-C 退出即可，不影响后续安装。
- 只想生成 profile 文件、不启动服务：`dsh --profile web --dump-config`。但它**不会**安装 `profiles/node_modules/`，因此随后运行 `install.mjs` 会提示 `could not load 'yaml'` 并把要手动添加的 loader 行打印出来（见「常见问题」）。
- 自定义 `DSH_HOME`：`DSH_HOME=/path/to/home dsh web`，后续 `install.mjs` 也用同一个 `DSH_HOME`（脚本默认读 `$DSH_HOME`，没设就用 `~/.dsh`）。

### 第 2 步：从源码安装插件

```sh
cd $PLUGIN
node install.mjs --tarball
```

它依次做四件事（幂等，可反复执行）：

1. `npm pack` 把当前目录打成 `dsh-plugin-deepseek-balance-<version>.tgz`（只含 `lib/`、`package.json`、`README.md`、`docs/`）；
2. `dsh plugin --profile web remove dsh-plugin-deepseek-balance`（忽略失败：避免 pnpm 沿用旧的 `link:` 解析）；
3. `dsh plugin --profile web add file:$PLUGIN/dsh-plugin-deepseek-balance-<version>.tgz`，由 pnpm 把包（以及它的运行期依赖 `@deepseek-ai/schemastery`）装进 profile 的 `node_modules`；
4. 往 `cordis.patch.yml` 追加 loader 行（已存在则跳过）。

其它模式见上文「安装」小节的对照表：`--copy`（目录副本）、默认 `link:`（开发用，客户端 HMR 热更新）、`--profile <name>`、`--remove`。

> **源码里必须带 `lib/`**：本仓库根 `.gitignore` 原有一条 `lib/`（DSH monorepo 的构建产物规则），会连 `dsh-plugin-deepseek-balance/lib/` 一起忽略——新克隆的仓库里没有 `lib/client.js`、`lib/index.js`，装出来的包是空的。仓库已加了一行例外：

```gitignore
!dsh-plugin-deepseek-balance/lib/
```

> 即便如此，**这两个文件必须真的提交进 git**：`git add dsh-plugin-deepseek-balance/lib/` 之后它们会出现在 `git status` 里（例外生效后不再需要 `-f`）。如果是从旧机器拷源码，直接连 `lib/` 一起拷即可。

### 第 3 步：重启 profile

```sh
# 在原来的终端里 Ctrl-C，然后
dsh web
```

原因是 host 半不会被热重载：

- `patchReload: live` 只监听 `cordis.patch.yml` 的**配置**变化。插件**第一次**被这个 profile 加载时，loader 行热应用即可生效；但**已经加载过**的 host 模块仍留在 Node 的模块缓存里，替换 `lib/index.js` 后必须重启才会重新 import（实测：摘掉再放回 loader 行能观察到路由 404→200，但模块仍是旧代码）。
- 客户端 bundle 相反：`dsh-client-hmr` 每 500ms stat-poll 已安装的 `lib/client.js`，改动会热更新并重挂插件。

所以「新装」通常只需**刷新一次浏览器**；「升级已装过的插件」需要**重启 profile + 刷新浏览器**。设置面板里的那张卡片由 host 半注册，因此升级后也要重启才会出现。

### 第 4 步：配置 API Key

插件通过 harness 凭据服务解析 `apiKeyRef`（默认 `DEEPSEEK_API_KEY`），密钥本身不落插件配置。任选一种：

```sh
# a) 环境变量（启动 dsh web 的那个终端）
export DEEPSEEK_API_KEY=sk-…

# b) $DSH_HOME/.credentials.yaml
#    refs:
#      DEEPSEEK_API_KEY: sk-…

# c) 项目目录下的 .env（若你的部署启用）
```

也可以直接在 GUI 的「设置 → 模型」里配置。没配置时余额处显示「读取失败」，`/deepseek-balance` 返回 503 + `no-credential`。

### 第 5 步：验证

```sh
# 1) 接口（在跑着 dsh web 的前提下）
curl -s http://127.0.0.1:3080/deepseek-balance | head -20

# 2) 离线单测（需要先装开发依赖，因为测试会真的 import schemastery）
cd $PLUGIN
npm install --no-package-lock --no-audit --no-fund
node test/run-tests.mjs            # 235 passed
node test/install-patch.test.mjs   # 17 passed
node test/run-tests.mjs --live     # 可选：用真实凭据打真实接口

# 3) 对着运行中的实例验客户端 bundle（只读，不会写 profile）
node test/verify-live.mjs          # 20 passed
```

界面上确认三处：输入框上方统计栏（或它下面一行）、侧边栏底部的余额胶囊、「设置 → 插件 → 插件配置」里标题为 **deepseek 账户余额** 的卡片（展开有 5 个配置项）。

### 升级 / 迁移 / 卸载

| 场景 | 做法 |
|---|---|
| 改了源码要生效 | 在 `$PLUGIN` 重新 `node install.mjs --tarball`，然后重启 `dsh web` + 刷新浏览器 |
| 源码目录**换了位置** | profile 里记的是绝对路径（`file:/…/xxx.tgz`），旧的会失效；到新位置重新 `node install.mjs --tarball` 即可（脚本先 remove 再 add） |
| 只升级到刚打好的包 | `npm run pack` 后 `node install.mjs --tarball`（先 remove 再 add 会刷新 lock 里的 tarball 校验；同版本号但 tgz 内容变了时，直接 `dsh plugin --profile web update` 会撞上 integrity 校验），然后重启 |
| 彻底重置 | `rm -rf ~/.dsh/profiles/web && dsh web`（重新生成 profile），再执行第 2、3 步 |
| 卸载 | `cd $PLUGIN && node install.mjs --remove`（移除依赖 + loader 行） |

装完之后文件落在：

```
~/.dsh/profiles/web/package.json          # dependencies: "dsh-plugin-deepseek-balance": "file:/…/dsh-plugin-deepseek-balance-1.2.0.tgz"
~/.dsh/profiles/web/node_modules/…        # 包实体（含 @deepseek-ai/schemastery）
~/.dsh/profiles/web/cordis.patch.yml      # loader 行：- insert: [{ id: deepseek-balance, name: dsh-plugin-deepseek-balance }]
~/.dsh/deepseek-balance-ledger.json       # 今日消耗账本（可选，trackDailySpend 关闭时不写）
~/.dsh/.credentials.yaml                  # API Key（refs.DEEPSEEK_API_KEY）
```

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `install.mjs: could not load 'yaml'` | profile 还没启动过，`profiles/node_modules` 未生成。先 `dsh web` 起一次再重跑；或把脚本打印的两行 YAML 手动加进 `cordis.patch.yml`，然后重启 |
| `dsh: command not found` | 没全局装 DSH，或不在 PATH。`npm i -g @deepseek-ai/dsh`，或用 `DSH_BIN=… node install.mjs --tarball` |
| `pnpm failed in profile directory` | 缺 pnpm（`npm i -g pnpm`）；或 profile 目录没有写权限 |
| `Cannot find package '@deepseek-ai/schemastery'` | 用默认 `link:` 从**没有 `node_modules` 的源码目录**安装时，host 半解析不到这个运行期依赖（插件本身仍可用，只是没有设置卡片）。改用 `--tarball`，或在源码目录先 `npm install` |
| 新克隆的仓库装出来是空包 / `lib/client.js` 不存在 | `lib/` 被 gitignore 了。`git add dsh-plugin-deepseek-balance/lib/` 后提交（仓库已加 `!dsh-plugin-deepseek-balance/lib/` 例外，必要时仍可 `-f`），或从旧机器拷贝 `lib/` |
| 余额显示了，但设置面板里没有卡片 | host 半是旧代码：重启 `dsh web`。还要确认 DSH 版本带设置面板（`0.1.5-rc` 系列已含 `settings.plugin.item`，本插件按该契约实现） |
| 输入框上方余额和统计栏叠在一起 | 属于已修复的显示问题（1.1.4 起）；确认装的是当前版本 |
| 余额显示「读取失败」/ 接口 503 | 没配 `DEEPSEEK_API_KEY`，或密钥无效；见第 4 步 |
| 改了 `lib/client.js` 但页面没变 | 客户端 HMR 有约 500ms 轮询；仍无变化就刷新页面（HMR 失败时不会回滚，下一次重建帧会重试） |

## 直接查看余额

```sh
# JSON（force=1 跳过 15 秒缓存）
curl -s http://127.0.0.1:3080/deepseek-balance | jq
curl -s 'http://127.0.0.1:3080/deepseek-balance?force=1' | jq

# 浏览器打开会渲染成一张卡片
open http://127.0.0.1:3080/deepseek-balance
```

返回示例（多账户；未配置 `accounts` 时 `accounts` 只有一项）：

```json
{
  "ok": true,
  "partial": false,
  "fetchedAt": "2026-09-20T07:20:11.482Z",
  "cached": false,
  "accounts": [
    {
      "id": "main", "label": "主账号", "ok": true,
      "available": true, "fetchedAt": "2026-09-20T07:20:11.482Z", "cached": false,
      "primary": { "currency": "CNY", "total": "28.28", "granted": "0.00", "toppedUp": "28.28" },
      "balances": [ { "currency": "CNY", "total": "28.28", "granted": "0.00", "toppedUp": "28.28" } ],
      "keyRef": "DEEPSEEK_API_KEY", "keySource": "file",
      "spentToday": "1.23", "spentDate": "2026-09-20"
    }
  ],
  "primary": { "currency": "CNY", "total": "28.28", "granted": "0.00", "toppedUp": "28.28" },
  "balances": [ { "currency": "CNY", "total": "28.28", "granted": "0.00", "toppedUp": "28.28" } ],
  "keyRef": "DEEPSEEK_API_KEY",
  "keySource": "file",
  "spentToday": "1.23",
  "spentDate": "2026-09-20"
}
```

`spentToday` 在 `accounts[i].balances[j]` 上也有（按币种），账户级和顶层是主币种的镜像；关闭统计时该字段整体不出现。

语义：

- `ok` —— **至少一个**账户读到了余额；`partial` —— 有成功也有失败。
- HTTP 200 当 `ok: true`（即使 `partial`），全部失败才 503。
- 顶层 `primary`/`balances`/`keyRef`/`keySource` 镜像**第一个成功**的账户，所以单账户消费者（以及旧版客户端）不用改。
- 每个账户的失败单独放在 `accounts[i].error`，互不影响。

失败时的 `error.code`：

| code | 含义 |
|---|---|
| `no-credential` | 该引用没有配置密钥 |
| `credential-error` | 凭据服务解析失败 |
| `http-<status>` | 上游返回非 2xx（如 `http-401` 密钥无效） |
| `bad-json` | 上游返回的不是 JSON |
| `timeout` | 超过 `timeoutMs` 未响应 |
| `network` | 网络/DNS/TLS 等错误 |

## 多个 key 与「同一账户」

插件**不做**「这些 key 是不是同一个账户」的推断。原因是官方 API 没有账号标识可比，只能靠余额快照相同去猜，而这个猜法会稳定误报：同一活动的赠金额度是固定的，两个素未使用的新账户必然逐项相同。

所以这里就是**一把 key 一行余额**，你配几个 `accounts` 就显示几行，互不合并、互不影响。

如果你确实想确认两个 key 的归属，用平台控制台核对即可 —— 这属于账号管理，不属于余额展示。

## 今日消耗是怎么算出来的

**先说明数据来源**：DeepSeek **没有**任何用量或账单查询接口。API Reference 里只有 Chat Completions / Responses / FIM / Lists Models / Get User Balance / Files；控制台的用量页面是网页 session 鉴权，API key 调不到。所以「今日消耗」只能是**推导值**。

推导方式（`lib/index.js` 的 ledger）：

1. 每次拿到**新**余额时，把该账户该币种的 `total_balance` 折成整数「分」，和上一次观测值比较；
2. **只把下降计入** `spentToday`。上升（充值 / 新赠金）一律不计 —— 这样充值永远不会被算成负消耗，而充值之后的下降仍然记在新基线上；
3. 本地跨天（`YYYY-MM-DD` 本地时区）时 `spentToday` 归零，但**保留上一次的 total 作为新一天的基线**，所以跨天那一段的下降会归到新的一天；
4. 状态持久化在 `$DSH_HOME/deepseek-balance-ledger.json`，**重启 profile 不清零**（详见下面的「落盘方案」）。

采样频率决定了准确性：

| 来源 | 间隔 | 说明 |
|---|---|---|
| 浏览器轮询 | 30 秒 | 页面打开时 |
| 后台采样器 | 5 分钟（`sampleMs`） | 页面关着也在采，否则「今日消耗」会有大段空洞 |

### 落盘方案

**文件与格式** —— JSON，单文件，键是 `账户id|币种`：

```json
{
  "version": 1,
  "accounts": {
    "main|CNY":   { "date": "2026-09-20", "spentCents": 145, "lastTotalCents": 2551 },
    "main|USD":   { "date": "2026-09-20", "spentCents": 0,   "lastTotalCents": 500 },
    "backup|CNY": { "date": "2026-09-20", "spentCents": 50,  "lastTotalCents": 950 }
  }
}
```

- `date` —— 该条目所属的**本地**日期，跨天时归零；
- `spentCents` —— 当天累计消耗，单位是**分**（整数）。金额一律折成整数分再累加，避免二进制浮点漂移；
- `lastTotalCents` —— 上次观测到的 total，作为下一次比较的基线；
- `version` —— 文档版本，留作将来迁移。

**写入时机**（分三档，这是关键设计）：

| 触发 | 是否立即写 | 原因 |
|---|---|---|
| 记录到一次**下降**（即真的产生了消耗） | **立即** | 这是账本存在的意义；若节流后紧接着一次充值把差额抹平，这段消耗将无法再推导出来 |
| 仅更新基线（首次观测、跨天重置） | 5 秒节流 | 丢了会**自愈**：下次读取会用上次落盘的基线重新算出同一次下降 |
| 卸载 fiber（profile reload）/ 进程 exit（含 Ctrl-C） | 强制写 | 两条关闭路径都挂上了 flush，见下 |

**原子性** —— 先 `mkdirSync(dirname, { recursive: true })` 建目录，写 `<path>.tmp`，再 `renameSync` 覆盖正式文件。同目录 rename 在 POSIX 上是原子的，所以任何时刻读到的要么是旧的完整文档，要么是新的完整文档，不会出现半截 JSON。

**加载与容错** —— 插件加载时读一次：文件不存在（`ENOENT`）静默接受；其它读取/解析失败只记一条 warn 并退回空账本（相当于重新建基线），**不会让插件加载失败**。文档形状会校验（`accounts` 必须是对象且不是数组），不合法则忽略。

**关闭时的一致性** —— 两条路径都强制 flush：

```js
const onExit = () => ledger.flush(true);
process.once("exit", onExit);
return () => { process.off("exit", onExit); ledger.flush(true); };
```

fiber 卸载（dispose）时移除 `exit` 监听并 flush；进程退出时由 `exit` 钩子 flush。因为用的是同步 IO，在 `exit` 处理器里也能写完。

**为什么用同步 IO** —— 每次几百字节、正常情况下每 30 秒最多一次。同步写换来的是「不存在交错写、不存在 await 之后再被别的事件改写状态」，代价是事件循环阻塞在微秒量级。异步写在这里只会引入竞态而没有任何收益。

**已知限制**：

- **未加跨进程锁**。同一个 `ledgerPath` 被两个 profile 同时打开会互相覆盖（后写者赢）。默认路径在 `$DSH_HOME` 下、按 profile 共用，所以别把同一个 profile 跑两份。
- **`SIGKILL` 无法拦截**：最多丢掉最后一次未落盘的基线更新（下降是立即写的，所以基本不丢消耗）。
- **旧条目不清理**：从 `accounts` 配置里移除的账户，其键会留在文件里；它只占几十字节，且该账户再被加回来时还能接上当天累计。
- 崩溃后重读时，如果同一窗口内既有下降又有充值，那次下降可能被少算 —— 这正是"下降立即写"想压掉的窗口，现已缩到单次写入延迟。

### 边界与误差（请当成估算）

- **只能统计观测到的下降**。如果两次采样之间先充值又消耗、且净额是上升的，那部分消耗会被漏掉。
- **首次运行从 0 开始**：第一次观测只建立基线，不产生消耗。所以装好当天看到的是「从装好那一刻起」的消耗，不是当天 0 点起的。
- **多币种分开记**（按 `账户|币种` 建键），不会把 CNY 和 USD 加在一起。
- 这不是官方账单，**对账请以平台控制台为准**。

## 配置（可选）

在 `cordis.patch.yml` 的那一行里加 `config`：

```yaml
- insert:
    - id: deepseek-balance
      name: dsh-plugin-deepseek-balance
      config:
        # 默认（不写 accounts）等价于下面这一项，行为与旧版一致
        accounts:
          - id: main                 # 可选，默认用 label 或 account-N
            label: 主账号             # 可选，显示名；不写则显示余额/密钥名
            apiKeyRef: DEEPSEEK_API_KEY
          - id: backup
            label: 备用
            apiKeyRef: DEEPSEEK_API_KEY_BACKUP
        baseUrl: https://api.deepseek.com
        routePath: /deepseek-balance  # 对外路径
        cacheMs: 15000                # 每个账户独立缓存，避免频繁打上游
        trackDailySpend: true         # 统计今日消耗（默认开）
        sampleMs: 300000              # 后台采样间隔，5 分钟；0 关闭
        timeoutMs: 10000
        allowHtml: true               # 浏览器访问时渲染卡片
```

`accounts` 最多 20 项；`id` 重复会自动去重。旧的单 key 写法仍然有效：

```yaml
        apiKeyRef: MY_OTHER_KEY        # 等价于 accounts: [{ id: account-1, apiKeyRef: MY_OTHER_KEY }]
```

密钥本身不写在配置里 —— 只写**引用名**，实际值由 harness 凭据服务解析（环境变量 / `$DSH_HOME/.credentials.yaml` / `.env`）。

### 在「设置 → 插件」里直接改（1.2.0+）

`package.json` 里**没有**能改插件管理面板文案的元数据字段：本版 DSH 的 `dsh` 清单只认 `bundle` / `profile` / `client` / `configTrees` / `sessionFormatMigration` / `moduleFallback`（见 `@deepseek-ai/dsh-package-manifest` 的 `DshManifest`），面板也不读 `description`。要出现在「设置 → 插件 → 插件配置」里，走的是插件自己贡献一张卡：**host 半注册一个 settings 命名空间，client 半用同一个命名空间为 key 注册进 `settings.plugin.item` slot**，卡片自己画标题、描述和字段。本插件已按这条路实现：

- 命名空间 `deepseek-balance`，卡片标题「deepseek 账户余额」，带一段描述；
- 卡片是 host 半注册的，所以**装好新版后要让 host 半重新 import 一次（重启 `dsh web`）卡片才会出现**；之后在面板里改这些字段即时生效，不需要再重启；
- 字段（用户层覆盖 loader 行配置，**改完即生效，无需重启**）：

| 卡片字段 | 覆盖的配置 | 说明 |
|---|---|---|
| 凭据引用 | `apiKeyRef` | 未配置 `accounts` 时生效；留空回到默认值 |
| 统计今日消耗 | `trackDailySpend` | 关掉后不再推导、不再写账本（缓存会一并失效） |
| 服务端缓存（毫秒） | `cacheMs` | `0` 表示每次都读上游 |
| 上游超时（毫秒） | `timeoutMs` | 最小 1000 |
| 后台采样间隔（毫秒） | `sampleMs` | `0` 关闭，会即时重启采样定时器 |

生效优先级是 **schema 默认值 < loader 行 `config`（作为 base 层） < 设置面板里的用户层**，即面板里改过的字段覆盖 YAML，其余继续用 YAML。`accounts` / `baseUrl` / `routePath` / `allowHtml` / `ledgerPath` 仍只认 YAML（`routePath` 之类改了本来就需要重启）。

实现细节：host 半用 `ctx.inject(["settings"], …)` + `ctx.settings.installSection(...)`（`@deepseek-ai/schemastery` 是运行期依赖，通过动态 `import()` 加载，因此缺少它或缺少 settings 服务时只丢卡片、不影响余额功能）；client 半用 `ctx.inject(["settingsScope"], …)` 绑定同一命名空间，编辑先暂存、点「保存」才写入（写入是带 revision 校验的持久化文档变更）。卡片样式直接对齐官方卡片（同样的圆角、配色、`--dsw-alias-*` token）。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `accounts` | `[{ apiKeyRef: "DEEPSEEK_API_KEY" }]` | 要监控的账户列表，每项 `{ id?, label?, apiKeyRef }`；也可以直接写字符串数组 |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 未配置 `accounts` 时的单账户引用 |
| `baseUrl` | `https://api.deepseek.com` | 官方文档只保证这个域名；不要加 `/v1` |
| `routePath` | `/deepseek-balance` | 自动补前导斜杠 |
| `cacheMs` | `15000` | 每账户独立缓存，`?force=1` 可绕过；设 `0` 完全关闭缓存 |
| `trackDailySpend` | `true` | 是否统计今日消耗；`false` 则不读不写 ledger，也不返回 `spentToday` |
| `ledgerPath` | `$DSH_HOME/deepseek-balance-ledger.json` | 状态文件位置，可改为任意可写路径 |
| `sampleMs` | `300000` | 后台采样间隔（毫秒），让没有浏览器轮询时也能记账；设 `0` 关闭 |
| `timeoutMs` | `10000` | 单次上游请求超时 |
| `allowHtml` | `true` | `Accept: text/html` 时返回卡片而不是 JSON |

## 为什么这样实现

- **host 半**（`lib/index.js`）：只用 `node:` 内置模块，不 import 任何第三方包。这样默认的 `link:` 安装方式也能正常加载（软链会让 Node 解析到真实路径，第三方裸导入可能解析不到）。
- **服务端缓存 + 请求合并**：每个账户一份缓存与一个在途 Promise，多个客户端/多次点击共享同一次上游请求。
- **客户端半**（`lib/client.js`）：手写的 `window.__ModuleLoader__.load({ id, factory })` bundle，只 `require` 浏览器平台模块表里已有的 `react`。注册进两个通用 list slot —— `conversation.composer.dock`（输入框上方统计栏）和 `sidebar.footer.action`（侧边栏底部）—— 不依赖任何私有 UI API；两个席位共用一个 `useBalance()` 读数 hook。dock 席位的配色与几何直接对齐 `StatsPills`（`--dsh-chat-content-width`、`--dsh-composer-side-clearance`、`--dsw-alias-label-tertiary`、24px 圆角 pill）。
- 不复用 Typert Remote（第三方插件无法新增 `ctx.remote.*` 命名空间：代码生成器不在安装闭包里），改用 webserver 的普通命名路由，客户端直接 `fetch` 相对路径，同源、无需 token。

## 开发提示

- 改 `lib/client.js`：以 `file:`（tarball 或目录副本）安装时，服务端加载的是 profile 里 `node_modules/dsh-plugin-deepseek-balance/lib/client.js` 那份**副本**，改源码目录不会生效（要重新 `node install.mjs --tarball`）。直接覆盖那份副本则**实测服务端立即返回新内容**——boot index 的 `rev` 只跟随 bundle 内容变化（重装同一份 bundle、只改版本号后 `rev` 不变），`dsh-client-hmr` 每 500ms stat-poll 该文件并推送重挂，所以通常无需重启 profile；界面没变化时刷新一次浏览器即可。
- 改 `lib/index.js`：host 半不会热重载，需要重启 profile（改 `cordis.patch.yml` 里的 `config` 会被实时重应用，但模块代码不会重新 import）。
- 插件包**不要**同时声明 `dsh.bundle.patch`：那会让 CLI 把它加入 `bundles` 层，与 `install.mjs` 写的 loader 行重复挂载同一个包（client-modules 会因同一包出现在多个 Loader 源而报错）。当前实现刻意只用 loader 行这一种方式。

## 安全说明

- 路由只返回余额与元数据，**不返回 API Key**（有测试覆盖）。
- 默认 DSH webserver 只监听 `127.0.0.1`。若你改成 `0.0.0.0`，该路由也会对局域网开放；此时余额信息（非密钥）可被网内读取，请自行评估。
- 插件不设置 CORS 头，因此其它网站的页面无法在浏览器里读取本接口的响应。
- 额外拒绝 `Sec-Fetch-Site: cross-site` 的请求（403），作为 harness 自身信任边界之外的一层防护。

## 测试

```sh
node test/run-tests.mjs          # 164 项：host 逻辑、多账户、今日消耗 ledger（累计/充值/跨天/持久化/多币种/后台采样）、HTML、请求卫生、客户端两个席位与渲染
node test/run-tests.mjs --live   # 追加一次读取真实凭据 + 真实 API 的调用
node test/install-patch.test.mjs # 17 项：cordis.patch.yml 编辑器（幂等、保留注释、块状输出）
node test/verify-live.mjs        # 18 项：对运行中的 GUI 做端到端核验（只读，不重启）
```

`verify-live.mjs` 会自己签发 harness 的浏览器 cookie（用 `$DSH_HOME/.credentials.yaml` 里的 `client-connection/browser-session` 密钥做 HMAC），抓取 boot index，确认：

- 插件出现在 `__DSH_BOOT__` 的客户端模块表里；
- 它的 combo bundle 真的被 `/plugins/...` 提供，且包含两个席位、刷新控件与同一行的度量逻辑；
- 余额路由返回 `ok: true`，且响应里没有密钥。

前两个套件完全 hermetic（本地假上游），只有 `--live` 与 `verify-live.mjs` 会访问真实网络/GUI。

## 文件

```
dsh-plugin-deepseek-balance/
├── package.json                              # main/exports + dsh.client 声明 + scripts
├── lib/index.js                              # host 半：凭据解析、余额读取、缓存、HTTP 路由
├── lib/client.js                             # 浏览器半：手写 module-loader bundle + 统计栏/侧边栏两个席位
├── install.mjs                               # 安装/卸载（link / copy / tarball + cordis.patch.yml 编辑）
├── dsh-plugin-deepseek-balance-1.2.0.tgz     # 打包产物（npm run pack / install.mjs --tarball）
├── docs/
│   ├── deepseek-balance-api.md               # 官方余额接口调研（含来源链接）
│   └── dsh-plugin-research.md                # DSH 插件体系调研（host/client/slot/HMR）
└── test/
    ├── run-tests.mjs
    ├── install-patch.test.mjs
    └── verify-live.mjs
```

`package.json` 的 scripts：

| 命令 | 作用 |
|---|---|
| `npm test` | 跑 `run-tests.mjs` + `install-patch.test.mjs`（离线，181 项） |
| `npm run test:live` | 追加一次真实凭据 + 真实 API 的调用 |
| `npm run verify` | 对运行中的 GUI 做端到端只读核验 |
| `npm run pack` | 产出 tgz |
