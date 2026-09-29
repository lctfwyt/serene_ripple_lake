# 108 · UP15 slap 拍击采样（**换源待议**）

> **波次 16** · 前置：无 · 并行：与波次 15/17/18 **均不争文件**（独占 `src/10-audio.js` + `assets/audio/**`）
> **题材**：**离散「拍击」采样 `slap1~4.wav` 换源 / 复核**（拖水时的拍水声）。**不含**连续「流水」合成层。
> ⚠ **规格待雨桐沟通**（§3 清单）—— **§3-A（来源）已裁：`sounds-mp3` 不可商用、必须换源**（2026-09-30）；余下 B/C/D 待答。
> 写作纪律见 `03-COLLAB-PROTOCOL.md`（**§7.4 白名单定义**：① 本包改动文件 ∪ ② 收尾四步产物）。

---

## 1. 现状 —— 「slap」在哪条链上

契约 §4 的既有事件是 **`splash { x, z, speed01 }`**（`70-input.js` 发 · `10-audio.js` 消费）—— 这是拖动水面的**划水**语义。
消费端把它做成 **两层混合**：

| 层 | 机制 | 代码锚点 |
|---|---|---|
| 连续「流水」层 | 程序化 WebAudio：`flowTarget` 随速度耦合 + 停手 `FLOW_HOLD` 平段 + 长淡出 | `flowCmd` / `flowTick` / `tailShape` |
| **离散「拍击」层** | `<audio>` 元素池直放 4 个 `0.55s` 采样 **`slap1~4.wav`** | `slapPool` / `poolPlay` |

**本包只动第二层（`slap1~4.wav`）。** 第一层（合成流水）是 `00-INDEX §5` 的全局决策，**不在本包范围**。

### 1.1 `slap1~4.wav` 是什么（现状）

| 事实 | 值 |
|---|---|
| 来源 | **`sounds-mp3`** —— 🔴 **2026-09-30 主控裁决：不可商用**（站方 About 页「site is not intended for commercial use」+ 素材「collected from open sources」⇒ 不持有版权、给不出授权；全站无 license 页）|
| 素材沿革 | 源自 `slap.mp3`（29s 连续戏水）→ 按「低频能量占比」自动挑出 **4 个低沉厚重片段** → 统一峰值 + 淡入淡出 |
| 文件 | 4 个 · 各 **139,244 B** · 0.55s · 含烘进去的混响尾 |
| 播放 | `<audio>` 元素池轮询（`file://` 唯一可行路）· `playbackRate` 抖 **0.88~1.12**（`SLAP_RATE = 0.24`）|

### 1.2 决定响度的 4 个源内常量（`src/10-audio.js`）

| 常量 | 值 | 作用 |
|---|---|---|
| `SLAP_FILES` | `slap1~4.wav` | 文件清单（`:67`）|
| `SLAP_TRIM` | `0.85` | 整体音量微调（`:72`）|
| `SLAP_RATE` | `0.24` | 变调抖动幅度（`:73`）|
| `SLAP_LUFS_TRIM` | `[1.0256, 1.1312, 0.8491, 1.0151]` | **逐段响度配平**（`峰值统一 ≠ 响度统一`）—— 由 `plan/audio-baseline.py` 实测反推（`:135`）|

🔴 **换采样 ⇒ `SLAP_LUFS_TRIM` 必须重算**（否则 4 段响度不再配平）：施工方跑
`python plan/audio-baseline.py --emit-js` 取新 4 个数，写回 `10-audio.js:135`。
**这是本包最容易被漏掉的一步** —— 漏了不会报错，只会「某一段明显比别人响」。

---

## 2. 硬约束（我这边钉死，施工方不许动）

| # | 约束 | 理由 |
|---|---|---|
| 1 | `SW.audio` 签名不动：`init / setEnabled / playHand / duck / sfxTick / bgmInfo / setBgmTrack / suspend / resume / probe` | 契约 §2.1 冻结签名 |
| 2 | `probe()` 字段名/语义不增删改 —— `slapReady` / `slaps` / `slapDur` / `slapMode` / `slapRouted` / `slapAnPeak` 保留 | UP5 验收 #2/#3/#4/#6 读它们（`10-audio.js:1518-1524`）|
| 3 | **冻结件 `wp5-assert.js` / `wp5-env.js` 零改动**（`npm run pw:frozen`） | 契约 §7 冻结 |
| 4 | `file://` 双击入口必须照常出声 ⇒ 采样**只能走 `<audio>` 元素** | 全局决策 §5「音频加载」|
| 5 | AudioContext 仍由**首次手势**创建 | 契约 §2.1 |
| 6 | 渲染路径禁 `Math.random()`（用 `mulberry32(SW.P.seed)`） | 全局决策 §5 |
| 7 | **连续「流水」合成层不碰**（`flowTarget` / `tailShape` 等） | 本包只动离散拍击层 |

---

## 3. 待雨桐提供的规格（**沟通清单**）

### A · 来源 —— ✅ **已裁：`sounds-mp3` 排除、必须换**（2026-09-30 主控）
1. **`sounds-mp3` 判死**：站方 About 页原文「**The Sounds-mp3.com site is not intended for commercial use.**」；
   素材自述「**collected from open sources**」⇒ 站方**不持有版权、给不出授权**；全站**无独立 license/terms 页**（`/contacts` 仅一张表单）。
   ⇒ 公开部署（Netlify / PWA）下**不可用**。**此前标的「免费商用免署名」系误记**（UP9 取证时已挂「待裁」，本日裁掉）。
2. **换成什么**：**`sound dino`**（与 `bird1~6` 同源，已确认 *free for personal and commercial work, no attribution*），
   还是 **其他来源**？

### B · 素材形态（决定改动量）
3. 你给什么：**一段可直接用的拍击采样** / **一个多段采样包** / **一个页面链接让我去挑**？
4. 若是单段：要不要**切成 4 段**（保 4 段轮询 + 变调 ⇒ 听感不重复），还是**就用 1 段**？
   > 用 1 段 = 改 `SLAP_FILES` 长度 ⇒ 撞 §4 判据 6。

### C · 替换策略（**强烈建议 A**）
5. 选 **A · 同名替换**（4 个文件同名 `slap1~4.wav`、只换内容）还是 **B · 改数量/改名**？

| | 判据 6 | `SLAP_LUFS_TRIM` | `dist-baseline` |
|---|---|---|---|
| **A 同名替换**（推荐） | **不撞** ✅ | 须重算 | 变（主控重落）|
| **B 改数量/改名** | **撞** ⚠（需 AM 授权改 `wantAudio`）| 须重算 | 变（主控重落）|

### D · 听感
6. 取向：保持现在「**低沉厚重**」（低频能量挑段的产物），还是换**清脆水花**？响度对 BGM / 咔嗒的关系？
7. 是否要**与拖动速度连续耦合**（现状拍击**不**耦合，只有合成流水层耦合）？

### E · 验收
7. 「像不像」由**你耳朵**定（§7.2-3：审美/取向类结论挂验收，施工方不得自判通过）。要不要机械判据（如「一次 splash 必触发一次采样」）做回归？

> 回法示例：「换 sound dino，我给你一个 wav；切成 4 段同名替换；比现在清脆一点；机械判据给一条。」

---

## 4. ⚠ 跨包冲突（**换源一定会碰** —— 先看清代价再选方案）

`plan/pw/tests/50-brand.spec.mjs` **判据 6** 钉死了 `assets/audio/` 的**文件名全集**（恰好 14 个）：

```js
const wantAudio = ['bgm-mingjing.mp3','bgm-weifeng.mp3',
  'bird1..6.wav','slap1..4.wav','tick1..2.wav'];            // 14 个
expect(fs.readdirSync('assets/audio').sort()).toEqual(wantAudio);
```

| 方案 | 文件名全集 | 撞判据 6？ | `SLAP_LUFS_TRIM` | `dist-baseline.txt` |
|---|---|---|---|---|
| **不换** | 不变 | 否 | 不需动 | 不变 |
| **A · 同名替换**（4 个，只换内容） | **不变** | **否** ✅ | **须重算** | 变（字节）⇒ 主控重落 |
| **B · 改数量 / 改名** | 变 | **是** ⚠ | **须重算** | 变 ⇒ 主控重落 |

> 选 B 时：`wantAudio` 属 **UP14 的文件**（跨包）⇒ 由 `AM-034` 授权施工方一并改，**你（施工方）不必自己去碰**；
> `dist-baseline` 一律**主控重落**（施工方不许碰）。

---

## 5. 判据（**规格锁定后填** —— 占位框架）

| # | 判据 | 方法（机械） | 状态 |
|---|---|---|---|
| 1 | 手势后音频态 `running` | 断言 #8（`audioCtx === 'running'`）仍绿 | 待定 |
| 2 | 采样每次必响 | 注入一次 splash → `probe().slaps` 单调 +1 | 待定 |
| 3 | `file://` 入口照常 | 免构建入口双击场景 `state === 'running'` 且出声 | 待定 |
| 4 | 响度配平仍到位 | `python plan/audio-baseline.py` 漂移检测 `SLAP_LUFS_TRIM` **无漂移** | 待定 |
| 5 | 冻结件 / 签名零改动 | `pw:frozen` ✅ · `SW.audio` 键集不变 | 待定 |
| 6 | 不该变的没变 | 非本包资产（`bgm-*` / `bird*` / `tick*`）sha256 与文件名未动 | 待定 |
| 7 | 文件名全集（判据 6 前提） | 同 §4 —— 选 A 则必然通过；选 B 则 `wantAudio` 已同步 | 待定 |
| 9 | **听感定档**（挂雨桐） | 响度 / 音色 / 是否耦合 —— **判定权在雨桐** | 挂验收 |

---

## 6. 禁区

- **`assets/audio/` 里的 BGM / 鸟鸣 / 咔嗒一律不碰**（同名同 sha256）
- **连续「流水」合成层不碰**（`flowTarget` / `flowTick` / `tailShape`）
- 冻结件 `wp5-assert.js` / `wp5-env.js` 只读
- **`plan/pw/tests/__snapshots__/**` 与 `plan/pw/dist-baseline.txt` 不碰**（主控地盘）
- **`dist/**` 不碰**（不重建）
- 不为本包在 `src/` 里新增模块（除非规格明确要求，届时由 AM 授权）
- 光照 / 水面 / env / 后期参数一个数不碰

---

## 7. 收尾

**施工方（§7 四步）**：完工记录 → `_STATUS` 一行 → 跨包影响先开 AM（选 B 时改 `50-brand.spec.mjs`，见 §4）→ 板 ⬜ 清零。

**主控专属**：`npm run build` + 重落 `dist-baseline`（`dist/**` 主控专有）· `00-INDEX` 波次 16 翻 ✅ · 契约 §2.1 若有签名外补充面（本包**预期无**）。

> **当前状态：⬜ 规格待雨桐沟通** —— 拿到 §3 的回答后，本文件补 §1.2 常量新值 / §5 判据正文并开 `AM-034`，再派施工方。
