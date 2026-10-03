# 112-UP18-ui-readability · UI 可读性与可达性打磨

- 变更单：**AM-037**（暂编，待主控在总表确认；只影响单包内部，按 `02 §4` 可不开单，本包因跨「像素基线」收口仍留一行总表记录）
- 所有者：本包只碰 `src/80-ui.js`（历史所有者链 WP3 → UP10 → UP11）；**不改任何冻结件**
- 入口：`plan/_STATUS.md` / `plan/02-AMENDMENTS.md` 各追加一行
- 触发：雨桐实测抓图（`_ui-contrast.mjs`，HOURS = [2, 8, 12.5, 18.5, 22.5]）——**白色 UI 文字在正午 / 黄昏几乎消失**

---

## 1. 实测依据

用无构建入口跑 Playwright（chromium channel `chrome`，viewport 1280×720，deviceScaleFactor 1），
逐时段 pin 后截 `full-*.png` 与左上角 `panel-*.png`（clip `{0,0,360,130}`）。
**实证**：`panel-12_5.png` / `panel-18_5.png` 上白字融进亮水面，`panel-02_00.png` 夜间正常。

根因：叠加层文字恒 `rgba(255,255,255,.72)`（设计基调「低对比」），
但**水面亮度随时段从夜间的深色变到正午的亮青**，白字只在夜间够对比。

以 `90-debug.js §fogL()` 的**同一算式**（fog OKLCH → 线性 sRGB → `srgbEnc` → 0.2126/0.7152/0.0722 加权 → ×255）
复算本表各键的雾色感知亮度 `fogL`（0–255）：

| 时刻 | 键 | fogL | 白字对比（估） | 结论 |
|---|---|---|---|---|
| 02:00 / 04:00 / 22:00 / 22:50 | 夜段 | 90.5 | ≈7.0:1 | 白字 OK |
| 21.35 | 蓝调 | 96.5 | ≈6.4:1 | 白字 OK |
| 20:30 | 晚霞 | 105.2 | ≈5.6:1 | 白字 OK |
| 19.75 | 暮色 | 116.9 | ≈4.5:1 | 临界 |
| 18.50 | 黄昏 | 146.0 | ≈3.1:1 | **白字不足** |
| 17.50 | 斜阳 | 165.3 | ≈2.5:1 | **白字不足** |
| 15.50 | 午后 | 181.0 | ≈2.1:1 | **白字不足** |
| 09:00 | 上午 | 171.1 | ≈2.3:1 | **白字不足** |
| 12.50 | 正午 | 190.2 | ≈1.9:1 | **白字不足** |
| 05.50 | 晨雾 | 134.1 | ≈3.6:1 | **白字不足** |

> 白/黑两墨的对比交叉点由 `(1.05)/(Y+0.05) = (Y+0.05)/0.05` 解出 `Y ≈ 0.179` ⇒ `fogL ≈ **117**`。
> **117 以上用近黑墨、以下用白墨**，两端都 ≥4.2:1。

---

## 2. 方案（用户裁决 A：自行选择；按昼夜自适应墨色）

**信号源**：`SW.time.current().fogColor`（线性 sRGB，与 `90-debug.js` 读的 `scene.fog.color` 同源），
经**与 `90-debug.js §fogL()` 逐字相同**的 `srgbEnc` 复算得 `fogL`（0–255）。**不新增 `src/` 依赖、不读 `SW.scene`**。

**切换**：`fogL ≥ 117.5 → 近黑墨`，否则白墨。**刻意不跨带混合** ——
白↔黑的中间是灰，而过渡带背景恰在中灰附近，混合中途对比会掉到 ≈1.2:1（比两端都差）；
在交叉点上**跳变**反而两端均 ≥4.2:1。跳变时刻由 fogL 缓慢移动（≈0.27/min）驱动，观感是一次换墨而非闪烁。

**实现**：`#ui` 上写两枚 CSS 变量
- `--sw-ink`：文字 / 刻度 / 中线 / 焦点环的墨色（白 `255,255,255` ↔ 近黑 `18,30,34`）
- `--sw-shadow`：`text-shadow` 的底色（暗 `0,0,0` ↔ 亮 `255,255,255`）

`src/80-ui.js` 里所有**无自带底色**的文字与线改用 `rgba(var(--sw-ink,255,255,255),α)`：
`CSS_BASE`（面板/时刻/时长文本）· 刻度尺刻度渐变 · 小时数字 · 「当前时刻」竖线 · BGM「BGM：」标签 · `#hour` 焦点环。

**例外（后经施工修订，见 §6.2）**：初稿设想 `#snd` 与 `.sw-bgm-btn` 保留写死白字（「自带深色药丸底」）。
施工实测药丸底仅 `rgba(10,18,22,.20~.26)`，正午叠亮水面合成亮度 ≈160 ⇒ 白字对比仅 ≈1.9:1，**例外不成立**；
改为两控件同样跟随 `--sw-ink`。

**出范围（本轮不做，附理由）**：
- 首屏 `#hint` / `#brand`：在**免构建入口 HTML** 里，逐字节冻结；且 `50-brand.spec.mjs` 判据 7b 明确
  「`brand` 不得因渲染错误出现在免构建入口的运行期 DOM ⇒ `src/**` 禁写 `hint`/`brand`」——
  任何 JS 侧改写都撞品牌判据，故本次不碰首屏墨色。
- 首屏 canvas 淡入 / 根 HTML 的 `theme-color` / favicon：同样受冻结入口限制，根入口不改；
  构建入口 `app/index.html` 已在 AM-036 补齐 manifest/theme 元信息，不重复。

## 3. 影响面（文件 + 判据）

| 文件 | 改动 | 判据影响 |
|---|---|---|
| `src/80-ui.js` | 新增 `INK` 常量 + `fogL()/paintInk()` + CSS 变量化文字色；`build()` 记 `el.root`；`paint()` 每帧调 `paintInk()` | ① 像素快照 `ui-panel.png`（`#ui > div.first()`）在正午变墨 → **需 `pw:update` 重落 ②** 另两张含 `#ui` 的帧同批重落 |
| `plan/pw/**` | **仅有 `pw:update` 写出的 PNG 基线**；冻结件 / spec 零改动 | `10-assert`（15 条，不读像素色）、`50-brand`（零改动）、`env-narrow`（只量 bbox，颜色无关）应全绿 |
| `app/**` | **零改动**（`80-ui.js` 已进构建入口，样式在 JS 侧，不碰 `app/index.html`） | — |
| `index.html` | **零改动**（冻结） | — |

**白名单（本包可写）**：`src/80-ui.js`、`plan/112-UP18-ui-readability.md`、`plan/pw/tests/*-snapshots/**`（仅 `pw:update` 产物）、
`plan/_STATUS.md`（一行）、`plan/02-AMENDMENTS.md`（一行）。**其余一律不碰。**

## 4. 验收判据

1. **对比**：正午 / 黄昏（fogL > 117）墨色为近黑，夜间（fogL < 117）为白；抓图 `panel-12_5.png` / `panel-18_5.png` 文字清晰可读。
2. **不变**：`npm run pw` 除**像素快照**外全绿；改动后 `npm run pw:update` 重落基线，再跑 `npm run pw` = 全绿。
3. **冻结**：`npm run pw:frozen` ✅；`50-brand` ✅（含旧名 0 命中）。
4. **降级**：`SW.time.current()` 取不到时 `fogL=0` → 退回白墨（与旧观感一致），不抛错。
5. **文档**：`_STATUS.md` / `02-AMENDMENTS.md` 各一行；`_ui-contrast.mjs` 交付前删除。

## 5. 施工顺序

1. `src/80-ui.js`：AVP 墨色（本节 §2）→ 抓图复核 → 单独 commit。
2.（视 env-narrow 约束）触控命中区 ≥44px：`#snd` / `.sw-bgm-btn` 高仅 ≈25px。
   ⚠ `B.top=56` 与 `#snd` 底（≈47）只隔 9px，向上/下扩命中区会与 BGM 行**相切/重叠**（撞 `env-narrow` 的「UI 不重叠」）。
   ⇒ 若做，须**同步下移 `B.top`** 并实测 bbox；本包先记录，除非 bbox 有解否则不硬塞。
3. `#snd` 焦点/悬停态对齐 `.sw-bgm-btn`（`:focus-visible` 描边提亮，无外框）→ 单独 commit。
4. 统计口径文案、其余 P2 → 视冻结限制逐项判定。
5. 统一 `npm run pw` → `npm run pw:update`；结果写回本文件；追加 `_STATUS.md` / `02-AMENDMENTS.md`。

## 6. 应用记录

### 6.1 P0 自适应墨色（`src/80-ui.js`）· commit `cbefa0a`

- **实现**：`INK` 常量 + `srgbEnc()/fogL()/paintInk()`；`--sw-ink` / `--sw-shadow` 写在 `#ui`；
  `CSS_BASE`、刻度尺刻度/中线/读数、`#hour` 焦点环全部改用 `var(--sw-ink,…)`。
  `fogL` 的像素算式与 `src/90-debug.js §fogL()` 逐字相同，信号取自 `SW.time.current().fogColor`。
- **阈值**：`INK.th = 117.5`（见 §1 交叉点推导）。近黑墨 `[18,30,34]` / 白 `[255,255,255]`；**刻意跨阈值跳变、不混合**。
- **实测**（`_ui-contrast.mjs` pin 5 时段，读 `SW.time.current().fogColor` 复算 + 读 `--sw-ink`）：

| 时刻 | fogL | `--sw-ink` | 面板 computed color |
|---|---|---|---|
| 02:00 | 90.5 | 255,255,255 | rgba(255,255,255,.72) |
| 08:00 | 163.7 | 18,30,34 | rgba(18,30,34,.72) |
| 12:30 | 190.2 | 18,30,34 | rgba(18,30,34,.72) |
| 18:30 | 146.0 | 18,30,34 | rgba(18,30,34,.72) |
| 22:30 | 90.5 | 255,255,255 | rgba(255,255,255,.72) |

- **抓图**：`panel-12_5.png` / `full-12_5.png` 复核 —— 正午「正午 / 12:30 · 已锁定」近黑、清晰；
  刻度尺 08–16、BGM 标签同为近黑；夜间回白。**与 §4 判据 1 一致。**
- **`npm run pw`**：仅像素快照漂移（详见 §6.5）。

### 6.2 P1 `#snd` 焦点/悬停态统一（`src/80-ui.js`）· commit `be4a3e9`

- **修订 §2 的「例外」**（见 §2 脚注）：药丸底 `rgba(10,18,22,.20~.26)` 正午叠亮水面后白字仅 ≈1.9:1，例外不成立。
  改为 `#snd` / `.sw-bgm-btn` **同样跟随 `--sw-ink`**（夜白昼黑），并给 `#snd` 补 `:hover` / `:focus-visible`
  （描边提亮、去原生 outline），与 `.sw-bgm-btn` 同族。
- **实测**：pin 后读 computed style —— 02:00 `#snd`/chip 均 `rgba(255,255,255,.72)`、12:30 均 `rgba(18,30,34,.72)`，描边同步。

### 6.3 P0-2 触控命中区 ≥44px（`src/80-ui.js`）· commit `bcbb433`

- **实现**：不改视觉尺寸，用 `::before` 外扩 —— `#snd::before` 向上 16px、`.sw-bgm-btn::before` 向下 19px，
  **各自背向那条 9px 的相邻边界生长** ⇒ 两块命中区不相交（§5-2 设想的「同步下移 `B.top`」因此**不需要**）。
- **实测**（`elementFromPoint`）：`#snd` 真实 bbox 104×29，顶部再上 12px 仍命中 `#snd`（有效 45px）；
  chip 真实 bbox 52×25，底部再下 12px 仍命中 chip（有效 44px）。
- **env-narrow**：伪元素不进 `querySelectorAll` ⇒ 真 bbox 不变、日志仍报 29/25，`375×812` 不重叠判据不破。

### 6.4 P2 状态文案 + 其余 P2（`src/80-ui.js`）· commit `3cea9bf`

- **做**：`sndText()` 三段统一为 `声音 · 待` / `声音 · 开` / `声音 · 关`（原 `声音 · 未启动` 偏长）。
- **记明（受冻结入口 / 品牌判据限制，本轮不做，留待主控裁）**：
  1. **首屏 `#hint` / `#brand` 中央墨色**：在**冻结入口** `index.html`（逐字节）内；且 `50-brand` 判据 7b 明令
     `src/**` 不得出现 `brand` 字样 ⇒ 无法从 `80-ui.js` 注入覆盖。正午中央「静湖微澜 · 轻触水面」仍为低对比。
  2. **首屏 canvas 淡入 / 根 HTML `theme-color` / favicon**：同受冻结入口限制（`app/index.html` 侧 AM-036 已补）。
  3. **`#hint bottom:8%` 短屏碰撞风险**：`#hint` 在冻结入口，无法在 `src/**` 收口。

### 6.5 统一 `npm run pw`（收口）

- 改动前 `npm run pw` **25 passed**（P0 基线已重落，见 6.1 抓图同步提交）。
- 四项改完后：`30-pixel` 仅 **`full.png`** 红（732 px / ratio 0.01；`ui-panel.png`、`bed-clip.png` 绿）。
- `npm run pw:update` ⇒ 22 passed / 3 skipped；再跑 `npm run pw` ⇒ **25 passed / 0 failed**。
- `pw:frozen` ✅（冻结件 sha 逐字未变）；`50-brand` ✅（含旧名 0 命中）。

### 6.6 提交拆分（每优化点一 commit）

| commit | 内容 |
|---|---|
| `8dce237` | docs：本计划文档 |
| `cbefa0a` | P0 自适应墨色 |
| `be4a3e9` | P1 `#snd` 焦点/悬停 + 控件族墨色 |
| `bcbb433` | P0-2 触控命中区 ≥44px |
| `3cea9bf` | P2 状态文案 |
| 收口 | 重落 `full.png` 像素基线 + `_STATUS` / `02` 各一行 + 删临时脚本 |
