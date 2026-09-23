# 80 · UP1 工作包 —— 构建链地基（**只做 UP1a**）

> **状态：⬜ 待开工** · 下发 2026-09-24 · **前置**：基线 tag `baseline-pre-tier12` ✅（`e37aa6b`）
> **上游**：`plan/60-UPGRADE-ROADMAP.md` §3 UP1 —— ⚠️ **但本包对上游做了三处纠正，以本文件 §2 为准**
> **边界见 §1。本包是唯一跑无头断言的包。**

---

## 0. 目标：把 14 个 `<script>` 变成一条命令，**但两条入口都不许退化**

| 入口 | 形态 | 本包的要求 |
|---|---|---|
| **免构建入口** `index.html`（现状） | 13 个经典 `<script>` + 1 段 boot，`file://` 双击即开 | 🔴 **字节不变、行为不变** |
| **构建入口** `app/` → `dist/index.html` | singlefile，JS/CSS 内联，`file://` 双击即开 | 新建 |

**真正买到的是什么**（诚实版）：

| 收益 | 值不值 |
|---|---|
| 🔴 **`three/examples/jsm` 解锁** ← **本包存在的唯一理由** | ✅ UP2 的 `EffectComposer` / UP3 的 `RGBELoader` 都卡在这上面，不做它后面全部走不动 |
| HMR 开发体验 | ✅ 顺手 |
| tree-shaking（669 KB → 200 KB） | ❌ **吃不到**，见 §2.1 |
| `.glsl` 真文件（高亮 / lint / `#include`） | ❌ **不在本包**，见 §2.2 |

---

## 1. 边界

### 1.1 可新建 / 可改

| 文件 | 动作 |
|---|---|
| `package.json` · `package-lock.json` | 新建（`package-lock.json` **必须入库**） |
| `vite.config.js` | 新建 |
| `app/index.html` · `app/main.js` · `app/three-global.js` | 新建 —— 构建入口 |
| `README.md` | 增补「开发 / 构建」章节 |
| `plan/wp5-assert.js` | **只加 URL 参数化**（§4），其余一字不动 |
| `plan/_STATUS.md` | **只追加一行**（不改历史行） |

### 1.2 不许碰

`index.html`（须逐字节不变）· `src/**`（**12 个模块全部**）· `vendor/**`（sha256 必须仍是 `170c6789…d49fa`，669884 B）· `assets/**` · `plan/shots-wp5/**` · 其余 `plan/*.md`

> ⚠️ **与 UP4 / UP8 互斥**：UP4 要动 `40-lakebed.js`，UP8 要动 `60-water.js` —— 本包虽不改它们，
> 但会**改变它们的加载方式**，同开会让「改代码 vs 改加载」互相污染 diff。**UP1a 期间不同开 UP4 / UP8。**

---

## 2. 🔴 三处对上游的纠正（**已复算，按本节执行，不要照 roadmap §3 原文**）

### 2.1 吃不到 tree-shaking —— 「669 KB → 200~250 KB」估算作废

**事实**：全部 12 个模块都用 `var THREE = window.THREE` 拿全局（`30-scene.js` / `40-lakebed.js` / `50-ripple.js` / `60-water.js` / `70-input.js` / `90-debug.js` 均是）。
构建入口因此必须写：

```js
import * as THREE from 'three';
window.THREE = THREE;          // ← 命名空间对象逃逸
```

**命名空间一旦逃逸（被赋给全局），Rollup 无法做静态分析 → 必须保留 `three` 的全部导出 → 摇树收益为 0。**

**能不能救？** 我实测过：全项目 `THREE.X` 的 distinct 成员 = **51 个**，且 `THREE[变量]` 动态访问 **零命中** → 理论上可以手写 51 条精确 `import`，构造一个 shim 对象赋给 `window.THREE`，把摇树换回来。

**主控裁决：UP1a 不做。** 理由：
- shim 漏掉任何一个成员 → 运行时是 `undefined`，且**静默**，要等那条代码路径被触发才炸；
- 这正是本项目已经吃过亏的坑型（cf. `glitterSpec` 与 GLSL 的静默漂移、`uProbe` 进生产 shader）；
- 收益（估 600 KB → 480 KB）与「一份 51 项手工清单 + 漂移守卫 + 生成脚本」的成本**不成比例**。

→ **留给 UP1b**，与生成脚本、断言守卫一起做。

**UP1a 的体积预期：持平或略降，不设目标。**
今天 = `vendor` 656 KB + `src` 196 KB = **852 KB / 14 个请求**；
UP1a = three ESM min ≈ 600 KB + 应用 ≈ 150 KB ≈ **750~800 KB / 1 个请求**（内联进 HTML）。
**不许为了体积动任何东西。**

### 2.2 `.glsl` 抽离**不在本包** —— 有一条硬约束还没解

`src/*.js` 必须**同时**满足两种加载方式：

| 加载方式 | 需要 |
|---|---|
| 免构建入口（经典 `<script>`） | 纯字符串字面量 |
| 构建入口（ESM） | 可以 `import frag from './x.glsl'` |

而 `import` 语句出现在经典脚本里 = **`SyntaxError`** → **免构建入口直接坏掉**。

绕过它的两条路都有代价：
- **生成一个 `src/shaders.generated.js`**（由 `npm run shaders` 产出并入库）→ 免构建入口改读全局；代价是「改一处着色器要动两个地方」，必须配**漂移守卫断言**；
- **接受双份**（`.glsl` + 内联 fallback 分支）→ 同样有漂移风险，且 `60-water.js` 会变丑。

**这两条都要先裁方案 → 归 UP1b。** 本包的 `src/60-water.js` 保持 `VERT`/`FRAG` 字符串数组原样，
`detailGLSL()`（编译期生成 16 波 GLSL）也**不动**。

### 2.3 交付物是 **`dist/` 目录**，不是孤立的单个 HTML

`P.bgmFile = 'assets/audio/bgm-stillwater.mp3'` 是**运行时字符串**，不是 `import` → **打包器不管它**。
所以 `dist/index.html` 旁边必须有 `dist/assets/audio/`（4 个 wav + 2 个 mp3，共 7.3 MB）。

→ 「**`dist/` 双击即开**」这条验收按**目录**判，与今天的 `index.html` 需要同目录的 `assets/` **同理，无退化**。
搬运方式（`vite.config.js` 的 `publicDir` 或 `vite-plugin-static-copy`）**由本包自选**，但必须在 §5-#12 证明音频**真的能播**。

---

## 3. three 版本必须精确锁死

```json
"dependencies": { "three": "0.160.0" }
```

**精确版本，不带 `^` / `~`。**

理由：`vendor/three.min.js` 是 **r160**。两条入口必须**同版本渲染** —— 否则同一套断言在两个入口会读出不同数，
而且没人能立刻看出原因（这正是 `THREE.REVISION` 在 §5-#7 被列为判据的原因）。

---

## 4. 断言脚本要参数化 URL（**本包唯一的既有文件改动**）

现状 `plan/wp5-assert.js:23`：

```js
const URL = 'file:///D:/projects/still_water/index.html?debug=1';
```

改为读 `process.argv[2]`，缺省仍为上面那个值（**保证不带参数时行为与现在完全一致**）。
`SHOT_DIR` 若因两条入口连跑而互相覆盖，允许按入口加后缀，但**默认目录名不变**。

> **只改这一处。** 断言逻辑、阈值、24 相位扫描、质心判据一律不动（那是 AM-008 刚定下的口径）。

---

## 5. 验收判据（**14 条，全过才算完工**）

| # | 判据 | 口径 / 命令 |
|---|---|---|
| 1 | `npm install` 成功，`package-lock.json` 生成并入库；`three` 精确 `0.160.0` | `node -e "console.log(require('three/package.json').version)"` |
| 2 | `npm run build` 产出 `dist/index.html`，**JS/CSS 已内联**（HTML 内无指向本地 js/css 的 `src=`/`href=`） | grep + 字节数 |
| 3 | 🔴 **`file://` 双击 `dist/index.html` 能开**（**不加** `--allow-file-access-from-files`） | console JS 错误 **0** · 非白屏 · `SW.ready === true` |
| 4 | 🔴 **`file://` 双击原 `index.html` 仍能开**（回归） | 同上 |
| 5 | 🔴 **两条入口各跑一遍 `plan/wp5-assert.js`，各 15/15 全过** | 窗口 `1306,876` → 1280×720 |
| 6 | 关键读数与基线一致 | `#5 chromaStep 2.108` · `#13` 24 相位中位 ≈ **2.14**、亮带质心 ≈ **634** · `#14` ≈ **0.81** · `#15` ≈ **0.44** · `#6`/`#8` 亮度与 R−B |
| 7 | **两条入口读数互相一致**（同一条判据数值差在噪声内） | 逐条比对两份 `assert.json` |
| 8 | 🔴 **`examples/jsm` 已解锁**：`import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'` 能建实例 | 写一个 **smoke test**，**不得接入渲染管线**（那是 UP2 的事） |
| 9 | `npm run dev` HMR：改 `src/80-ui.js` 一行文案，**不整页刷新**即生效 | 人工确认一次 |
| 10 | 🔴 **`index.html` 与 `src/**` 零改动** | `git diff baseline-pre-tier12 -- index.html src/` → **输出为空** |
| 11 | `vendor/three.min.js` 未改 | sha256 仍 `170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa` · 669884 B |
| 12 | 🔴 **音频真的能播**（构建版） | 点水面有拍击声；BGM 起播（`SW.audio` 读数或 `?debug=1` 面板） |
| 13 | **体积诚实记录** | `dist/index.html` 与 `dist/` 总字节数，与基线 852 KB / 14 请求 对比，**写进 `_STATUS.md`** |
| 14 | `README.md` 增补「开发 / 构建」 | 含 `npm install` / `npm run dev` / `npm run build` 三条命令 + 产物位置 + **双入口说明** |

---

## 6. 已知风险与备选（**R1 是本包最可能翻车的一条**）

| # | 风险 | 症状 | 备选 |
|---|---|---|---|
| **R1** | 🔴 **Vite 产出 `type="module"` 脚本 → `file://` 打不开** | 双击白屏 / console 报 CORS | 先按 `vite-plugin-singlefile` 默认配置试；**fail 则按此顺序退**：① `build.rollupOptions.output.format = 'iife'` + `inlineDynamicImports: true` → ② `build.target = 'es2018'`。**判据 #3 是硬门，不接受"http 下能开"当通过** |
| R2 | 音频没被复制进 `dist/` | 无声 / 404 | `publicDir` 或 `vite-plugin-static-copy`；判据 #12 |
| R3 | 构建入口里 boot 时机变了 | `SW` 未就绪、白屏 | `app/main.js` 的模块顺序必须与 `index.html:29-41` **完全一致**；boot 仍用 `try/catch` 包（同 `index.html:42-50`） |
| R4 | three ESM 与 UMD 行为差异 | 两入口画面/读数不同 | 判据 #1 + #7 会抓到；差异若确实存在 → **报告，不要自己调阈值** |

---

## 7. 完成后

1. `plan/_STATUS.md` **追加**一行（含 §5 全部读数 + 体积对比 + R1 的实际走向）
2. `README.md` 增补「开发 / 构建」章节
3. 提交：`feat(UP1a): Vite 构建链 —— 单文件产物 + 双入口并存`
4. **不要**删 `vendor/` · **不要**改 `index.html` · **不要**动 `src/`

---

## 附录 A：配置起点（**参考，不是答案**）

```js
// vite.config.js —— 起点，按 §6-R1 逐级退
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'app',                 // 构建入口目录，根 index.html 不受影响
  publicDir: '../public',      // 音频搬运（§2.3）—— 或改用 static-copy
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2018',          // R1 退路②
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true }   // R1 退路①
    }
  },
  plugins: [viteSingleFile()]
});
```

```js
// app/three-global.js —— 必须在所有 src 模块之前执行
import * as THREE from 'three';
window.THREE = THREE;          // §2.1：这行就是摇树被放弃的原因，但它换来"零风险"
```

```js
// app/main.js —— 顺序必须与 index.html:29-41 完全一致
import './three-global.js';
import '../src/00-config.js';
import '../src/10-audio.js';
/* … 10/20/30/40/50/60/70/80/85/90 → 99-main.js … */
try { window.SW.boot(); } catch (e) { /* 同 index.html:42-50 */ }
```

> ⚠️ ESM 的 `import` 是**提升**的 —— 顺序靠「顶层 import 的书写顺序」保证，
> **不要**把 `window.THREE = ...` 写在 `import '../src/...'` 之后。
