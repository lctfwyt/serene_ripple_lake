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

---

## 9. 完工记录（施工方 · 2026-09-29 23:5x · 独占工作区 模式 A）

### 9.1 自证声明（§7.2-1）

**本包无独立复核方，复核为同上下文自证。** 下面每一条都是机械可验证的读数（文件内容 / 页面计算样式 /
像素差分数），**不含"复核通过"这类判断**。审美结论（§5 判据 9）一律挂雨桐。

### 9.2 改动清单（逐条 = §7.4-①）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `index.html` | `:6` `<title>` → `静湖微澜 · Serene Ripple Lake`；`:17-29` 新增 `#brand` CSS 块；`:41` 新增 `#brand` DOM（紧跟 `#hint`） |
| 2 | `app/index.html` | 同上三处（构建入口镜像，逐字一致 —— 判据 1b 机械核对） |
| 3 | `src/85-fallback.js` | `:167` 兜底页品牌串 → 新名（1 行） |
| 4 | `README.md` | `:1` H1 → `# 静湖微澜 · Serene Ripple Lake` |
| 5 | `package.json` | `:5` `description` 内旧名 → 新名（其余文字未动；`name` 仍未 `still-water`，§3） |
| 6 | 新建 `plan/pw/tests/50-brand.spec.mjs` | **8 用例**（下 §9.4），覆盖判据 1~7 |

`git diff --stat`：`5 files changed, 33 insertions(+), 5 deletions(-)`。

**`#brand` 实测几何**（Playwright 读 `getBoundingClientRect`，CSS px @1280×720 · dpr=1）：

```
box    = [530.9, 614.4, 749.1, 632.4]   ⇒ 整数 [531, 614] 起 · 218×18 px
text   = "静湖微澜·Serene Ripple Lake"（三 span：.cn 13.5px/ls .20em · .dot 10px · .en 11px/ls .16em）
开关   = #hint.on + #brand{opacity:1}   （相邻兄弟选择器 ⇒ 零 JS 同步）
```

### 9.3 判据读数

| # | 判据 | 读数 | 结果 |
|---|---|---|---|
| 1 | 两入口 `<title>` 均为新名 | `index.html` / `app/index.html` 均 `静湖微澜 · Serene Ripple Lake` | ✅ |
| 2 | 两行**同起同落** | 相位 A（首屏）：`#hint=1 · #brand=1`；相位 B（一次 `pointerdown` 后）：`#hint=0 · #brand=0`；**两相位不透明度差均为 0** | ✅ |
| 3 | 同步是**结构性**的 | 两相位 + 初始态 `#brand.classList.length === 0`（`className` 恒 `''`）· `previousElementSibling.id === 'hint'` | ✅ |
| 4 | 兜底页不显示 · 文案含新名 · console 干净 | `brandOpacity=0` · `fbText="此浏览器不支持 WebGL，已切换为静态画面静湖微澜 · Serene Ripple Lake"` · `swReady=false` · `#c display=none` · **JS 报错 0 条** | ✅ |
| 5 | 改名残留 = 0 | 扫描 **89** 个文本文件、命中 **13** 处，**全部在 `plan/` 记录面**（产品面 0）；13 处的分布：`00-INDEX:76` · `02-AMENDMENTS:24/108` · `106`×6 · `10-WP1:100` · `98b`×2 · `50-brand.spec.mjs:43`（模式串自指）—— 逐条对上 §3 不改清单 / 改名记录允许集 | ✅ |
| 6 | 不该变的一字未动 | `pw:frozen` **两冻结件 sha256 逐字一致**（`abf23d7d…` / `bd9dd0e8…`）· `vendor/three.min.js` 669 884 B / `170c6789…` · `assets/audio/` **14 件文件名全集未动** · `index.html` 15 条 `<script src>` 序列未动 | ✅ |
| 7 | 正反两面 | 正面：5 个载体逐个命中（含两条入口的 DOM/开关规则/`pointer-events` 正则）· 反面：**12 个渲染路径 `src` 模块** 品牌串 / `brand` 标识 / 旧名 **三项均 0 命中** | ✅ |
| 8 | 构建链未坏 | 免构建入口 `npm run assert` **15/15**（`#13` peak/median **2.683** · `#14` 接缝 **0.809** · `#15` 覆盖 **0.4548** · console 0 报错）· ⚠ `assert:dist` **跑的是旧构建**（`dist/` 不在本包白名单，未重建，见 §9.6） | ✅ / ⚠ |
| 9 | 观感定档 | 截图由施工方给，**判定权在雨桐** | ⬜ 挂验收 |

### 9.4 新增回归 `50-brand.spec.mjs`（8 用例）

`判据 1` · `判据 1b`（两入口 DOM/CSS 逐字一致）· `判据 5` · `判据 6` · `判据 7` · `判据 7b` ·
`判据 2/3` · `判据 4`。单跑 **8 passed**。

**三处设计取舍（写进文件头注释，便于复核）**：

1. **判据 4 不用 `--disable-webgl`，改 `page.addInitScript()` 覆写 `getContext`** ——
   加 project 要动 `playwright.config.mjs`，**该文件不在本包白名单**；而覆写 `getContext` 与
   `85-fallback.js:47 hasWebGL()` 读的是同一个 API、`addInitScript` 在页面脚本之前跑 ⇒ 等价。
2. **判据 6/7 不读 git 状态** —— `git status` / `git diff HEAD` 的结果**随"提没提交"翻转**，
   而本文件会被反复跑（施工 / 提交后 / 复核各一次）⇒ 靠 git 的断言第二次运行就自相矛盾。
   故只钉**绝对量**（sha256 / 字节数 / 文件名全集）；「白名单外零改动」是一次性核查，证据在 §9.5。
3. **判据 5 分「产品面 / 记录面」两段** —— 原文排除项漏了 `app/index.html` 这类**记录面之外**的镜像
   文件；本实现改为：产品面命中**必须为 0**（更强），`plan/` 命中必须全落在**显式白名单**内
   （多一处即红，能同时抓「漏改」与「新增旧名」）。

**一处已知耦合（已在 `04-BOARD` UP15 箱点明）**：判据 6 里的
「`assets/audio/` 文件名全集 = 14 件」是**硬编码**的 —— 将来若有包**新增/改名音频资产**
（例如 UP15/AM-034 若选「新增 splash 采样」），本判据会立刻红。那是**预期行为**（它正是「不该变的没变」
的守卫），由该包的变更单一并授权改本文件即可，**不要**把这条判据放宽成"只查子集"。

### 9.5 越界核查（§7.4-2 正反两面）

```
$ git status --porcelain
 M README.md              <- 白名单 ①
 M app/index.html         <- 白名单 ①
 M index.html             <- 白名单 ①
 M package.json           <- 白名单 ①
 M src/85-fallback.js     <- 白名单 ①
?? plan/pw/tests/50-brand.spec.mjs   <- 白名单 ①（本包新建）
```

- **白名单外 diff 为空**（逐条查过）：`git diff --name-only -- vendor assets dist
  plan/pw/tests/__snapshots__ plan/pw/dist-baseline.txt plan/wp5-assert.js plan/wp5-env.js
  plan/pw/frozen-hashes.json package-lock.json vite.config.mjs` → **无输出**。
- `git diff --name-only -- src/` → **只有 `src/85-fallback.js`**（渲染路径 12 个模块一个字节未动）。
- 临时诊断件 `_branddelta.mjs` 已删（`_*.mjs` 本就被 `.gitignore §9` 忽略，且不入提交）。
- ℹ `plan/108-UP15-splash.md` / `plan/109-UP16-deploy.md` 是**主控在本包施工期间（23:56）新落的派包文档**，
  不是本包产物，本包未碰、也不会 `git add`。
- ⚠ **共享文件的本提交边界（治理记录 · 非越权但要说清）**：提交 `5c35c6b` 里 `plan/04-BOARD.md` 的
  **`+32` 行中有一部分是主控在 23:5x 并发写入的**（UP15 / UP16 / UP17 三个新箱 + 收件箱目录三行 +
  全体箱「开三个新包」一行）。`git add <file>` **无法按 hunk 分割**（要 `git add -p`），故这些行随本提交入库。
  **影响**：内容无错（都是主控自己的板内容），但那批板改动**已提前进入历史** —— 若主控原计划单独提交它们，
  现在 `04-BOARD.md` 对它已是 clean。按 §7.1-2 **不 amend**，留此一行备查。
  对照：`plan/106-UP14-brand.md` 本提交只有 `@@ -158,3 +158,132 @@` **一个 hunk**（纯 §9 追加）；
  `plan/_STATUS.md` 4 行 = 表头时间 + §1 一条 + 台账一行 —— 两者均为本包独有。

### 9.6 基线影响（**主控专属动作**，本包不碰 `__snapshots__/**`）

`npm run pw` 全链 **25 用例 = 20 passed / 1 failed / 4 skipped**：

| 基线 | 结果 | 原因 |
|---|---|---|
| `ui-panel.png` | ✅ 绿 | `#brand` **不在 `#ui` 子树**（`80-ui.js` 那条契约级创建顺序未受影响）⇒ **不必重录** |
| `bed-clip.png` | ❌ **红** · pw 报 **447 px**（ratio 0.01） | `#brand` 的 box `y∈[614,632]` **落在裁切区 `y∈[475,677]` 内**（`x` 531–749 ⊂ 448–832） |
| `full.png` | ⏸ **未跑**（serial 中止） | `30-pixel.spec.mjs` 是 `mode:'serial'`，② 一红就**中止** ③ 与哨兵 A/B/C |
| 哨兵 A/B/C | ⏸ **未跑**（同上） | ⇒ **主控重录后必须整份复跑 `30-pixel`**，否则哨兵这一轮等于没验（protocol §8.2-2） |

**归因证据（把"UP14 造成"与"先存缺陷"分开，跑了三轮）**：

| 对照 | 读数 | 说明 |
|---|---|---|
| 真 HEAD（`git stash -u` 后 `npm run pw -- 30-pixel`） | **6/6 passed** | ⇒ 两条基线在 UP14 **之前都是绿的**，本包是唯一成因 |
| 模拟 HEAD（运行时 `#brand.remove()`，零文件改动）vs `full.png` | **0 px 差（逐字节相同）** | ⇒ 画面其余部分**完全没动** |
| UP14 之后 vs `full.png` | 782 px 超阈 · **差异 bbox = [531,617]–[747,629]**，**完全被 `#brand` 行罩住** | ⇒ 改动**只**落在品牌行，无二次回归 |
| UP14 之后 vs `bed-clip.png` | pw 口径 **447 px**；同一脚本原始度量 737 px | 差值是 pixelmatch 的 AA 启发式（`includeAA:false`）不计入 |

**给主控的两个操作要点**：

1. **必须用 `--update-snapshots=all`**（不能 `npm run pw:update`）：`pw:update` 是 `changed` 模式，
   只改写"红了"的基线 —— 而本轮 `bed-clip` / `full` 确实红了，能覆盖；但**重录后必须整份复跑**
   确认哨兵能变红（protocol §8.2-3 的 `changed` 陷阱）。
2. `dist/` 需 `npm run build` + 重落 `dist-baseline.txt`（本包未重建；`assert:dist` 本轮跑的是旧构建）。

### 9.7 自纠：一处中间推断被自己证伪

诊断途中我曾据「两个基线互比 → 全 77568 像素差 ≥1、54 px 超阈」推断
「**`bed-clip.png` 是旧基线（09-25 14:02 录，与 09-29 的 `full.png` 不同源）⇒ UP14 之前就已经红**」。
**该推断错误，已证伪**：真 HEAD 上 `30-pixel` 实跑 **6/6 全绿**。
原因：我那个简易度量**没有实现 pixelmatch 的 `includeAA` 启发式**，把基线间的 ±1 抖动算成了"超阈"；
pw 的口径会把这些丢进 AA 类而不计。⇒ 记录在此，避免后来者照那条错误结论去重录或改基线策略。

（**教训归属**：不看 pw 的原始读法就自造度量去下"先存缺陷"的结论 —— 属于 §7.2 口径纪律里的
「判据读数只能当筛子不能当裁判」。）

### 9.8 提交

模式 **A（独占）**：`feat(up14): 品牌改名 + 首屏标题行（AM-033）`，`git add` 逐条列名（禁 `-A`）。
提交凭证见 `_STATUS.md` 与 `git log -1 --stat`。
