# 静湖微澜 · Serene Ripple Lake

Three.js 治愈湖面。**双击 `index.html` 即可**（无需服务器、无外部依赖）。

## 操作
- **点击**水面 → 拍击声（4 段真实采样轮询 + 随机变调）+ 一圈涟漪
- **拖动**水面 → 连续流水声，**流量跟随拖动速度**；停手后约 **1.1s 拖尾淡出**（先落水花、低频水体垫后）
- 首次交互后音频启动（浏览器自动播放策略）· 右上角可开关声音 · **进页面随机放一首 BGM**，
  右上角「**BGM：**」那一行的 chip 可随时切听（明镜 / 微风）
- `[` / `]` 切时段（±0.5h）· 拖底部 24h 刻度尺锁定时段（可甩动、有咔嗒声）· 双击画面空白回到真实时间
- `?hour=18.5` 直达指定时段 　`?debug=1` 只读调试面板（含 fps / 预算 / 读数）＋ **参数滑杆 24 个，分四组**（音频 3 · 后期 8 · 湖底 10 · 波纹 3），拖动实时生效、刷新即还原默认（默认形态不创建任何 DOM）

## 一天光影
默认跟随**系统真实时钟**，13 个 keyframe 在四态（晨雾 / 正午 / 黄昏 / 星夜）之间连续插值。
夜间光源是**月亮**（正仰角约 28°，低强度冷色），水面上有一条月光反光带。
窗口越窄，反光带越靠画面中央 —— 安全区随水平视角收缩（竖屏时自动收到 ±7°）。
反光带**近端会自然展开成扇形**（25° 俯角下的几何必然，真实月光路同理）；晨 / 昏因太阳方位偏 **−8° / +8°**，
带子会相应**偏右 / 偏左**，夜间（方位 0°）居中。

## 环境光照（IBL）
水面与湖底的反光来自一张**运行时生成的**环境贴图 —— 128×64 equirect `DataTexture` → `PMREMGenerator`，
**不加载任何 `.hdr` 文件**（`file://` 双击即可用，零网络请求）。
贴图内容由当前 keyframe 的天空渐变色 + 太阳瓣实时算出：白日带暖色日面、夜间是冷色月晕，与天空球同一算式。
- 水面：自定义 shader 直接按 `equirectUv()` 采样，并按粗糙度加 mip 偏置（越糙越糊）。
- 湖底（两层鹅卵石）：走 `scene.environment`（只作用于 `MeshStandardMaterial`）。
- ✋ 环境光会和半球光 / 环境光**重复计光** → 开启后自动把两者按比例收回（`envHemiScale` / `envAmbScale`），避免过曝。
- 只在天色变化超过阈值时才重烘（惰性重建），自动走时下不产生额外开销；重烘失败自动回退、画面不黑。
- 关掉：`P.envEnabled = false`（退回纯天空球反光）。

## 降级
| 条件 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | 停止自动走时（锁当前小时）· 关相机晃动 · **钉住水面自走相位** → 画面成静帧；**点击/拖动照旧出涟漪与声音** |
| WebGL 不可用 | 显示静态渐变兜底（含一句说明），不白屏、console 无 JS 报错 |
| 窄屏 < 768px 或核数 ≤ 4 | 一次性降级：波纹场 512→256 · 砾石 238→120 颗 · DPR 上限 2→1.5 |

## 可调参数
全部在 `src/00-config.js` 的 `P` 里，改完刷新即可。控制台执行 `SW.resetP()` 复位。
几个常用项：`exposure` 整体明暗 · `fogDensity` 按天走（keyframe 里）· `glitterDetail` / `glitterRough` 反光带破碎感与宽度 ·
`caustics` 湖底水下光斑（**默认 `false`**，置 `true` 才开；强度已做昼夜调制）· `pebbleScaleNear` / `pebbleScaleFar` 石头尺寸（**两层必须同区间**）·
`envEnabled` 环境光照总开关 · `envIntensity` 湖底 IBL 强度 · `envWaterGain` 水面环境反光增益 · `envResolution` 环境贴图宽（POT，默认 128）。

## 开发 / 构建（可选）

**只想看效果 → 直接双击 `index.html`，本节可以整段跳过。**
本节只服务「要改代码」或「要调 `three/examples/jsm`」的场景。

```bash
npm install     # 依赖：three 精确锁 0.160.0 + vite + vite-plugin-singlefile
npm run dev     # 开发服务器 → http://localhost:5173/ ，改 src/ 即时生效（HMR）
npm run build   # 产出 dist/ —— 单文件 HTML + 随行音频
```

### 两条入口并存

| 入口 | 形态 | 用途 |
|---|---|---|
| `index.html` | 15 个经典 `<script>`（13 个 `src/` + `vendor/three.min.js` + `three-post.min.js`） | **交付形态**：`file://` 双击即开，零安装 |
| `app/` → `dist/` | 单文件 HTML（JS/CSS 已内联）**+ 必须随行 `dist/assets/audio/`** | 开发；以及需要 `three/examples/jsm` 时 |

- 两条入口**渲染同一套画面**：`plan/wp5-assert.js` 各跑一遍都是 **15/15**（同一条判据、同一画布口径 1280×720）。
- 🔴 **构建版不能只拷那个 HTML**：`P.bgmFiles` / `SLAP_FILES` 是**运行时字符串**，打包器不管它们 →
  必须连 `dist/assets/audio/`（14 文件 · 8.2 MB）一起拷，否则没声音。分发时整个 `dist/` 目录一起走。
- ⚠ **改样式 / DOM 要改两处**：`index.html` 与 `app/index.html` 是**刻意分开的两份** ——
  前者是"逐字节冻结"的交付物，构建入口不许碰它，只能另抄一份。改的时候别只改一边。
- ⚠ `package.json` **故意不写 `"type": "module"`**：`plan/wp5-assert.js` 是 CommonJS，
  加上这个字段它会立刻以 `require is not defined` 挂掉。所以配置文件叫 **`vite.config.mjs`**（不是 `.js`）。
- 若 `npm run dev` 后 `localhost` 打不开，加 `--host 127.0.0.1`（Vite 8 默认只绑 IPv6 回环）。

### 构建版的体积
12 个模块全用 `var THREE = window.THREE` 取全局 → 构建入口必须 `window.THREE = THREE` →
**命名空间逃逸**，打包器**摇不掉 three**（实测：免构建 **16 请求 / 1073 KiB** → 构建 **1 请求 / 772 KiB**，
省下的全是**我方源码的注释与空白**，`three.min.js` 669 KB 一个字节没少）。
这是**已知代价**，换来的是"零风险"：不手写 51 成员 shim，就没有"漏一个成员 = 静默 `undefined`"的坑。

### 自检
```bash
npm run assert        # 免构建入口 15 条断言
npm run assert:dist   # 构建入口 15 条断言（同一脚本，URL 参数化）
npm run pw            # Playwright 回归：像素基线 / 品牌 / 环境 / 降级
npm run pw:frozen     # 冻结件校验 —— wp5-assert.js · wp5-env.js 未被改动
npm run pw:dist       # dist 与 plan/pw/dist-baseline.txt 逐文件一致 + 引用泄漏检查
python plan/audio-baseline.py --seam-ab   # 音频体检：LUFS / 真峰值 / 常量漂移 / 接缝研究
                                             # 需 numpy · soundfile · pyloudnorm · scipy
```
另：`npm run dev` 后开 `http://localhost:5173/jsm-smoke.html` 可看 `three/examples/jsm` 是否可达
（`EffectComposer` / `UnrealBloomPass` / `RGBELoader` —— **UP2 / UP3 的前置**）。

## 部署（Netlify）

`dist/` 是**纯静态、全相对路径、零外部请求**（`index.html` 790 KB 内联 + `assets/audio/` 14 文件 8.2 MB
⇒ **15 文件 / 9.0 MB**），任意域名、任意子路径都能开。**不需要 SPA 回退**（只有 1 个 HTML、无前端路由）。

`netlify.toml` 已写好构建命令 / 发布目录 / 5 条缓存头，三种方式任选（A / B 都要先 `npm run build`）：

| 方式 | 操作 |
|---|---|
| **A · 拖文件夹**（最快） | `app.netlify.com/drop` → 拖**整个 `dist/` 目录**。⚠ **免登录站点 1 小时后自动删除**，上传后要点 **claim** |
| **B · CLI** | `npm run deploy`（走 `npx --yes netlify-cli`，不进依赖树；首次提示登录并问「新建 / 关联已有站点」） |
| **C · Git 集成** | Netlify 连仓库 → Build `npm run build` · Publish `dist`（`dist/` 不入库 ⇒ **必须让它自己构建**） |

- 🔴 **必须拖整个 `dist/` 目录**：只拖 `index.html` ⇒ `assets/audio/` 不跟着走 ⇒ **BGM / 拍击 / 鸟鸣全静音**。
- **额度**：9.0 MB / 次冷加载；免费额度 100 GB 月带宽 ⇒ 约 **1.1 万次**（个人分享绰绰有余）。
- **缓存**（`netlify.toml` 5 条）：入口 / `sw.js` / `manifest` 一律 `max-age=0, must-revalidate`（否则新版刷不出来）；
  音频与图标 7 天（文件名无 hash，不能用 `immutable`）。`sw.js` / `manifest` 两条等 UP17 产出后才生效。
- 🔴 **上线 = 向公众传播音频** ⇒ 先核下面「资产与授权」一节（BGM 商用口径、及仓库公开时是否把 mp3 移出 git 历史，该条仍挂雨桐）。
- **「整包下载到本地」不需要额外脚本**：把整个 `dist/` 压成 zip 即可（解压双击 `index.html` 即开）。
  代价：9 MB 一份、改版要重发、无更新机制 —— 要更新机制就等 UP17 的 Service Worker。

## 安装 · 离线（PWA）

**只在构建产物（`dist/` → Netlify / localhost）里生效**；免构建入口是 `file://`，
浏览器对 `file://` 不启用 Service Worker 与 manifest，**双击打开那条路永远没有 PWA**（刻意的，非漏改）。

| 项 | 说明 |
|---|---|
| **安装** | Chrome / Edge 桌面：地址栏右侧「安装」图标；安卓 / iOS：「添加到主屏幕」—— 装完是**独立窗口**（`display: standalone`），不带地址栏 |
| **离线** | 外壳（`index.html` 790 KB 内联 + manifest + 图标）安装时**预缓存** ⇒ 断网可开、水面照常渲染 |
| **离线出声** | `assets/audio/` **8.2 MB 刻意不预缓存**（否则安装要下 8 MB）⇒ **首次真正播放时**才入缓存。**联网听过一次**之后，断网照样划水出声 |
| **更新怎么发** | `app/public/sw.js` 的 `VERSION`（现 `srl-v1`）改动 ⇒ `activate` 清旧 cache 并 `skipWaiting()`；配套靠 `netlify.toml` 对 `/sw.js`、`/manifest.webmanifest` 的 `must-revalidate` 头（**两条必须同时成立**，否则浏览器拿到旧 SW，更新链断在第一步） |
| **图标** | `app/public/icons/` 6 件（`icon-192` · `icon-512` · `icon-maskable-512` · `apple-touch-icon` · `favicon.ico` · `favicon.svg`），由源 SVG 栅格派生，见 `plan/110-UP17-pwa.md §3` |
| **本地自测** | `npm run build` → `npx vite preview`（或任意静态服务器）→ 开 `http://localhost:…`：`navigator.serviceWorker.controller !== null` 即注册成功；DevTools → Network 勾 **Offline** 再刷新可验离线 |

## 文件
| 文件 | 职责 |
|---|---|
| `index.html` | 入口（**经典 `<script>`，非 ES module** —— 为了 `file://` 能直接打开） |
| `vendor/three.min.js` | three **r160** UMD（669,884 B；r161 起 UMD 已移除，故锁此版） |
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
| `src/90-debug.js` | `?debug=1` 面板 + 滑杆组 + `window.__probe/__seek/__clock/__hold` |
| `src/99-main.js` | 启动装配：模块初始化顺序 + 首帧 |
| `assets/audio/` | BGM · 拍击 · 海鸟 · 咔嗒（14 文件 8.2 MB，授权见下） |
| `package.json` · `package-lock.json` | 依赖与脚本（**`package-lock.json` 必须入库**） |
| `vite.config.mjs` | 构建配置：singlefile + 音频随行 + dev HMR 垫片（**见上方"开发 / 构建"**） |
| `netlify.toml` · `.nvmrc` | 部署配置：构建命令 / 发布目录 / 5 条缓存头 · Node 锁 22（**见上方"部署"**） |
| `app/` | 构建入口：`index.html` / `main.js` / `three-global.js` / `jsm-smoke.*`（dev-only） |
| `app/public/` | PWA 静态件：`manifest.webmanifest` · `sw.js` · `icons/` 6 件（Vite 默认 `publicDir`，原样拷进 `dist/`；**见上方"安装 · 离线"**） |
| `dist/` | 构建产物（**不入库**，`npm run build` 重建） |

## 资产与授权
- **three.js r160** —— MIT
- **BGM `bgm-mingjing.mp3`（明镜 146.8s）/ `bgm-weifeng.mp3`（微风 172.8s）** —— **Suno 生成**
  （早期文档写的「MiniMax」**已废案**：该接口对新用户下线）。进页面随机放一首，右上角「BGM：」chip 可随时切听。
  ⚠ **商用前核 Suno 订阅条款**（付费账号订阅期内生成的有商用权），并留存「生成记录 + 授权书」。
  换曲三步：① 命名放 `assets/audio/` ② `src/00-config.js` 的 `bgmFiles` 加一行 ③ `src/10-audio.js` 的
  `BGM_TRACKS` 补一项。🔴 每首的 `trim`（响度配平）与 `trueDur`（真实时长）**必须实测** ——
  跑 `python plan/audio-baseline.py --emit-js` 取数（不填对不会静音，但母带目标与循环出点会失准）。
- **拍击采样 `slap1~4.wav`** —— ✅ **已换源（2026-09-30）**
  旧源 `sounds-mp3` **不可商用**（站方原文「not intended for commercial use」+ 素材「collected from open sources」
  ⇒ 站方不持版权、无权可授；此前标的「免费商用免署名」系误记）。**定案源 = `small-splashes-of-water.mp3`**，
  **出处 sound dino**（与海鸟同源）⇒ **可商用、免署名**。4 段均 `48 kHz / 单声道 / PCM_16 / 1.4500 s / 峰值 0.6200`。
  详见 `plan/108-UP15-slap.md`。
- **海鸟 `bird1~6.wav`** —— SoundDino「岸边可以听到海鸥的叫声」（源 5.89s / 22050 Hz）
  授权原文（2026-09-25 取证）：「Free to download for **personal and commercial work**, **no attribution**,
  no licence chase.」「Can I use Sounddino in commercial or paid client work? **Yes**.」
  处理：只做**淡入淡出 + 拖尾 + 电平归一**（不滤波 / 不重采样 / 不加混响）。
- **咔嗒 `tick1.wav`（Mixkit #1125）/ `tick2.wav`（Mixkit #1120）** ——
  Mixkit **Sound Effects Free License**：免费商用、免署名、允许修改
- 其余**全部程序化生成**，零外部依赖

## 已知限制
- `file://` 下音频**不能** `fetch` / `decodeAudioData`（浏览器跨源策略）→ BGM 与拍击采样都走
  `<audio>` 元素直放，**不过 limiter**，debug 面板的 `bgmPeak` 在 file 模式恒为 0。
  起 http 服务器打开可恢复完整 Web Audio 链路，但**双击打开才是本项目的目标形态**。
- 无头软件光栅（SwiftShader）下约 20 fps；真机独显无压力（实测 `calls 6` / `tris 53,088`）。
- **移动端真机帧率未实测**（只有无头软件光栅的数据）。窄屏已自动降级（波纹场 256 / 砾石 120 颗 / DPR 1.5），
  若真机仍掉帧，**该降的是水面片元**（`60-water.js` 两层细节法线共 12 波），不是几何。
- 音频需**先有一次交互**才启动，这是浏览器策略，不是缺陷。
