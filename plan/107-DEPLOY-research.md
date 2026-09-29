# 107 · 部署调研（Netlify 静态站 / PWA 可安装）

> 状态：**调研结论 · 路径已选**（2026-09-29 23:5x 更新）。已按 §7.3 拆包：
> **波次 17 = `109-UP16-deploy.md`（Netlify · AM-035）✅ 已交** · **波次 18 = `110-UP17-pwa.md`（PWA 可安装 · AM-036，🔶 已开工 —— 图标已并入包内，雨桐与施工方多轮对话定）**。
> 数据采集于 2026-09-29，来源见 §5。授权状态更新见 §3-1。

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
| 1 | **音频授权** | ⚠ **部分澄清（2026-09-29 23:5x）** —— 见下方三条 | 见下方 | **雨桐**（`70-REPO-BASELINE §6` 已挂账） |
| 2 | Node 版本（走方式 B 才需要） | 本机 node 22.22.2；`vite@8.3.0` 要求 `^20.19 \|\| >=22.12` | Netlify 设 `NODE_VERSION=22`（或加 `.nvmrc`） | 主控 |
| 3 | 缓存头 | 无 | 可选加 `netlify.toml`：`assets/*` 长缓存。**不加也能跑** | 主控 |
| 4 | SPA 回退 `/* → /index.html` | **不需要** | 本页只有 1 个 HTML、无前端路由 | — |
| 5 | HTTPS / 域名 | Netlify 自动签发 SSL | 要自定义域名才需要动 | 雨桐 |
| 6 | 首屏流量 | 音频 `preload='auto'`（`10-audio.js:519/663/1121`） | 首次手势后开始拉 BGM ⇒ 首访有 8 MB 流量。**可选优化**：改 `metadata` + 只加载选中曲 | 待裁 |

> **音频授权 —— 2026-09-30 全部澄清 ✅ 且换源已完成 ✅。** BGM（Suno）· 海鸟（sound dino）· 咔嗒（Mixkit）已确认；
> `slap1~4` 原源 `sounds-mp3` 不可商用（§3.1）⇒ **换源已完成**：走过两代源，**定案 = `small-splashes-of-water.mp3`
> 出处 `sound dino`**（与 `bird1~6` 同源，*free for personal and commercial work, no attribution*）⇒ **授权门已清**。
> 执行包 = 波次 16（`108-UP15-slap.md`），**已收口**（`108 §11.8` / `§13` / `§14`）。
> ⚠ 剩余**非授权**事项：仓库若公开，BGM 两首 mp3 是否移出历史仍待裁（§3.1-1）。

### 3.1 音频授权 —— 2026-09-30 02:1x 更新（雨桐口径）

| 资产 | 状态 | 依据 / 待办 |
|---|---|---|
| **2 首 BGM** `bgm-mingjing.mp3` · `bgm-weifeng.mp3` | ✅ **可商用**（主体已澄清） | 来源：`suno-api.io/blog/ai-music-commercial-license`（2026-09-10 更新）。**2026-09-30 雨桐澄清：生成主体 = Suno**（本项目旧记录的「MiniMax 链路」**已废案** —— 该接口对新用户下线，`98-STATUS-ARCHIVE-v1` 2026-09-24 复测确认）。该文口径：**Suno Pro / Premier 付费账号订阅期内生成的曲目具有商用权**，官方不抽版税、取消订阅后仍保留。<br>⚠ **仅剩一条提醒**：该站系**第三方转售**（非 Suno 官方），真正能拿在手上的是它出具的**授权书**（个人满 200 / 公司满 500 可申请）—— 建议留存「生成记录 + 授权书 + 交付说明」三件（其文末也这么建议）。 |
| **拍击采样** `slap1~4.wav` | ✅ **可商用（换源已完成 · 2026-09-30 02:1x）** | 原源 `sounds-mp3` ❌ 不可商用（站方 About 原文「The Sounds-mp3.com site is not intended for commercial use.」+「collected from open sources」⇒ 站方不持有版权；此前记的「免费商用免署名」**系误记**）⇒ 换源走两代：源① `lake-water-breaks-on-a-rocky-shore.mp3`（99.253 s · `3c0470de…`）因偏轻被换 ⇒ **定案源② = `small-splashes-of-water.mp3`**（17.856 s · 44.1 kHz · 300 765 B · sha[:16] `c246ea712ffa82e9`），**出处 = `sound dino`**（与 `bird1~6` 同源，*free for personal and commercial work, no attribution*）⇒ ✅ **可商用 · 免署名**。四件已同名替换 + 配平（`108 §11.8`） |
| **海鸟** `bird1~6.wav` · **咔嗒** `tick1~2.wav` | ✅ **已确认** | **2026-09-30 雨桐确认**：鸟鸣 = **sound dino** · 咔嗒 = **Mixkit** ⇒ 无需动作 |

---

## 4. Q3：「渐进式网页 / 供用户下载到本地」需要什么

> **2026-09-29 23:5x 更新**：雨桐**已选方案 B（PWA）**。本节保留方案 A 的对照是**为了记录为什么它未被采用** —— 见 §6。

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

## 6. 路径（**已决** · 2026-09-29 23:5x）

雨桐选定 **PWA 路线**（可安装 + 离线）。原「方案 A · zip」不再单列 —— **已被 PWA 覆盖**（用户说「下载到本地」，落地形态 = 安装到桌面 / 主屏）。

| 步 | 动作 | 归属 |
|---|---|---|
| ① | 补齐授权（§3.1）—— **2026-09-30 更新：仅剩 `slap1~4` 换源**（BGM / 海鸟 / 咔嗒已 ✅） | **雨桐给素材** + **波次 16 · `108`** |
| ② | `netlify.toml` + 5 条缓存头 + `.nvmrc` + README 部署节 | **波次 17 · `109`（AM-035）** |
| ③ | 拖 `dist/` 上 Netlify（零改动，立即有链接）· Git 集成可选 | **雨桐**（`109 §6` 明列不代劳） |
| ④ | 图标（`110 §3`）→ manifest + SW + 注册 + head 元信息 | **波次 18 · `110`（AM-036）** |
| ⑤ | 安装到桌面/主屏 + 离线可用验证 | **雨桐**（`110 §8` 判据 4~7） |

> **为什么 Netlify 与 PWA 仍分两包**（雨桐授权「一到两个包」）：**图标是外部依赖（你提供），不该卡住 30 分钟的配置工作** —— 拆开后波次 17 可先落地给链接，波次 18 等图标。两者不争文件（唯一共写的 `README.md` 串行处理）。
