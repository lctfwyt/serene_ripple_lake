# 90a · UP8 完工报告 —— 水面 shader 收敛

> 口径唯一来源：`plan/90-WAVE4.md` §0 / §1 / §2 / §6（`60-UPGRADE-ROADMAP.md §UP8` 只作背景，**它漏了 #7**）
> 完工：**2026-09-24 18:10** · 提交：`refactor(UP8): 水面 shader 收敛 —— probe 分支改编译期 + glitterSpec 去重`
> 改动文件：**`src/60-water.js` 一个**（净 **−18 行**：+41 / −59，524 → 506）

---

## 0. 一句话

两处真债都收掉了，**画面零变化**：交付着色器里 `uProbe` 字样 **0 次**，`glitterSpec` 的 55 行 JS 重算删除后
`#7` 用**直读 uniform** 继续成立。验收 **6/6**，其中「不改行为」的核心读数 ——
`#13` 24 相位中位 **2.138**（doc 基线 2.144 ± 0.02 ✓）· 亮带质心 **635.1**（634.3 ± 8 ✓）·
`calls 6` / `tris 53088` 未变；坑 2 的非 debug 一致性 **16 项 |Δ| 全 0.0000**（阈值 ≤ 0.02）。

---

## 1. 动手前的三条复述

### ① 文件边界（一票否决级）

| | |
|---|---|
| **拥有** | `src/60-water.js` · `plan/_STATUS.md`（只追加自己的行）· 本报告文件 |
| **不许碰** | `index.html` · `app/**` · `src/**` 其余 11 个模块（含 `90-debug.js`，归 WP1）· `vendor/**` · `assets/**` · `plan/wp5-assert.js` / `plan/wp5-env.js`（**归 UP6，本波次冻结**）· `plan/90-WAVE4.md`（只读口径）· `dist/**` |

实测**遵守**：`git status --short` 全程只有 `M src/60-water.js`；`git diff --stat -- plan/` **输出为空**。
冻结脚本哈希（自行记录，供主控核对）：

```
8ac52579f41a342a16056810385fb677b17c95f574a9d9aabe93291591345904  plan/wp5-assert.js
bd9dd0e8fc115cce0a3ffe243a9f58ac9ec6218a6d31445c2d519ce61869ad2a  plan/wp5-env.js
```

### ② 删 `glitterSpec()` 会打挂 #7 → 选 **A**

依赖链（实读源码，非推测）：

```
wp5-assert.js:388   check(7, '反光柱:夜强于午(probe)', states[22.5].glitterSpec > 0.5 && states[12.5].glitterSpec < 0.2)
   ↑ states[h].glitterSpec
   ↑ 90-debug.js:249   SW.water.probe().glitterSpec
   ↑ 60-water.js       glitterSpec()          ← 要删的就是它
```

**直接删 → `#7` 立刻失败**，而 `#7` 是「反光柱夜强于午」唯一的 **probe** 判据（`#13` 只给像素口径）。

**选 A（保留字段名 + 改直读 uniform）**，三条理由：

1. `90-WAVE4 §2` 为 A 已核算过最大收益 —— **`90-debug.js` 与 `wp5-assert.js` 一行都不用动**；
2. B 要**作废一条断言**，而 §6.3 / §2 明写「删断言要主控批，且必须同步 `50-WP5-polish-verify.md` 与 `_STATUS.md`」→ **超出本包权限**；
3. 覆盖面**没有缺口**：柱的几何可行性由 `#9 / #10 / #12`（仰角 · 方位）覆盖，柱的可读性由 `#13`（直读像素）覆盖。

**实现**：`glitterSpec = clamp(u.uGlitterGain.value, 0, 1)`（直读、不重算）。
契约 §5 给该字段声明的是量程 `0~1`，而 `TimeState.glitterGain` 可 `>1`（夜 1.20）→ **做钳制，而不是去改 #7 的阈值**。

实测后果（本机 6 时段）：

| hour | 2 | 5.5 | 8 | 12.5 | 18.5 | 22.5 |
|---|---|---|---|---|---|---|
| `glitterGain` | 1.15 | 0.30 | 0.236 | **0.15** | 0.35 | **1.20** |
| `glitterSpec`（改后） | 1.000 | 0.300 | 0.236 | **0.150** | 0.350 | **1.000** |
| `glitterSpec`（改前） | 1.000 | 1.000 | 0.176 | 0.001 | 1.000 | 1.000 |

`#7` 两条子判据：`>0.5` 余量 **0.500**（改前 0.500）· `<0.2` 余量 **0.050**（改前 0.199）。
⚠ **判据余量在午端收窄到 0.05** —— 但它是 **TimeState 定值**（`h=12.5` 恰好落在 keyframe 上），
**没有相位噪声**，比改前那个从 64 步扫描里取 max 的值更稳。**若后续有人改 `20-time.js` 的 `glitterGain`，需同步复核 #7。**

### ③ probe 分支改编译期后，非 debug 形态由本包补验证

断言一律用 `?debug=1` 起页（注入 API 只在 debug 模式暴露）→ **真实交付形态没有任何断言覆盖**。
→ 见 §3，这是本包**自己新建**的一条验证，不是"顺带看看"。

---

## 2. 改了什么

### 2.1 债 #1 —— `uProbe` 的 8 个分支改编译期

| 位置 | 改法 |
|---|---|
| FRAG 的 uniform 声明（现 **168–170 行**） | `uniform float uProbe;` 用 `#ifdef WP_PROBE` 包住（1 行） |
| FRAG 的 ⑦ 探针段（现 **280–289 行**） | 8 个 `if (uProbe > x.5 && uProbe < y.5) {...}` 用 `#ifdef WP_PROBE` 包住（8 行） |
| `init()` 建材质处 | `var defines = {}; if (P.debug) { defines.WP_PROBE = ''; }` → `new THREE.ShaderMaterial({ …, defines: defines, … })` |

* `SW.P.debug` 由 `00-config.js:71` 在**脚本加载时**按 `?debug=1` 置好，早于 `60-water.js` 的 `init()`（`99-main.js:34`）→ 此处直读安全。
* 已核：`P.debug` 在 `src/` 里**只被 `90-debug.js` 消费**（`99-main.js` 的 `SW.debug.dtFor` 在非 debug 下原样返回 `dt`）→ 加这个分支不会引入第二种"debug 态行为"。
* `uniforms.uProbe` **保留在 uniforms 对象里**（契约 §2.6 公开 `uniforms`）—— three 的 `WebGLUniforms` 只遍历**活动** uniform，非 debug 下它不会进 `seq`，也不会被上传，**无警告**。

**交付形态的静态证明**（行级扫描 FRAG 区段 137–296，摘下全部 `#ifdef WP_PROBE` 段后）：

```
#ifdef WP_PROBE 段 = 2  →  168–170（uniform 声明 1 行） · 280–289（8 个分支）
摘除后剩余 FRAG 里 uProbe 出现处：
   166: // ★ UP8：uProbe 仅在 ?debug=1 时定义 WP_PROBE …            ← JS 注释
   167: //   three 的 WebGLUniforms 只遍历**活动** uniform …           ← JS 注释
   251: // ⚠ D/Vis/Fs 必须在 if 块**外**声明 —— uProbe=8 要在块外读  ← JS 注释
   269: // ⑦ 私有探针（uProbe）：把中间量直接写进颜色，供断言读回    ← JS 注释
```

→ **4 处全在 JS 注释里，不进 GLSL 字符串。交付着色器的 GLSL 中 `uProbe` 出现 0 次。**
同时确认环境量全在：`uGlitterGain` / `uSunDir` / `uGlitterColor` / `swDetail` / `wband` /
`tonemapping_fragment` / `colorspace_fragment` / `fog_fragment` **均为 true**。

### 2.2 债 #2 —— `glitterSpec()` 55 行 JS 重算 → 直读

```js
// 改前：64 步沿光源方位线扫描，逐点重算 GGX 的 D / Vis / Fs（55 行）
// 改后：
function glitterSpec() {
  if (!u) { return 0; }
  var g = u.uGlitterGain.value;
  if (typeof g !== 'number' || !isFinite(g)) { return 0; }
  return g < 0 ? 0 : (g > 1 ? 1 : g);
}
```

**删掉它的理由（写进文件头注释了）**：① shader 一改它就**静默漂移**（改 shader 的人不会记得同步这段 JS）；
② 它的返回值只被 probe 消费，而"柱能不能被看见"的硬判据已由 `#13` 直读像素承担。

### 2.3 边界遵守（可复算的机器核对）

| 项 | 方法 | 结果 |
|---|---|---|
| `SW.water` 方法签名 | `init:` / `update:` / `setRefract:` / `probe:` 集合 diff | **一致**（4 个） |
| `uniforms.*` 赋值集合 | 集合 diff | **一致**（31 个） |
| GLSL `uniform` 声明集合 | 集合 diff | **一致**（26 个） |
| `SW.P` 字段引用集合 | 集合 diff | 只多 **`SW.P.debug`**（读已有的 §6 字段，非新增字段） |
| `swDetail()` / `detailGLSL()` / `DETAIL` 波表区段 | 该区段 sha256 | **一致** `741b56f9…a59f` → **未碰**（归 UP4） |

---

## 3. 坑 2 的验证（非 debug 形态）

**命题**：非 debug 形态的画面 **=** debug 形态下 `uProbe=0` 的画面（差异 ≤ 0.02）。

**方法**（临时脚本 `_up8-nodebug.js`，**已按项目纪律删**；方法是本报告 §3 的文字 + `wp5-assert.js` 的 `HELPERS` 可直接重建）：

1. 同一台 Chrome、同一 GPU 上下文：先开 `index.html?debug=1`，量完再 `Page.navigate` 到 `index.html`（无 query）。
2. 同 hour（`SW.time.setMode('fixed')` + `setHour`，公开 API）+ **显式钉 `uTime` 相位**（契约 §2.6 公开字段）+ `uProbe=0`，
   在一个**同步块**里量完 —— rAF 无法在中间插入 → 逐帧确定性可比。
3. 量 `#6` 湖底 std（`regionStd(0.35,0.65,0.06,0.34)`）与 `#13` 列剖面（`colProfile(0.30,0.70)` 单相位 + 24 相位中位/质心）。
4. 硬证据：`renderer.info.programs` 里所有已编译 program 的**活动 uniform 名集合**。

**原始输出（截取）**：

```
阶段 A（?debug=1）SW.ready = true
  h=12.5 uTime=12.345  std=14.78  ratio(单)=1.044 cen=651.2  24相位中位=1.04  cenMed=697  range 1.035~1.046
       · programs=10 hasUProbe=true  defines=["WP_PROBE"]  · __probe=function #dbg=true
  h=22.5 uTime=7.771   std=42.78  ratio(单)=2.04  cen=639.1  24相位中位=2.115 cenMed=637.5 range 2.007~2.254
       · programs=10 hasUProbe=true  defines=["WP_PROBE"]  · __probe=function #dbg=true
  阶段 A 报错: {"console":0,"log":0,"exc":0}

阶段 B（无 query · 交付形态）SW.ready = true  location.search = ""
  h=12.5 uTime=12.345  std=14.78  ratio(单)=1.044 cen=651.2  24相位中位=1.04  cenMed=697  range 1.035~1.046
       · programs=10 hasUProbe=false defines=[]  · __probe=undefined #dbg=false
  h=22.5 uTime=7.771   std=42.78  ratio(单)=2.04  cen=639.1  24相位中位=2.115 cenMed=637.5 range 2.007~2.254
       · programs=10 hasUProbe=false defines=[]  · __probe=undefined #dbg=false
  阶段 B 报错: {"console":0,"log":0,"exc":0}
```

**A/B 逐项比对（阈值 ≤ 0.02，两小时各 8 项 = 16 项）**：

| 指标 | h=12.5 A / B | h=22.5 A / B |
|---|---|---|
| `std` | 14.78 / 14.78 · **Δ0.0000** | 42.78 / 42.78 · **Δ0.0000** |
| `mean` | 138.18 / 138.18 · **Δ0.0000** | 110.92 / 110.92 · **Δ0.0000** |
| `ratio`（单相位） | 1.044 / 1.044 · **Δ0.0000** | 2.04 / 2.04 · **Δ0.0000** |
| `peak` | 161.83 / 161.83 · **Δ0.0000** | 147.99 / 147.99 · **Δ0.0000** |
| `median` | 155.05 / 155.05 · **Δ0.0000** | 72.56 / 72.56 · **Δ0.0000** |
| `centroid`（单相位） | 651.2 / 651.2 · **Δ0.0000** | 639.1 / 639.1 · **Δ0.0000** |
| `ratioMed`（24 相位） | 1.04 / 1.04 · **Δ0.0000** | 2.115 / 2.115 · **Δ0.0000** |
| `cenMed`（24 相位） | 697 / 697 · **Δ0.0000** | 637.5 / 637.5 · **Δ0.0000** |

**最大差异 = 0.0000**（不是"小于阈值"，是**逐位相同**）→ **坑 2 通过**。

**编译期开关的硬证据**：

| | programs | 活动 uniform 表含 `uProbe` | `material.defines` |
|---|---|---|---|
| debug 页 | 10 | **true** | `["WP_PROBE"]` |
| 交付页 | 10 | **false** | `[]` |
| 对照（两页都应有） | — | `uGlitterGain` true/true · `uSunDir` true/true | — |

→ ① debug 下分支**确实在**（断言读数不变的机制）；② 交付下分支**确实不在**（驱动预处理器真的摘掉了）；
③ 两页 program 数相同、对照 uniform 都在 → 差异**只**来自 `WP_PROBE` 这一个宏。

**契约 §5 顺带核验**：debug 页 `__probe=function` / `#dbg=true`；**交付页 `__probe=undefined` / `#dbg=false`** ✅

---

## 4. 验收 6 条逐条

### ① 15 条断言仍全过 —— ✅ **15/15**

### ② 🔴 `#13` 与基线一致 + `calls` / `tris` 不变 —— ✅

| 项 | doc 基线（`90-WAVE4 §2`） | 本机**改前**实跑 | 本机**改后**实跑 | 判定 |
|---|---|---|---|---|
| `#13` 24 相位中位 | 2.144 ± 0.02 → [2.124, 2.164] | 2.127 | **2.138** | ✅ 带宽内（Δ=0.006） |
| `#13` 亮带质心 | 634.3 ± 8px → [626.3, 642.3] | 639.3 | **635.1** | ✅ 带宽内（Δ=0.8） |
| `#13` 相位范围 | — | 1.905 ~ 2.266 | 1.908 ~ 2.266 | ✅ |
| `calls` | 6 | 6 | **6** | ✅ |
| `tris` | 53088 | 53088 | **53088** | ✅ |

> 相位的**帧间抖动**（AM-008 §3 已记录：`#13` 本身随波纹相位在 ±0.02 量级波动）在本机也可见：
> 改前/改后两跑差 0.011 / 4.2px，**同量级于改前自身的重复性**。真正确定性的证据是 §3 —— 钉住 `uTime`
> 后 debug(uProbe=0) 与非 debug **逐位相同**（Δ0.0000）。

`#7` 阈值原样成立：`gSpec(22.5)=1.000 > 0.5` ✓ · `gSpec(12.5)=0.1500 < 0.2` ✓

### ③ 其余断言读数（回归保护）—— 全过

| # | 改前 | 改后 |
|---|---|---|
| 1 `anyNaN` | false | **false** |
| 3 折射差分 | hitFrac 18.9% · mean 4.69 · max 92 | **19.0%** · 4.68 · 91 |
| 5 `chromaStep` | 2.108 @sun | **2.108 @sun**（逐字段相同） |
| 6 湖底 std（60 帧中位） | 15.01（14.54~23.84） | **15.06**（14.67~23.42） |
| 9/10/11/12 | 仰角/方位/月光 | **逐字相同** |
| 14 LOD 接缝比 | 0.809 | **0.809** |
| 15 覆盖率 | 0.4377 / 0.4548 | **0.4377 / 0.4548** |
| 4 涟漪衰减 | active 1→0，3.75s | **1→0，3.75s** |
| 8 音频态 | running · bgmGain 0.6 | **相同** |

### ④ 坑 2 的非 debug 一致性 —— ✅ **16/16 项 Δ=0.0000**（见 §3）

### ⑤ console 0 报错 · `anyNaN false` —— ✅
断言脚本：`JS 错误 (0)` · `Log error (0)`。坑 2 两阶段：`{"console":0,"log":0,"exc":0}`。

### ⑥ 契约公开面签名不变 —— ✅

| 项 | 结果 |
|---|---|
| `SW.water` 方法名 | `init` / `update` / `setRefract` / `probe` —— 集合 **一致** |
| `uniforms.*` 赋值集合 | **31 个，一致**（含 `uProbe`，未改名未删） |
| GLSL uniform 声明集合 | **26 个，一致**（**名字 / 类型 / 含义全未动**） |
| `SW.P` §6 参数键 | **未新增**（只多一处**读** `SW.P.debug`） |
| 事件名 / DOM id | 未涉及 |
| `swDetail()`（16 波细节法线） | 区段 sha256 **一致** → **未碰**（归 UP4） |

---

## 5. 遗留 / 交还主控

1. **`#7` 的语义已变**（「预测的镜面峰值」→「直读的反光增益」）。字段名与 0~1 量程不变，所以
   `90-debug.js` / `wp5-assert.js` / `01-CONTRACT.md §5` **都不需要改** —— 但**语义记录在此**：
   若要把它写进契约 §5 的说明栏，属主控的编辑动作，本包未动契约。
2. **午端余量 0.05**（见 §1②）。当前是定值、无噪声；**若 `20-time.js` 的 `glitterGain` 后续被改，需复核 #7**。
3. **本包对 `#13` 的读数只到"带宽内"**。真正干净的「UP8 前后像素等价」证据是 §3 的钉相位对齐（Δ0.0000）——
   建议 **UP2 开包时沿用同一手法**（钉 `uTime` + `uProbe=0` 对齐）做 bloom 前后基线，比拿两次独立跑断言比更可靠。
4. **`_up8-nodebug.js` 已删**（项目纪律：`_*.js` 交付前删）。方法是标准 CDP 样板 + `wp5-assert.js` 的 `HELPERS`，
   重建成本约十几分钟；若主控希望它像 `wp5-assert.js` 那样**归档**，说一声即可（本包未擅自新建归档脚本）。
