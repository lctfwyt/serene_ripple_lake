# 111 · 开发笔记（从 README 迁出的「部署前 / 开发向」内容）

> **迁出时间**：2026-09-30 03:5x（主控，雨桐要求）。
> **迁出理由**：`README.md` 的定位改为「**部署完之后给访客看的说明**」—— 只留怎么用、怎么装、授权与限制。
> 构建、目录、参数、自检、降级这些**开发向**内容一律搬到这里，README 只留一行指针。
> 迁出时**未改写结论**，只按主题重排；与 README 若有冲突，**以本文件为准并回报主控**。

---

## 1. 两条入口并存

| 入口 | 形态 | 用途 |
|---|---|---|
| `index.html` | 15 个经典 `<script>`（13 个 `src/` + `vendor/three.min.js` + `three-post.min.js`） | **交付形态**：`file://` 双击即开，零安装 |
| `app/` → `dist/` | 单文件 HTML（JS/CSS 已内联）**+ 必须随行 `dist/assets/audio/`** | 开发；以及需要 `three/examples/jsm` 时 |

- 两条入口**渲染同一套画面**：`plan/wp5-assert.js` 各跑一遍都是 **15/15**（同一判据、同一画布口径 1280×720）。
- 🔴 **构建版不能只拷那个 HTML**：`P.bgmFiles` / `SLAP_FILES` 是**运行时字符串**，打包器不管它们 →
  必须连 `dist/assets/audio/`（14 文件 · 8.2 MB）一起拷，否则没声音。分发时整个 `dist/` 目录一起走。
- ⚠ **改样式 / DOM 要改两处**：`index.html` 与 `app/index.html` 是**刻意分开的两份** ——
  前者是「逐字节冻结」的交付物，构建入口不许碰它，只能另抄一份。改的时候别只改一边。
- ⚠ `package.json` **故意不写 `"type": "module"`**：`plan/wp5-assert.js` 是 CommonJS，
  加上这个字段它会立刻以 `require is not defined` 挂掉。所以配置文件叫 **`vite.config.mjs`**（不是 `.js`）。
- 若 `npm run dev` 后 `localhost` 打不开，加 `--host 127.0.0.1`（Vite 8 默认只绑 IPv6 回环）。

**命令**

```bash
npm install     # three 精确锁 0.160.0 + vite + vite-plugin-singlefile
npm run dev     # http://localhost:5173/ ，改 src/ 即时生效（HMR）
npm run build   # 产出 dist/ —— 单文件 HTML + 随行音频
```

### 构建版的体积（为什么没变小）

12 个模块全用 `var THREE = window.THREE` 取全局 → 构建入口必须 `window.THREE = THREE` →
**命名空间逃逸**，打包器**摇不掉 three**（实测：免构建 **16 请求 / 1073 KiB** → 构建 **1 请求 / 772 KiB**，
省下的全是**我方源码的注释与空白**，`three.min.js` 669 KB 一个字节没少）。
这是**已知代价**，换来的是「零风险」：不手写 51 成员 shim，就没有「漏一个成员 = 静默 `undefined`」的坑。

---

## 2. 自检

```bash
npm run assert        # 免构建入口 15 条断言
npm run assert:dist   # 构建入口 15 条断言（同一脚本，URL 参数化）
npm run pw            # Playwright 回归：像素基线 / 品牌 / 环境 / 降级
npm run pw:frozen     # 冻结件校验 —— wp5-assert.js · wp5-env.js 未被改动
npm run pw:dist       # dist 与 plan/pw/dist-baseline.txt 逐文件一致 + 引用泄漏检查
npm run pw:mix        # UP15 混音平衡独立复核（需先起静态服务，见脚本头注释）
npm run audio:baseline  # 音频资产体检（LUFS / 真峰值 / 常量漂移）
python plan/audio-baseline.py --seam-ab   # 音频体检：LUFS / 真峰值 / 常量漂移 / 接缝研究
                                          # 需 numpy · soundfile · pyloudnorm · scipy
```

另：`npm run dev` 后开 `http://localhost:5173/jsm-smoke.html` 可看 `three/examples/jsm` 是否可达
（`EffectComposer` / `UnrealBloomPass` / `RGBELoader` —— **UP2 / UP3 的前置**）。

> `pw:dist` 的基线 `plan/pw/dist-baseline.txt` 由主控 `npm run pw:dist:snapshot` 重落；
> **UP17 之后 `dist/` 是 23 文件**（原 15 + `manifest.webmanifest` + `sw.js` + `icons/` 6 件）。

---

## 3. 可调参数

全部在 `src/00-config.js` 的 `P` 里，改完刷新即可。控制台执行 `SW.resetP()` 复位。
常用项：`exposure` 整体明暗 · `fogDensity` 按天走（keyframe 里）· `glitterDetail` / `glitterRough`
反光带破碎感与宽度 · `caustics` 湖底水下光斑（**默认 `false`**，置 `true` 才开；强度已做昼夜调制）·
`pebbleScaleNear` / `pebbleScaleFar` 石头尺寸（**两层必须同区间**）· `envEnabled` 环境光照总开关 ·
`envIntensity` 湖底 IBL 强度 · `envWaterGain` 水面环境反光增益 · `envResolution` 环境贴图宽（POT，默认 128）。

音频两层电平：`flowVolume`（连续流水）/ `slapVolume`（拍击）/ `handVolume`（两者共用总线）——
UP15 / AM-034 加，默认 `0.20 / 0.30 / 0.80`，`?debug=1`「音频（实时）」滑杆组可实时调。

---

## 4. 降级（三层）

| 条件 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | 停止自动走时（锁当前小时）· 关相机晃动 · **钉住水面自走相位** → 画面成静帧；**点击/拖动照旧出涟漪与声音** |
| WebGL 不可用 | 显示静态渐变兜底（含一句说明），不白屏、console 无 JS 报错 |
| 窄屏 < 768px 或核数 ≤ 4 | 一次性降级：波纹场 512→256 · 砾石 238→120 颗 · DPR 上限 2→1.5 |

---

## 5. 环境光照（IBL）

水面与湖底的反光来自一张**运行时生成的**环境贴图 —— 128×64 equirect `DataTexture` → `PMREMGenerator`，
**不加载任何 `.hdr` 文件**（`file://` 双击即可用，零网络请求）。
贴图内容由当前 keyframe 的天空渐变色 + 太阳瓣实时算出：白日带暖色日面、夜间是冷色月晕，与天空球同一算式。

- 水面：自定义 shader 直接按 `equirectUv()` 采样，并按粗糙度加 mip 偏置（越糙越糊）。
- 湖底（两层鹅卵石）：走 `scene.environment`（只作用于 `MeshStandardMaterial`）。
- ✋ 环境光会和半球光 / 环境光**重复计光** → 开启后自动把两者按比例收回（`envHemiScale` / `envAmbScale`），避免过曝。
- 只在天色变化超过阈值时才重烘（惰性重建），自动走时下不产生额外开销；重烘失败自动回退、画面不黑。
- 关掉：`P.envEnabled = false`（退回纯天空球反光）。

---

## 6. 目录 / 文件

| 文件 | 职责 |
|---|---|
| `index.html` | 入口（**经典 `<script>`，非 ES module** —— 为了 `file://` 能直接打开） |
| `vendor/three.min.js` | three **r160** UMD（669,884 B；r161 起 UMD 已移除，故锁此版） |
| `vendor/three-post.min.js` | three examples/jsm 的后期三件套（`EffectComposer` / `UnrealBloomPass` / `OutputPass`）打包件 |
| `src/00-config.js` | 参数表 `P` · 事件总线 · 工具函数 |
| `src/10-audio.js` | 音频：程序化划水（连续流水模型）+ 拍击采样 + BGM |
| `src/20-time.js` | 13 keyframe 环形插值（OKLCH 最短弧）→ `TimeState` |
| `src/30-scene.js` | 相机 / 光照 / 雾 / 渲染循环 · `applyTimeState()` |
| `src/40-lakebed.js` | 湖底 + 鹅卵石（两层 LOD）+ 程序化 caustic 纹理 |
| `src/50-ripple.js` | 波纹：波动方程 FBO ping-pong（512² Float） |
| `src/60-water.js` | 水面：屏幕空间折射 + Beer-Lambert 吸收 + GGX 反光路径 |
| `src/65-post.js` | 后期处理：Bloom + vignette + grain + 色调映射输出 |
| `src/70-input.js` | 指针交互 → 波纹 + 声音 |
| `src/80-ui.js` | 时段标签 / 24h 刻度尺 / 声音开关 / **BGM 选曲（`#sw-bgm`）** |
| `src/85-fallback.js` | 三层降级：reduced-motion · WebGL 兜底 · 移动端 |
| `src/90-debug.js` | `?debug=1` 面板 + 滑杆组 + `window.__probe/__seek/__clock/__hold`（**代码进包、面板默认不建 DOM**） |
| `src/99-main.js` | 启动装配：模块初始化顺序 + 首帧 |
| `assets/audio/` | BGM · 拍击 · 海鸟 · 咔嗒（14 文件 8.2 MB，授权见 README） |
| `package.json` · `package-lock.json` | 依赖与脚本（**`package-lock.json` 必须入库**） |
| `vite.config.mjs` | 构建配置：singlefile + 音频随行 + dev HMR 垫片 |
| `netlify.toml` · `.nvmrc` | 部署配置：构建命令 / 发布目录 / 5 条缓存头 · Node 锁 22 |
| `app/` | 构建入口：`index.html` / `main.js` / `three-global.js` / `jsm-smoke.*`（dev-only） |
| `app/public/` | PWA 静态件：`manifest.webmanifest` · `sw.js` · `icons/` 6 件（Vite 默认 `publicDir` ⇒ 原样拷进 `dist/`） |
| `dist/` | 构建产物（**不入库**，`npm run build` 重建） |
| `audio-build/` · `icon-build/` | 音频 / 图标的派生工作目录（**`.gitignore` 忽略**，不入库） |

---

## 7. 部署细节（Netlify）

- **额度**：9.0 MB / 次冷加载；免费额度 100 GB 月带宽 ⇒ 约 **1.1 万次**（个人分享绰绰有余）。
- **缓存**（`netlify.toml` 5 条）：入口 / `sw.js` / `manifest` 一律 `max-age=0, must-revalidate`（否则新版刷不出来）；
  音频与图标 7 天（文件名无 hash，不能用 `immutable`）。
- **不需要 SPA 回退**（只有 1 个 HTML、无前端路由）。
- 🔴 **上线 = 向公众传播音频** ⇒ 先核 README「资产与授权」与 `plan/70-REPO-BASELINE.md §6`
  （BGM 商用口径、以及仓库若公开时是否把 mp3 移出 git 历史 —— 该条仍挂雨桐）。
- **另两条备选路径**（雨桐不用，留档）：
  - **CLI**：`npm run deploy`（走 `npx --yes netlify-cli`，不进依赖树；首次提示登录并问「新建 / 关联已有站点」）
  - **Git 集成**：Netlify 连仓库 → Build `npm run build` · Publish `dist`（`dist/` 不入库 ⇒ **必须让它自己构建**）
- **「整包下载到本地」不需要额外脚本**：把整个 `dist/` 压成 zip 即可（解压双击 `index.html` 即开）。
  代价：9 MB 一份、改版要重发、无更新机制 —— 要更新机制就靠 Service Worker（UP17 已落地）。

---

## 8. PWA 维护细节（UP17 / AM-036）

- **更新怎么发**：`app/public/sw.js` 的 `VERSION`（现 `srl-v2`）改动 ⇒ `activate` 清旧 cache + `skipWaiting()`。
  ⚠ **连带规则**：`manifest.webmanifest` 本身在 SHELL 清单里走 **cache-first** ⇒
  **改 manifest（应用名 / 图标 / 主题色）必须同时 bump `VERSION`**，否则已安装的 PWA 永远吃旧 manifest。
- **Range 坑**：`<audio>` 发 `Range` 请求、服务器回 **206**，`cache.put()` 对 206 直接抛错 ⇒
  `audioStrategy()` 命中缓存返回全量 200；未命中则**去掉 `Range` / `If-Range` 头**取全量再入缓存。
- **音频刻意不预缓存**（8.2 MB）：首次播放才入 cache。副作用 —— 离线且从未播放过的音频 ⇒ SW 返回 504，
  播放器退回合成兜底（不白屏、不抛）。要「装上就全量离线」就得预缓存 8 MB，与红线冲突，未做。
- **本地自测**：`npm run build` → `npx vite preview`（或任意静态服务器）→ 开 `http://localhost:…`：
  `navigator.serviceWorker.controller !== null` 即注册成功；DevTools → Network 勾 **Offline** 再刷新验离线。
- **图标派生**：见 `plan/110-UP17-pwa.md §3.6`（ImageMagick 六条命令 + 四个实测坑）。
  `favicon.ico` 走**透明底**（雨桐 09-30 定）；`icon-maskable-512` / `apple-touch-icon` **必须满底**（平台规范）。

---

## 9. 换 BGM 的三步（含必须实测的常量）

1. 按命名放 `assets/audio/`；
2. `src/00-config.js` 的 `bgmFiles` 加一行；
3. `src/10-audio.js` 的 `BGM_TRACKS` 补一项（`label` + `trim` + `trueDur`）。

🔴 **每首的 `trim`（响度配平）与 `trueDur`（真实内容时长）必须实测** —— 跑
`python plan/audio-baseline.py --emit-js` 取数（不填对不会静音，但母带目标与循环出点会失准）。

---

## 10. 光影与限制的技术底稿（2026-09-30 04:0x 从 README 再精简迁出）

> 雨桐二次要求：README **只留非技术人员看得懂的话**，技术细节一律不留。
> 下面是 README 曾写过的**事实底稿**，搬到这里存档 —— README 里的说法若与本条冲突，**以本条为准并回报主控**。

**一天光影**

- 13 个 keyframe 环形插值（OKLCH 最短弧，`src/20-time.js`）覆盖晨雾 / 正午 / 黄昏 / 星夜。
- 夜间光源 = 月亮，**仰角约 28°**；水面月光反光带位置随窗口宽窄变化（越窄越靠画面中央）。
- 反光带近端自然展开成扇形 —— **25° 俯角下的几何必然**（真实月光同理），不是特意做的效果。
- 晨 / 昏太阳方位偏 **−8° / +8°** ⇒ 带子相应偏右 / 偏左；夜间居中。

**已知限制（技术底稿）**

- `file://` 下音频不能 `fetch` / `decodeAudioData`（跨源策略）⇒ BGM 与拍击走 `<audio>` 元素直放、
  **不过 limiter**；起 http 打开可恢复完整链路。⚠ **双击才是本项目的目标形态**。
- **移动端真机帧率未实测** —— 只有无头软件光栅数据（约 20 fps），真机独显无压力；
  窄屏已自动降级（波纹场 / 砾石数 / DPR，见 §4）。
- 音频需**先有一次交互**才启动 —— 浏览器自动播放策略，非缺陷。

---

> **迁移记录**：本文件由主控于 2026-09-30 03:5x 从 `README.md` 迁出（雨桐：README 定位改为「部署后给访客看」）；
> 04:0x 二次精简，README 再删掉「光影几何 / 音频链路 / 帧率数据」等技术表述 ⇒ 存于 §10。
> 迁出后 README 保留：简介 / 怎么玩 / 一天光影（白话）/ 安装·离线 / 授权 / 已知情况 / 部署（仅拖文件夹）。
