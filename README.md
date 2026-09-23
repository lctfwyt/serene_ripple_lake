# 静水 · still water

Three.js 治愈湖面。**双击 `index.html` 即可**（无需服务器、无外部依赖）。

## 操作
- **点击**水面 → 拍击声（4 段真实采样轮询 + 随机变调）+ 一圈涟漪
- **拖动**水面 → 连续流水声，**流量跟随拖动速度**；停手后约 **1.1s 拖尾淡出**（先落水花、低频水体垫后）
- 首次交互后音频启动（浏览器自动播放策略）· 右上角可开关声音
- `[` / `]` 切时段（±0.5h）· 拖底部滑块锁定时段 · 双击画面空白回到真实时间
- `?hour=18.5` 直达指定时段 　`?debug=1` 只读调试面板（含 fps / 预算 / 读数）

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

## 资产与授权
- **three.js r160** —— MIT
- **BGM `bgm-stillwater.mp3`** —— 海绵音乐生成（146.8s / 128kbps）
  ⚠️ **授权范围需自行确认** —— 用于公司 / 商用项目前先核对生成平台条款
- **备用 BGM `bgm-cand1.mp3`** —— 同批生成的另一首候选（3.8 MB，**不在运行路径**）。想换：
  `cp assets/audio/bgm-cand1.mp3 assets/audio/bgm-stillwater.mp3` 后刷新
- **拍击采样 `slap1~4.wav`** —— sounds-mp3（免费商用、免署名）
- 其余**全部程序化生成**，零外部依赖

## 已知限制
- `file://` 下音频**不能** `fetch` / `decodeAudioData`（浏览器跨源策略）→ BGM 与拍击采样都走
  `<audio>` 元素直放，**不过 limiter**，debug 面板的 `bgmPeak` 在 file 模式恒为 0。
  起 http 服务器打开可恢复完整 Web Audio 链路，但**双击打开才是本项目的目标形态**。
- 无头软件光栅（SwiftShader）下约 20 fps；真机独显无压力（实测 `calls 6` / `tris 53,088`）。
- **移动端真机帧率未实测**（只有无头软件光栅的数据）。窄屏已自动降级（波纹场 256 / 砾石 120 颗 / DPR 1.5），
  若真机仍掉帧，**该降的是水面片元**（`60-water.js` 两层细节法线共 12 波），不是几何。
- 音频需**先有一次交互**才启动，这是浏览器策略，不是缺陷。
