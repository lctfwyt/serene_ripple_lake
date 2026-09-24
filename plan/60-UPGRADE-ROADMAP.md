# 60 · 专业工具链升级路线图

> **状态：提案（不是变更单）** —— 待雨桐拍板后再拆成 `AM-009 ~ AM-012`
> **日期**：2026-09-24 · **前置**：WP1 ~ WP5 全部 ✅ 收官
>
> ## 🔴 约束变更（本方案的前提）
> **`file://` 从「硬红线」降为「降级档」，主目标形态改为本地 http(s) 服务。**
>
> 这一条解开后，之前所有「只能手搓」的妥协都变成「可以直接用」：
>
> | 能力 | `file://` | `http://localhost` |
> |---|---|---|
> | `fetch` / `XMLHttpRequest` | ❌ 被 CORS 挡 | ✅ |
> | ES Module（`<script type="module">`） | ❌ 被挡 | ✅ |
> | `decodeAudioData` | ❌ | ✅ |
> | `createMediaElementSource` | ❌ 判为跨源污染 → **静音** | ✅ |
> | `<img>` / `<audio>` 相对路径 | ✅ | ✅ |
> | three.js `examples/jsm` 全生态 | ❌（r148 起 `examples/js` 已删，只剩 ESM） | ✅ |
>
> **但 `file://` 不能丢** —— 现有 `85-fallback.js` 的三层降级与 `10-audio.js` 的 file/http 双分支
> 已经证明本项目有「按环境降级」的架构。本方案沿用同一模式：**http 是主路径，file 是降级路径**。

---

## 0. 根因：为什么之前什么都要手搓

不是技术选择，是**两条约束的必然结果**：

1. `file://` 双击 → 禁 fetch、禁 ESM
2. 无构建步骤 → 无 tree-shaking、无 shader 独立文件、无依赖管理

这两条**同时把整个 three.js `examples/jsm` 生态挡在门外**（`EffectComposer` / `RGBELoader` /
`ImprovedNoise` / `Water2` 全部不可达）。所以「更专业」这件事的本质是**解开约束**，
而不是「换个更专业的库」——`UP1` 是总钥匙，`UP2`/`UP3` 都是它的下游红利。

---

## 1. 保护清单 —— 已达标，**不要动**

按图形学/音频教科书逐项核过，这些**换成"专业库"大概率是降级**：

| 项 | 位置 | 判断 |
|---|---|---|
| ACES Filmic + `SRGBColorSpace` | `30-scene.js:140-149` | ✅ 彩色管线正确 |
| OKLCH 最短弧插值 | `20-time.js` | ✅ 色彩科学的正确做法（RGB lerp 会灰） |
| Beer-Lambert 吸收 + GGX 高光 | `60-water.js` | ✅ 物理正确，非假造 |
| 波动方程 FBO + CFL + **边界吸收带** | `50-ripple.js:61-65` | ✅ 连「撞场边弹回→鱼缸感」都处理了 |
| InstancedMesh 两层 LOD | `40-lakebed.js:323` | ✅ 238 颗 ≈ 2 draw call |
| Convolver + Compressor(limiter) 总线 | `10-audio.js:192-217` | ✅ 有母带意识 |
| `gl.readPixels` 数值断言（15+16 条） | `plan/wp5-assert.js` | ✅ **真资产，UP6 只包一层、不推倒** |

> ⚠️ **three 自带的 `Water2` 是降级**：它做屏幕空间反射，但**不支持点击涟漪**，而"波纹干涉"是本项目核心。

---

## 2. 先说风险：哪些升级会打挂现有断言

**这一节比升级项本身更重要** —— 加东西容易，保住已验的读数难。

| 升级 | 会失效的现有判据 | 处理 |
|---|---|---|
| **UP1 构建** | 任何依赖**具体字节数/字符串**的判据 | 逐个复核（产物会被压缩） |
| **UP2 后期 bloom** | **#13** `peak/median ≥ 1.8`（光晕会抬高比值）· **#6 / #8** 整幅亮度与 R−B | 重测重标阈值 |
| **UP3 HDRI** | **AM-007 §1** 四态 R−B 谱（环境光会漂） | 重测标定 |
| **UP4 贴图** | 🔴 **#14（LOD 接缝比）/ #15（覆盖率）失去对象** | 新架构没有"两层 LOD"，两条需**重构或作废**（= AM-007 的二次修订） |
| **UP5 音频** | 无 | 新增 2 条 |
| **UP6 验证** | 无 | 无 |

### 2.1 🔴 像素级视觉回归：**不能拿 `plan/shots-wp5/` 做逐像素基线**

UP1a 实测（2026-09-24）：四态静帧是**时间驱动**的（水面 `uTime` 自走相位），
**同一入口跑两次也拍不出相同的帧**：

| 帧 | 同入口 dist #1↔#2 | 跨入口（dist ↔ 免构建） |
|---|---|---|
| dawn | max 70 · PSNR **30.5**dB | max 19 · **46.1**dB |
| noon | max 104 · 26.3dB | max 98 · 28.3dB |
| dusk | max 107 · 24.4dB | max 115 · 23.7dB |
| night | max 140 · **20.9**dB | max 141 · **20.0**dB |

**两种差异同量级，晨雾帧「同入口」的差异甚至比跨入口更大** → 差异由**波纹相位**主导，
与「两条入口是否等价」无关（两入口的确定性读数与 15 条断言完全一致，这才是等价性证据）。

**推论 —— UP2 / UP3 / UP4 / UP6 的验收都必须遵守：**

1. 「升级没弄坏画面」**只能靠数值断言证明**（#1~#15 里那些确定性读数）。静帧比对不构成证据。
2. 静帧的唯一用途是**给人看**（审美裁决 / 前后对比）——**它 diff 了不等于坏了**。
3. 🔴 **UP6 的 `toHaveScreenshot()` 不能直接罩在整幅水面上** —— 相位抖动会让它永远红，
   而「永远红」比「没有」更坏（人会开始无视它）。两条可行路子：
   - 钉相位后再截：先 `SW.water.uniforms.uTime.value = 固定值`（契约 §2.6 公开字段），
     再配 Playwright 的 `animations:'disabled'`；
   - 或者只对**非水面区域**（UI 层 / 湖底局部裁切）做像素回归 —— 那里是确定的。
4. 本项已落地为 **AM-013**（⚠ 不是 AM-009 —— 那个号已按 §6 表预留给了 UP2）：断言脚本的截帧改为显式 `--shots`，默认跑断言不再产生那 4 个假改动。

---

## 3. 升级项

### UP1 · 构建链：Vite + singlefile + glsl 【地基】

> 🔴 **本节已被 `plan/80-UP1-build-chain.md` 拆并纠正（2026-09-24）—— 三处，施工以包文档为准：**
> 1. **UP1a 只做「打包 + 双入口并存」，`src/**` 零改动。** `.glsl` 抽离**移出本包**：
>    `src/*.js` 要同时当经典脚本用，`import … from './x.glsl'` 在经典 `<script>` 里是 `SyntaxError`，
>    会**直接打断免构建入口**。「着色器双入口供给」方案未裁 → **UP1b**。
> 2. **tree-shaking 吃不到，下表的「669 KB → 200~250 KB」作废。** 全模块用 `var THREE = window.THREE` 拿全局，
>    构建入口必须 `window.THREE = THREE` → **命名空间逃逸 → Rollup 无法摇树**。
>    实测 `THREE.X` 成员 **51 个**、无动态访问 → 理论上可手写 shim 换回，但会引入「漏成员即静默 `undefined`」的陷阱，
>    **裁决不做**（同 `glitterSpec` 那类静默漂移）。→ **UP1b**。
> 3. **交付物是 `dist/` 目录，不是单个 HTML。** `bgmFile` 是运行时字符串而非 `import`，打包器不管它 →
>    `dist/index.html` 旁边必须有 `dist/assets/audio/`（7.3 MB）。
>    「双击即开」按**目录**判 —— 与今天 `index.html` 需要同目录 `assets/` **同理，无退化**。
>
> **UP1a 的真实收益只有两条：`three/examples/jsm` 解锁（UP2/UP3 的唯一前置）+ HMR。体积不设目标。**

| | |
|---|---|
| **现状** | 13 个 `<script>` 标签（`index.html:29-41`）· `vendor/three.min.js` UMD **669,884 B** · shader 是 JS 字符串数组拼接 |
| **方案** | `package.json` + **Vite** + `vite-plugin-singlefile`（保双可双击）<br>**UP1a**：只做打包 + 双入口 · **UP1b**（后议）：`.glsl` 抽离 + tree-shaking |
| **🔴 关键决策** | **不要一次性 ESM 化 `src/`**。全局 `SW` 命名空间是模块间契约（契约 §1），ESM 化会打断它。<br>**UP1a**：`src/*.js` 保持 IIFE 与字符串 shader，构建入口依序 import<br>**UP1b**（可选，后议）：`.glsl` 真文件 + 51 成员 shim 摇树 + 漂移守卫 |
| **收益** | **解锁 examples/jsm（UP2/UP3 的前置）** · HMR<br>~~`.glsl` 高亮/lint/#include~~（→ UP1b）· ~~tree-shaking 669→200 KB~~（**吃不到**，→ UP1b） |
| **成本 / 风险** | 中 / 中（🔴 **R1：Vite 默认产出 `type="module"`，`file://` 下可能打不开** → 备选 `format:'iife'` / `target:'es2018'`，判据是硬门） |
| **验收** | **14 条，见 `80-UP1-build-chain.md` §5** —— 产出单 HTML 于 `dist/` · **两条入口各跑 15/15 断言** · 两入口读数一致 · `index.html` 与 `src/**` **零改动** · 音频能播 · 体积诚实记录 |
| **包文档** | **`plan/80-UP1-build-chain.md`**（含边界、纠正、风险与配置起点） |

### UP2 · 后期处理管线 【视觉收益最大】

| | |
|---|---|
| **现状** | grep `EffectComposer\|bloom\|vignette\|grain\|postprocess` → **0 命中**。完全无后期 |
| **方案** | `EffectComposer` + `RenderPass` + `UnrealBloomPass`（**阈值调高，只吃反光柱/高光**）+ `OutputPass` + 轻 vignette / film grain |
| **🔴 技术难点** | 现有 RT 链是 `sceneRT`（带 `DepthTexture`，供水面折射读取，`30-scene.js:95-112`）。加 composer 后必须保证：**折射读「水面渲染前」的 sceneRT，bloom 读「水面渲染后」的合成帧**。<br>正确顺序：`湖底 → sceneRT(折射源) → 水面采样 sceneRT → composer(RenderPass 取水面帧) → bloom → OutputPass → 屏幕`<br>**sceneRT 与 composer 的 RT 必须是两个独立 RT** —— 合并会让折射击中自己（水里有水） |
| **收益** | **镜面高光 + bloom = 治愈感翻倍**，全案性价比最高的一笔 |
| **成本 / 风险** | 低（UP1 之后）/ 低-中 |
| **✅ 安全点** | UI 全是 DOM（`80-ui.js` / `#hint` / `#dbg`），**不在 GL 里 → 不受 bloom 影响** |
| **验收** | 新增：光晕半径像素判据 · **回归**：#13 阈值重标 + #6/#8 重测（见 §2） |

### UP3 · HDRI 环境光照

| | |
|---|---|
| **现状** | `30-scene.js:165-175` = 1 DirectionalLight + 1 HemisphereLight（**两个颜色是手猜的**）+ 1 AmbientLight。**无 env map、无 PMREM** |
| **方案** | 4 张 CC0 HDRI（Poly Haven）晨/午/昏/夜 → `RGBELoader` + `PMREMGenerator` → `scene.environment`；在 `applyTimeState()` 里切换（或交叉淡化） |
| **🔴 风险** | **会和 13 个 keyframe 的美术方向打架** —— 缓解：env map 只承担「环境光 + 水面反射」，`fog` / `sun` / `sky` 色**仍由 keyframe 主导**；`HemisphereLight` 保留但强度下调为补差 |
| **已知空缺** | **真月光 HDRI 稀缺** → 夜间可能要用「低强度冷色 + 程序化」补 |
| **收益** | 环境光物理一致 · 水面有**真实环境反射**（现在只有一个 `uSkyTop`/`uSkyBottom` 二色渐变在假装天空） |
| **成本 / 风险** | 中（4 张 1k HDRI ≈ 1~3 MB）/ 中高 |
| **验收** | 四态 R−B 判据重测标定（见 §2）+ 新增「环境光贡献」读数 |

### UP4 · PBR 扫描贴图（湖底）

| | |
|---|---|
| **现状** | **零贴图**。全库只有 `CanvasTexture`（caustics）与 `DataTexture`（fallback）。`40-lakebed.js:116-210` 是 `MeshStandardMaterial` + 顶点色噪波，**无 normal / AO / roughness map** |
| **方案** | ambientCG / Poly Haven **CC0** 河流卵石贴图组（albedo/normal/roughness/AO，2K）→ 湖底平面用 tiled normal + AO 补微观起伏；鹅卵石保留 hero 层真几何 |
| **🔴 已知坑** | **tiling 会有可见重复图案** → 需 stochastic tiling 或大尺度 macro variation 打破 |
| **收益** | 视觉提升 · **消灭「LOD 接缝」整类问题**（贴图没有接缝，AM-007 那整条线从此不用再打补丁）· 实例数 **238 → ~40** |
| **成本 / 风险** | 低 / 中 |
| **🔴 断言影响** | **#14 / #15 失去对象**（不再有"两层 LOD"）→ 需**重构或作废**，即 AM-007 的二次修订 |

### UP5 · 音频：母带 + 空间化 + foley

| | |
|---|---|
| **🔴 现状欠账** | `10-audio.js:232` 拍击用 `new window.Audio()`，`:267` 只设 `el.volume` —— **不过 limiter、无声像，http 下也一样**。<br>而 BGM（`:524`）在 http 下**已经**走 `createMediaElementSource`。<br>**→ 拍击是全库唯一没跟上 http 升级的音频通路。** 且助手 `panner(v)`（`:169`）只被 `padVoice`（环境垫）用了 |
| **方案** | ① http 下把拍击池接入 `createMediaElementSource` → gain → `StereoPanner` → limiter<br>② **声像由点击 x 驱动** ⚠️ 需给 `playSlap(lv)` 加 x 参（`70-input.js:54` 调用点同步）→ **跨模块签名变更，要走变更单**<br>③ **LUFS 归一**：`pyloudnorm` 两遍，BGM → **−16 LUFS**；拍击 4 段统一峰值<br>④ **无缝循环**：146.8s 是不是干净循环**没验过**（`el.loop = true` 直接接）→ 检测 + crossfade<br>⑤ **foley 分层**：impact + body + spray 三层叠（合成层已有 body/spray 概念，采样层可复用）<br>⑥ **BGM stems**：若生成器支持分轨 → 3~4 层按时段交叉淡化，正好吃满「随时间变化」的主题 |
| **收益** | **声像跟手是交互质感的大项**；LUFS 归一让混音"专业"（现在无响度目标） |
| **成本 / 风险** | 中（①②低，③④低，⑤⑥看素材）/ **低** |
| **验收** | 新增「拍击经过 limiter」断言 + LUFS 读数 + **声像随 x 单调** |

### UP6 · 验证链：Playwright

| | |
|---|---|
| **现状** | `plan/wp5-assert.js` 手搓 CDP + WebSocket + 注入 `__clock` |
| **方案** | Playwright **包一层**（现有 15+16 条断言是真资产，**不推倒**）：`page.clock` 替掉手搓 `__clock`（顺带绕开 `MAX_SUB=4` 那个坑）· trace viewer 看 GL 时间线 · video 录制 · chromium/firefox/webkit 三引擎 · **有条件**的 `toHaveScreenshot()` —— 用法见 §2.1 #3（**不能直接罩整幅水面**） |
| **收益** | 可维护性 · **pixel diff 只对「确定性区域」有效**（UI 层 / 湖底局部 / 布局与配色漂移）。⚠ 对水面碎光**无效**：相位抖动本身就是 20~46dB 的差异（§2.1），套上去只会得到一条永远红的断言 |
| **成本 / 风险** | 低 / **低（dev-only，不进交付物）** |

### UP7 · 数值方法（**建议不做**）

`50-ripple.js:61-65` 的边界吸收是「外圈 12% 均匀衰减」的 heuristic，不是严格的 Mur 一阶 ABC / PML。
收益小、风险中（改错会让涟漪行为整体变化；`_STATUS.md` 的半精度台阶遗留也在这块）。
**除非真出现边界伪影，否则不做。**

### UP8 · 水面 shader 减负（**纯收敛，不改行为**）

> 起因：雨桐问「水面能不能用现成的 `water.js`」。审计 `60-water.js` 后的答复见下 —— **不能换，但里面有真债。**

**不换的理由（能力映射）**：`three/examples/jsm/objects/Water.js`（jbouny 海面）与 `Water2.js` 都是
**海洋**解 —— 靠风、无限远、法线来自**滚动贴图**。本项目是**能用手碰的池塘** —— 有限、点击驱动、静止。
四个已验收的能力它们给不了：

| 契约要求 | `Water.js` | `Water2.js` | 现实现 |
|---|---|---|---|
| 点击出涟漪 + **波纹互相干涉** | ❌ 无波场 | ❌ 无波场 | ✅ 波动方程 FBO |
| 水面**几何**随波起伏 | ❌ 纯法线贴图 | ❌ | ✅ 顶点位移 `uDisp` |
| 透过水看见**被扭曲的鹅卵石** | ⚠️ 只有 alpha/beta **混色**，不采样场景 | ❌ | ✅ depth-aware 屏幕空间折射 |
| 按水深变化的吸收（近清远浊） | ❌ | ❌ | ✅ Beer-Lambert + `NEAR_CLEAR` |
| 破碎反光柱（**两层**法线） | ⚠️ 单层贴图 | ⚠️ 两层但都靠贴图滚动，**不随昼夜变** | ✅ 大波 FBO + 16 波细节 |
| 与 13 keyframe 昼夜联动 | ❌ 需自接 | ❌ | ✅ `applyState` |
| **探针可断言** | ❌ | ❌ | ✅ 8 个 `uProbe` |

**即：换库 = 放弃上表 4 条已验收判据。** `60-water.js` 的"复杂"不是手滑，每一块都映着一条需求。

**但审计查出两处真债，建议收掉：**

| # | 债 | 位置 | 处置 |
|---|---|---|---|
| 1 | 🔴 **`uProbe` 的 8 个 debug 分支编在交付 shader 里** | `60-water.js:266-273` | 调试代码进了生产着色器。改用 `material.defines` / `#define WP_PROBE` → **只在 `?debug=1` 时编译进去**。顺带省掉热路径的 8 次比较 |
| 2 | 🔴 **`glitterSpec()` 用 JS 把 GLSL 的 D/Vis/Fs 又实现了一遍** | `60-water.js:297-351`（55 行） | 只服务于 `probe` 预测值。**shader 一改它就静默漂移** —— 维护陷阱。而断言 **#13 已直接读像素** → 它很可能**完全冗余**。**建议审计后删除，或改为直读像素** |
| 3 | ⚪ `swDetail()` 的 16 波 + 域扭曲（约 40 行生成 GLSL） | `60-water.js:83-130` | **可**用**滚动 normal map**（UP4 的贴图）部分替换：更便宜、更真实，且 **mipmap 天然做了 `pw` 的手工滤波**。⚠️ 但必须实测防「蜂巢纹」回归 —— 那是 WP2 打过的仗 |

> **#1 / #2 是纯收敛，不改任何画面行为，也不动契约签名** —— 风险最低的一类改动，
> 可以随时插入任何波次。**#3 归 UP4，别单独做。**

---

## 4. AI 工具的定位（雨桐专门问了，单列）

| 该用 | 理由 |
|---|---|
| **albedo-only 图案**（caustics / foam mask） | AI 只做"颜色"，不碰几何量，风险可控 |
| **BGM 的 stems** | **要的是分轨，不是更好的生成器** —— 分层才吃满"随时间变化" |
| **前期 mood reference** | 用 AI 对齐审美方向，比返工便宜 |

| 不该用 | 理由 |
|---|---|
| PBR 的 **normal / roughness** | AI 生的几何量不可靠 → 用**扫描件**（CC0） |
| **mesh**（鹅卵石） | AI mesh 是未优化高模；**程序化低模 + 实例化更好** |
| shader / 代码 | 不适用 |

---

## 5. 依赖图与波次

```
UP1 构建地基 ──┬──→ UP2 后期 bloom
               └──→ UP3 HDRI env
UP4 贴图    （独立）
UP5 音频    （独立，但 ② 要改 playSlap 签名）
UP6 验证    （独立，dev-only）
```

| 波次 | 包 | 前置 | 可并行 |
|---|---|---|---|
| **A** | **UP1**（构建）∥ **UP6**（验证）∥ **UP4**（贴图） | 无 | 三者文件交集为零 ✅ |
| **B** | **UP2**（后期）∥ **UP3**（HDRI） | **UP1 done** | 二者交集在 `30-scene.js` → **串行** |
| **C** | **UP5**（音频） | 无 | 与 A/B 并行安全 |
| **任意** | **UP8**（shader 减负 #1/#2） | 无 | **风险最低，可随时插入** —— 但 #3 归 UP4 |

> ⚠️ **UP4 与 UP2/UP3 都碰 `30-scene.js` 或 `40-lakebed.js`** —— 排包时要按文件所有权错开，别重演 WP5 那种并发写。
> ⚠️ **UP8 独占 `60-water.js`**，与 A/B/C 都无交集 —— 但它会被 UP4 的 #3 二次触及，**别和 UP4 同时开**。

---

## 6. 契约 / 变更单影响

| 升级 | 改契约 §6 参数 | 需开变更单 | 使哪条断言失效 |
|---|---|---|---|
| UP1 | 无 | — | 依赖字节数的判据需复核 |
| **UP1a** | 无 | **AM-013**（截帧改显式 `--shots`，默认不写静帧） | 无（断言条数与阈值均未变） |
| UP2 | 新增 bloom 参数组 | **AM-009** | #13 阈值 · #6 / #8 |
| UP3 | 新增 env 参数组 | **AM-010** | AM-007 §1 四态 R−B |
| UP4 | `pebbleScaleNear/Far` 语义变 | **AM-011** | 🔴 **#14 / #15** |
| UP5 | `playSlap` 签名 +x | **AM-012** | 无（新增 2 条） |
| UP6 | 无 | — | 无 |
| **UP8** | **无（不动签名）** | — | 无。⚠️ 但 #2 若删 `glitterSpec`，需先确认 **#13** 不依赖它（#13 读像素，应无关） |

---

## 7. 不做清单

| 不做 | 理由 |
|---|---|
| AI 生 mesh 给鹅卵石 | 程序化低模 + 实例化**更好**；AI mesh 是未优化高模 |
| Blender / Houdini 做石头 | geometry nodes 可行，但对 238 颗石头性价比极低 |
| 换引擎（Babylon / PlayCanvas） | 零收益，全是重写成本 |
| **一次性全面 ESM 化** | 会打断 `SW` 契约（§1），收益低于风险 → 拆成 UP1a/UP1b |
| 严格 Mur / PML 边界 | UP7，收益小风险中 |
| three 自带 `Water2` | **降级**：不支持点击涟漪 |

---

## 8. 回退策略

- **双入口并行**：保留传统 `index.html`（13 个 `<script>`，`file://` 可用）作为 fallback entry，
  构建版另出。与 `10-audio.js` 已有的 file/http 双分支**同一模式**，架构一致。
- **每一项可独立回退**：UP2/UP3 是渲染后处理与光照，拔掉即回当前状态；UP4 是材质替换，
  `40-lakebed.js` 是单文件；UP5 是音频链。**没有任何一项是不可逆的。**
- **每项独立验收**：按 §3 各包的验收条目逐项过，**不攒到最后一起验**。

---

## 9. 如果只做两件

**UP2（后期 bloom）+ UP5（音频母带/空间化）。**
前者是肉眼最大的跃升、代码量最小；后者是**零风险纯收益**，且 `playSlap` 那条是**真欠账**而非"不够专业"。

要**工程**专业度则选 **UP1 + UP6** —— 它们不改善画面，但让后面所有事情都变简单。
