# UP9 —— 海鸟环境音 + 咔嗒音效 API

> 开工口径：**先读 `90-WAVE5.md`，再读本文**；冲突以 `90-WAVE5.md` 为准。
> 变更单：**AM-010**　·　开工时间：2026-09-24

---

## §0 需求原文（雨桐）

> 背景远处浪声不错，加点偶尔的海鸟声（用音效下载器 skill）

外加一项**连带交付**：为 UP10 的时间刻度尺提供咔嗒音效 `SW.audio.sfxTick()`（签名已由主控在 `90-WAVE5.md §5` 冻结）。

**定位**：海鸟是**环境层**（amb），不是音乐也不是特效。要"偶尔"——几声鸟叫点缀在浪声之上，
让画面显得更远、更空。宁少勿多：**听感上每分钟 1~2 次封顶**，绝不能变成鸟语林。

---

## §1 你拥有的文件（白名单）

| 文件 | 权限 | 说明 |
|---|---|---|
| `src/10-audio.js` | ✅ 所有者 | 主战场 |
| `src/00-config.js` | ✅ 所有者（**音频段**） | 只加音频参数，别碰 glitter/bloom/post 段 |
| `assets/audio/` | ✅ 所有者（新增鸟声文件） | 溯源必须留档 |
| `plan/01-CONTRACT.md` | §2.1 `SW.audio` + §6 音频参数 + §7（`10-audio.js`/`assets/audio/*` 改判 **UP9**） | 分段改 |
| `plan/02-AMENDMENTS.md` | AM-010 那一行 | 只写自己的 |
| `README.md` | ✅ 资产表 + 参数说明 | UP5 之后无单一所有者，改前看一眼有没有别人刚改过 |
| `plan/94-UP9-birds.md` | ✅ 本文 | 完工记录写这里 |
| `plan/_STATUS.md` | 只**追加**一行 | 不改别人的行 |

**禁止碰**（越界即退回）：
`src/80-ui.js`（UP10 的）· `src/90-debug.js` · `src/60-water.js` · `index.html`（要改先问）·
`plan/wp5-assert.js` 和 `plan/wp5-env.js`（冻结件）· `plan/wp5-assert.json`
**断言阈值一个都不许改**——受影响就报前后两套读数。

---

## §2 必须先知道的五件事

### ① `file://` 下没有 `decodeAudioData`（铁律）
`10-audio.js:57` 的实测结论：file 协议下 `fetch / XHR / decodeAudioData` **全部被拦**。
现有拍击音 `slap1~4.wav` 因此走 **`<audio>` 元素池**（`new window.Audio()`）：建池在 314-330 行，播放选空闲元素在 378-390 行。

**鸟声必须沿用同款元素池路线**。用 `AudioBuffer`/`BufferSource` 的话 `dist/` 能响、`file://` 哑掉 → 两入口分裂，直接退回。

### ② 随机只能用 `rng`
`10-audio.js:138` 有唯一随机源 `rng`，**禁止 `Math.random`**（可复现性纪律）。
鸟声间隔、左右声像、音高抖动、选哪个片段——全部走 `rng`。

### ③ 加载竞争是真的
`SLAP_DELAY = 4000`（10-audio.js:63）就是为了错开 BGM 的解码高峰，注释里写了"否则 BGM 播不动"。
你再加一批音频元素会加剧竞争：
- 鸟声文件**尽量小**（建议单片段 ≤ 3s、≤ 80 KB；总数 2~4 个）
- 建池时机**错开**：建议 ≥ 6000ms，或在 slap 池建完之后再建
- 验收时必须确认**BGM 仍能正常起播**（这是最容易踩的回归）

### ④ 响度要对齐，用现成工具实测
项目有响度基线体检器：`npm run audio:baseline`（`plan/audio-baseline.py`）。
现有做法：BGM 有 `BGM_LUFS_RAW = -15.06` / `BGM_TRIM = 0.8974`，slap 有 `SLAP_TRIM = 0.85`。
**鸟声照此办理**：测出 LUFS → 定一个 `BIRD_TRIM` 常量 → 注释写清"实测值 + 目标值 + 算式"。
不要凭耳朵拍一个数。

### ⑤ 授权与溯源（比技术更重要）
雨桐已明确：BGM 是 AI 生成、**授权范围不清楚**、因此 repo 暂不公开。
你下载的鸟声**必须确认授权**并留档：
- 用 **yinxiao-downloader** skill 下载（`sounds-mp3.com` / `poppop.ai` / `mixkit.co`，该 skill 声明免费商用）
- 在 `README.md` 资产表补一行：**文件名 · 来源站点 · 原始文件名 · 授权条款 · 下载日期**
- 若某个站点**查不到明确授权条款** → **换一个**，不要用"应该没事"的素材
- 下载后确认格式：`file://` 下 `.mp3`/`.wav` 都能走 `<audio>`；若拿到别的格式先转码

---

## §3 实现要点（建议，不是圣旨）

### 3.1 鸟声层
- 挂 **amb 总线**（与浪声、风同总线），受 `P.ambVolume` 与 `#snd` 静音开关管辖
- 触发模型：随机间隔（建议 **25~70s**，走 `rng`），每次播 **1~3 声**短叫（声间 0.3~0.9s）
- 空间感：左右声像随机（`rng`）且**偏远处**——可用 `StereoPannerNode`，或元素池 + 双声道素材；
  音量比浪声**明显低**（先按 amb 的 0.3~0.5 倍起步，听感定档）
- 音高抖动：学 slap 的 `SLAP_RATE`（playbackRate 0.88~1.12），避免"同一个音反复"
- **静帧/降级时不响**：`prefers-reduced-motion` 与 WebGL 兜底路径下行为要正确（见 `85-fallback.js`）

### 3.2 咔嗒声 `SW.audio.sfxTick(step)`
签名**已冻结**（`90-WAVE5.md §5`），必须照此实现，不要单方面改——UP10 正按这个签名写：

```js
SW.audio.sfxTick(step);   // step: number 0~1，可选，默认 0.5；返回 boolean 是否出声
```

要求：**短、干、轻**的木质咔嗒（拖动时密集触发，**不许带混响尾**）；自带节流（≤ 25ms 重复调用只出一声）；
受 `#snd` 管辖；未就绪返回 `false` 且不抛错。
素材同样用下载器找（"click" / "tick" / "wood click"），**同样走元素池**。

### 3.3 参数（进 `00-config.js` 音频段）
建议命名（你可按实现需要微调，但要在契约 §6 同步）：

```js
birds: true, birdVolume: 0.5, birdGapMin: 25, birdGapMax: 70,
```

⚠ 这两个后缀 `Min/Max` 的间隔参数若你觉得用一个 `birdGap` + 抖动更简洁，可以改，但**契约要同步**。

---

## §4 验收（逐条打勾，写进完工记录）

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | **`file://` 双击能听见鸟声** | 🔴 最重要的一条。用 headless Chrome 打开 `file:///…/index.html`，等 ≥ 70s 或临时把间隔调短验证元素池真的播了（别只验 http） |
| 2 | 两入口行为一致 | `dist/` 同样验一遍 |
| 3 | **BGM 未回归** | BGM 仍能正常起播（不被你的加载竞争挤死） |
| 4 | 15/15 断言两入口全过 | `npm run assert` + `npm run pw` |
| 5 | console 0 报错 | 两入口都要 |
| 6 | 静音开关有效 | `#snd` 关闭后鸟声与咔嗒都不响 |
| 7 | 降级路径不回归 | 移动端 / 无 WebGL / reduced-motion 三档（Playwright 已有这三个 spec） |
| 8 | 响度有实测 | `npm run audio:baseline` 跑过，`BIRD_TRIM` 注释写了算式和来源 |
| 9 | 授权留档 | README 资产表补齐全，来源站点授权条款明确 |
| 10 | 可复现 | 间隔/声像/选片全部走 `rng`，**grep 不到 `Math.random`** |

**UI 相关提醒**：如果你动了任何 DOM，Playwright 的 `env-narrow` 会查 UI 元素不重叠 → 跑 `npm run pw`；
若 `ui-panel` 之类像素快照变红，**不要自己 `pw:update` 了事**，先确认是不是结构变了（那是真变更，报给主控）。

---

## §5 收尾四步

1. 完工记录写进本文 §6
2. `plan/_STATUS.md` 只追加自己一行
3. **AM-010 关单**：`02-AMENDMENTS.md` 总表登记 → 全文移 `98b` 归档 → 契约 §2.1/§6/§7/§10 同步
4. 留言板 `04-BOARD.md` 本包 ⬜ 清零；**明确告诉主控 `sfxTick()` 已就绪**（UP10 在等这条）

改了 `src/` 就要：`npm run build` → `npm run pw:dist:snapshot` → `npm run pw:dist`。

---

## §6 完工记录（过程流水）

_（开工后逐条追加）_
