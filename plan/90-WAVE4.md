# 波次 4 包文档 —— UP8 ∥ UP5 ∥ UP6（并行）· **UP2 受限延后**

> 状态：**待开工** · 前置：基线 `baseline-pre-tier12` ✅ · **UP1a ✅**（`80-UP1-build-chain.md`）
> 本文件是这四个包的**唯一开工口径**。`60-UPGRADE-ROADMAP.md` 的对应节只作背景；
> 凡冲突以本文件为准（**§2 已纠正 roadmap 一处漏项**）。
> 当前提交点：`6b27318`（工作区干净，`main` 3 个提交 + tag 1 个）

---

## 0. 并行校验结果（主控直裁 2026-09-24 13:20）

雨桐勾了 **UP8 + UP5 + UP6 + UP2** 四个包。我按「文件所有权 + 断言耦合」两层校验：

| 包 | 主改文件 | 文件层 | 断言层 |
|---|---|---|---|
| **UP8** | `src/60-water.js` | 零交集 ✅ | 🔴 影响 **#13 / #3 / #6** |
| **UP5** | `src/10-audio.js` · `src/70-input.js` · `assets/audio/**` | 零交集 ✅ | 只新增音频判据 ✅ |
| **UP6** | `plan/wp5-assert.js` · `package.json` · `plan/pw/**`（新） | ⚠ 见下 ① | 无 ✅ |
| **UP2** | `src/30-scene.js` · `src/65-post.js`（新）· `index.html` · `app/index.html` · `app/main.js` | 零交集 ✅ | 🔴 影响 **#13 / #6 / #8** |

**文件零交集 ≠ 可并行** —— 查出两处真实耦合：

### 🔴 耦合 ①：UP6 与 UP8/UP5 争同一个断言脚本

`plan/wp5-assert.js` 是 UP8 / UP5 唯一的验证手段，而 UP6 的活正是改造它。
若 UP6 一边重写驱动、UP8 一边拿它跑回归 → 结果不可信，且谁背锅说不清。

**裁决**：**UP6 不得改动 `plan/wp5-assert.js` 与 `plan/wp5-env.js`**。
你要做 Playwright 版 ⇒ **新建 `plan/pw/` 目录**（可整份复制现有脚本再改造）。
两套并存到本波次结束，**由主控裁谁留**。你若认为必须原地改，先停下来问，别自己动手。

### 🔴 耦合 ②：UP8 与 UP2 都要动 #13

两者都改变水面像素 → 谁跑断言谁就会被对方的改动污染，
「UP8 不改行为」和「UP2 抬高了 #13」两个结论**都会失去干净的前后基线**。

**裁决**：**UP2 排在 UP8 提交之后再开**。UP8 是收敛类小活（roadmap 估计半小时级），
延迟成本远低于两套读数互相污染的代价。

**→ 本轮实际可同时开工的是三个：UP8 ∥ UP5 ∥ UP6。UP2 开场白另发。**

---

## 1. 文件所有权总表（**一个文件一个所有者，不拥有就不许改**）

| 文件 | 所有者 | 备注 |
|---|---|---|
| `src/60-water.js` | **UP8** | 唯一源码改动 |
| `src/10-audio.js` · `src/70-input.js` · `assets/audio/**` | **UP5** | |
| `plan/wp5-assert.js` · `plan/wp5-env.js` · `package.json` | **UP6** | ⚠ 前两个**本波次禁改**（耦合 ①） |
| `plan/pw/**`（新建） | **UP6** | Playwright 版本落这里 |
| `plan/90-WAVE4.md`（本文件） | **主控** | 只读 |
| `plan/_STATUS.md` | **三者都可** | **只许追加自己的行，历史行不得改写** |
| `plan/9x-UP*.md` | 各自 | 你的完工报告，新建 |
| `index.html` · `app/**` · `vendor/**` · `assets/**`（音频除外）· `src/` 其余 11 个模块 | **本波次无人拥有** | 要碰先问主控 |
| `plan/shots-wp5/**` | **冻结** | 升级前证据 |

**三名并发者的交集只有一个**：`plan/_STATUS.md`。**只追加，不改别人的行。**

---

## 2. UP8 · 水面 shader 收敛

**目标**：收掉 `src/60-water.js` 的两处真债 —— **不改画面行为、不动契约签名**。

| # | 债 | 位置 |
|---|---|---|
| 1 | `uProbe` 的 **8 个 debug 分支编在交付 shader 里** | `60-water.js:266-273` |
| 2 | `glitterSpec()` 用 **55 行 JS 把 GLSL 的 D/Vis/Fs 又实现了一遍**，只服务 probe 预测 | `60-water.js:291-351` |

### 🔴 坑 1 —— roadmap **漏了 #7**，照它施工会立刻挂

`60-UPGRADE-ROADMAP.md` §UP8 只写了「断言 **#13** 已直接读像素 → `glitterSpec` 很可能完全冗余」。
**但它漏了 #7。** 实测依赖链：

```
wp5-assert.js:388   check(7, '反光柱:夜强于午(probe)',
                          states[22.5].glitterSpec > 0.5 && states[12.5].glitterSpec < 0.2, …)
      ↑ states[h].glitterSpec  ←  __probe()
      ↑ 90-debug.js:249        ←  SW.water.probe().glitterSpec
      ↑ 60-water.js:513        ←  glitterSpec()      ← 你要删的就是它
```

**直接删 `glitterSpec()`，`#7` 会立刻失败。** 处置二选一，**你裁并在报告里写明理由**：

- **A（我倾向）**：`probe()` 的 `glitterSpec` 字段**保留不改名**，但值改为**直读已有 uniform**（不重算）。
  这样 `90-debug.js` 与 `wp5-assert.js` **一行都不用动**，`#7` 的阈值 `>0.5 / <0.2` 原样成立，
  语义从「预测的镜面峰值」变为「直读的反光增益」—— 反光柱**可读性**的硬判据本来就已交给 `#13`（实测像素）。
  ⚠ 注意 `glitterSpec` 现值钳在 `0~1`，而 `P.glitterGain` 可以 `>1`（实测夜 1.20 / 午 0.15）——
  要么做归一，要么把 `#7` 阈值同步改掉并**在报告里说明这是判据替换**。
- **B**：`#7` 作废（理由：与 `#13` 语义重叠，`#13` 读像素更硬）。
  ⇒ 但删断言要**主控批**，且必须同步 `50-WP5-polish-verify.md` 与 `_STATUS.md`，别留悬空引用。

### 🔴 坑 2 —— 编译开关有个验收盲区

断言脚本一律用 `?debug=1` 起页（注入 API 只在 debug 模式暴露）。
所以 `uProbe` 分支改成「仅 debug 编译」之后：

- **debug 下**：分支还在 → 15 条断言读数不变 ✅
- **非 debug 下（真实交付形态）**：**没有任何断言覆盖** ⚠

**你必须补一条验证**：**非 debug 模式的画面 = debug 模式下 `uProbe=0` 的画面**。
可行做法：同一 hour，分别用 `?debug=1` 与不带 debug 起页，比对 `#6` 湖底 std / `#13` 读数（容差 ≤ 0.02）；
或用 `SW.water.uniforms.uTime` 钉住相位后直接比像素。若实在不便，**至少要在报告里证明
「`uProbe=0` 时这 8 个分支不会进入」**（贴出改后的 GLSL 条件与 `uProbe` 的默认值）。

### 验收判据

| # | 判据 | 阈值 |
|---|---|---|
| 1 | 15 条断言仍全过 | 15/15 |
| 2 | 🔴 **`#13` 与基线一致** | 24 相位中位 **2.144 ± 0.02** · 亮带质心 **634.3 ± 8px** |
| 3 | `calls` / `tris` 不变 | `6` / `53088` |
| 4 | 坑 2 的非 debug 一致性 | 差异 ≤ 0.02 |
| 5 | console 0 报错 · `anyNaN false` | — |
| 6 | **契约公开面签名不变** | `SW.water` 方法名 · `uProbe` 等 uniform 名与含义 · §6 参数键 |

> **#2 是这包的核心** —— 它同时验证「收敛成功」与「没有改行为」。**超阈值就不许提交。**
> 基线来源：`plan/wp5-assert.json`（每次跑都会刷新）与 `_STATUS.md` 的 UP1a 行（`#13` 2.126/2.150、`#14` 0.809、`#15` 0.4377/0.4548）。

### 边界（**只许动这两处的组织方式**）

- **不许**动 `swDetail()`（16 波细节法线 —— 归 **UP4**，roadmap §UP8 的 #3）
- **不许**改任何 uniform 的名字、类型、含义
- **不许**改 `SW.water` 的对外方法签名
- **不许**碰 `index.html` / `app/**`

### 完成后

1. `plan/_STATUS.md` **追加**一行（含 §验收 全部读数 + 你选的 A/B 方案及理由）
2. 新建 `plan/90a-UP8-report.md`（或直接写进上面那行，你定）
3. 提交：`refactor(UP8): 水面 shader 收敛 —— probe 分支改编译期 + glitterSpec 去重`

---

## 3. UP5 · 音频：母带 + 空间化 + foley

**目标**：修一处**真欠账** + 做母带。

### 🔴 现状欠账（roadmap §UP5 已写明，我复核确认）

- `10-audio.js:232` 拍击用 **裸 `new window.Audio()`**，`:267` 只设 `el.volume`
  → **不过 limiter、无声像，http 下也一样**
- 而 BGM（`:524`）在 http 下**已经**走 `createMediaElementSource` 全链路
- **→ 拍击是全库唯一没跟上 http 升级的音频通路**
- 且 `panner(v)`（`:169`）只被 `padVoice`（环境垫）用了

### 任务（按性价比排序，前两项必做）

1. 🔴 http 下把拍击池接入 `createMediaElementSource` → gain → `StereoPanner` → limiter
2. 🔴 **声像由点击 x 驱动** —— ⚠️ **跨模块签名变更**：`playSlap(lv)` → `playSlap(lv, x)`，
   调用点 `70-input.js:54` 同步。**这要走变更单（AM-012 已预留）**，别偷偷改。
3. **LUFS 归一**：BGM → **−16 LUFS**（`pyloudnorm` 两遍）；拍击 4 段统一峰值
4. **无缝循环**：`el.loop = true` 直接接 —— **146.8s 是不是干净循环没验过**，接了会「咔」
   → 检测循环点 + crossfade
5. **foley 分层**：impact + body + spray 三层叠
6. **BGM stems**：若生成器支持分轨 → 3~4 层按时段交叉淡化（吃满「随时间变化」主题）

### 拥有 / 不许碰

- **可改**：`src/10-audio.js` · `src/70-input.js`（仅 `:54` 调用点）· `assets/audio/**` · `plan/91-UP5-audio.md`（新）· `_STATUS.md`（追加）
- **不许碰**：`src/60-water.js`（**UP8**）· `src/30-scene.js`（**UP2**）· `index.html` · `app/**` ·
  `plan/wp5-assert.js`（**UP6**）· 其余 `src/**` · `vendor/**`

### 验收

| # | 判据 |
|---|---|
| 1 | 15 条现有断言仍全过（**音频不影响画面**，这是回归保护） |
| 2 | 新增：**拍击经过 limiter**（可读取链路证明） |
| 3 | 新增：**LUFS 读数**（BGM 目标 −16 LUFS，容差 ±1） |
| 4 | 新增：**声像随 x 单调**（同一 y、x 从左到右 → panner 值单调） |
| 5 | 拍击在 `file://` 下行为**不变**（降级保留，别把免构建入口弄哑） |
| 6 | 循环接缝无爆音（循环点前后 50ms 能量差 / 波形连续性） |

### 完成后

`_STATUS.md` 追加一行 · 提交 `feat(UP5): 拍击接入全链路 + 声像跟手 + LUFS 母带（AM-012）`

---

## 4. UP6 · 验证链：Playwright

**目标**：把现有 15+16 条断言**包一层**（**不推倒** —— 它们是真资产）。

### 🔴 三条硬约束

1. **不得改动 `plan/wp5-assert.js` / `plan/wp5-env.js`** —— 它们是 UP8/UP5 本轮的验证手段（耦合 ①）。
   你的东西放 **`plan/pw/`**（新建目录）。
2. **`package.json` 不许加 `"type": "module"`** —— 加了之后 `wp5-assert.js` 的 CJS `require`
   会立刻 `ERR_REQUIRE_ESM` 挂掉。**这条 UP1a 已踩过一次**（见 `vite.config.mjs` 头部注释）。
   你要加 Playwright 依赖没问题，**只加 devDependencies，别动 type 字段**。
3. 🔴 **`toHaveScreenshot()` 不能直接罩整幅水面** —— 见 `60-UPGRADE-ROADMAP.md §2.1`：
   相位抖动本身就是 **20~46 dB** 的差异（同入口跑两次都如此）。
   正确用法二选一：① 先钉 `SW.water.uniforms.uTime.value = 固定值`（契约 §2.6 公开字段）
   + Playwright 的 `animations:'disabled'`；② 只对**非水面区域**（UI 层 / 湖底局部裁切）做像素回归。

### 方案要点

- `page.clock` 替掉手搓 `__clock`（顺带绕开 `50-ripple.js` 的 `MAX_SUB=4` 那个坑 ——
  现有 #4 已改用「自然衰减」绕过，`page.clock` 能更干净地解决）
- trace viewer 看 GL 时间线 · video 录制 · chromium / firefox / webkit 三引擎
- **dev-only，不进交付物** —— 别让它出现在 `dist/` 或 `index.html` 的加载链里

### 拥有 / 不许碰

- **可改**：`package.json`（**仅 devDependencies**）· 新建 `plan/pw/**` · `plan/92-UP6-playwright.md`（新）· `_STATUS.md`（追加）
- **禁止**：`plan/wp5-assert.js` · `plan/wp5-env.js`（本波次冻结）· `src/**` · `index.html` · `app/**` · `dist/**`

### 验收

| # | 判据 |
|---|---|
| 1 | Playwright 版能跑通现有断言中**全部确定性项**（6 时段升/方位/sunI/gGain/gSpec · `lod` 全字段 · `chromaStep` per 表 · `REVISION` · 画布尺寸）+ 至少 `#13 / #14 / #15` |
| 2 | 新旧两套**读数一致**（拿 `wp5-assert.js` 的输出逐字段对） |
| 3 | 像素回归**只用在确定性区域**，且**必须证明它在「故意改坏一像素」时会红**（否则是摆设） |
| 4 | `plan/wp5-assert.js` 的 sha256 **未变** |
| 5 | Playwright 不进 `dist/`（跑一次 `npm run build` 验证 `dist/` 内容不变） |

### 完成后

`_STATUS.md` 追加一行 · 提交 `test(UP6): Playwright 包一层验证链（dev-only）`

> ⚠️ 收工时**由主控裁**：两套并存还是切到 Playwright。**你不要自行删 `wp5-assert.js`。**

---

## 5. UP2 · 后期处理管线（**等 UP8 提交后再开**）

> **本包现在不要开工。** 等 UP8 落地（`_STATUS.md` 出现 UP8 行）后，主控另发开场白。
> 下面是提前告知的口径，好让你（或同一个聊天框）有预期。

**方案**：`EffectComposer` + `RenderPass` + `UnrealBloomPass`（**阈值调高，只吃反光柱/高光**）
+ `OutputPass` + 轻 vignette / film grain。**UP1a 解锁的 `three/addons/**` 正是为此**。

### 🔴 三个必须知道的点

1. **RT 链是这包的技术难点**：现有 `sceneRT`（带 `DepthTexture`，供水面折射读取，`30-scene.js:95-112`）。
   加 composer 后必须保证：**折射读「水面渲染前」的 sceneRT，bloom 读「水面渲染后」的合成帧**。
   **两个 RT 必须独立** —— 合并会让折射击中自己（水里有水）。
   正确顺序：`湖底 → sceneRT(折射源) → 水面采样 sceneRT → composer(RenderPass 取水面帧) → bloom → OutputPass → 屏幕`
2. 🔴 **`index.html` 的「逐字节冻结」到此结束**。你**必须**加 `<script src="src/65-post.js"></script>`，
   而 `app/index.html` + `app/main.js` 要**同步**加对应 `import` —— 这是 UP1a 的已知成本（两份手抄）。
   **两处入口都要改，改完各跑一遍断言**。
3. 🔴 **不许改任何断言的阈值** —— 你的职责是**报读数**（bloom 前 / 后两套），
   **重标由主控在本波次末统一做**（因为 UP8 也动了 #13，最终阈值要看到两者都完成才能定）。

### 拥有（开包时生效）

`src/30-scene.js` · **`src/65-post.js`（新）** · `index.html` · `app/index.html` · `app/main.js` ·
`plan/93-UP2-bloom.md`（新）· `_STATUS.md`（追加）

### 验收（开包时以正式包文档为准）

新增光晕半径像素判据 + 报「bloom 前 / 后」两套 `#13 / #6 / #8` 读数 + UI 不受 bloom 影响
（UI 全是 DOM，`80-ui.js` / `#hint` / `#dbg` 不在 GL 里 —— roadmap §UP2 已确认这是安全点）。

---

## 6. 共同纪律（三个包都适用）

1. **动手前先复述**：你拥有哪些文件、哪些不许碰、本包要开哪张变更单。
2. **只追加 `_STATUS.md` 你自己的行**，历史行不得改写 —— UP5 那次覆盖历史行的教训还在。
3. **不拥有就不改**。要改别人的文件 ⇒ **停下来问主控开变更单**，别「顺手」改。
4. **验收读数要贴原始输出**，不要只写「通过」。
5. **不许 `git commit --amend` 已推送的提交**（当前无远端，但保持同样纪律）。
6. 提交前 `git status` 必须只剩你自己的文件。
7. **本文件（`plan/90-WAVE4.md`）是只读口径**，不要改它 —— 有异议请回报主控。

---

## 7. 变更单占用表（**别撞号**）

| 变更单 | 归属 | 说明 |
|---|---|---|
| AM-009 | **UP2** | 新增 bloom 参数组 → 影响 #13 阈值 · #6/#8 |
| AM-010 | UP3 | 新增 env 参数组 → 影响 AM-007 §1 四态 R−B |
| AM-011 | UP4 | `pebbleScaleNear/Far` 语义变 → 影响 #14/#15 |
| AM-012 | **UP5** | `playSlap` 签名 +x → 无（新增 2 条） |
| **AM-013** | 已用 | UP1a 主控复核：截帧改显式 `--shots`（`wp5-assert.js`） |
| AM-014+ | 空闲 | 你要开新号，**先回报主控** |

> ⚠ **订正块（主控 2026-09-25）—— 本表前三行已失效，别照它开工：**
>
> | 本表原写 | 实际 | 处置 |
> |---|---|---|
> | `AM-010` → UP3 | 被 **UP9 海鸟环境音** 占用（波次 6 · 09-25） | UP3 顺延 **AM-017**（登记于 `02-AMENDMENTS.md §2.1`） |
> | `AM-011` → UP4 | 被 **UP10 时间刻度尺** 占用（波次 5 · 09-25） | **UP4 无号**，开包当刻由主控分配 |
> | `AM-012` → UP5 | ✅ 正确（UP5 音频，已关单） | 保留 |
> | `AM-014+` 空闲 | 已用：**AM-014** = UP10 手感增量 · **AM-015** = UP11 BGM 选曲 | AM-016 预留 WP6 · **AM-017** 预留 UP3 |
>
> **根因与纪律**：本表按"提前预留号"填，但号码会在他处被消费 → 本项目**已三次撞号**
> （AM-012/013 → UP10 顺延 AM-014；本表 AM-010 → UP3 顺延 AM-017；本表 AM-011 → UP4 悬空）。
> **今后本表只写"该包需要开一条变更单"，不再预填号码；号由主控开包当刻分配。**
