# UP11 —— BGM 选择器（前端选曲 + 进页面随机一首）

> 开工口径：**先读 `90-WAVE5.md`，再读本文**；冲突以 `90-WAVE5.md` 为准。
> 变更单：**AM-012**　·　波次：**6**（UP9 / UP10 收工后才开工）
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
| `src/80-ui.js` | ✅ 所有者（**波次 6 起从 UP10 移交**） | 选曲控件；🔴 前置：UP10 已收工 |
| `plan/01-CONTRACT.md` | §2.1 `SW.audio` + §6 音频参数 + §7 所有权 | 分段改 |
| `plan/02-AMENDMENTS.md` | AM-012 那一行 | 只写自己的 |
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
3. **AM-012 关单**：`02-AMENDMENTS.md` 总表登记 → 全文移 `98b` 归档 → 契约 §2.1/§6/§7/§10 同步
4. 留言板 `04-BOARD.md` 本包 ⬜ 清零

---

## §7 完工记录（过程流水）

_（开工后逐条追加）_
