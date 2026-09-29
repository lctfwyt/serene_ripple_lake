# 104 · UP13-fix2 —— 光带夜间结构性归零（消费层硬门控）

> 包名 `UP13-fix2` · 变更单 **AM-031** · 波次 **13** · 独占工作区 · 主控开包 2026-09-29 22:2x
> 所有者：UP13（`src/60-water.js` / `src/30-scene.js`）
> **状态**：✅ **已完工（2026-09-29 22:5x）** —— 判据 1/2/3/7 全过 · 两入口 15/15 · pw 16 passed · 夜段 A/B 截图 sha256 逐位相同。
> 完工记录见 **§10**；开工口径见 §0~§9（原文保留）。**待雨桐目检验收**（§8 末）。

---

## 0. 需求原文与症状

雨桐（2026-09-29 22:1x）：

> 「能不能把横向光带参数调成在夜晚彻底没有，就像夜晚月光在白天彻底消失。永绝后患。你上次修复如果很复杂也能省去」

拆三条：

- **R1（主）** 夜段横向光带**一点都不能有** —— 不是"变淡"，是**结构性不存在**。
- **R2（参照）** 要像月亮柱 —— 月亮柱的消失是**每帧算**的（`uSunRadiance × (1−g)`，`60-water.js:702`），时间一到立刻生效，**不依赖任何缓存刷新**。
- **R3（授权）** 若 AM-030 那次修复很复杂，可以省去。

**症状**：白天把刻度尺拖到夜，光带**留着不走**（AM-030 已修；冷启动进夜段本来就是对的）。

---

## 1. 现状机制与根因

光带**不是每帧算的**，是**烘进 env 贴图**的：

| 环节 | 位置 | 行为 |
|---|---|---|
| ① 烘图（生产） | `30-scene.js:264-267` `buildEnvEquirect` | 按**仰角**加一条高斯光环，幅度 `ampBand = amp × envBand.amp × g` |
| ② **选图**（生产） | `30-scene.js:512-513` | `eqWater = (g > 0) ? 带光带版 : eq`（`eq` = 无光带版）；`g = 0` 时**两张同一个对象** |
| ③ 供给 | `30-scene.js:523` | `env.equirect = eqWater` |
| ④ 消费 | `60-water.js:724` | `u.uEnvEq.value = ev.equirect` —— 每帧重指，**但指哪张由生产者定死** |

🔴 **根因（本包要补的那一层）**：「**用哪张贴图**」这个选择**只在烘图那一刻做一次**（②）。一旦贴图 stale，水面就一直采着**带光带**那张 —— 而**消费端没有任何门控**去否决它（④）。

AM-030 修的是**生产端**（让"该重烘时重烘"），**不是消费端**。⇒ 只要生产端还有一条路径漏掉，症状就复发。雨桐要的是**消费端也掐一次**。

### 1.1 为什么不回退 AM-030（回应 R3）

AM-030 冻的是**整张 env**，不止光带：

| 冻结的东西 | 后果 |
|---|---|
| 水面天空反射（`uEnvEq`） | 天光反射错档 |
| 石头/湖底漫反射 IBL（`scene.environment` ← PMREM） | 石头亮度错档 |
| 只读读数 `env.gate` / `env.spread` | **假读数**（出图脚本 / 断言会读到错的） |

且默认跟**真实时钟**时 `envDist` 约 1.7 min 触发一次 ⇒ **挂机 ~70 min 必现**（不是"拖动才有"的边角）。

**⇒ 保留 AM-030；本包是叠加的保险，不是替代。**

---

## 2. 定稿方案：消费层硬门控

`60-water.js` 每帧供给 `uEnvEq` 时，按**当帧**的 `bandGate()` 选图：

```
g > 0  →  ev.equirect       （带光带版，白天照旧）
g = 0  →  ev.equirectBase   （无光带版 ⇒ 光带**结构性为 0**）
```

配套：`30-scene.js` 把**本来就存在**的无光带那张（`eq`）暴露为 `env.equirectBase`（不新建任何贴图）。

**为什么这样就"永绝后患"**：夜段水面**不可能**采到带光带的贴图 —— 无论 env 是否 stale、无论生产端有没有重烘。**与月亮柱 `×(1−g)` 是同一手法**（每个消费者自己掐一次）。

**稳态零影响**：夜段本来就是 `equirect === equirectBase`（同一对象，`:513`）⇒ 选的还是那一张，**像素逐位不变**；白天选的还是 `equirect` ⇒ **白天也逐位不变**。

### 2.1 备选（已否决）：把光带改成 shader 内每帧解析计算

即去掉烘焙，在片元里直接算 `exp(-0.5·((asin(Renv.y)−elev)/σ)²) × amp × g`。

**否决理由**：烘出来的那张是 128×64 + mip 链，按粗糙度**自动模糊**；改屏幕分辨率解析 = **边缘变锐**，直接推翻 UP13 五轮调出的白天观感，`#13` / `R−B` 读数也会漂。

> **本包只准动"选哪张"，不准动"长什么样"。**

---

## 3. 施工清单

| # | 文件 | 位置 | 动作 |
|---|---|---|---|
| **L1** | `30-scene.js` | `buildEnv()` `:523` 前后 | 新增 `this.env.equirectBase = eq;`（`eq` = 无光带那张，**已存在**，不新建贴图） |
| **L2** | `30-scene.js` | `:332` `env:` 初始化 | 字段加 `equirectBase: null` |
| **L3** | `30-scene.js` | 顶部 `:18-22` 字段说明 | 追加 `equirectBase` 一行（**无光带**版；AM-031 起夜段水面改采它） |
| **L4** | `60-water.js` | `update()` env 供给段 `:720-725` | **核心**：`if (envOn)` 内改 `var gSel = bandGate(); u.uEnvEq.value = (gSel > 0) ? ev.equirect : (ev.equirectBase \|\| ev.equirect);` |
| **L5** | `60-water.js` | `probe()` `:780-793` | 追加只读读数 `envTex`：`'base'` / `'band'` / `'none'` —— **判据的读数入口** |
| **L6** | `60-water.js` | `:420-432` AM-029 L7 注释段 | 补一句"消费层硬门控见 L4（AM-031）"（**不动任何 GLSL**） |
| **L7** | `plan/pw/tests/60-envgate.spec.mjs` | 追加 `test(...)` | 新增 R4（见 §5）；顺手改文件头注释里的过期文件名（`60-env-refresh` → `60-envgate`） |

**不改一个 shader 字符**（L6 只加注释）。全部改动 ≈ 10 行。

---

## 4. 白名单 / 禁区

**你的文件（一票否决级所有权）**

- `src/60-water.js`
- `src/30-scene.js`
- `plan/pw/tests/60-envgate.spec.mjs`
- `plan/104-UP13-fix2-band-night-zero.md`（本文件）
- `plan/_STATUS.md`（**只追加**）

**禁区（一个字都不许动）**

| 文件 / 项 | 原因 |
|---|---|
| `src/00-config.js` | **本包不加任何 `P` 字段**（`envBand` 四数不动 —— 观感挂雨桐） |
| `src/20-time.js` | `gGain` 13 键一字不动（护 `#7` / `#11`） |
| `plan/wp5-assert.js` · `wp5-env.js` | **冻结件**（`frozen-hashes.json`） |
| `src/90-debug.js` | 属 WP1（已裁"随下个碰它的包一并修"） |
| `01-CONTRACT.md` | 主控文件；§2.3 的 `env` 字段表**由主控补** |
| 门控两端 `0.52 / 0.70` | 实现常量，**不入 `P`**、不许改 |

---

## 5. 判据

**A. 结构性（本包核心）**

| # | 判据 | 口径 |
|---|---|---|
| 1 | 冷启动夜段 `probe().envTex === 'base'` | `__seek(22.5)` 后读 |
| 2 | **stale 免疫**：正午（`envTex='band'`）→ **停掉重建**（`SW.scene.buildEnv = () => true` 存根）→ `__seek(22.5)` ⇒ `envTex` **必须变 `'base'`**，且 `env.rebuilds` **未增** | 证明"**不依赖重烘**" |
| 3 | 昼段防过度修复：正午 `envTex === 'band'`（不许一刀切回 base） | — |

**B. 不许动的既有读数**

| # | 判据 | 期望 |
|---|---|---|
| 4 | `30-pixel ③ 整幅视口` | 用**现行基线不重落**仍绿 ⇒ 稳态画面逐位不变 |
| 5 | 15 条断言 | `#6 ≈19.54` · `#7 0.55 / 0.0` · `#11 0.55 (≥0.5)` · `#13 2.591` · `#14 0.809` · `#15 0.4548` · console 0 · jsErrors 0 |
| 6 | 夜段 `uSunRadiance` | 逐位不变（L6 镜面门控未动） |
| 7 | 降级 | `envEnabled=false` ⇒ `envReady=0`、走二色渐变不黑；`equirectBase` 缺失 ⇒ 回退 `equirect`（不炸） |
| 8 | 两入口 | `npm run assert` / `assert:dist` 各 **15/15**；`npm run pw` **全绿** |

> **判据 2 是本包的灵魂**：它模拟"生产端彻底不工作"，仍要求光带归零。做不到就是没修到根上。

---

## 6. 前置 / 并行

- **前置**：无。AM-030 已应用；`npm run pw` / `pw:dist` **全线无红**（HEAD `399bd40`）。
- **并行**：无（本波次独占工作区）。

---

## 7. 不做清单

1. 不改 `P.envBand` 四数（`amp / elev / sigma / detail`）。
2. 不把光带改成 shader 解析计算（§2.1）。
3. 不动门控两端 `0.52 / 0.70`、不动 `gGain`。
4. **不重落任何基线**（`__snapshots__/full.png` / `dist-baseline.txt` 都不动）—— 本包要求稳态逐位不变。
5. 不回退 AM-030。
6. 不碰 §4 禁区表里的任何文件。
7. 不新增 `P` 字段、不改契约 `§9`。

---

## 8. 收尾四步（`03-COLLAB-PROTOCOL §7`）

1. 本文件追加 `## 9 · 完工记录`（改前/改后读数 + 原始输出）。
2. `_STATUS.md §1` 追一行（≤60 字结论）。
3. 跨包影响 → 先开 AM（本包预计**无**：不新增字段、不改读数）。
4. `04-BOARD` 自己箱里的 ⬜ 清零。

**提交**：模式 A 独占；信息带 `AM-031`；`git add` **逐条列名**（禁 `-A`）。

**验收（挂雨桐，不得自行判定通过 —— `§7.2-3`）**

- 夜段**目检**：`index.html?hour=22.5` 与"正午拖到夜"两条路径，横向光带**一点都没有**。
- `envBand` 四数观感（与 `102 §9.5` 同挂账）。

---

## 9. 代码锚点速查

| 位置 | 作用 |
|---|---|
| `30-scene.js:234-302` `buildEnvEquirect()` | 烘图（光带在这儿加） |
| `30-scene.js:508-513` | `eq`（无光带）/ `eqWater`（带光带）/ 二选一 |
| `30-scene.js:522-529` | 提交 `scene.environment` / `env.equirect` / `env.gate` |
| `30-scene.js:188-190` `envGate()` | **生产端**门控（同式同参数） |
| `60-water.js:240` `bandGate()` | **消费端**门控（**本包用它选图**） |
| `60-water.js:702-703` | 月亮柱 `uSunRadiance × (1−g)` —— **本包要模仿的手法** |
| `60-water.js:720-725` | env 供给（**L4 改这里**） |
| `60-water.js:757-796` `probe()` | 只读读数（**L5 加 `envTex`**） |
| `plan/pw/tests/60-envgate.spec.mjs` | R1~R3 已存在；本包追加 R4 |

> ⚠ 上表 `60-water.js` 的行号是**改前**的；本包后整体下移（见 §10.1 的订正行号）。

---

## 10 · 完工记录

> 施工方：UP13-fix2 · **2026-09-29 22:5x** · 变更单 **AM-031** · 独占工作区 · 前置 AM-030 已应用（HEAD `a6715b7`）
> ⚠ **本包无独立复核方，复核为同上下文自证** —— 数值判据可自证，"好不好看"不行（`03-COLLAB-PROTOCOL §7.2`）。
> 注：本节编号取 **10**（§8 收尾清单里写的"§9"已被上方「代码锚点速查」占用，不重排已有编号）。

### 10.1 施工清单落地（L1~L7）

| # | 文件 | 动作 | 落地 |
|---|---|---|---|
| L1 | `src/30-scene.js` `buildEnv()` `:531` | 新增 `this.env.equirectBase = eq;`（无光带那张，**不新建贴图**） | ✅ |
| L2 | `src/30-scene.js` `env:` 初始化 `:337` | 加 `equirectBase: null` | ✅ |
| L3 | `src/30-scene.js` 顶部字段说明 `:19-25` | 追加 `equirectBase` 行（AM-031 起夜段水面改采它） | ✅ |
| L4 | `src/60-water.js` `update()` `:740-743` | **核心**：`var gSel = bandGate();` → `uEnvEq = (gSel > 0) ? ev.equirect : (ev.equirectBase \|\| ev.equirect)` | ✅ |
| L5 | `src/60-water.js` `probe()` `:814` | 追加只读读数 `envTex`（`'base'` / `'band'` / `'none'`，模块态 `:217`） | ✅ |
| L6 | `src/60-water.js` FRAG 的 AM-029 L7 注释段 `:423-425` | 补「消费层硬门控见 L4」一句 —— **GLSL 一字未动** | ✅ |
| L7 | `plan/pw/tests/60-envgate.spec.mjs` | 追加 R4（判据 1/2/3/7）；顺手改文件头过期文件名（`60-env-refresh` → `60-envgate`） | ✅ |

改动量（**只算两个 src 文件**）：`git diff --stat -- src/` = **2 files changed, 33 insertions(+), 4 deletions(-)**
（`30-scene` +14−3 · `60-water` +23−1，均含注释）。含文档的整包 diffstat 见 §10.7 的 `git show --stat`。
`FRAG` / `VERT` 两个 GLSL 数组**没有一个字符变化**（`git diff` 可核）—— 只加了两处 JS 注释。

### 10.2 判据 A（结构性 —— 本包核心）

| # | 判据 | 实测 |
|---|---|---|
| 1 | 冷启动夜段 `probe().envTex === 'base'` | ✅ `'base'`；且 `env.equirect === env.equirectBase`（**同一对象** ⇒ 选图是空动作 ⇒ "逐位不变"的结构前提） |
| 2 | **stale 免疫**：正午 `'band'` → 停掉重建（`SW.scene.buildEnv` 换存根）→ `__seek(22.5)` ⇒ 必须变 `'base'` 且 `rebuilds` 未增 | ✅ `'base'`；`rebuilds 2 → 2` 未增；`env.gate` 停在正午的 **1**（⇒ 桩确实生效，不是"其实偷偷重烘了"） |
| 3 | 昼段防过度修复：正午 `envTex === 'band'` | ✅ `'band'`；且两张为**不同对象**（选图有实义，判据 2 才有对照） |
| 7 | 降级：`envEnabled=false` ⇒ `envReady=0` 不黑；`equirectBase` 缺失 ⇒ 回退 `equirect` 不炸 | ✅ `off: false/'none'` → 回开 `true` → `noBase: true/'base'`；**全程 JS 错误 0** |

`npm run pw` 里 R4 的原始输出：

```
ℹ R4 · 夜(冷启动)=base · 正午=band(gate 1) · 桩后夜=base(gate 1 · rebuilds 2→2) · 降级 off:false/none backOn:true noBase:true/base
ok 13 [main] › plan\pw\tests\60-envgate.spec.mjs:75:1 › UP13-fix2 · 光带夜段结构性归零（消费层门控 · stale 免疫） (13.9s)
```

### 10.3 判据 B（不许动的既有读数）

| # | 判据 | 实测 |
|---|---|---|
| 4 | `30-pixel ③ 整幅视口` 用**现行基线不重落**仍绿 | ✅ ok（`__snapshots__/full.png` 未被改写 —— `git status` 无该文件） |
| 5 | 15 条断言 | ✅ 免构建 **15/15** · dist **15/15** · console 0 · JS 错误 0。逐字与改前一致：`#6 19.53` · `#7 0.55 / 0.0000` · `#11 0.55 (≥0.5)` · `#9/#10/#12` · `#14 0.809` · `#15 0.4548` |
| 6 | 夜段 `uSunRadiance` 逐位不变（L6 镜面门控未动） | ✅ A/B 两侧同为 `[0.4497285968277148, 0.48183927500955903, 0.5179061582113365]` |
| 8 | 两入口 + pw | ✅ `npm run assert` **15/15** · `npm run assert:dist` **15/15** · `npm run pw` **16 passed**（含新 R4；20-determinism C：4 次采样指纹数 = 1） |

§8.3 规范说法：**哨兵与确定性未退化；门内无超阈像素。**

### 10.4 机械证据：夜段**逐位不变**（A/B sha256）

口径：钉住 `hour=22.5` + `uTime=7.0` + `dt=0`（同 `pinSnippet` 的三条链）→ 整幅截图 sha256。
`BEFORE` = `git stash push src/30-scene.js src/60-water.js`（回到 HEAD `a6715b7`），`AFTER` = 本包工作区。

| 侧 | sha256 | bytes | `envTex` |
|---|---|---|---|
| **AFTER**（AM-031） | `5d2e8edaa57bc1ebf1e560c8b48f1b317625ecf8cb083558dc08a08f5384d631` | 545831 | `base` |
| **BEFORE**（HEAD） | `5d2e8edaa57bc1ebf1e560c8b48f1b317625ecf8cb083558dc08a08f5384d631` | 545831 | （字段不存在） |

⇒ **逐位相同**。机理也直白：夜段 `g = 0` ⇒ `eqWater === eq` ⇒ `equirectBase` 与 `equirect` 是**同一个对象** ⇒ 选图是空动作。
（stash 已 pop，工作区无残留；临时脚本 `_ab-night.cjs` 已删。）

> **`#13` 的一处读数差异先说清（免得被读成回归）**：本轮免构建 `#13 = 2.654`、dist `#13 = 2.645`，
> 而 §5 判据 5 上记的期望是 **2.591**。归因**不是**本包：
> ① **dist 侧不含本包改动**，读数照样 ≈2.645（两次"同一份代码"先后差 0.009）；
> ② `colProfileStable()` 以**当帧 `uTime`** 为相位原点（`uTime = t0 + i·0.37`），而 `t0` 随"页面已跑时长"漂移
>   ⇒ 该读数**本来就不可精确复现**（台账已记「`#13` 运行间方差 ~3%」）。
> 本包的"稳态不变"由 §10.4 的 sha256 **与** `30-pixel ③` 用旧基线仍绿 **两路独立证据**钉死，不依赖 `#13`。

### 10.5 与 AM-030 的关系（回应需求 R3「很复杂也能省去」）

**没有回退 AM-030**（§2 已论证）。AM-030 冻的是**整张 env** —— 水面天光反射、石头/湖底 PMREM IBL、
只读读数 `env.gate`/`spread`；日常跟真实时钟时 `envDist` 约 1.7 min 触发一次 ⇒ **挂机 ~70 min 必现**（非边角）。
本包是**叠加的第二道闸**：生产端（AM-030）保证"该烘时烘"，消费端（AM-031）保证"夜段无论烘没烘都不采光带"。
与月亮柱 `uSunRadiance × (1−g)` 同一手法 —— 每个消费者自己掐一次，时间一到立刻生效、**不依赖缓存刷新**（= R2 要的）。

### 10.6 契约 / 跨包影响

- `SW.scene.env` 新增只读字段 **`equirectBase`** —— 契约 `§2.3` 的 env 字段表**由主控补**（§4 已定）。
- `SW.water.probe()` 新增只读键 **`envTex`** —— 契约 `§2.6` 的 probe 列表同步归**主控**（本包未越权改契约）。
- **无新增 `P` 字段** · **无阈值变更** · **无读数预期变更** ⇒ **不开新变更单**（收尾第 3 步为空）。
- `dist/` **未重建**（不在白名单）：`assert:dist` 跑的是 AM-030 版构建，15/15 只说明"本包没破坏构建链"；
  AM-031 在 dist 入口的生效要等**主控重落 `dist/` + `dist-baseline.txt`**。
- 02-AMENDMENTS 状态行：本包已按生命周期把 `AM-031` 行翻 ✅（`§2`）+ 更新 `§1` 的「全库最新已应用」指针。

### 10.7 提交凭证

模式 **A 独占**（本波次无并行包）· 信息带 `AM-031` · `git add` **逐条列名**（未用 `-A`）· 未 `--amend` / 未动 tag / 未动基线。

```
commit 904dad0a689d6fc6bf7851910d57cbdeb4a86791
Author: lctfwyt <lctfwyt@outlook.com>
Date:   Tue Sep 29 22:41:38 2026 +0800

    fix(up13): 光带夜段结构性归零 —— 水面按 bandGate() 选无光带贴图（AM-031）

 plan/02-AMENDMENTS.md                 |   7 ++-
 plan/04-BOARD.md                      |   9 ++-
 plan/104-UP13-fix2-band-night-zero.md |  97 +++++++++++++++++++++++++++++-
 plan/_STATUS.md                       |   5 +-
 plan/pw/tests/60-envgate.spec.mjs     | 108 +++++++++++++++++++++++++++++++++-
 src/30-scene.js                       |  14 ++++-
 src/60-water.js                       |  23 +++++++-
 7 files changed, 249 insertions(+), 14 deletions(-)
```

**白名单越界核查**（逐条对照 §4）：`src/00-config.js` / `src/20-time.js` / `src/40-lakebed.js` / `src/90-debug.js` /
`01-CONTRACT.md` / `plan/wp5-assert.js` / `plan/wp5-env.js` / `plan/pw/__snapshots__/**` / `plan/pw/dist-baseline.txt` /
`dist/**` —— **全部 0 改动**（`git status` 与 `git show --stat` 双证）。
白名单外的两个文件 `plan/02-AMENDMENTS.md`（AM-031 翻 ✅，收尾生命周期）与 `plan/04-BOARD.md`（§5 板：清自己箱 + 给主控留行）
是 `03-COLLAB-PROTOCOL §5/§7` 要求的写作面，**未改任何他人规格**。


