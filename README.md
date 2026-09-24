# 静水 · still water

Three.js 治愈湖面。**双击 `index.html` 即可**（无需服务器、无外部依赖）。

## 操作
- **点击**水面 → 拍击声（4 段真实采样轮询 + 随机变调）+ 一圈涟漪
- **拖动**水面 → 连续流水声，**流量跟随拖动速度**；停手后约 **1.1s 拖尾淡出**（先落水花、低频水体垫后）
- 首次交互后音频启动（浏览器自动播放策略）· 右上角可开关声音
- `[` / `]` 切时段（±0.5h）· 拖底部滑块锁定时段 · 双击画面空白回到真实时间
- `?hour=18.5` 直达指定时段 　`?debug=1` 只读调试面板（含 fps / 预算 / 读数）＋ **参数滑杆 8 个**（bloom 强度/阈值/半径 · vignette · grain · glit 细节/粗糙/抖动，拖动实时生效、刷新即还原默认；默认形态不创建任何 DOM）

## 一天光影
默认跟随**系统真实时钟**，13 个 keyframe 在四态（晨雾 / 正午 / 黄昏 / 星夜）之间连续插值。
夜间光源是**月亮**（正仰角约 28°，低强度冷色），水面上有一条月光反光带。
窗口越窄，反光带越靠画面中央 —— 安全区随水平视角收缩（竖屏时自动收到 ±7°）。
反光带**近端会自然展开成扇形**（25° 俯角下的几何必然，真实月光路同理）；晨 / 昏因太阳方位偏 **−8° / +8°**，
带子会相应**偏右 / 偏左**，夜间（方位 0°）居中。

## 降级
| 条件 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | 停止自动走时（锁当前小时）· 关相机晃动 · **钉住水面自走相位** → 画面成静帧；**点击/拖动照旧出涟漪与声音** |
| WebGL 不可用 | 显示静态渐变兜底（含一句说明），不白屏、console 无 JS 报错 |
| 窄屏 < 768px 或核数 ≤ 4 | 一次性降级：波纹场 512→256 · 砾石 238→120 颗 · DPR 上限 2→1.5 |

## 可调参数
全部在 `src/00-config.js` 的 `P` 里，改完刷新即可。控制台执行 `SW.resetP()` 复位。
几个常用项：`exposure` 整体明暗 · `fogDensity` 按天走（keyframe 里）· `glitterDetail` / `glitterRough` 反光带破碎感与宽度 ·
`caustics` 湖底水下光斑（**默认 `false`**，置 `true` 才开；强度已做昼夜调制）· `pebbleScaleNear` / `pebbleScaleFar` 石头尺寸（**两层必须同区间**）。

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
| `index.html` | 13 个经典 `<script>` + `vendor/three.min.js` | **交付形态**：`file://` 双击即开，零安装 |
| `app/` → `dist/` | 单文件 HTML（JS/CSS 已内联）**+ 必须随行 `dist/assets/audio/`** | 开发；以及需要 `three/examples/jsm` 时 |

- 两条入口**渲染同一套画面**：`plan/wp5-assert.js` 各跑一遍都是 **15/15**（同一条判据、同一画布口径 1280×720）。
- 🔴 **构建版不能只拷那个 HTML**：`P.bgmFile` / `SLAP_FILES` 是**运行时字符串**，打包器不管它们 →
  必须连 `dist/assets/audio/`（7.3 MB）一起拷，否则没声音。分发时整个 `dist/` 目录一起走。
- ⚠ **改样式 / DOM 要改两处**：`index.html` 与 `app/index.html` 是**刻意分开的两份** ——
  前者是"逐字节冻结"的交付物，构建入口不许碰它，只能另抄一份。改的时候别只改一边。
- ⚠ `package.json` **故意不写 `"type": "module"`**：`plan/wp5-assert.js` 是 CommonJS，
  加上这个字段它会立刻以 `require is not defined` 挂掉。所以配置文件叫 **`vite.config.mjs`**（不是 `.js`）。
- 若 `npm run dev` 后 `localhost` 打不开，加 `--host 127.0.0.1`（Vite 8 默认只绑 IPv6 回环）。

### 为什么构建版没有变小
12 个模块全用 `var THREE = window.THREE` 取全局 → 构建入口必须 `window.THREE = THREE` →
**命名空间逃逸**，打包器无法摇树。**体积 ≈ 与免构建版持平**（实测 829 KB / 14 请求 → 713 KB / 1 请求，
差的 14% 只来自 minify 我方源码，**不是摇树**），
这是**已知代价**，换来的是"零风险"：不手写 51 成员 shim，就没有"漏一个成员 = 静默 `undefined`"的坑。

### 自检
```bash
npm run assert        # 免构建入口 15 条断言
npm run assert:dist   # 构建入口 15 条断言（同一脚本，URL 参数化）
python plan/audio-baseline.py --seam-ab   # 音频资产体检：LUFS / 真峰值 / 常量漂移 / 接缝研究
                                             # 需 numpy · soundfile · pyloudnorm · scipy
```
另：`npm run dev` 后开 `http://localhost:5173/jsm-smoke.html` 可看 `three/examples/jsm` 是否可达
（`EffectComposer` / `UnrealBloomPass` / `RGBELoader` —— **UP2 / UP3 的前置**）。

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
| `src/70-input.js` | 指针交互 → 波纹 + 声音 |
| `src/80-ui.js` | 时段标签 / 滑块 / 声音开关 |
| `src/85-fallback.js` | 三层降级：reduced-motion · WebGL 兜底 · 移动端 |
| `src/90-debug.js` | `?debug=1` 面板 + `window.__probe/__seek/__clock/__hold` |
| `assets/audio/` | BGM + 拍击采样 |
| `package.json` · `package-lock.json` | 依赖与脚本（**`package-lock.json` 必须入库**） |
| `vite.config.mjs` | 构建配置：singlefile + 音频随行 + dev HMR 垫片（**见上方"开发 / 构建"**） |
| `app/` | 构建入口：`index.html` / `main.js` / `three-global.js` / `jsm-smoke.*`（dev-only） |
| `dist/` | 构建产物（**不入库**，`npm run build` 重建） |

## 资产与授权
- **three.js r160** —— MIT
- **BGM `bgm-stillwater.mp3`** —— 海绵音乐生成（146.8s / 128kbps）
  ⚠️ **授权范围需自行确认** —— 用于公司 / 商用项目前先核对生成平台条款
- **备用 BGM `bgm-cand1.mp3`** —— 同批生成的另一首候选（3.8 MB，**不在运行路径**）。想换：
  `cp assets/audio/bgm-cand1.mp3 assets/audio/bgm-stillwater.mp3` 后刷新
  🔴 **换完必须重算常量**：`src/10-audio.js` 里的 `BGM_LUFS_RAW` / `BGM_TRIM` / `BGM_TRUE_DUR` /
  `SLAP_LUFS_TRIM` 都是**针对当前资产实测**的，换了资产就不对（不会静音，但母带目标与循环出点会失准）。
  跑 `python plan/audio-baseline.py --emit-js`，它会列出每项差多少、并给出可直接粘贴的新值。
- **拍击采样 `slap1~4.wav`** —— sounds-mp3（免费商用、免署名）
  ⚠️ **待裁（UP9 取证时发现，未改动原结论）**：sounds-mp3 站方 About 页自述
  「site is **not intended for commercial use**」且素材「collected from open sources」——
  即站方不持有版权、给不出商用授权。该行标注是否站得住需要主控裁（见 AM-010 §5）。
- **海鸟 `bird1~6.wav`** —— SoundDino「岸边可以听到海鸥的叫声」
  （`such-a-cry-of-seagulls-can-be-heard-on-the-shore.mp3`，5.89s / 22050 Hz）
  授权原文（sounddino.com 分类页 + 首页 FAQ，2026-09-25 取证）：
  「Free to download for **personal and commercial work**, **no attribution**, no licence chase.」
  「Do I need to credit Sounddino? **No** — attribution is not required.」
  「Can I use Sounddino in commercial or paid client work? **Yes**.」
  「Nothing on Sounddino is registered with **Content ID**.」
  处理：只做**淡入淡出 + 拖尾 + 电平归一**（不滤波 / 不重采样 / 不加混响）。
  切点落在两声之间的包络谷底，距下一声起振 ≥ 60 ms；段与段**允许重叠**（源只有 5.89 s）。
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
