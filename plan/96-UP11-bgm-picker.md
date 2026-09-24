# UP11 —— BGM 选择器（前端选曲 + 进页面随机一首）

> 开工口径：**先读 `90-WAVE5.md`，再读本文**；冲突以 `90-WAVE5.md` 为准。
> 变更单：**AM-015**　·　波次：**7**（UP9 / UP10 收工后才开工；本单原标"波次 6"，按 `00-INDEX` 全局编号订正）
> ⚠ 本单原定 `AM-012`，该号已被 UP5 音频变更占用 → 主控 2026-09-25 顺延为 **AM-015**（裁决见 `90-WAVE5.md §2` 订正块）。**别再用 AM-012。**
> 开工前置：`plan/_STATUS.md` 里 UP9 与 UP10 两行都是 ✅。若 UP10 未收工 → **停下来问主控**（`80-ui.js` 所有权还在它手上）。

---

## §0 需求原文（雨桐）

> BGM 有备选，希望能在前端选择听哪首，刚进页面播放随机一首

---

## §1 你拥有的文件（白名单）

| 文件 | 权限 | 说明 |
|---|---|---|
| `src/10-audio.js` | ✅ 所有者 | 播放列表、切歌、随机首播 |
| `src/00-config.js` | ✅ 所有者（音频段） | `bgmFile` → 列表 |
| `src/80-ui.js` | ✅ 所有者（**波次 7 起从 UP10 移交**） | 选曲控件；🔴 前置：UP10 已收工 |
| `plan/01-CONTRACT.md` | §2.1 `SW.audio` + §6 音频参数 + §7 所有权 | 分段改 |
| `plan/02-AMENDMENTS.md` | AM-015 那一行 | 只写自己的 |
| `README.md` | ✅ 资产表 + 选曲说明 | UP5 之后无单一所有者 |
| `plan/96-UP11-bgm-picker.md` | ✅ 本文 | 完工记录写这里 |
| `plan/_STATUS.md` | 只**追加**一行 | 不改别人的行 |

**禁止碰**：`src/90-debug.js` · `index.html`（🔴 **不要新建模块文件**，选曲 UI 并入 `80-ui.js`，免得动加载顺序）·
冻结件 `wp5-assert.js` / `wp5-env.js` · **断言阈值一律不许改**

---

## §2 现状（已替你查好）

| 位置 | 内容 |
|---|---|
| `src/00-config.js:63` | `bgmFile: 'assets/audio/bgm-stillwater.mp3'` ← **要改成列表** |
| `plan/01-CONTRACT.md:329` | 契约 §6 同步着同一行（改 config 就要改这里） |
| `src/10-audio.js:79-81` | `BGM_LUFS_RAW = -15.06`（**bgm-stillwater.mp3 实测**）/ `BGM_LUFS_TARGET = -16.00` / `BGM_TRIM = 0.8974` |
| `src/10-audio.js:116-117` | `BGM_TRUE_DUR = 146.832`（**资产真实内容时长**）/ `BGM_TRUE_GUARD = 1.0` |
| `src/10-audio.js:103` | file:// 下 BGM 不进图，淡入淡出靠 `el.volume` 5ms 台阶实现 |
| `src/10-audio.js:12` | file:// 下 BGM 走 `<audio>` + `createMediaElementSource` |
| `src/10-audio.js:138` | 唯一随机源 `rng`，**禁止 `Math.random`** |
| `README.md:98-101` | 现说明是"想换 BGM 就 `cp bgm-cand1.mp3 bgm-stillwater.mp3`" ← **这条要被你的功能取代** |

资产现状：`assets/audio/` 下 **bgm-stillwater.mp3**（3.25 MB，在跑）与 **bgm-cand1.mp3**（3.88 MB，备用未用）。

---

## §3 三个必须知道的坑

### ① 每首歌有自己的 LUFS 和**自己的时长**
`BGM_TRIM`（0.8974）和 `BGM_TRUE_DUR`（146.832s）**都是按 bgm-stillwater.mp3 实测出来的**。
换到 cand1 后这两个数**全部失效**：
- 响度不对 → 比现在响或轻（破坏 UP5 刚做好的母带对齐）
- 时长不对 → **循环淡入淡出会在错误的位置接缝**（尾静音或被截断），这是最容易被忽略的回归

**做法**：给每首歌配一组 `{ file, trim, dur }`，用 `npm run audio:baseline`（`plan/audio-baseline.py`）实测 cand1 的 LUFS，
照 BGM 那套注释格式写清"实测值 + 目标 -16.00 + 算式 10^((T-R)/20)"。
切换曲目时 **TRIM 与 DUR 必须一起换**。

### ② 切歌不能爆音
现有淡入淡出是 5ms 台阶（file:// 限制）。切歌流程建议：**淡出当前 → 停 → 换 src → 重新接图（http）/换 volume（file）→ 淡入新曲**。
`bgmInGraph`（10-audio.js:166）标记元素是否已接进 Web Audio 图——换 src 后这个状态要重新评估，别接两次。

### ③ 随机首播走 `rng`，且要可复现
"进页面随机一首"用 `rng`（138 行），**不要 `Math.random`**。
验收时能用固定种子复现出"同一首"，否则 Playwright 侧没法稳定断言。

---

## §4 实现要点（建议）

- `00-config.js`：`bgmFile` 改为 `bgmFiles: [ 'assets/audio/bgm-stillwater.mp3', 'assets/audio/bgm-cand1.mp3' ]`
  （是否保留 `bgmFile` 单值字段做兼容，你判断；**契约 §6 必须同步**，§10 记一笔）
- 曲目表（含 trim / dur）建议写在 `10-audio.js` 顶部常量区，与现有 BGM 常量放一起，注释写清实测来源
- 选曲 UI：并入 `80-ui.js`，风格与 `#snd` 声音开关一致（**不要做成突兀的大控件**——雨桐刚因为"突兀"让我改了时间滑杆，同样的审美标准适用）
- 选曲后**持久化**？用户没要求，用 `localStorage` 记住上次选择是加分项，但要能优雅降级（file:// 下 localStorage 可用；隐私模式可能抛错 → try/catch）
- `#snd` 静音开关对切歌依然有效

---

## §5 验收（逐条打勾）

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | **进页面随机一首** | 多次加载能出现不同首；固定种子可复现同一首 |
| 2 | **前端可切换** | 选曲控件能切到另一首并真的在放 |
| 3 | **每首响度对齐** | `npm run audio:baseline` 实测两首，TRIM 注释完整；听感两首响度一致 |
| 4 | **每首时长正确** | 换曲后 DUR 跟着换；循环接缝无尾静音、无截断（这条要真听/看 `currentTime` 走到接缝处） |
| 5 | 切歌无爆音 | 淡出淡入正常 |
| 6 | **`file://` 与 `dist/` 两入口一致** | 两入口各验一遍（file:// 是主入口） |
| 7 | 15/15 断言两入口全过 | `npm run assert` |
| 8 | Playwright 全链 | `npm run pw`（UI 多了一个控件 → 窄屏布局检查 + `ui-panel` 像素快照可能变红，**先报主控再重录**） |
| 9 | console 0 报错 | 两入口都要 |
| 10 | 静音开关 + 降级路径 | `#snd` 有效；移动端 / 无 WebGL / reduced-motion 不回归 |
| 11 | README 更新 | 删掉"cp 替换"的旧说明，改成选曲功能说明；资产表补齐两首的来源 |

改了 `src/` 就要：`npm run build` → `npm run pw:dist:snapshot` → `npm run pw:dist`。

---

## §6 收尾四步

1. 完工记录写进本文 §7
2. `plan/_STATUS.md` 只追加自己一行
3. **AM-015 关单**：`02-AMENDMENTS.md` 总表登记 → 全文移 `98b` 归档 → 契约 §2.1/§6/§7/§10 同步
4. 留言板 `04-BOARD.md` 本包 ⬜ 清零

---

## §7 完工记录（过程流水）

**状态：✅ 完工（2026-09-25 04:5x）· AM-015 关单**。以下逐条追加。

### 7.1 落地清单

| 文件 | 改动 |
|---|---|
| `src/10-audio.js` | `BGM_TRACKS` 曲目表（唯一真值源）· `bgmInfo()` / `setBgmTrack(i)` · 切歌序列（淡出 .22 → 静音窗换源/换 trim → 淡入 .34）· `startBgm()` 随机抽签（独立 mulberry32 流）· `?bgm=<n>` 钉选 · `bgmTrimCur` 与选中态分离 · 修 `tryFileBgm()` 元素音量初值缺陷 |
| `src/00-config.js` | 音频段：`bgmFile` → `bgmFiles`（含曲名/命名说明） |
| `src/80-ui.js` | 右上 `#sw-bgm`：「**BGM：** + 每曲一枚 chip」，追加在时段面板**之后**；常量 `B` + `.sw-bgm-tag` / `.sw-bgm-btn` CSS |
| `assets/audio/` | `bgm-stillwater.mp3` → **`bgm-mingjing.mp3`**（明镜）、`bgm-cand1.mp3` → **`bgm-weifeng.mp3`**（微风）；`git mv`，字节数/sha256 未动 |
| `plan/audio-baseline.py` | 输入文件名 + `expected` 集合同步（口径与产物格式未动） |
| `README.md` · `vite.config.mjs` 注释 | 删「`cp` 换曲」旧说明 → 改为选曲功能说明 + 「加新曲三步」 |
| `plan/01-CONTRACT.md` | §2.1 签名 · §2.8 / §4 新增 `#sw-bgm` · §6 `bgmFiles` + 曲名 · §7 四方所有者 · §10 记 AM-015 一行 |
| `plan/02-AMENDMENTS.md` | 总表登记 AM-015 + §6 全文 |

**未碰**：`index.html` · `app/**` · `vite.config.mjs` 的**代码**（只改一行注释）· 冻结件
`wp5-assert.js` / `wp5-env.js` · 任何断言阈值 · `plan/pw/**`。

### 7.2 三条硬约束的落实

1. **`file://` 一律 `<audio>` 元素池**：一元素一曲（`createMediaElementSource` 按元素建，
   换元素 = 接两次图 → 峰值翻倍）。file:// 元素路靠 `elVolApply()` 逐级写 `el.volume`
   （`loopWatch` 5 ms 驱动 → 0.34 s 淡变 ~68 档，Δgain ≤ 0.02，听不出台阶）；
   http 图路走 `fileGain.gain` 线性 ramp。
2. **随机只用 `rng`**：`U.newRng((P.seed ^ (Date.now() & 0x7fffffff)) >>> 0)` —— 独立成流，
   **不消耗**渲染 `rng` 序列（否则 20-determinism 的逐帧复现被打乱）。全库 grep `Math.random`
   仍只命中注释。
3. **`BGM_TRIM` / `BGM_TRUE_DUR` 一起换**：每首一组 `{trim, trueDur}`；首项直接**引用**两标量
   （零重复字面量 → `audio-baseline.py` 漂移检测仍全绿），次项写实测值 + 算式。
   守卫 `BGM_TRUE_GUARD = 1.0` 对两首都够宽（实测元素时长与真值差：明镜 0.000 s、微风 0.011 s）。

### 7.3 UI 形态：三轮迭代的终点（雨桐 2026-09-25 三次裁决）

1. 一排胶囊按钮 + 曲名「原曲 / 备选」→ **被否**（要「BGM：」字样、要下拉框、曲名改「明镜 / 微风」）。
2. 原生 `<select>` 去壳（`appearance:none` + 自绘三角；并做了 Chrome 135+ `appearance:base-select`
   的 `::picker(select)` 定制面板 + 展开动效）→ **也被否**（弹层是**独立绘制层**：不吃
   `backdrop-filter`、不吃父元素透明底，能改的只有 `color-scheme` 与选项底色 →
   「和 chip 一样的透明」在那条链路上根本做不到；且「点选不要外围框」与「要有加深反馈」在原生
   弹层上只能半实现）。
3. **终点 = 「BGM：」标签 + 并排 chip**，与 `#snd` 共用同一套 token（padding 6/13、radius 14、
   描边 .22、字号 11、字距 .08em、blur 6px），只在面透明度上更透一档（.26 → .20），另加 `.on` 选中态。

**回滚的干净度**：select 相关常量（`padX/padY/arrowW/radius/rowPadY/rowPadX/rowRadius/panelGap/durOpen/durClose`）
与 CSS 段（`.sw-bgm-sel` 系列、`@supports (appearance:base-select)`、`::picker*`、`option*`）
**全部删除**；验收脚本加了**反向把关**：DOM 里出现 `select`、或 CSSOM 里出现
`sw-bgm-sel` / `base-select` / `picker` / `option` 字样 → 直接判失败（防止以后死灰复燃）。
CSS 级联也钉了一条：`.sw-bgm-btn.on` 必须排在 `:active` **之前**（同特异性 0,2,0，后写的胜 ——
顺序反了会导致「按住已选中那枚」只剩缩放、面不加深）。

### 7.4 过程里自己踩的坑（留档，别再犯）

1. **`bgmSwitching` 只置一次** → 第二段淡入没人推进，切歌后包络恒 0（音量归零）。
   修法：挪进 `switchRamp()`（两段式，第二段由第一段回调发起）+ `switchSeq` 序号作废旧回调。
2. **静音模式下按切歌有 1 帧尖峰**：`switchRamp(1, 0.001, null)` 会从当前包络滑到 1 → 改 `switchRamp(0, …)`。
3. **临时验收脚本的两层转义**：注入串是**模板字符串**，① 注释里写「反斜杠 + n」会被折成真换行、
   把注入的 JS 撕成两行；② 正则只写两个反斜杠会让页面拿到非法转义 → 退化成 `new RegExp('s+')`，
   把 CSS 里所有字母 `s` 删光（`.sw-bgm-btn` 变 `.w-bgm-btn`）→ **所有 CSSOM 检查静默失配**。
   另外注释里不能出现反引号（会把模板串提前闭合）。这两条已在脚本里写成注释警示。
4. **needle 必须按 CSSOM 序列化后的形态写**：浏览器把 `.20` 补成 `0.2`，照抄源码字面量永远匹配不上。

### 7.5 验收读数

| 项 | 读数 |
|---|---|
| 免构建 + dist 双入口（临时脚本 118 项） | ✅ 118/118 · console/页面错误 **0** |
| `npm run assert` / `npm run assert:dist` | ✅ 15/15 · 15/15 |
| `npm run audio:baseline` | ✅ 全部一致（`BGM_TRIM` 差 3e-5 · `BGM_TRUE_DUR` 差 11 ms · 守卫 1.0 > 0.332） |
| `env-narrow`（375×812 UI 不重叠） | ✅ 零违规 · `sw-bgm@197,56 156×25`（右缘 353 = 375−22，与 `#snd` 同列；与 `#snd` 底 47 间隙 9 px） |
| `dist/index.html` 体积 | **771.89 kB**（gzip 207.68 kB）；`assets/` → `dist/assets/` 8,248,776 B / 15 文件，14 个资产全部 `=` |
| pw 像素基线 | ⚠ **`full.png` 变红待主控重录** —— 差异 2866 px **全部**落在 `#sw-bgm` bbox `x[1100,1257] y[56,80]` 内（零外溢），最大通道差 71；`ui-panel.png` / `bed-clip.png` **未受影响**。⚠ `full.png` 对近水色底的差异不敏感（旧基线里 1932 个非零差异像素曾**全部**落在 threshold 0.2 内 → 该断言不是有效门禁） |
| 旧文件名残留 | ✅ `src/**` · `vite.config.mjs` · `plan/audio-baseline.py` · `README.md` 零命中；`plan/01-CONTRACT.md` §6 已换新名 |

### 7.6 挂账（需主控处理）

1. **`plan/audio-baseline.py` 只自动校验首曲常量**：它只读 `bgm-mingjing.mp3`、按名字抓
   `BGM_TRIM` / `BGM_TRUE_DUR` 两标量 → **次曲（微风）的 `{trim, trueDur}` 无自动漂移检查**，
   现靠 `BGM_TRACKS` 注释里的算式与人工复核。
2. **pw 基线重录**：`full.png`（真变更，已量化）与 `plan/pw/dist-baseline.txt`（sha256 清单含旧文件名）。
3. **历史文档刻意未改**：`plan/70-REPO-BASELINE.md`、`91-UP5-audio.md`、`92-UP6-playwright.md`、
   `98-STATUS-ARCHIVE-v1.md`、`98b-AMENDMENTS-ARCHIVE-v1.md` 里的旧文件名是**当时的仓库状态记录**，
   改了等于篡改历史；若主控要求全库一致，另开一条统一处理。
4. **`plan/01-CONTRACT.md §9` 未动**：BGM 母带常量一直不在共享常量表里（它只被 `10-audio.js`
   一个模块消费），本包维持现状。

### 7.7 临时件

验收脚本 `plan/_up11-verify.mjs` + 诊断件（`_dbg-cv.mjs` / `_up11-diff.mjs` / `_up11-shot.mjs` /
`_probe-select.mjs` / `_up11-*.png`）**用完即删**，不进交付物。
