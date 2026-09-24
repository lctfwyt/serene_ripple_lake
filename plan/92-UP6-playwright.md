# 92 · UP6 完工报告 —— 验证链：Playwright（波次 4 的第三个包）

> 口径：`plan/90-WAVE4.md` **§0 / §1 / §4 / §6**（本文件是那四节的落地记录）。
> 归属：**只新建 `plan/pw/**`**，另加 `package.json`（仅 devDependencies + 6 条 scripts）。
> **`plan/wp5-assert.js` / `plan/wp5-env.js` 一个字节都没动** —— 见 §4 验收 #4。
> 完成时间：2026-09-24 20:1x · 提交：`test(UP6): ...`

---

## 0. 一句话

把 15 条断言 + 16 条环境判据**包了一层 Playwright**，全部通过；顺带把「静帧能不能做像素基线」
这件事从"经验判断"变成了**可执行的证明**（钉住 → 指纹恒等；不钉 → 复现 20~28 dB 漂移），
并给出**一个 1 像素的哨兵**证明像素回归不是摆设。

| | 手搓 CDP（`npm run assert`） | Playwright（`npm run pw`） |
|---|---|---|
| 覆盖 | 15 条断言（+ `wp5-env.js` 16 条在另一个脚本） | **14 个用例 / 4 个项目**：15 条断言 · 16 条环境判据 · 确定性证明 · 像素回归 + 哨兵 · `page.clock` |
| 环境换档 | 一个判据起一个 Chrome 实例（3 段 spawn + 3 段 CDP 样板） | 一个 config 里的 4 个 `project`（`testMatch` + `use` 覆盖） |
| 媒体模拟 | 先导航 → CDP 设媒体 → **再导航一次** | `use: { reducedMotion: 'reduce' }`（context 级，第一帧就生效） |
| 浏览器 | 系统 Chrome（路径硬编码常量） | 系统 Chrome（`channel: 'chrome'`） |
| 耗时 | 15 条 ≈ 60~90s | 14 个用例 **2.1 分钟** |
| 浏览器下载 | — | **0**（`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` + `channel: 'chrome'`） |

---

## 1. 交付物

```
plan/pw/
├── playwright.config.mjs          # 4 个项目分档；viewport 1280×720 直接设（不走 --window-size 换算）
├── frozen-hashes.json             # ★ 入库：冻结件 sha256（验收 #4 的基线）
├── compare-readings.mjs           # ★ 入库：新旧读数逐字段比对器（验收 #2）
├── verify-frozen.mjs              # 验收 #4：两冻结脚本 sha256 未变
├── verify-dist.mjs                # 验收 #5：dist/ 内容哈希清单 + dev-only 引用泄漏检查
├── lib/
│   ├── const.mjs                  # 入口 / 路径 / 产物落点，config 与 specs 共用
│   └── page-lib.mjs               # 页面内测量库（HELPERS 逐字副本）+ EXTRA + 钉相位/哨兵注入
└── tests/
    ├── 10-assert.spec.mjs         # 15 条断言（顺序不可调换，见文件头）
    ├── 20-determinism.spec.mjs    # A 只钉 uTime 不够 · B 不钉会漂 · C 钉住指纹恒等
    ├── 30-pixel.spec.mjs          # 像素回归 ①②③ + 哨兵 A/B/C
    ├── 40-clock.spec.mjs          # page.clock 推模拟时间
    ├── env-narrow.spec.mjs        # 判据 #2（project env-narrow：375×812）
    ├── env-reduced-motion.spec.mjs# 判据 #3（project env-reduced-motion）
    ├── env-no-webgl.spec.mjs      # 判据 #4（project env-no-webgl）
    └── __snapshots__/             # ★ 入库：3 张像素基线（ui-panel 4.7KB / bed-clip 35.6KB / full 523.9KB）
```

**所有"跑一次就改写"的产物统一落 `test-results/`**（已被 `.gitignore §5` 覆盖）——
读数 JSON、报告 JSON、dist 清单基线、失败 diff 产物。理由与 `.gitignore §10` 对
`plan/wp5-assert.json` 的裁决完全一致（"脚本每次重跑都改写它 → 纯 diff 噪声"），
**且本包没有去改 `.gitignore`**（它不属 UP6，本波次无人拥有）。

`package.json` 新增 6 条脚本：

```
"pw":              playwright test --config=plan/pw/playwright.config.mjs
"pw:update":       …… --update-snapshots          # 重录像素基线
"pw:compare":      node plan/pw/compare-readings.mjs
"pw:frozen":       node plan/pw/verify-frozen.mjs
"pw:dist":         node plan/pw/verify-dist.mjs check
"pw:dist:snapshot":node plan/pw/verify-dist.mjs snapshot
```

> ⚠ **明确报备一处超出字面约束的改动**：`90-WAVE4 §4` 约束 ② 写的是"只加 devDependencies"，
> 我在 devDependencies 之外**还加了 6 条 `scripts`**。理由：验收要求"跑一次 `npm run build` 验证
> `dist/` 内容不变"、以及"证明哨兵会红"，这些都得有可复现的入口；缺了脚本，主控复核只能手敲长命令。
> **`"type": "module"` 一个字都没加**（`plan/wp5-assert.js` 是 CJS，加了立刻 `ERR_REQUIRE_ESM`）。
> devDependencies 只多 `"@playwright/test": "^1.63.0"`。

---

## 2. 验收 ①：确定性项 + #13 / #14 / #15 全跑通

`15/15`，且**两个入口都跑了**：

| 入口 | 结果 | 耗时 |
|---|---|---|
| 免构建 `index.html?debug=1` | **15/15** | 31.7s |
| 构建版 `dist/index.html?debug=1` | **15/15** | 31.5s |

`§4` 点名的确定性项**逐项落地**（原始输出见下表）：

| §4 点名项 | Playwright 实测 |
|---|---|
| 6 时段 `sunElev` / `sunAz` / `sunI` / `gGain` / `gSpec` | h2/h5.5/h8/h12.5/h18.5/h22.5 —— 五个字段全部采集（见 `test-results/pw-readings.json` 的 `states`） |
| `lod` 全字段 | `counts 88+150` · `seam 58.06/46.95 ratio 0.809` · `whole 84.17/44.83` · `midRatio 1` · `coverage instance 0.4548 / analytic 0.4377 / area 103.67 / n 88` · `screen 84.2 / 175.5` |
| `chromaStep` per 表 | `sun 2.108 / sky 1.8 / gnd 1.406 / fog 1.512 / wat 1.924 / gli 2.1` · `max 2.108 @sun` · `keys 13` |
| `REVISION` | `160` |
| 画布尺寸 | `1280×720` · `aspect 1.7778` · `hHalf 28.53°` · `dpr 1` |
| **#13** | 24 相位中位 **2.136**（≥1.8）· 亮带质心 **636.4/1280 = 49.7%**（中心 ±6% 内） |
| **#14** | `farMed/nearMed = 0.809 < 1.00` |
| **#15** | 解析覆盖 **0.4377 ≥ 0.40** |
| 其余确定性项 | #1 `anyNaN false` · #2 `calls 6 / tris 53088` · #5 `max 2.108 < 2.5` |
| 非确定性/行为项 | #3 折射差分（`hitFrac 18.1%`）· #4 涟漪衰减 · #6 湖底 std 中位 `15.05 > 14` · #7 · #8 `audioCtx=running` |

**环境判据 16 条**（`wp5-env.js` 的全量移植，逐项见下）：

| 判据 | 实测 |
|---|---|
| #2 窄屏 375×812（5 条） | `ready true` · `mobile true (innerWidth<768)` · `fieldSize 256` / `50+70` / `caustics false` · **6 个可见元素两两零交叠** · 零出屏 · console 干净 |
| #3 reduced-motion（7 条） | `matchMedia true` · `mode fixed` · hour `19.6856 → 19.6856`（4s 差 **0.00e+0**）· `cameraSway false` / `glitterJitter 0` · `__rmFrozen true` · `uTime 0 → 0` · 画面亮度 `104.18 → 104.18` · **点击后 `ripple.active 1`** |
| #4 关 WebGL（4 条） | `webglCtx false`（flag 真生效）· `#fallback.on true` · `#c display none` · `SW.ready false` · `bootWrapped true` · 文案含 "WebGL" · **console 零报错**（证明走的是 boot 拦截器而非 try/catch 兜底） |

---

## 3. 验收 ②：新旧读数逐字段一致 —— **87/87**

`node plan/pw/compare-readings.mjs` 分两档容差，**无一项超差**：

| 档 | 项数 | 容差 | 结果 |
|---|---|---|---|
| **精确档**（几何 / 关键帧 / 材质 / LOD） | 62 | `1e-9` 或整数相等 | **全部 `Δ = 0.000000000`** |
| 相位档（随 `uTime` 走） | 6 | 显式（`ratioMed ≤0.15`、`centroid ≤8px`…） | `cpNight.ratioMed 2.143→2.136 (Δ0.007)` · `centroidMed 639.9→636.4 (Δ3.5px)` · `cpNoon.ratio 1.043→1.040` · `rf.hitFrac 0.1885→0.1813` · `rf.maxDiff 92→88` |
| 行为档（15 条断言的判定） | 15 | 两者皆 true | 全 true |
| 其余 | 4 | — | `env.canvas` / `aspect` / `dpr` / `rev` 全等 |

精确档里包括 `lod` **全部 18 个字段**、6 时段 **30 个字段**、`chroma` **20 个字段**、
`calls 6` / `tris 53088` —— **逐位相等，不是"在容差内"**。

> 旧读数取的是**已落盘的 `plan/wp5-assert.json`**（UP5 提交时的那份），不是"现场再跑一遍旧脚本"。
> 理由：旧脚本每次运行都重写那个文件，而它**不属 UP6** —— 为了拿一份"同会话"读数去动别人的文件、
> 并制造一个与本包无关的 diff，不划算。落盘件就是它的输出。

---

## 4. 验收 ③：像素回归 + 哨兵（**本包最需要认真做的一项**）

### 4.1 选了哪条路，以及为什么"另一条路在本场景不存在"

`§4` 约束 ③ 给了两条路：① 钉 `uTime` + `animations:'disabled'`；② 只罩非水面区域。

> **② 在本项目不可用。** 水面是 90×90 平面、铺满整个视口；`#ui` / `#hint` 的子元素全是
> **半透明叠在湖水上**的，`#fallback` 正常情况下 `display:none`。
> **全库不存在"非水面区域"** —— 所以只能走 ①。这不是偷懒，是场景决定的。

### 4.2 ① 照字面写是**不够**的 —— 这一点本包用实测钉死了

`roadmap §2.1 #3` 写的是"先 `SW.water.uniforms.uTime.value = 固定值`"。实测：

```
uTime 赋值后立即读 = 7         ← 赋值生效
300ms 后读        = 4.6585    ← 已被覆盖回 tAcc（两次运行 4.6585 / 4.8764）
```

原因在 `src/60-water.js:456`：`update()` 每帧无条件 `u.uTime.value = tAcc`；
而 `99-main.js` 的帧循环里 `SW.water.update(dt)` 在 `SW.scene.render(dt)` **之前**。
→ **单次赋值活不过一帧。**

所以钉相位必须同时钉住**三条独立的链**（缺一条帧就还在漂）：

| # | 链 | 手段 | 归属 |
|---|---|---|---|
| ① | `hour` | `window.__seek(h)` → `SW.time` 切 `fixed` | 契约 §2.9 |
| ② | 水面 `uTime` | **运行时包装 `SW.water.update`：原函数返回后再回钉一次** | 契约 §2.6 公开面 |
| ③ | 每帧 `dt` | `window.__hold(true)` → `ripple.simTime` / 湖底 caustic 相位 / 时间过渡全停 | 契约 §2.9 |

**只碰公开面，不改任何 `src/**` 文件**（`plan/pw/lib/page-lib.mjs` 的 `pinSnippet`）。

### 4.3 确定性证明（`tests/20-determinism.spec.mjs`）

| 用例 | 结论 | 实测 |
|---|---|---|
| **C · 钉住之后** | 帧指纹**逐位相同** | 4 次采样 `hash = 1606781963` ×4 · 不同指纹数 **1** |
| **C 的跨运行复现** | **两次独立运行的指纹也相同** | 第一轮 `1606781963` · 完整套件轮 `1606781963` |
| **B · 不钉** | 复现 `§2.1` 的漂移量级 | dawn `max 74 / 28.2dB` · noon `100 / 27.8dB` · dusk `100 / 24.9dB` · night `137 / 20.2dB`（第二组 28.2/27.5/24.8/20.4）<br>↳ 对上 roadmap 表「同入口 dist #1↔#2」列的 **30.5 / 26.3 / 24.4 / 20.9 dB** |
| **A · 只钉 uTime** | **不够** | 见 §4.2 |

### 4.4 覆盖的三块区域

| 区域 | 说明 |
|---|---|
| `ui-panel.png` | 左上时段面板（`#ui > div` 第一个，纯 DOM 文本 + 半透明底） |
| `bed-clip.png` | 湖底清晰带局部裁切 —— `x∈[448,832] × y∈[475,677]`，由断言 #6 的采样区反推（`readPixels` 原点在底部，注意换算） |
| `full.png` | 整幅视口。**只在 4.3 的确定性证明成立的前提下才允许** —— 它就是一个"如果确定性不成立就不该存在"的断言 |

截图前清掉两样东西（否则帧不可复现）：
- `#dbg` 调试面板 —— 里面有 fps / calls / hour 的**实时文本**，每帧都在变；断言必须用 `?debug=1` 起页，所以它必然在
- 残留波场 / 哨兵注入的 `#pw-px`

`#ui` / `#hint` **保留**（与 `plan/shots-wp5/` 那套干净帧口径一致，它们本就是交付画面的一部分）。

### 4.5 哨兵：证明它**会红**（而且只改 1 个像素就会红）

```
哨兵 A · UI 面板     控制组（未注入）→ 绿 ✔
                     注入 1 个设备像素品红 @(30,26)，实测 bbox=[30, 26, 1, 1]
                     → ❌ 1 pixels (ratio 0.01 of all image pixels) are different
哨兵 B · 湖底裁切    控制组 → 绿 ✔ · 注入 @(640,576) bbox=[640, 576, 1, 1]
                     → ❌ 1 pixels (ratio 0.01 of all image pixels) are different
哨兵 C · 反向对照    带坏像素 → 红 · 移除后 → **绿**
```

**C 是关键**：只有 A + B，"永远红"也能通过。C 证明这条断言**既不漏报、也不虚报**。

**为什么用品红**：`toHaveScreenshot` 单像素比较带 `threshold: 0.2` 的感知容差，
近湖水色的"坏像素"会被容差吃掉 → 哨兵假绿。

### 4.6 🔴 踩到的坑（值得写进波次纪律）

**Playwright 的 `updateSnapshots` **默认值是 `'missing'`，不是 `'none'`。**
本包第一版的跳过判据写成 `updateSnapshots !== 'none'` → **3 个哨兵被静默跳过**，
输出里只是 3 行 `-`，很容易当成"通过"。正确判据是只在 `'all'` / `'changed'` 时跳过：

```js
const OVERWRITES_BASELINE = (t) =>
  t.config.updateSnapshots === 'all' || t.config.updateSnapshots === 'changed';
```

理由：危险的不是"快照缺失"，而是**失败断言不抛错、直接改写基线** —— 那会让坏帧覆盖干净基线，
之后所有运行都对着坏基线比。`--update-snapshots` 那次运行里哨兵必须让路。

---

## 5. 验收 ④：两个冻结脚本 sha256 未变

```
node plan/pw/verify-frozen.mjs
  ✅ plan/wp5-assert.js   8ac52579f41a342a16056810385fb677b17c95f574a9d9aabe93291591345904
  ✅ plan/wp5-env.js      bd9dd0e8fc115cce0a3ffe243a9f58ac9ec6218a6d31445c2d519ce61869ad2a
```

基线落 `plan/pw/frozen-hashes.json`（**入库**，tiny 且"永远不该变"正是它的用途），
并在报告里与开工前的 `sha256sum` 输出逐字符对上。`plan/shots-wp5/` 4 张证据帧亦在位未动。

---

## 6. 验收 ⑤：Playwright 不进交付物

```
node plan/pw/verify-dist.mjs snapshot   → 7 个文件
npm run build                           → dist/index.html 732.05 kB │ gzip 195.96 kB（537ms）
node plan/pw/verify-dist.mjs check      → 7/7 逐文件一致
```

| dist 文件 | 体积 | 哈希（前 12 位） | 与**开工前**记录比对 |
|---|---|---|---|
| `./index.html` | 732057 B | `14f8519ef502` | **一致** |
| `./assets/audio/bgm-stillwater.mp3` | 3254563 B | `6f977ada98e6` | **一致** |
| `./assets/audio/bgm-cand1.mp3` | 3881827 B | `153a206a0767` | **一致** |
| `./assets/audio/slap1~4.wav` | 139244 B ×4 | `1dbd53a9d053` / `772866158a86` / `0f1e2d4457fe` / `578bee67bb7e` | **一致** |

> 这三个哈希就是我开工时（**尚未做任何事之前**）落的那份 manifest，逐字符相同。
> 也就是说：UP6 全程（含 2 次构建）**没有改变交付物一个字节**。

额外的针对性检查（`verify-dist.mjs` 内置）：
- 交付物 `dist/index.html` 里搜 `playwright` / `plan/pw` / `pw-report` / `test-results` / `@playwright` → **零命中**
- `dist/` 下无 `plan` / `pw` / `playwright` / `test-results` 等非交付目录

---

## 7. `page.clock`（`tests/40-clock.spec.mjs`）—— 含一条**反吹**的结论

`§4` 方案要点说 `page.clock`「顺带绕开 `MAX_SUB = 4` 那个坑」。绕开了，但**收益不是速度**：

| | 实测 |
|---|---|
| 量化 `MAX_SUB` 限流 | `SW.ripple.step(4.6)` → `simTime` 只推进 **0.0667s**（= 4 × 1/60），远小于 4.6 |
| `page.clock.runFor(6000)` | `simTime +6.02~6.07s` · `active 0`（源按 simTime 正常老化） |
| **墙钟** | **2268ms / 4838ms / 4978ms**（三轮）|
| 对照：自然衰减 | `3250ms / 3750ms` |

**结论（诚实版）**：`page.clock` **不一定更快，实测还慢过自然衰减** —— 因为墙钟大头是
375 帧 rAF 的 **GL 渲染**，一帧都省不掉；而"自然衰减"等的其实是**同一个** 4.5s 模拟时间。
它真正的收益是**确定性**：从"轮询 20s 等它自己老化、超时了再拿 `step()` 兜底"
变成"一次调用推完精确的模拟时间"。判据从**赛跑**变成**算术**。

> 本包因此**没有**在用例里设"更快"的硬阈值（`wallMs < 20000` 只当"没卡死"的护栏）——
> 那种阈值会随机器抖动，而且它本来就不是这条用例的主张。

---

## 8. 边界与纪律自查

| 项 | 结果 |
|---|---|
| `git status --short` 全程 | 只有 `M package.json` · `M package-lock.json` · `?? plan/pw/` —— **零越界** |
| `plan/wp5-assert.js` / `wp5-env.js` | 未改（sha256 已核）· **未删**（保留两套并存待主控裁） |
| `src/**` · `index.html` · `app/**` · `vendor/**` · `assets/**` | 未碰 |
| `dist/**` | 未提交改动（.gitignore §4）：2 次构建后内容哈希与开工前**逐位相同** |
| `.gitignore` | **未改**（UP6 段 §5 是早先预留的；产物改落 `test-results/` 规避） |
| `_STATUS.md` | **只追加**自己的段，历史行未改写 |
| 一次性临时脚本 | 无（`plan/pw/**` 全是正式资产，命名不带 `_` 前缀） |
| 凭据 | 未使用、未出现 |

---

## 9. 交给主控的三件事

### ① 两套并存还是切到 Playwright —— **我建议：两套并存到 UP2/UP3/UP4 落地之后再裁**

理由：本波次之后马上要开 UP2（bloom）/ UP3（HDRI）/ UP4（贴图），这三项**都会让像素基线失效、
也会动 `#13 / #6 / #8` 的阈值**。此刻删掉手搓脚本，等于在"读数正在变"的时候丢掉一份独立实现。
两套的读数一致本身现在是一条**交叉验证**（87/87 已证），别提前放弃这份冗余。
**我没有自行删 `plan/wp5-assert.js`。**

### ② 像素基线会随渲染后端变 —— 它是**本机回归门**，不是跨机契约

3 张基线是 SwiftShader 软件光栅化的产物（`--enable-unsafe-swiftshader`）。
换机器 / 换 GPU / 换 Chrome 大版本都可能产生非零 diff。建议：
- 当作"**本机**改动检测器"用（它的价值就在于"我改坏了会立刻红"，§4.5 已证）；
- **不要**把它挂进 CI 当作跨环境门 —— 那会得到一条常在红的断言，比没有更坏。

### ③ 开 UP2/UP3/UP4 时各要做的两件事

1. 先 `npm run pw:update` **重录**像素基线（并在报告里写清"这次重录对应哪次改动"）；
2. 按 `roadmap §2` 的失效表**重标**受影响阈值（UP2 → `#13 / #6 / #8`；UP4 → `#14 / #15` 失去对象）。

### ④ 留一个缺口（明确不假装做完）

`wp5-env.js` 的 16 条判据**已全量移植**，但 `wp5-env.js` 里还有两处**非判据的附加输出**未搬：
`interactions` 与 `fallback` 的原始 `applied` 明细表。它们不是判定项，只是诊断打印；
本包的 `env-*.spec.mjs` 已经把 `applied` 数组**原样打印**了（见 §2 表格），故未单独成项。

---

## 10. 复现命令（主控复核用）

```bash
export PATH="/usr/bin:/bin:$PATH"

# 全套：14 个用例 / 4 个项目（约 2.1 分钟）
npm run pw

# 逐项验收
npm run pw:compare     # 验收 ②  87/87
npm run pw:frozen      # 验收 ④  sha256 未变
npm run pw:dist:snapshot && npm run build && npm run pw:dist   # 验收 ⑤

# 构建入口也跑一遍 15 条（验收 ① 的第二个入口）
SW_URL="file:///D:/projects/still_water/dist/index.html?debug=1" npm run pw

# 重录像素基线（UP2/UP3/UP4 开工时用）
npm run pw:update
```
