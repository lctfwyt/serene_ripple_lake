# 105 · UP13-fix3 —— 横向光带与月亮柱同频（门控搬到消费端 mix）

> 包名 `UP13-fix3` · 变更单 **AM-032** · 波次 **14** · 独占工作区 · 主控开包 2026-09-29 22:5x
> 所有者：UP13（`src/30-scene.js` / `src/60-water.js`）
> **状态**：⬜ **待施工**（本文件 = 唯一开工口径）
> 前置：AM-030 已应用 · AM-031 已应用（HEAD `b0a77d6`）· `npm run pw` 16 passed · `pw:dist` ✅

---

## 0. 需求原文与症状

雨桐（2026-09-29 22:5x）：

> 「我还是觉得一边拖动时间，夜晚月光立刻就出现，但白天的横向光带必须松手才出现，很奇怪，真的没有改良法吗」

> 「UP13修复完了，请检查代码和文档。视觉我来验。」

拆三条：

- **R1（主）** 横向光带的**出现**与**消失**都要像月亮柱那样**当帧生效** —— 不等松手、不等重烘。
- **R2（参照）** 月亮柱的机制是 `60-water.js:709` 的 `uSunRadiance × (1 − bandGate())`：**每帧在 shader 里算**，时间一到当帧生效。
- **R3（反向约束）** 不许为此把画面改样（观感已五轮定档，且用户明确"视觉我来验"）。

**症状（精确版）**：

| 方向 | 月亮柱 | 横向光带 | 结论 |
|---|---|---|---|
| 夜 → 昼 | 立刻出现 | **不出现**（要松手） | ← 本次要治的 |
| 昼 → 夜 | 立刻消失 | 立刻消失 | AM-031 刚修好 |

---

## 1. 现状机制与根因

### 1.1 两条路径的本质差别

| | 月亮柱 | 横向光带 |
|---|---|---|
| 算法在哪 | `60-water.js` **FRAG**，每帧按 `g` 现算 | `30-scene.js` **烘进 env 贴图** |
| 门控作用点 | 消费端（shader 里乘 `1−g`） | **生产端**（决定烘哪张） |
| 拖动中 `g` 变化 | 立刻生效 | **要等重烘** |

### 1.2 根因链（白天侧无解的原因）

`30-scene.js:517-518`：

```js
var g = envGate(s);
var eqWater = (g > 0) ? buildEnvEquirect(s, W, H, { g: g, band: P.envBand }) : eq;
```

- `g = 0`（夜）⇒ `eqWater === eq` ⇒ **两张是同一个对象**，且**那张里没有环**。
- `g = 1`（昼）⇒ `eqWater` = 一张**带混合**的贴图（`ampDisc = 0`、`ampBand = amp × 0.5`）。
- **中间 `g`** ⇒ 烘出来的是一张**按当帧 g 混好的**贴图。

AM-031 补的消费端门控（`60-water.js:740-743`）只能做**二选一**：

```
g > 0  →  ev.equirect      （带光带那张）
g = 0  →  ev.equirectBase  （无光带那张）
```

🔴 **于是"夜 → 昼"这一侧无解**：从夜里往白天拖时，`g` 确实在涨，消费端也确实立刻改选了"带光带那张"—— 但**那张贴图是夜里烘的，里面根本没有环**。必须等松手重烘，才有环可采。

> 一句话：**当前生产端烘的是「按 g 混好的成品」，所以"当帧换档"在物理上不可能** —— 成品只有一个档。

### 1.3 与 AM-030 / AM-031 的关系（三层闸，各治一层，不许回退任何一层）

| 层 | 变更单 | 管什么 | 治的病 |
|---|---|---|---|
| ① 生产端 **节奏** | AM-030 | 何时重烘（停稳 6 帧 + 成功才提交） | 拖一次烧光终身配额 ⇒ 永久静默失效 |
| ② 消费端 **选图** | AM-031 | 夜段一律不采光带贴图 | 贴图 stale 时夜段仍挂带子 |
| ③ 消费端 **混权重**（本包） | AM-032 | 两张常驻 + 每帧 `mix(·, ·, g)` | **拖动中两侧都不跟档** |

②③ 不构成替代：② 只在"两张里挑一张"，③ 是"两张按权重混" —— ② 是 ③ 在 `g ∈ {0,1}` 的退化情形。

---

## 2. 定稿方案：两张常驻 + 消费端 `mix`

### 2.1 生产端改为**恒烘两张满档贴图**（与当帧 `g` 无关）

| 贴图 | 烘法 | 含义 | 字段 |
|---|---|---|---|
| `eq` | `buildEnvEquirect(s, W, H)`（不传 `opt`） | **纯圆斑满档**（= 现行 `g = 0` 那张） | `env.equirectBase` |
| `eqBand` | `buildEnvEquirect(s, W, H, { g: 1, band: P.envBand })` | **纯光环满档**（= 现行 `g = 1` 那张） | `env.equirect` |

两张**每次都烘**、与 `g` 无关 ⇒ `env.equirect !== env.equirectBase` **恒成立**（不再有"夜段同对象"特例）。

### 2.2 消费端把"选图"升级为"混权重"

```glsl
vec3 envCol = mix(texture2D(uEnvEqBase, swEnvUV(Renv), envBias).rgb,
                  texture2D(uEnvEq,     swEnvUV(Renv), envBias).rgb,
                  uEnvMix) * uEnvGain;
```

`uEnvMix = bandGate()`（每帧写）⇒ `g` 一动权重立刻变 ⇒ 光带**当帧**出/消，**与月亮柱同频**。

### 2.3 为什么数学等价（逐项对照）

`buildEnvEquirect(s, ·, { g })` 的两个幅度项（`:251-252`）：

```
ampDisc = amp × (1 − g)      ampBand = amp × bd.amp × g
```

| | 现行（烘成品） | 本包（两张 + mix） |
|---|---|---|
| 环项 | `amp × bd.amp × g × ring` | `g × (amp × bd.amp × ring)` |
| 圆斑项 | `amp × (1−g) × lobe` | `(1−g) × (amp × lobe)` |
| 底色（天空/地面半球） | `(1−g)·sky + g·sky = sky` | `mix(sky, sky, g) = sky` |

⇒ **逐项相同**。且：

- `mix(a, b, 1) = a·0 + b·1 = b` —— **IEEE754 精确**（`x·0 = 0`、`0 + y = y`）
- `mix(a, b, 0) = a·1 + b·0 = a` —— **精确**
- ⇒ **13 个 keyframe 上 `g ∈ {0, 1}`，结果与现行逐位相同**

⚠ **诚实公布唯一的差异窗口**：`0 < g < 1`（仅在两个 keyframe **之间**的插值过渡段）——
现行是**烘图时在 float 里求和**再 `toHalfFloat` 存一次；本包是**两张各自 `toHalfFloat`** 后在 shader 里求和。
half 精度 ~3 位十进制 ⇒ 过渡段可能有 **≤ 1 ULP 级**差异。**这不视为回归**（过渡段本来就每帧在变，且不在任何基线的定格上）。

### 2.4 备选（已否决）

| 方案 | 否决理由 |
|---|---|
| 拖动中也重烘 env | 每次烘 = 2 × 8192 像素循环 + 2 次纹理上传，**每次 pointermove 都做 ⇒ 掉帧** |
| 光带改 shader 解析计算 | 烘出来那张是 128×64 + **mip 链**，按粗糙度自动模糊；改屏幕分辨率解析 = 边缘变锐 ⇒ **直接推翻 UP13 五轮调出的白天观感**（`104 §2.1` 已否决过，本次仍否决） |
| 只加 `uEnvMix` 不加第二张贴图 | 不成立 —— 没有"满档环版"可混 |

---

## 3. 施工清单

| # | 文件 | 位置 | 动作 |
|---|---|---|---|
| **L1** | `30-scene.js` | `buildEnv()` `:515-518` | 去掉 `(g > 0) ? … : eq` 二选一，改**恒烘两张**：`var eqBand = buildEnvEquirect(s, W, H, { g: 1, band: P.envBand });` |
| **L2** | `30-scene.js` | `buildEnv()` `:521-531` | 双缓冲第三槽 `_envEqW` 改名/复用为 band 版（**两张恒不同对象** ⇒ 原来的 `oEqW !== oEq` 判空可简化为无条件 dispose，但**保守起见保留判空**）；`env.equirect = eqBand`、`env.equirectBase = eq` |
| **L3** | `30-scene.js` | 顶部字段说明 `:11` / `:19-25` · `env:` 初始化 `:335-337` | 更新注释：`equirect` 自 AM-032 起 = **满档光环版（`g=1`）**、与当帧 `g` 无关；`equirectBase` = 无光带版（`g=0`）；两张**恒存** |
| **L4** | `60-water.js` | FRAG uniform 声明 `:295` 附近 | 新增 `uniform sampler2D uEnvEqBase;` + `uniform float uEnvMix;`（**保留 `uEnvEq`**，其语义变为"满档光环版"） |
| **L5** | `60-water.js` | FRAG `envCol` `:437` | **核心**：`vec3 envCol = mix(texture2D(uEnvEqBase, swEnvUV(Renv), envBias).rgb, texture2D(uEnvEq, swEnvUV(Renv), envBias).rgb, uEnvMix) * uEnvGain;` |
| **L6** | `60-water.js` | `uniforms.*` 初始化 `:612-616` | 新增 `uniforms.uEnvEqBase = { value: makeEnvPlaceholder() };` 与 `uniforms.uEnvMix = { value: 0 };` |
| **L7** | `60-water.js` | `update()` env 供给段 `:729-743` | 改写：`envOn` 追加 `&& ev.equirectBase`（或缺失时回退同槽）；`u.uEnvEq.value = ev.equirect`（**不再二选一**）；`u.uEnvEqBase.value = ev.equirectBase \|\| ev.equirect`；`u.uEnvMix.value = bandGate()`；`curEnvTex` 改**三态**（见 L8） |
| **L8** | `60-water.js` | `probe()` `:812-814` + 模块态 `:217` | `envTex` 改三态：`'base'`（`g ≤ 0`）/ `'mix'`（`0 < g < 1`）/ `'band'`（`g ≥ 1`）/ `'none'`（env 未生效）；**新增只读读数 `envMix`**（`+uEnvMix.value.toFixed(4)`）—— 判据 1/2 的读数入口 |
| **L9** | `plan/pw/tests/60-envgate.spec.mjs` | R4 现有两条断言 `:96-97` / `:107-108` | 🔴 **必须同步改**：现行断言「夜段两张**同一对象**、正午**不同对象**」在本包后**反向**（两张**恒不同**）⇒ 改为「**任意时刻两张都是不同对象且都非空**」；R4 其余断言（`envTex` 三态在 `g∈{0,1}` 时仍是 `'base'`/`'band'`）不变 |
| **L10** | `plan/pw/tests/60-envgate.spec.mjs` | 追加 `test(...)` | 新增 **R5**（本包判据 1/2/3，见 §5） |

改动量预估：`src/` **约 +25 −10 行**（含注释）；GLSL 变更 **1 行**（L5）+ 2 行声明。

---

## 4. 白名单 / 禁区

**你的文件（一票否决级所有权）**

- `src/30-scene.js`
- `src/60-water.js`
- `plan/pw/tests/60-envgate.spec.mjs`
- `plan/105-UP13-fix3-band-mix.md`（本文件）
- `plan/_STATUS.md`（**只追加**）

**禁区（一个字都不许动）**

| 文件 / 项 | 原因 |
|---|---|
| `src/00-config.js` | **本包不加任何 `P` 字段**（`envBand` 四数与雨桐的观感挂账绑定，一个都不许动） |
| `src/20-time.js` | `gGain` 13 键一字不动（护 `#7` / `#11`） |
| `plan/wp5-assert.js` · `wp5-env.js` | **冻结件**（`frozen-hashes.json`） |
| `src/90-debug.js` | 属 WP1（已裁"随下个碰它的包一并修"） |
| `01-CONTRACT.md` | 主控文件（本包 §2.3/§2.6 的同步**已由主控在开包时先落**，见 §6） |
| 门控两端 `0.52 / 0.70` | 实现常量，**不入 `P`**、不许改（`envGate` 与 `bandGate` 必须继续同式同参数） |
| `plan/pw/tests/__snapshots__/**` · `plan/pw/dist-baseline.txt` · `dist/**` | 基线类；本包要求稳态逐位不变 ⇒ **不重落任何基线** |

---

## 5. 判据

### A. 同频性（本包灵魂）

| # | 判据 | 口径 |
|---|---|---|
| **1** | **拖动中当帧跟随**：正午（`g=1`）→ 连续 `__seek` 推进到夜 ⇒ **在拖动序列进行中**（未停稳、`deferred` 在涨、`rebuilds` **未增**）读到 `envMix` 已随 `g` 单调降到 **0** | 证明"当帧生效**不依赖任何重烘**" |
| **2** | **双向 stale 免疫**：① 正午 → 把 `SW.scene.buildEnv` 换存根 → `__seek(22.5)` ⇒ `envMix = 0`、`envTex = 'base'`、`rebuilds` 未增；② **反向**：夜 → 存根 → `__seek(12.5)` ⇒ `envMix = 1`、`envTex = 'band'`、`rebuilds` 未增 | 🔴 **② 是本包区别于 AM-031 的关键** —— 白天侧也当帧出现 |
| **3** | **两张恒存**：任意时刻 `env.equirect` 与 `env.equirectBase` 都是**非空对象且互不相等**（含夜段） | "白天侧有环可采"的**结构前提** |
| 4 | 中间态：把 `__seek` 停在 `g ∈ (0,1)` 的时刻（两 keyframe 之间）⇒ `envMix ∈ (0,1)`、`envTex = 'mix'` | 三态读数生效 |

### B. 不许动的既有读数

| # | 判据 | 期望 |
|---|---|---|
| 5 | `30-pixel ③ 整幅视口`（钉 `PIN_HOUR=12.5` ⇒ `g=1` ⇒ `mix` 退化为 `uEnvEq` 那张） | 用**现行基线不重落**仍绿 |
| 6 | 夜段 A/B（钉 `hour=22.5` + `uTime=7.0`）整幅 sha256 | 与 HEAD **逐位相同**（`g=0` ⇒ 退化为 `uEnvEqBase`） |
| 7 | 15 条断言 | `#6 ≈19.53` · `#7 0.55 / 0.0` · `#11 0.55 (≥0.5)` · `#13 ≈2.6` · `#14 0.809` · `#15 0.4548` · console 0 · jsErrors 0 |
| 8 | 降级 | `envEnabled=false` ⇒ `envReady=0` / `envTex='none'` / 不黑；`equirectBase`（或 `equirect`）缺失 ⇒ 回退同槽、不炸 |
| 9 | 两入口 | `npm run assert` / `assert:dist` 各 **15/15**；`npm run pw` **全绿**（含改后的 R4 + 新 R5） |

> ⚠ `assert:dist` 跑的是**旧 dist 构建**（`dist/` 不在白名单）⇒ 只证明"本包没破坏构建链"。dist 入口的生效要等主控重建 `dist/`（与 AM-031 同款，见 §8）。

### C. 观感（**挂雨桐，不得自行判定通过 —— `§7.2-3`**）

| # | 判据 |
|---|---|
| 10 | 拖动时间：**夜 → 昼，横向光带当帧出现**（与月亮柱同步）；**昼 → 夜，当帧消失** |
| 11 | 稳态观感与改前一致（五轮定档的白天横向碎光、夜晚月色） |

---

## 6. 前置 / 并行

- **前置**：无。AM-030 / AM-031 均已应用；`npm run pw` 16 passed；`pw:dist` ✅（HEAD `b0a77d6`）。
- **并行**：无（本波次独占工作区）。
- **主控已先落**（开包动作，本包不必碰）：`01-CONTRACT.md §2.3`（`equirect` / `equirectBase` 语义表）· `§2.6`（新增 `uEnvEqBase` / `uEnvMix` / `probe().envTex` 三态 / `probe().envMix`）· `02-AMENDMENTS.md`（AM-032 登记 + 改写关系）· `00-INDEX §3`（波次 14）· `04-BOARD`（新箱）。

---

## 7. 不做清单

1. 不改 `P.envBand` 四数（`amp / elev / sigma / detail`）—— 与雨桐观感挂账绑定。
2. 不把光带改成 shader 解析计算（§2.4）。
3. 不动门控两端 `0.52 / 0.70`、不动 `gGain`、不动 `envGate` / `bandGate` 的**算式**（两者必须继续同式同参数）。
4. **不重落任何基线**（`__snapshots__/full.png` / `dist-baseline.txt` 都不动）—— 本包要求稳态逐位不变。
5. 不回退 AM-030 / AM-031（§1.3 的三层闸是叠加关系）。
6. 不碰 §4 禁区表里的任何文件。
7. 不新增 `P` 字段、不改契约 `§9`。
8. 不为"过渡段 ≤ 1 ULP 差异"做补偿（那是 half 量化的自然结果，不值得加复杂度）。

---

## 8. 收尾四步（`03-COLLAB-PROTOCOL §7`）

1. 本文件追加 `## 11 · 完工记录`（📌 取 **11**：`§10` 已被上方「代价与风险」占用，**不重排已有编号**）—— 内容 = 改前/改后读数 + 原始输出 + A/B sha256。
2. `_STATUS.md §1` 追一行（≤60 字结论）。
3. 跨包影响 → 先开 AM（本包预计**无**：不新增 `P` 字段、不改读数预期；但 **`probe().envTex` 语义由二态扩为三态** —— 已由主控在 `01-CONTRACT.md §2.6` 预先写清，不另开单）。
4. `04-BOARD` 自己箱里的 ⬜ 清零。

**提交**：模式 A 独占；信息带 `AM-032`；`git add` **逐条列名**（禁 `-A`）。

**⚠ dist 不重建**（不在白名单）⇒ 完工记录里必须写明"`assert:dist` 跑的是旧构建，dist 入口生效待主控重建"。

---

## 9. 代码锚点速查

| 位置 | 作用 |
|---|---|
| `30-scene.js:237-305` `buildEnvEquirect(s, W, H, opt)` | 烘图；`opt.g = 1` ⇒ `ampDisc = 0`、`ampBand = amp × bd.amp`（满档环） |
| `30-scene.js:251-254` | `ampDisc` / `ampBand` / `elRing` / `sigRing` 四行（**本包一个字不动**） |
| `30-scene.js:188-190` `envGate()` | 生产端门控（本包后仅用于 `env.gate` 只读读数） |
| `30-scene.js:513-531` | **L1/L2 改这里**：`eq` / `eqBand` 两张 + 双缓冲 + 字段暴露 |
| `30-scene.js:337` | `env:` 初始化（字段名不变，语义按 L3 更新注释） |
| `60-water.js:295` | **L4**：FRAG uniform 声明处 |
| `60-water.js:437` `vec3 envCol = ...` | **L5 核心**：单张采样 → `mix` 两张 |
| `60-water.js:612-616` | **L6**：`uniforms.*` 初始化处 |
| `60-water.js:709-710` | 月亮柱 `uSunRadiance × (1 − bandGate())` —— **本包要模仿的手法**（本包后两条路径同频） |
| `60-water.js:217` `curEnvTex` · `:729-743` | **L7**：env 供给段（三槽 + `envMix`） |
| `60-water.js:812-814` | **L8**：`probe().envTex` / 新增 `envMix` |
| `plan/pw/tests/60-envgate.spec.mjs:75-167` | R4（**L9 必须同步**两根"同一对象"断言） |
| `plan/pw/lib/const.mjs:41-42` | `PIN_HOUR = 12.5`（`g = 1`）· `PIN_UTIME = 7.0` —— 判据 5/6/7 的定格口径 |

---

## 10. 代价与风险（先摊开，免得事后当回归读）

| 项 | 量 | 性质 |
|---|---|---|
| 每像素多 1 次 `texture2D`（带 mip） | 水面占屏大部分 ⇒ 水面着色成本 **+5~10%** 量级 | 可接受；不加分支（GLSL 分支未必省） |
| 夜段烘图由 1 张 → 2 张 | 8192 像素 × 2 循环 + 2 次上传；**只在"停稳才烘"那一刻发生** | 可忽略 |
| 常驻贴图 +1 张 | 128×64 HalfFloat ≈ **64 KB** | 可忽略 |
| 过渡段（`0 < g < 1`）像素 | half 量化位置不同 ⇒ **≤ 1 ULP 级**差异 | 不在任何基线定格上，**不视为回归** |
| 稳态像素（`g ∈ {0,1}`） | **逐位不变** | 由判据 5/6 钉死 |
