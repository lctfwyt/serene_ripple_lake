# 107 · 部署调研（Netlify 静态站 / PWA 可安装）

> 状态：**调研结论，未开工**。无变更单、无包、无白名单 —— 待雨桐选路径后再按 §7.3 拆包。
> 数据采集于 2026-09-29，来源见 §5。

---

## 1. 交付物现状（实测，非估计）

`dist/` 的实际内容（`plan/pw/verify-dist.mjs` 的清单口径）：

| 项 | 值 |
|---|---|
| `dist/index.html` | **788584 B**（≈ 770 KB）—— **JS/CSS 全内联**（`vite-plugin-singlefile`），three.js + 后处理都在里面 |
| `dist/assets/audio/` | **14 个文件 · 8.08 MB** —— 2 首 BGM（3.25 + 3.88 MB）+ 6 鸟鸣 + 4 拍击 + 2 咔嗒 |
| **合计** | **≈ 8.9 MB / 15 个文件** |
| 最大单文件 | `bgm-weifeng.mp3` **3.88 MB** |
| 外部引用 | **零** —— `verify-dist.mjs` 的「引用泄漏检查」保证 `dist/index.html` 内不含 `plan/pw` / `playwright` 等 dev-only 引用；`verify-dist.mjs` 同时校验 `dist/` 下无 `plan|pw|playwright|test-results` 杂目录 |
| 路径形态 | **相对路径**（`assets/audio/...` 是运行时字符串，由 `vite.config.mjs` 的 `sw:copy-audio` 保证旁边真有这个目录）⇒ **部署在子路径 / 任意域名都能开**，不依赖站点根 `/` |

---

## 2. Q1：当前 `dist/` 能直接上 Netlify 吗？

**能，零改动。** 两种方式：

| 方式 | 操作 | 适用 |
|---|---|---|
| **A · 拖文件夹** | 打开 `app.netlify.com/drop`，把**整个 `dist/` 目录**拖进去 | 最快；⚠ **不登录的话站点 1 小时后被删** —— 必须点 claim 用免费账号认领 |
| **B · Git 集成** | 连仓库，Build command `npm run build`，Publish directory `dist` | 每次 push 自动部署；⚠ `dist/` 被 `.gitignore` 忽略（正确）⇒ 必须让 Netlify 自己构建，不能指望仓库里有 dist |
| C · CLI | `npx netlify-cli deploy --prod --dir=dist` | 本地一条命令 |

**注意：拖的是目录，不是只拖 `index.html`** —— `assets/audio/` 必须跟着走，否则 BGM/拍击/鸟鸣全静音（代码走相对路径找它们）。

**体积安全**：我们最大单文件 3.88 MB、总量 ≈ 8.9 MB，远低于任何来源口径的限制（见 §5：有说单文件 6 MB 的、有说 10 MB 预警的、有说无硬限的）⇒ **不构成风险**。

**免费额度**（2026-09 口径）：带宽 100 GB/月 · 构建 300 分钟/月 · 部署次数无限 · 并发构建 1 个。本页 8.9 MB ⇒ 100 GB 约等于 **1.1 万次完整冷加载**，个人分享绰绰有余。

---

## 3. Q2：还需要准备什么

| # | 项 | 现状 | 动作 | 谁 |
|---|---|---|---|---|
| 1 | **BGM 授权** | ❌ **授权范围不明** | **公开部署 = 向公众传播 mp3**。必须先确认 2 首 BGM + `slap1~4`（sounds-mp3）+ 鸟鸣的授权，否则只能走私有/密码保护 | **雨桐**（`70-REPO-BASELINE §5` 已挂账） |
| 2 | Node 版本（走方式 B 才需要） | 本机 node 22.22.2；`vite@8.3.0` 要求 `^20.19 \|\| >=22.12` | Netlify 设 `NODE_VERSION=22`（或加 `.nvmrc`） | 主控 |
| 3 | 缓存头 | 无 | 可选加 `netlify.toml`：`assets/*` 长缓存。**不加也能跑** | 主控 |
| 4 | SPA 回退 `/* → /index.html` | **不需要** | 本页只有 1 个 HTML、无前端路由 | — |
| 5 | HTTPS / 域名 | Netlify 自动签发 SSL | 要自定义域名才需要动 | 雨桐 |
| 6 | 首屏流量 | 音频 `preload='auto'`（`10-audio.js:519/663/1121`） | 首次手势后开始拉 BGM ⇒ 首访有 8 MB 流量。**可选优化**：改 `metadata` + 只加载选中曲 | 待裁 |

> **第 1 项是唯一的硬阻断。** 其余都是加分项。

---

## 4. Q3：「渐进式网页 / 供用户下载到本地」需要什么

需求其实有两种完全不同的实现，**成本差一个数量级**：

### 方案 A · 「下载即开」压缩包（**现在就已经具备，零代码改动**）

- 依据：本项目**双入口**设计的免构建入口本来就是「file:// 双击即开」；构建版 `dist/` 也是相对路径
- 做法：把 `dist/` **整个目录**（含 `assets/audio/`）压成一个 zip → 用户解压 → 双击 `index.html`
- 成本：**0 行代码**；只要在 Netlify 上再放一个 `still_water.zip` 供下载
- 代价：8.9 MB 下载、**没有更新机制**（改一版要重发）、每个用户本地一份
- 结论：**「供用户下载到本地」这句话，方案 A 已经满足。**

### 方案 B · PWA（可安装 + 离线）

| # | 需要什么 | 本项目现状 | 工作量 |
|---|---|---|---|
| 1 | `manifest.webmanifest`（`name`/`short_name`/`start_url`/`display:standalone`/`theme_color`/`background_color`/`icons`） | 无 | 新建 1 文件 |
| 2 | **Service Worker** | 无 | **本项目这一步异常简单**：singlefile 把 JS/CSS 全内联 ⇒ **只有 1 个 HTML 要预缓存**（770 KB）；`assets/audio/**` 走 runtime cache（**不要预缓存 8 MB**）。约 40 行 |
| 3 | **图标** 192×192 + 512×512（含 maskable） | 无 | **要新做**（这是唯一需要"设计"的部分） |
| 4 | HTTPS | Netlify 自动 | — |
| 5 | `netlify.toml` 里给 `manifest.webmanifest` 显式声明 MIME | — | 2 行 |

```toml
# netlify.toml（参考）
[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"
```

**PWA 的三个坑**：

1. **只在 `https://` 或 `localhost` 生效** —— `file://` 双击开的那条入口**永远不受影响**（保持现状即可，不冲突）；
2. `sw.js` / `index.html` / `manifest` **不能长缓存**（否则更新发不出去），只有 `assets/*` 可以 `immutable`；
3. iOS Safari 对 `manifest` 支持有限，要额外 `apple-touch-icon`；且 iOS 上的音频仍要用户手势（本项目已满足）。

---

## 5. 依据来源（2026-09-29 检索）

| 结论 | 来源 |
|---|---|
| Netlify Drop 免登录站点 1 小时后删除、需 claim；拖拽部署建议 < 50 MB、单文件 > 10 MB 可能卡住；免费 100 GB/月 | supadrop.host 对比文 · Netlify 官方文档口径 |
| 单文件限制口径不一（有 6 MB / 10 MB / 无硬限三种说法） | 三处来源互不一致 ⇒ 本报告按「我们最大 3.88 MB，任一口径下都安全」写 |
| Netlify 免费额度：带宽 100 GB/月 · 构建 300 分钟/月 | 腾讯云开发者社区平台对比（2026） |
| PWA 必须在 HTTPS；`manifest.webmanifest` 需 `application/manifest+json`；`sw.js`/`index.html` 需 `must-revalidate`；图标 192/512 + maskable | `vite-plugin-pwa` 官方部署文档（Netlify 章） |

---

## 6. 建议路径

1. **先解决 §3-1 授权**（唯一的硬阻断，且是雨桐的事）；
2. 授权过了 → **先上方案 A（直接拖 `dist/` + 顺带放一份 zip）**，成本近零，立刻能给链接；
3. 若真要「像 App 一样可安装 / 离线可用」→ 再开 PWA 包（本报告 §4-B 的 5 项，其中图标设计是新增工作量）。
