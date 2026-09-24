# 93 · UP2 后期处理管线（bloom + vignette/grain）

> 所有者：UP2 · 开包口径：`90-WAVE4.md §5` · 变更单：**AM-009**（已关，全文在 `98b-AMENDMENTS-ARCHIVE-v1.md`）
> 状态：**✅ 完工 2026-09-24 22:0x** · 断言 2×2 矩阵 4×(15/15) · 主控验收项见 §6

---

## 0. 一句话

给两入口接上 `EffectComposer → UnrealBloomPass（阈值 0.85 只吃高光）→ GradePass（轻 vignette + film grain，线性光域）→ OutputPass（末位收尾 ACES+sRGB）`，**不改任何断言阈值**，前后读数只报不判。

## 1. 文件清单（全部为本包动作）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/65-post.js` | **新建** | 后期模块 `SW.post`：能力检测 + composer 构建 + render/降级/probe |
| `app/post-global.js` | **新建** | 构建入口供给件：`three/addons` 五类原生 import → 挂 `window.THREEPOST` |
| `index.html` | +2 行 | `vendor/three-post.min.js`（vendor 之后 src 之前）+ `src/65-post.js`（60-water 之后） |
| `app/main.js` | +2 行 import | `./post-global.js` + `../src/65-post.js`（顺序与 index.html 逐条对齐） |
| `src/30-scene.js` | 改 render() 步骤② | `SW.post.active → SW.post.render(dt)`，否则 v1 直渲；步骤① sceneRT 不动 |
| `src/00-config.js` | +post 参数段 | `bloom/bloomStrength/bloomRadius/bloomThreshold/vignetteAmp/grainAmp`（WP1 无活跃窗口，主控预批，UP2 代为落地；`SW.P0` 自动含新键 → 重置按钮无需改） |
| `vendor/three-post.min.js` | **只消费** | 主控构建入库（sha256 `dcc95447…`），暴露 `THREEPOST={EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,OutputPass,CopyShader,LuminosityHighPassShader}` |

## 2. 实现要点（三个踩坑点都实证过）

1. **tone mapping 归属**：r160 实证（`three.module.js:20716`）——`material.toneMapped && currentRenderTarget === null` 才编入 ACES。→ 中间帧全是线性 HDR；**OutputPass 必须是最后一个 pass**，它渲到画布时施加 renderer 同款 ACES + sRGB。若 OutputPass 后再接任何 pass，ACES 永远不发生 → 最终帧变亮/变灰。故 vignette/grain 放在 OutputPass **之前**的 GradePass（线性光域——这正是胶片颗粒的物理形态），振幅随亮度缩放（暗部有 0.15 下限、亮部不过曝）。
2. **RT 独立**（90-WAVE4 §5-①）：折射源 `sceneRT` 仍由 `30-scene.render()` 步骤①独占（水面隐藏、rtCamera）；composer 的 read/write buffer 由 EffectComposer 内部自建。两套零接触 —— 验收 C（#3 折射差分 post 后仍过）证实。
3. **两入口零分叉**：免构建走 `THREEPOST` 全局（vendor bundle，主控所有）；构建入口由 `app/post-global.js` 用**同版本** r160 addons 原生 import 挂**同名同形**全局。`65-post.js` 一份代码、一条路径。
   - ⚠ 坑：不能把 addons 赋到 `import * as THREE` 的命名空间对象上（ESM namespace 不可扩展，严格模式直接 TypeError）→ 只挂 `window.THREEPOST`。
4. **确定性**：grain 时基 `uTime` 由 `render(dt)` 累加，dt 经 `SW.debug.dtFor` 钉控 → `?debug=1` 下断言可复现；`mod(uTime,64)` 防长时间运行 sin 精度塌缩。
5. **降级三重保险**：`?nopost=1` / `THREEPOST` 缺失 / composer 首帧异常 → 全部回落直渲，只 warn 不黑屏（验收 F 实测）。

## 3. 读数矩阵（wp5-assert.js · 1280×720 · 不改阈值 · #13=24 相位中位）

| 配置 | #2 calls/tris | #3 max | #6 std | #13 ratio | #13 质心 | 判定 |
|---|---|---|---|---|---|---|
| **基线（改动前直渲）** | 6 / 53088 | 91 | 15.09 | 2.141 | 634.5 | 15/15 |
| 免构建 · nopost | 6 / 53088 | 91 | 15.05 | 2.115 | 638 | 15/15 |
| dist · nopost | 6 / 53088 | 91 | 15.08 | 2.138 | 635 | 15/15 |
| 免构建 · **post** | **1 / 1** | 74 | 15.06 | 2.121 | 637 | 15/15 |
| dist · **post** | **1 / 1** | 81 | 15.06 | 2.136 | 636.1 | 15/15 |

读法：

- **#2 语义变化**：`renderer.info.autoReset` 使每次 `render()` 重置 → composer 末位 pass（OutputPass 全屏一quad）`calls=1/tris=1`。不是性能数字，是管线形态指纹。重标由主控做。
- **#13 抖动地板**：同一代码路径的 5 次跑动 spread ≈ 0.026（2.115~2.141）。post vs nopost 配置均值差 **0.002** —— bloom 对 #13 指标中性（柱峰值/中位同涨）。像素级效果见 §4 差分。
- **#3（验收 C）**：post 后 `hitFrac 18.8~19.1%`、`max 74~91`（判据 >30）——折射未被 composer 污染。
- 其余 11 条（#1/#4/#5/#7/#9~#12/#14/#15/#8）逐格全过、读数与基线一致（probe 类不走像素）。

## 4. 像素差分取证（临时脚本 `_up2-pixdiff.mjs`，已删）

同页钉控（`seek(22.5)` + `hold`）后 `render()+readPixels` 抽 160×90 亮度网格：

| 对比 | mean\|ΔL\| | max\|ΔL\| | 结论 |
|---|---|---|---|
| nopost vs nopost 重复跑 | 2.7/255 | 59.9/255 | 抖动地板（启动期相位漂移） |
| nopost vs **post** | **13.9/255** | **113/255** | **效果 = 地板 5.1×**，bloom+grain+vignette 真实可见 |

诊断同时证实：`THREEPOST` 7 键齐全 · post 链 4 passes · `probe()={post:true,bloom:true,…}` · 三次加载 0 页面错误。

## 5. 验收 A~F（AM-009 §4）

| # | 判据 | 结果 |
|---|---|---|
| A | 2×2 读数矩阵全记录、不改阈值 | ✅ §3 五行全 15/15 |
| B | 两入口 ACES 逐位一致（同配置读数一致 ≤ 抖动） | ✅ post: #13 Δ0.015/#6 Δ0.00；nopost: #13 Δ0.023/#6 Δ0.03（均在 §3 抖动带内） |
| C | RT 独立（#3 post 后仍过） | ✅ max 74~91（>30）· flagOff=false/flagOn=true |
| D | console 0 报错 · anyNaN=false · 双入口 file:// 可开 | ✅ 四格 JS 错误 (0) · Log error (0) |
| E | build + dist 基线重落 + pw:dist 过 + pw:frozen 过 | ✅ dist/index.html 753359 B（哈希变化=预期）· `pw:dist` ✅ · `pw:frozen` ✅ 冻结件未动；dist/index.html **零** `three-post` vendor 引用（构建入口走原生 import） |
| F | THREEPOST 缺失 → warn 一条 + 直渲不黑屏 | ✅ `passes=0` · `post:false` · 恰好一条 `[still_water] post: THREEPOST 不可用…` warn（另有该文件缺失本身的 ERR_FILE_NOT_FOUND 资源报错，属预期环境噪声）· post/nopost 像素差塌缩到 0.66 < 地板 |

## 6. 遗留（→ 主控）

1. **阈值重标**（90-WAVE4 §5-③ 约定主控收尾统一做）：#2 的 calls/tris 语义已变（1/1）；#13 新带建议按 §3 post 行 2.12~2.14 重标；#6/#15/#14 读数稳定无需动。
2. **挂账「#7 语义退化（gSpec≡gGain）」**（`_STATUS.md §4` 写明「UP2 开包时必裁」）：断言脚本冻结未动，**待主控裁**（改名 / 恢复独立探针 / 维持现状）。
3. **Playwright 像素基线**（`plan/pw/tests` 快照）：bloom 改变像素后预期变红，待主控 `npm run pw:update` 重录（plan/pw 非本包所有）。
4. **审美四项归雨桐**：bloomStrength 0.55 / threshold 0.85 / vignetteAmp 0.16 / grainAmp 0.05 均在 `SW.P`，可运行时调；`?nopost=1` 随时对比。

## 7. 完工记录（过程流水）

- 21:15 开包 · 复述所有权/变更单/三必须点 · BOARD 无本包 ⬜
- 21:2x 基线断言（改动前）：15/15，#13 2.141/634.5 —— 与 `_STATUS` UP1a 行一致
- 21:3x AM-009 全文落 `02-AMENDMENTS.md` §1 + 总表 ⬜；vendor bundle 核验（`window.THREEPOST` 7 键）
- 21:4x 实现 65-post.js / post-global.js / 两入口接线 / 30-scene 挂钩 / 00-config 参数段；r160 RT-不-tonemap 实证（three.module.js:20716）
- 21:5x 2×2 矩阵 4 跮 15/15 · 像素差分 5.1× · F 降级测试 · dist 基线重落
- 22:0x 关单归档 · 契约同步 · 台账 · 提交
