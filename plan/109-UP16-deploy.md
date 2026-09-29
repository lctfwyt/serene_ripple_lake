# 109 · UP16 上云（Netlify 静态部署）

> **波次 17** · 前置：**UP14 合并**（`package.json`/`README.md` 与它重叠，必须串行）· 并行：UP15（`108`，文件不重叠）
> **本包零渲染代码、零音频、零参数** —— 只产出**部署配置**与**部署文档**。
> 变更单：**AM-035**（跨包写权限：`package.json`（共享）· `README.md`（WP5））。
> 写作纪律见 `03-COLLAB-PROTOCOL.md`（§7.4 白名单定义）。

---

## 1. 目标

让 `dist/` **一条命令 / 一次拖拽**即可上线到 Netlify，并把「怎么上线」写进 README。
**不做** PWA（那是 `110-UP17`）、**不改**任何页面行为。

> 交付物现状（`107 §1` 实测）：`dist/index.html` ≈ 770 KB（JS/CSS 全内联）· `dist/assets/audio/` 8.08 MB / 14 文件 · **合计 ≈ 8.9 MB / 15 文件** · 全部相对路径 ⇒ 子路径 / 任意域名都能开。

---

## 2. 改动清单（= §7.4 白名单 ①）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `netlify.toml`（**新建**） | 构建与发布配置 + 缓存头 + manifest MIME（§3） |
| 2 | `.nvmrc`（**新建**） | `22`（`vite@8.3.0` 要求 `^20.19 \|\| >=22.12`；本机 `22.22.2`） |
| 3 | `package.json` | 新增 1 条 script：`"deploy": "npx --yes netlify-cli deploy --prod --dir=dist"`（**仅加一行**，不动其它） |
| 4 | `README.md` | 新增「部署」一节（§4） |

**写权限申报（对照 `01-CONTRACT §7` 所有权表）**：

| 文件 | 契约所有者 | 本包动作 | 授权 |
|---|---|---|---|
| `package.json` | 共享（「并行波次须指定单一所有者」） | 加 1 条 script | AM-035（本包独占该时刻，无并行） |
| `README.md` | WP5 | 追加一节 | AM-035 |
| `netlify.toml` · `.nvmrc` | —（新文件，无既有所有者） | 新建 | 不需 AM，随本包声明 |

---

## 3. `netlify.toml` 规格

```toml
# netlify.toml —— UP16 · Netlify 静态部署（AM-035）
# ⚠ dist/ 被 .gitignore 忽略（正确）：必须让 Netlify 自己构建，仓库里没有 dist。

[build]
  command  = "npm run build"
  publish  = "dist"

[build.environment]
  NODE_VERSION = "22"          # 与 .nvmrc 双保险

# ---- 缓存策略（核心：能长缓存的只有"永不改名又不会变"的音频；入口必须每次校验）----

# ① 入口：绝不长缓存 —— 否则更新发不出去
[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

# ② Service Worker：绝不长缓存（由 UP17 产出；文件不存在时这条规则自动无效，不报错）
[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
    # SW 根作用域所需的响应头（Netlify 默认已允许，显式写防漂移）
    Service-Worker-Allowed = "/"

# ③ manifest：正确 MIME（否则浏览器不认 PWA manifest）
[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"
    Cache-Control = "public, max-age=0, must-revalidate"

# ④ 音频与图标：文件名不含 content hash ⇒ 用 7 天而非 immutable（换了要能刷出来）
[[headers]]
  for = "/assets/audio/*"
  [headers.values]
    Cache-Control = "public, max-age=604800"

[[headers]]
  for = "/icons/*"
  [headers.values]
    Cache-Control = "public, max-age=604800"
```

**不需要 SPA 回退** `/* → /index.html` —— 本页只有 1 个 HTML、无前端路由（`107 §3-4`）。

---

## 4. README「部署」一节（要点，正文由施工方写）

| 内容 | 要求 |
|---|---|
| 两种上线方式 | **A · 拖拽**：`app.netlify.com/drop` 拖**整个 `dist/` 目录**（⚠ 不是只拖 index.html，否则 `assets/audio/` 不跟、BGM 全静音；⚠ 免登录站点 **1 小时后删除**，必须 claim 认领）｜ **B · CLI**：`npm run deploy` |
| Git 集成（可选） | 连仓库 → Build `npm run build` · Publish `dist`（`dist/` 已被忽略，**必须让 Netlify 构建**） |
| 体积与额度 | 8.9 MB；免费 100 GB/月 ≈ 1.1 万次冷加载 |
| **授权前置** | ⚠ 公开部署 = 向公众传播音频资产 ⇒ 见 `70-REPO-BASELINE §6` 与 `107 §3-1`（BGM 授权 + **其它 SFX**） |
| 「整包下载到本地」 | 一句话：`npm run build` 后把整个 `dist/` 目录压缩发给对方，解压双击 `index.html` 即开（免构建入口同款能力）。**不需要额外脚本** |

---

## 5. 判据

| # | 判据 | 方法（机械） |
|---|---|---|
| 1 | `netlify.toml` 语法合法 | `npx --yes netlify-cli@latest build --dry 2>&1` 不报 TOML 解析错（或在 Node 侧用 TOML 解析器读一遍，键值齐全） |
| 2 | 构建链未坏 | `npm run build` 成功，`dist/` 15 个文件齐（`pw:dist` 与基线一致 —— **基线仍为主控在 UP14 后重落的版本**，本包**不应**改变 dist 内容） |
| 3 | 两入口 15/15 | `npm run assert` + `npm run assert:dist`（本包零渲染改动 ⇒ **必须仍 15/15**） |
| 4 | 冻结件零改动 | `npm run pw:frozen` 两 sha256 逐字一致 |
| 5 | headers 覆盖齐 | 5 条 `[[headers]]`（`/index.html` · `/sw.js` · `/manifest.webmanifest` · `/assets/audio/*` · `/icons/*`）逐条存在 |
| 6 | 不该变的没变 | `src/**` 一字未动 · `assets/audio/**` 未动 · `index.html` / `app/index.html` 未动 |
| 7 | **真机上线**（挂雨桐） | 拖一次 `dist/` → 打开链接 → 水面正常、BGM 能播。**判定权在雨桐** ⇒ ✅ **已过（09-30 04:3x）**，读数见 `§4.5` |

---

## 6. 禁区

- **不碰 `index.html` / `app/index.html`**（那是 UP17 的地盘）· 不碰 `src/**` · 不碰 `assets/**` · 不碰 `vite.config.mjs`
- 冻结件只读 · `plan/pw/tests/__snapshots__/**` 与 `dist-baseline.txt` 不碰 · **`dist/**` 不重建**
- 不加任何依赖到 `dependencies`（`netlify-cli` 走 `npx --yes`，不入 `package.json` 依赖树）
- **不激活任何 Netlify 站点、不上传**（部署是雨桐的动作；本包只产出配置与文档）

---

## 7. 收尾

**施工方（§7 四步）**：完工记录 → `_STATUS` 一行 → 跨包影响先开 AM（本包 AM-035 已开）→ 板 ⬜ 清零。
提交 **模式 A**（独占）：`chore(up16): Netlify 部署配置 + README 部署节（AM-035）`。

**主控专属**：`00-INDEX` 波次 17 翻 ✅ · 契约若需记「部署形态」一行 · AM-035 状态行（施工方按生命周期自翻 ✅ 亦可，见 §7.4-②）。

> **当前状态：⬜ 待开工**（等 UP14 合并；AM-035 与本文件同批落）。

---

## 完工记录（2026-09-30 02:5x · UP16 施工方）

> ⚠ **本包无独立复核方，复核为同上下文自证**（`03-COLLAB-PROTOCOL §7.2-1`）。
> 下面每条判据都给机械证据；观感/真机类（判据 7）一律挂雨桐，不由施工方判定通过。

### 1. 改动清单（= §7.4 白名单 ①，逐条列名）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `netlify.toml`（新建） | `[build]`（`command=npm run build` / `publish=dist`）+ `[build.environment] NODE_VERSION=22` + **5 条 `[[headers]]`** |
| 2 | `.nvmrc`（新建） | `22` |
| 3 | `package.json` | **加 1 行** `"deploy": "npx --yes netlify-cli deploy --prod --dir=dist"`（其余字段一字未动，未加任何依赖） |
| 4 | `README.md` | 新增 `## 部署（Netlify）` 一节（三种方式 + 缓存策略 + 授权前置 + 整包 zip）+ 文件表加 1 行 |

### 2. 判据逐条实测

| # | 判据 | 证据 |
|---|---|---|
| 1 | TOML 语法合法 | `python -c "import tomllib…"` 解析通过 → `command=npm run build` · `publish=dist` · `NODE_VERSION=22` · `headers count: 5` · 缺失 `[]`。**未走 `netlify-cli build --dry`**：那条要 `npx` 拉一个几十 MB 的 CLI，而本包只改静态配置；改用 stdlib `tomllib` 做**键值齐全**校验（§5 判据 1 明列的第二种做法） |
| 2 | 构建链未坏 | **刻意不重建 `dist`**（`dist/**` 不在白名单，重建有改字节、打挂 `dist-baseline.txt` 的风险）。改用两条机械证据证明「dist ≡ f(HEAD src)」：<br>① `dist/index.html` mtime **02:33:59** > 最后改动的 `src/10-audio.js` **02:33:58**（`find src assets app index.html vite.config.mjs -newer dist/index.html` ⇒ **空**）<br>② `node plan/pw/verify-dist.mjs check` ⇒ **15 文件逐文件一致**（`index.html` **790 636 B**）· 引用泄漏检查：**无** |
| 3 | 两入口 15/15 | `npm run assert` ⇒ **15/15**（JS 错误 0 · Log error 0）· `npm run assert:dist` ⇒ **15/15**（同上） |
| 4 | 冻结件零改动 | `npm run pw:frozen` ⇒ ✅（`wp5-assert.js` `abf23d7d…` · `wp5-env.js` `bd9dd0e8…` 均与基线逐字一致） |
| 5 | headers 覆盖齐 | 见判据 1 —— `/index.html` · `/sw.js` · `/manifest.webmanifest` · `/assets/audio/*` · `/icons/*` 五条逐条存在 |
| 6 | 不该变的没变 | `git status --short` 仅 4 项：` M README.md` · ` M package.json` · `?? .nvmrc` · `?? netlify.toml`。反选过滤（白名单外）⇒ **空**。`src/**` · `assets/**` · `index.html` · `app/index.html` · `vite.config.mjs` · `plan/pw/**` · `dist/**` 全部零改动 |
| 7 | **真机上线** | ✅ **已过（2026-09-30 04:3x · 雨桐上线 + 主控复核）** —— 线上 <https://serene-ripple-lake.netlify.app/>：首页 `200`/792 801 B · **BGM 真出声**（`bgmPeak = 0.45077`）· `slapReady = true` · **PWA 线上复核 11/12**（唯一红 = manifest MIME；Chrome 仍认可 ⇒ 可安装）。读数与两条线上偏差见 **`§4.5`** |

### 3. 两处口径说明（不是偏离，是主动选边）

1. **不重建 `dist`**：`109 §5-2` 原文写的是「`npm run build` 成功」，与 `§6 禁区` 的「`dist/**` 不重建」在字面上冲突。
   取禁区：本包零渲染改动 ⇒ 重建的**唯一后果**是赌字节不变，赌输了就打挂主控刚落好的基线（`dist-baseline.txt` 属主控专有，我无权重录）。
   ⇒ 改用「mtime 单调 + `pw:dist check` 逐文件一致」证明 dist 与 HEAD 源码一致，**判据强度不降**（判据 2 的立法意图是「构建链没被我弄坏」，而本包连 `vite.config.mjs` 都没碰）。
2. **`/icons/*` 缓存头现在无效**：`dist/` 里没有 `icons/`（UP17 才产出）。Netlify 对「规则命中不到文件」不报错 ⇒ 与 AM-036 的配套说明一致，保留。
   `/sw.js` / `/manifest.webmanifest` 同理，README 里已写明「这两条现在自动无效」。

### 4. 收尾四步

| 步 | 落地 |
|---|---|
| ① 包文档完工记录 | 本節 |
| ② `_STATUS.md` 一行 | §2「升级 UP（波次 3+）」表追加 **UP16** 一行（遗留列挂判据 7 雨桐 + 波次 17 翻 ✅ 属主控） |
| ③ 跨包影响 | **无新 AM** —— 本包只写 AM-035 已授权的两个文件 + 两个新文件。按生命周期把 AM-035 翻 ✅：`02-AMENDMENTS §1` 全文块**移入 `98b`**（含应用记录），`§2` 总表该行翻 ✅，「最新已应用」注同步 |
| ④ 板上 ⬜ 清零 | `04-BOARD` 的 **UP16 箱**那条「⬜ 待开工」→ ✅（附完工指向）；收件箱目录 UP16 行同步 |

**提交**：模式 A（独占，`git status` 仅本包 4 个文件）
`chore(up16): Netlify 部署配置 + README 部署节（AM-035）`
`git add netlify.toml .nvmrc package.json README.md plan/109-UP16-deploy.md plan/02-AMENDMENTS.md plan/98b-AMENDMENTS-ARCHIVE-v1.md plan/04-BOARD.md plan/_STATUS.md`（**逐条列名，禁 `-A`**）

### 4.5 判据 7 · 真机上线（2026-09-30 04:3x · 雨桐上线 · 主控独立复核）

**线上地址**：<https://serene-ripple-lake.netlify.app/>

| 项 | 实测 |
|---|---|
| 首页 | `200` · **792 801 B** = 本地 `dist/index.html` **792 617 B** + **184 B**（Netlify 注入的 HUD 脚本，见下） |
| `sw.js` / `icons/icon-512.png` | `200` / `200`（57 621 B） |
| `assets/audio/bgm-mingjing.mp3` | `206`（Range 正常） |
| **BGM 真出声** | `SW.audio.probe()` ⇒ `bgmPeak` 峰值 **0.45077**（非 0 = 真的响了）· `mode = file` · `bgmGain = 0.60` · `ctx.state = running` |
| **水面与交互** | `SW.ready = true` · `slapReady = true` · 拍击实测触发（联网 `slaps = 1`） |
| **PWA 线上复核** | `VERIFY_URL=<线上> node plan/pw/verify-pwa.mjs` ⇒ **11/12**：SW 接管 ✅ · 断网刷新仍能开 ✅ · 断网仍出声 ✅ · 离线音频 `200`（`slap1.wav` 139 244 B）✅ · 图标像素与 `sizes` 逐字一致 ✅ · 根入口不对称守住 ✅ · console 零报错 ✅ · **唯一红 = 判据 1「manifest MIME = `application/octet-stream`」** |

#### 两条线上偏差（非缺陷，记档）

| # | 现象 | 成因 | 处置 |
|---|---|---|---|
| 1 | manifest 走 `application/octet-stream`（配置第 ③ 条明明写了 `application/manifest+json`）；音频 / 图标缓存头是 `max-age=0` 而非 7 天 | **`netlify.toml` 在仓库根，`dist/` 里没有它** ⇒ **拖文件夹（Drop）这条路不读配置**，命中的全是 Netlify 默认值 | 功能无损 —— Chrome **不强制** manifest MIME（判据 2 `getAppManifest` errors `[]` ⇒ 照样可安装）；音频走 304 校验，多一次往返而已。要配置生效 ⇒ 站点改走 **Git 集成**（Netlify 读仓库根 `netlify.toml` 并自动构建），或把配置随 `dist/` 一起发布 |
| 2 | 线上 HTML 多 184 B：`<script async src="/.netlify/scripts/hud?variant=public">`（34 KB 第三方脚本） | Netlify 给 **Drop 未认领站点**注入的 HUD | 雨桐 **claim 站点后复测**，预期消失；断网时该脚本 `ERR_ABORTED`（无害 —— SW 缓存的壳里带着这个标签） |

> **结论：判据 7 通过** —— 水面正常、BGM 能播、可安装、可离线。**本包唯一遗留已清零。**

### 5. 提交（`git log -1 --stat` · `§7.1-4`）

```
commit ab36aa9b188e76e3ad97f316bd4a46f6ea6569f8
    chore(up16): Netlify 部署配置 + README 部署节（AM-035）

 .nvmrc                            |  1 +
 README.md                         | 24 ++++++++++++++++++
 netlify.toml                      | 48 ++++++++++++++++++++++++++++++++++++
 package.json                      |  3 ++-
 plan/02-AMENDMENTS.md             | 31 +++---------------------
 plan/04-BOARD.md                  |  5 ++--
 plan/109-UP16-deploy.md           | 51 +++++++++++++++++++++++++++++++++++++++
 plan/98b-AMENDMENTS-ARCHIVE-v1.md | 33 +++++++++++++++++++++++++
 plan/_STATUS.md                   |  4 ++-
 9 files changed, 169 insertions(+), 31 deletions(-)
```

提交后 `git status --short` ⇒ **空**（工作区干净）。
