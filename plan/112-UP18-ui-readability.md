# 112-UP18-ui-readability · UI 可读性与可达性打磨

- 变更单：**AM-037**（单包内部；跨「像素基线」收口，留总表一行）
- 所有者：本包只碰 `src/80-ui.js` 与根 `index.html`（后者经 AM-037 明确解冻、仅加两行 head 元信息）；冻结件零改动
- 入口：`plan/_STATUS.md` / `plan/02-AMENDMENTS.md` 各一行
- 触发：抓图复核发现白色 UI 文字在正午 / 黄昏融入亮水面（`_ui-contrast.mjs`，HOURS = [2, 8, 12.5, 18.5, 22.5]）

---

## 1. 结果（最终交付）

| 项 | 处理 | commit |
|---|---|---|
| 昼夜自适应墨色（`fogL≥117.5` 近黑 / 否则白） | **已做后还原** —— 观感不佳，恢复固定白墨 `rgba(255,255,255,.72)` | `cbefa0a` → `88f5594` |
| `#snd` 焦点 / 悬停态对齐 BGM 芯片 | **随墨色一并还原** | `be4a3e9` → `88f5594` |
| 声音状态文案 `声音 · 待/开/关` | **已做后还原** —— 「待」含义不清，恢复 `声音 · 未启动/开/关` | `3cea9bf` → `88f5594` |
| 触控命中区 ≥44px | **保留** —— `#snd::before` 上扩 16px、`.sw-bgm-btn::before` 下扩 19px；真实 bbox 不变 | `bcbb433` |
| 首屏画布淡入 | **新增** —— `#c.enter` 触发 `.6s` 淡入 | `32360f4` |
| 根入口 `theme-color` + favicon | **新增** —— 内联 SVG data URI，`file://` 下零失败请求 | `8338716` |

## 2. 关键实现

**触控命中区**（`src/80-ui.js` `injectStyle`）：`#snd` 向上、`.sw-bgm-btn` 向下各补一圈 `::before`，
两块命中区**背向**那条约 9px 的相邻边界生长、互不相交；伪元素不进 `querySelectorAll`
⇒ env-narrow 的真 bbox 不变（仍报 29 / 25），命中面积实测 45 / 44px。

**首屏画布淡入**（`src/80-ui.js`）：`#c.enter{animation:sw-fade .6s ease;}`，`build()` 末尾给 `#c` 挂 `.enter`。
关键取舍：**不写 `#c{opacity:0}` 基线** —— 动画 `fill:none`，播完回落默认 `opacity:1`，
故 `animations:'disabled'`（像素快照会禁动效）与 `prefers-reduced-motion` 都不会把画布留在透明态。

**根入口元信息**（`index.html`）：`<meta name="theme-color" content="#0b1418">` +
`<link rel="icon" type="image/svg+xml" href="data:...">`（内联 favicon，`file://` 双击不产生请求失败）。
⚠ `verify-pwa.mjs` 判据 10 只禁「根 `index.html` 引用 manifest / sw」；theme-color / favicon 不触该判据。

## 3. 验收

- `npm run pw` **25 passed**（`30-pixel` 三帧 + 三哨兵、`env-narrow`、`env-reduced-motion`、`50-brand`）。
- `npm run assert` **15/15**，console 零错误 / 零 Log error。
- `pw:frozen` ✅（仅 `wp5-assert.js` / `wp5-env.js` 被冻结，逐字未变）。
- 像素基线在还原后重落一次（`full.png` / `ui-panel.png`，`5052fd6`）；画布淡入与根元信息不改稳态像素。

## 4. 未做（受限记录）

首屏中央 `#hint` / `#brand` 的正午墨色：文本写在冻结入口的 CSS 里，且 `50-brand` 判据 7b 禁止
`src/**` 出现 `brand` 字样 ⇒ 无法从 JS 侧注入覆盖 —— 正午中央两行仍为低对比，留待后续单独立项。
`#hint bottom:8%` 的短屏碰撞风险同理，未动。

## 5. commit 序

`8dce237` docs → `cbefa0a` P0 墨色 → `be4a3e9` P1 `#snd` → `bcbb433` P0-2 触控 → `3cea9bf` P2 文案
→ `5b36f8e` 收口 → **`88f5594` 还原墨色 / 文案（保留触控）** → `5052fd6` 重落基线
→ `32360f4` 画布淡入 → `8338716` 根 `theme-color` / favicon
