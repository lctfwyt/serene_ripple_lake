# 106 · UP14 品牌改名 + 首屏标题行（AM-033）

> **波次 15** · 前置：无 · 并行：无（独占工作区，模式 A 自提）
> 本包只改**文案与标识**：零光照 / 零音频 / 零参数 / 零着色器。
> 写作纪律见 `03-COLLAB-PROTOCOL.md`（**§7.4 白名单定义**为本包新增，本包是第一份按它写的包）。

---

## 1. 新名与格式（锁定，不要再议）

| 项 | 值 |
|---|---|
| 中文名 | **静湖微澜** |
| 英文名 | **Serene Ripple Lake** |
| 组合串（唯一格式，沿用现有 `中文 · English`） | **`静湖微澜 · Serene Ripple Lake`** |
| 分隔符 | ` · `（U+00B7，两侧各一个空格）—— 与旧值 `静水 · still water` 同款 |
| 文件夹 / 目录名 | **不改**：`still_water`（雨桐明示「不方便改」） |

---

## 2. 改动清单（= §7.4 白名单 ①）

| # | 文件 | 位置 | 现值 → 新值 |
|---|---|---|---|
| 1 | `index.html` | `:6` `<title>` | `静水 · still water` → **`静湖微澜 · Serene Ripple Lake`** |
| 2 | `app/index.html` | `:6` `<title>` | 同上（**构建入口镜像，必须同改**，否则两条入口标题不一致） |
| 3 | `README.md` | `:1` H1 | `# 静水 · still water` → **`# 静湖微澜 · Serene Ripple Lake`** |
| 4 | `package.json` | `:5` `description` | 串内「静水 · still water」→ **新名**（其余描述文字不动） |
| 5 | `src/85-fallback.js` | `:167` `tag.textContent` | `'静水 · still water'` → **`'静湖微澜 · Serene Ripple Lake'`** |
| 6 | `index.html` · `app/index.html` | `<style>` + `<body>` | **新增首屏标题行** `#brand`（规格见 §4） |
| 7 | 新建 `plan/pw/tests/50-brand.spec.mjs` | — | 本包新回归（§5 判据 1~4 的机械证据） |

> **⚠ 文件名含 `env-` 会被 `testIgnore: /env-/` 静默忽略**（AM-031 踩过）—— 故命名 `50-brand.spec.mjs`，**不含 `env-`**。

**写权限申报（对照 `01-CONTRACT §7 所有权表`）** —— 下述文件他包权限为「只读」，本包写属**越权**，由 **AM-033 授权**：

| 文件 | 契约所有者 | 本包动作 |
|---|---|---|
| `index.html` | WP1 | 改 1 行 `<title>` + 加 `#brand` DOM/CSS |
| `src/85-fallback.js` | WP5 | 改 1 处品牌串 |
| `README.md` | WP5 | 改 1 行标题 |
| `package.json` | 共享（「并行波次须指定单一所有者」）| 改 1 处描述；**本包独占 ⇒ 无并行冲突** |

**契约偏离申报（2 处，主控收尾时补进 `01-CONTRACT`）**：
1. `01-CONTRACT` 记「所有 UI 用 JS 创建并 append 到 `#ui`，不改 `index.html` 结构」—— 本包把 `#brand` **写进 `index.html`**。
   理由：`#hint` 本身就是 index.html 里的 WP1 元素（同类「首屏引导文案」而非 UI 面板），放它旁边**能用一条 CSS 相邻兄弟选择器实现零 JS 同步**（§4）；该约束的立法意图是「防并行包抢 `#ui`」，本包独占 ⇒ 意图不冲突。
2. `#brand` 不属 `#ui` 子树 ⇒ 须自加 `pointer-events:none`（否则吃掉水面手势；`#ui > *` 那条规则管不到它）。

---

## 3. 不改清单（主控裁决 · 一句话可否决）

**裁决口径：改「用户可见的产品名」；不动「内部标识」与「历史事实」。**

| 项 | 例 | 理由 |
|---|---|---|
| 仓库 / 文件夹路径 | `D:/projects/still_water`（`plan/wp5-assert.js`·`wp5-env.js`·`plan/pw/lib/const.mjs`·`package.json` 的 `assert:dist`） | 雨桐明示不改；且**冻结件里写死了它**，一改就破 `pw:frozen` |
| 运行日志命名空间 | `[still_water]` —— **7 个文件 13 处**（`index.html` `:48` · `app/main.js` `:34` · `src/10-audio.js` `:1172/1277/1280` · `50-ripple.js` `:198` · `65-post.js` `:114/116/173/189` · `85-fallback.js` `:208/216` · `99-main.js` `:15`） | **对用户不可见**（只在 DevTools console）；与仓库名同源，仓库不改 → 日志前缀跟着仓库走；改它扩散 7 文件但用户价值 = 0，白增评审面。**⚠ 若雨桐要一致 → 改 `[serene-ripple]`，一句话可翻。** |
| npm 包名 | `package.json` `:2` `name: "still-water"`（+ `package-lock.json` 两处） | 等同仓库身份；改它须同步 lock 两处，运行期无任何影响 |
| `.gitignore` 头注 | `:2` `# still_water · .gitignore` | 仓库名 |
| **历史记录** | `10-WP1-scaffold-lakebed.md:100` 的旧 `<title>` 引用 · `40-WP4` / `91-UP5` / `92-UP6` / `96-UP11` 里的 **`bgm-stillwater.mp3`（真实历史文件名）** · `70-REPO-BASELINE:49/139` 的资产表 · `80-UP1:97` · `01-CONTRACT:497/553` · `src/10-audio.js:183-185` 的改名沿革注释 | **改了就是篡改历史**。旧名是「当时发生过的事」，新名只体现在「当前状态」类文档 |
| 归档文档 | `plan/98*.md` 全部 | 雨桐明示范围 = 非归档文档 |

---

## 4. 首屏标题行（设计规格）

### 4.1 结构

DOM 里 **`#brand` 紧跟 `#hint` 之后**（同级、`body` 子元素），**视觉在「轻触水面」上方**：

```html
<div id="hint">轻触水面</div>
<div id="brand"><span class="cn">静湖微澜</span><span class="dot">·</span><span class="en">Serene Ripple Lake</span></div>
```

### 4.2 显隐 —— **零 JS 改动**（本包的关键取巧）

```css
#hint.on + #brand { opacity: 1; }
```

**这样做的三个好处**：
1. `#brand` 的显隐**完全由 `#hint` 的 `.on` 派生** ⇒ 结构上不可能不同步，交付时「同起同落」是恒等式而非需要维护的约定；
2. **不动 `99-main.js`**（那两处 `classList` 一行都不用碰）；
3. `85-fallback.js:187` 已经 `#hint.classList.remove('on')` ⇒ 兜底页两行**自动一起消失**，零额外改动。

### 4.3 视觉参数（默认方案 · 推荐）

| 属性 | 值 |
|---|---|
| 定位 | `position:absolute; left:50%; bottom:calc(8% + 30px); transform:translateX(-50%)` |
| 布局 | `display:flex; align-items:baseline; gap:.62em; white-space:nowrap` |
| 初始 / 过渡 | `opacity:0; transition:opacity .8s ease`（**与 `#hint` 完全同参数 ⇒ 同速率淡入**） |
| 指针 | `pointer-events:none`（**必须**，见 §2 偏离申报 2） |
| 中文 `.cn` | `13.5px` · `letter-spacing:.20em` · `rgba(255,255,255,.88)` |
| 分隔 `.dot` | `10px` · `rgba(255,255,255,.42)` |
| 英文 `.en` | `11px` · `letter-spacing:.16em` · `rgba(255,255,255,.62)` |
| 字体 | **沿用 `#hint` 的同一 sans 栈**（PingFang SC / Microsoft YaHei / system-ui）—— 零新增字体风险 |

> **备选 B（一句话可切，不默认）**：英文换衬线 `font-family:"Optima","Palatino Linotype",Georgia,serif` —— 更有「品牌 lockup」味，但与全页 sans 体系不同源。**审美结论一律挂验收（§7.2-3），施工方不得自行判定通过。**

### 4.4 为什么标题行不做成「跟随 `#hint` 的兄弟带 `.on` 的独立元素」

需求原文是「随『轻触水面』四个字出现和消失」。若给 `#brand` 自己一个 `.on`，就需要在 `99-main.js` 的 900ms 定时器与首次手势两处**各写一遍**，属于「需要维护的同步」。§4.2 的做法把它降为 CSS 恒等式。

---

## 5. 判据（机械可验证；5.9 挂验收不在此列）

| # | 判据 | 方法（机械） |
|---|---|---|
| 1 | 两入口 `<title>` 均为新名 | 读 `index.html` / `app/index.html` 的 `<title>` 文本 === `静湖微澜 · Serene Ripple Lake` |
| 2 | 首屏两行**同时**出现、**同时**消失 | Playwright：起页 → 等 900ms + 0.8s 淡入 → 读 `getComputedStyle(#hint).opacity` 与 `(#brand).opacity`，**两者都必须 === 1**；发一次 `pointerdown` → 等 0.9s → **两者都必须 === 0**。判据是**两者相等**，不是绝对值 |
| 3 | 同步是**结构性**的（不是巧合） | 全程 `document.getElementById('brand').classList.length === 0`（`#brand` 自己从不被 toggle）⇒ 证明只有 `#hint` 这一个开关 |
| 4 | 兜底页不显示、且品牌串是新名 | `env-no-webgl.spec.mjs` 路径起页 → `#brand` opacity 0 · `#fallback` 内文本含新名 · **console 零 JS 报错**（只允许多那条既有 warn） |
| 5 | 改名残留 = 0 | 全仓 grep（排除 `.git` / `node_modules` / `plan/98*.md` / §3 不改清单）`静水\|still water` → **命中 0** |
| 6 | 不该变的一字未动 | `npm run pw:frozen` 两冻结件 sha256 逐字一致 · `vendor/**` 未动 · `assets/audio/**` 文件名与 sha256 未动 |
| 7 | 正反两面 | **该变的变了**：`git status` = §2 清单逐条（加收尾产物）；**不该变的没变**：`envBand`/`gGain`/`gGrain`/光照/音频常量一字未动 |
| 8 | 构建链未坏 | `npm run build` 后记 `dist/index.html` 体积；`assert` + `assert:dist` 各 15/15（**⚠ 见 §7：dist 不在白名单**） |
| 9 | **观感定档**（挂雨桐） | 标题行大小 / 位置 / 字距 / 两行间距 / 英文是否换衬线 —— 截图由施工方给，**判定权在雨桐** |

---

## 6. 禁区

- 光照 / 水面 / env / 后期 参数**一个数不碰**（`envBand` · `gGain` · `gGrain` · `bloomStrength` · 门控两端 …）
- `assets/audio/**` 不改名、不重编码
- 不动历史文档里的旧名叙述（§3）
- **`plan/pw/tests/__snapshots__/**` 与 `plan/pw/dist-baseline.txt` 一律不碰**（§7.1-3 主控地盘）
- **`dist/**` 不碰**（不重建、不改）—— 改 `src`/`index.html` 后由主控重建
- `plan/pw/wp5-assert.js` · `wp5-env.js` 冻结件只读

---

## 7. 收尾

**施工方（§7 四步）**：完工记录 → `_STATUS` 一行 → 跨包影响先开 AM（本包**没有**新影子常量，AM-033 已开）→ 板 ⬜ 清零。
提交 **模式 A**（独占）：`feat(up14): 品牌改名 + 首屏标题行（AM-033）`。

**主控专属（施工方做不了 / 不许做）**：

| # | 动作 | 原因 |
|---|---|---|
| 1 | **重录 `plan/pw/tests/__snapshots__/full.png`**（可能含 `ui-panel.png`） | `30-pixel.spec.mjs:66` **明确等 `#hint` 的 900ms + 0.8s 淡入落地才截图** ⇒ 新增 `#brand` **必然进入定格**。基线是主控地盘（§7.1-3）。**⚠ 重录前先把 §4.3 的视觉定死，否则反复重录** |
| 2 | `npm run build` + `npm run pw:dist:snapshot` | `dist/**` 主控专有；且 `pw:dist` 的「**假绿**」陷阱（只锁 `dist ≡ 基线`、不锁 `dist ≡ f(src)`）—— AM-031 / AM-032 各踩一次 |
| 3 | `plan/00-INDEX.md:1` 标题改名 + 波次 15 翻 ✅ | `00-INDEX` 属主控地盘（不在 §7.4-② 收尾产物内） |
| 4 | `plan/01-CONTRACT.md` 补 §2 偏离申报 + §7 所有权表记 AM-033 授权 | 契约由主控维护（同 `b0a77d6`） |

---

## 8. 风险

| 风险 | 说明 | 对策 |
|---|---|---|
| **像素基线必红** | 判据 2 的截图口径天然包含 `#hint` | 预期内；主控重录。**先定死视觉再重录**（§7-1） |
| **两处 `<title>` 双写漏改** | `index.html` 与 `app/index.html` 是镜像（README：「改样式要改两处」同款坑） | 判据 1 同时读两份，不等即挂 |
| **`dist/` 未重建** | 不在白名单 ⇒ `assert:dist` 跑旧构建 | 施工方在完工记录写明；主控重建（§7-2） |
| **`#brand` 吃掉水面手势** | 它不在 `#ui` 子树 | `pointer-events:none`（§4.3）；判据 2 的 `pointerdown` 本身就是一次手势回归 |
| `#hint` 在 DOM 里不是 `#brand` 的前一个兄弟 | 相邻兄弟选择器失效 ⇒ 两行不同步 | 判据 3 兜底（`#brand` 从不被 toggle，若失效则 opacity 恒 0，判据 2 立刻红） |
