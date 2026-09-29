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
| 7 | **真机上线**（挂雨桐） | 拖一次 `dist/` → 打开链接 → 水面正常、BGM 能播。**判定权在雨桐** |

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
