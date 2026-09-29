// src/10-audio.js —— 所有者：WP4 → UP9（AM-010）→ UP11（AM-015，波次 7 起）
// 签名逐字对齐 01-CONTRACT.md §2.1：{ ready, init, setEnabled, playHand, duck, sfxTick,
//   bgmInfo, setBgmTrack, suspend, resume, probe }
//
// 三总线：bgm（音乐床，被 hand duck） / hand（划水 + 点击） / amb（水拍岸 + 风）
//   source ──┬── bgm  (Gain) ─────────────────┐
//            ├── hand (Gain) → Pan → limAn ───┼──→ limiter ──→ master ──→ destination
//            └── amb  (Gain) ─────────────────┘
//   UP5 / AM-012：hand 总线新增 StereoPanner（声像跟手）+ limiter 输入端体检点 limAn
//   （拍击 + 连续流水 + foley 全部经此进 limiter，故"拍击经过 limiter"可直读证明）。
//   UP9 / AM-010：第四条总线 uiGain（刻度尺咔嗒），与 bgm/hand/amb 并列进 limiter。
//   UP11 / AM-015：BGM 由单曲变**曲目列表** —— 进页面随机一首、运行期可切（`#sw-bgm`）。
//     母带数值（trim / trueDur）按曲目存进 `BGM_TRACKS` 表（唯一真值源，见该表注释）。
//     切歌复用同一个 <audio> 元素、只换 .src —— `createMediaElementSource` 是按元素建的，
//     换元素等于重建 SourceNode，那正是"接两次图 → 峰值翻倍"的来源。
//
// 两条硬约束（踩了就静音或爆音）：
//   ① file:// 下 fetch + decodeAudioData 被 CORS 挡死 → BGM 走 <audio> + createMediaElementSource
//   ② 划水声是「持续噪声源 + 推包络」，不是「每事件新建声源」→ 否则拖动时爆音、CPU 爆
//
// 冻结的渲染循环里没有 SW.audio.update()，所以本文件**不依赖每帧 tick**：
// 所有包络与和声都用 AudioParam 的 ctx-time 调度（setTargetAtTime / linearRamp），
// 只有「下一个和弦 / 下一次水拍岸」这种秒级事件用 setTimeout 预约。
(function (SW, window) {
  'use strict';

  var P = SW.P;                       // SW.P 是同一对象（resetP 原地改），引用长期有效
  var U = SW.util;

  // ------------------------------------------------------------------ 常量
  // §4.2「e *= P.handDecay 每 tick」→ 换算成 AudioParam 的时间常数（帧率按 60）。
  // ⚠ 0.62/帧 = τ≈0.035s：拖动时 splash 每 33ms 来一次，包络来不及保持 → 变成 30Hz 的哒哒声
  //   （雨桐反馈「像在打架子鼓」）。所以给释放时间设 0.14s 下限：拖动成连续 swish，单击才听得见尾巴。
  var HAND_TAU_MIN = 0.14;
  function handTau() {
    var d = clamp(P.handDecay, 0.01, 0.999);
    return Math.max(HAND_TAU_MIN, -(1 / 60) / Math.log(d));
  }
  // ---- 划水：连续「流水」模型（替代旧的「每事件冲一次包络」）----
  // ⚠ 旧模型的问题：splash 每 33ms 一次，每次都 linearRamp 12ms 冲到峰值再衰减 ——
  //   那是一串脉冲，不是水流。听感 = 连续同质爆破（雨桐反馈）。
  //   新模型：事件只负责「更新目标电平 + 刷新最后活动时间」，包络由指数跟随平滑逼近，
  //   停手后保持 FLOW_HOLD 再长淡出 → 淡入 / 拖尾 / 淡出都自然。
  var FLOW_MIN = 0.10;                // 慢划的目标电平
  var FLOW_MAX = 0.60;                // 快划的目标电平（留余量：还有混响湿声叠加）
  var FLOW_UP_TAU = 0.11;             // 淡入时间常数（≈0.33s 到位，起手不突兀）
  var FLOW_DN_TAU = 0.36;             // 淡出时间常数（≈1.1s 收干净 = 鼠标停下后的拖尾）
  var FLOW_HOLD = 0.22;               // 停手后先平一段再淡出（拖尾的「平段」）
  // ⚠ 拖尾的音色：高频「水花」层必须先收，低频「涌动」层留下来 —— 真实的物理顺序是
  //   细碎水花最先落回水面、水体波动持续最久。反过来（两层等速衰减）听感就是「沙沙的风」。
  var TAIL_SPRAY = 0.10;              // 拖尾时水花层压到多少（常态 0.45）
  var TAIL_SPRAY_LFO = 0.06;          // 拖尾时水花层 LFO 深度也要压小（常态 0.22），否则又被抬回来
  var TAIL_BODY = 0.80;               // 拖尾时涌动层反而抬一点（常态 0.55）→ 补量感，靠低频撑住
  var TAIL_BODY_LP = 230;             // 拖尾低通再往下扫（常态 300~720Hz）→ 更闷 = 水波不是风
  var FLOW_TICK = 80;                 // 收尾检查步长（ms，墙钟）——鼠标停下后没有事件，只能靠它淡出
  var FLOW_THROTTLE = 0.04;           // 事件节流（s，ctx 钟）：33ms 一次的下达没必要全排

  var CLICK_GAP = 0.18;               // 距上次 splash 超过这个间隔 → 可能是点击
  var CLICK_MIN_SPEED = 0.85;         // 并且速度要够高。慢拖时位移攒得慢、间隔也会 >0.18s，
                                      // 只靠间隔判会把「慢拖」误判成一串点击 → 鼓点。两条同时满足才算点击。

  // 拍击采样：一次性离散事件，用 <audio> 元素池直放。
  // ⚠ 为什么不用 BufferSource：file:// 下 fetch/XHR/decodeAudioData 全部被拦（实测 FAIL），
  //   采样想出声只能走元素直放 —— 而它正好不需要连续调制，是唯一可行的路。
  // 片段集：由 `plan/audio-slap-cut.py`（入库）从源 mp3 自动挑段 + 加工生成 ——
  //   48000 Hz · 单声道 · PCM_16 · 各 **1.4500 s / 69 600 帧 / 峰值 0.6200**（与历代旧件同规格）。
  //   换源史（AM-034）：① `slap.mp3`（29s 连续戏水，每段 0.55 s；WP4-sfx2）
  //     → ② `lake-water-breaks-on-a-rocky-shore.mp3`（岸浪环境声；落地段 `108 §11.7`，因整体偏轻被换）
  //     → ③ **`small-splashes-of-water.mp3`（现行 · 2026-09-30 定案）**。
  //   出处：① `sounds-mp3` **不可商用**（站方 About 原文「not intended for commercial use」+ 素材
  //     「collected from open sources」⇒ 站方不持版权、无权可授）⇒ 这正是换源的原因；
  //     ②③ 均 = **`sound dino`**（可商用免署名，与 `bird1~6` 同源，`108 §3.3`）。
  //   现行选材 = **定长窗扫描 + 全按能量挑**（`--final --picks A1,A2,A3,A5 --level heavy`）——
  //   「挑一半厚拍」在现行源不成立，改全按能量（`108 §4.2` 订正）。
  var SLAP_FILES = ['assets/audio/slap1.wav', 'assets/audio/slap2.wav',
                    'assets/audio/slap3.wav', 'assets/audio/slap4.wav'];
  var SLAP_DELAY = 4000;              // 延迟建池（ms）：错开 BGM 加载高峰，否则 BGM 播不动
                                      //   ⚠ 采样加了混响尾后从 80KB 涨到 136KB，启动瞬间的解码竞争
                                      //   更明显（实测 BGM 会卡在「paused 但 currentTime=0」）→ 2s 提到 4s
  var SLAP_TRIM = 0.85;               // 整体音量微调（片段已统一到 0.62 峰值，留余量防削波）
  var SLAP_RATE = 0.24;               // playbackRate 抖动 0.88~1.12 → 每次音高略不同，避免"同一个音反复"
  var CHORD_DUR = 16.0;               // 每个和弦时长（s）—— 拉长 = 减少建节点频率（卡顿主因）
  var CHORD_STEP = 11.0;              // 和弦推进步长（< CHORD_DUR → 5s 交叉淡化）
  var PAD_ATTACK = 4.0;
  var PAD_RELEASE = 5.0;

  // ===================== UP9 / AM-010：海鸟环境音 + 咔嗒音效 =====================
  // ---------------------------------------------------------------------------
  // ① 建池时机必须**排在 slap 之后**。SLAP_DELAY 的存在本身就在证明一件事：
  //    启动瞬间同时存在的媒体元素多了（1 BGM + 4 slap），BGM 会卡在「paused=false
  //    但 currentTime 不推进」→ 播不动。所以新增两座池继续往后再错一格：
  //      BGM(0s) → slap(4.0s) → tick(5.2s) → bird(6.5s)
  //    新增 payload：tick 22 KB + bird 371 KB。鸟声这一段是三个**完整长句**（≈2s/段），
  //    雨桐要「更长、更完整、带远处回声」，而这个回声只能**烘进资产**（见下 ②），
  //    所以它就是会比 slap 之外的任何东西都大 —— 仍远小于 BGM 的 3.2 MB。
  //    验收必须复验 **BGM 仍能正常起播**（这是最容易踩的回归，见 94 §4 #3）。
  // ② file:// 下走**元素直放**，与 slap 同款协议分流：`createMediaElementSource` 会被判
  //    跨源污染、输出恒静音（见 tryFileBgm 的实测注释）→ 只在 http(s) 下接 Web Audio 图。
  //    file:// 的代价：元素直放没有 StereoPanner，海鸟的左右声像自动失效（§3.1 已知限制）。
  // ③ 两座池各自链式建造，避免同一 tick 内同时 Decode：这也是 Delay 有 1.3s 落差的原因。
  // ---------------------------------------------------------------------------
  var BIRD_FILES = ['assets/audio/bird1.wav', 'assets/audio/bird2.wav',
                    'assets/audio/bird3.wav', 'assets/audio/bird4.wav',
                    'assets/audio/bird5.wav', 'assets/audio/bird6.wav'];
  var TICK_FILES = ['assets/audio/tick1.wav', 'assets/audio/tick2.wav'];
  var BIRD_DELAY = 6500;              // ms，错峰（在 slap 4000 之后）
  var TICK_DELAY = 5200;              // ms，同上
  // 片断已经按「有声段 RMS = -24.25 dBFS」做过**组内等响配平**（只衰减、不提升 ——
  //   提升会把 crest 大的那片推过 0 dBFS），最大有效波峰统一留在 0.62。
  //   所以运行期只需要一个全局 trim，不必再挂逐片断配平数组（对比 SLAP_LUFS_TRIM）。
  //   BIRD_TRIM 0.32：入 amb 总线的有效波峰 = 0.62 × 0.32 = 0.198
  //     ↳ 对比 lap() 的包络目标 0.30~0.45（同样处在 ambGain 之前）→ 鸟确实在浪之下。
  var BIRD_TRIM = 0.32;
  var TICK_TRIM = 0.70;               // ui 总线内有效波峰 = 0.62 × 0.70 = 0.434（再乘 uiVolume 0.30 → 0.130）
  var BIRD_RATE = 0.16;               // playbackRate 抖动 ±8%（同 SLAP_RATE 的数量级）
  var TICK_RATE = 0.10;               // ±5%
  var TICK_STEP_PITCH = 0.06;         // step(0~1) 对音高的横跨（±3%）
  var TICK_STEP_MIN = 0.45;           // step=0 时的音量下限（占 TICK_TRIM 的比例）
  var BIRD_GAP_MIN = 25;              // s，两次鸣叫的最小间隔（听感上每分钟 1~2 次封顶）
  var BIRD_GAP_MAX = 70;              // s，最大间隔（走 rng，禁 Math.random）
  var BIRD_CALLS_MAX = 3;             // 一次最多叫几声
  var BIRD_CALL_GAP = [0.30, 0.90];   // s，一次鸣叫里声与声之间的间隔
  var BIRD_DIST_MIN = 0.55;           // 每声随机远近（音量系数 0.55~1.0）
  var BIRD_PAN_MAX = 0.70;            // http 下的左右候选（file:// 元素直放无法声像，自动跳过）
  var TICK_THROTTLE = 0.025;          // s，25ms 节流：拖动时会密集触发，防止糊成一片

  // ===================== UP5 / AM-012：母带 trim + 声像 + 循环 =====================
  // 全部数字来自**实测**（无头 Chrome 内 decodeAudioData + ITU-R BS.1770-4 集成响度），
  // 本机无 ffmpeg / Python 音频库，故不重编码资产，一律走**运行期增益**（语义等价、可一行回退）。
  // 明细与原始读数见 plan/91-UP5-audio.md §2。
  var IS_FILE = /^file:/i.test(window.location.href);   // 唯一的环境判定（slap 与 BGM 共用）

  var BGM_LUFS_RAW = -15.06;          // bgm-mingjing.mp3（曲名「明镜」）实测集成响度
  var BGM_LUFS_TARGET = -16.00;       // 母带目标
  var BGM_TRIM = 0.8974;              // 10^((TARGET-RAW)/20) = 10^(-0.94/20) → 命中 -16.00
  // 拍击 4 段：峰值**已经**统一（4 段都 0.62），但集成响度跨 2.33 LU
  //   （-21.06 / -22.27 / -21.90 / -23.39）→ "峰值统一 ≠ 响度统一"，会被听成忽大忽小。
  //   归一到四段均值 -22.16；平均增益 1.0047（≈0 dB，平均电平不变）。
  //   ⚠ 2026-09-30 UP15（AM-034）换源 → 本节数字整体重算。
  //     第二版源 = `small-splashes-of-water.mp3`（雨桐 09-30 给，出处同 `108 §3.3` `sound dino`）；
  //     第一版 = 岸浪环境声（见 `108 §11.7`），因整体偏轻 + 厚重感不足被换掉。
  //   最大有效峰值 = 0.62 × max(SLAP_LUFS_TRIM 1.1530) × SLAP_TRIM(0.85) = 0.6077（-4.3 dBFS）≪ 1.0
  //   ⚠ 两个 trim 是**串联**的（见 playSlap() 内 `trim = SLAP_TRIM * SLAP_LUFS_TRIM[...]`），算峰值时缺一不可 ——
  //     本注释曾写 0.701（漏乘 SLAP_TRIM），2026-09-24 由音频资产基线体检器
  //     （`npm run audio:baseline` · plan/audio-baseline.py）复核查出并更正。
  var SLAP_LUFS_TRIM = [0.8813, 1.0131, 0.9713, 1.1530];
  // 声像：世界 x → pan。PAN_WORLD_REF 取 z≈-6 处的**可见半宽**（≈6.0 世界单位）——
  //   即"点到画面左右边缘附近 ≈ 满偏"，且对 x 严格单调（验收 #4 就钉这个）
  var PAN_WORLD_REF = 6.0;
  var PAN_MAX = 0.85;                 // 不做满偏，留一点居中感
  var PAN_TAU = 0.05;                 // 平滑时间常数（避免抖动手时声像抽动）
  // 循环：实测曲首 0~0.10s 是**数字静音**、0.108s 才有首个有效样本；曲尾一直有声。
  //   el.loop=true 会每 146.8s 塌一次 ~100ms 静音（不是爆音，是"呼吸"）。
  //   修法 = 手动区间。取 0.20s 的依据：曲首 [0.20,0.25]s 电平 ≈-29.8dB，
  //   曲尾 50ms = -29.87dB → **首尾天然对齐**，接缝电平几乎无跳变。
  //   两侧淡入淡出取**等长**（对称包络）→ 接缝前后 50ms 能量天然相等。
  var LOOP_IN = 0.20;                 // s，起播/回卷点（跳过静音与起手瞬态）
  var LOOP_TAIL = 0.03;               // s，提前这么多回卷（避开元素自然结束）
  var LOOP_FADE_OUT = 0.04, LOOP_FADE_IN = 0.04;
  // ⚠ 步长取 **5ms** 而不是 20ms：file:// 下 BGM 元素**不进图**，淡入淡出只能靠 el.volume 台阶实现。
  //   20ms 步长在 40ms 淡变里只有 2 级台阶 → 每级 Δgain=0.5，接缝处会产生 ~-36dBFS 的阶跃
  //   （相对信号本身只低几 dB，是听得见的"咔"）。5ms → 8 级（Δgain=0.125），阶跃降到 ~-48dBFS。
  //   图路径（http）本来就用 AudioParam linearRamp 精确插值，不受此步长影响。
  var LOOP_TICK = 5;                  // ms，看门狗步长（seek 判断 + 增益包络台阶粒度）
  // 🔴 资产的**真实内容时长**（秒）—— 由 decodeAudioData 实测（本资产 146.832s）。
  //   为什么必须有这个常量：元素的 `duration` 是浏览器**按码率估算**的，本资产在 file:// 下报
  //   **147.164s**（多 0.332s），而音频数据只到 146.832s。用 `duration − LOOP_TAIL` 当出点，
  //   每圈尾部就会塌出 ~0.3s 数字静音 —— 与曲首那 100ms 是同一类缺陷（更隐蔽）。
  //   ⚠ 不能靠 `buffered` 末端封顶：file:// 下 buffered 末端**也被报成估算值 147.164**（实测）。
  //     http 下 duration 就是真值（146.832），故这项封顶只对 file:// 生效。
  //   守卫：仅当元素时长与该常量相差 < 1.0s（= 仍是同一份资产）时才采信；
  //     换资产（`npm run audio:baseline` 复核后按上面 ③ 的流程入表）后自动退回估算式，不会静音、只是可能留尾静音。
  var BGM_TRUE_DUR = 146.832;
  var BGM_TRUE_GUARD = 1.0;
  // foley 分层（AM-012 §3.2 第 8 条）：采样自带 impact（瞬态）+ body（低频），
  //   **缺的是随力度变亮的水花** → 只补 spray 这一层，避免叠加糊掉采样本体
  var FOLEY_SPRAY = 0.10;

  // ===================== UP11 / AM-015：BGM 曲目表（唯一真值源）=====================
  // ① 为什么必须「每首一组 {trim, trueDur}」而不是两个全局常量：
  //    BGM_TRIM 与 BGM_TRUE_DUR 都是**按当前那首实测**出来的，换曲后**两个一起失效** ——
  //      · trim 错     → 响度不再命中 -16.00 LUFS，把 UP5 刚做好的母带对齐破坏掉
  //      · trueDur 错  → `loopOut()` 的出点落在错误位置 → 每圈接缝塌出 ~0.3 s 尾静音
  //                      （或被截断）。这是全包最隐蔽的回归（96 §3 ①），
  //                      所以两者**绑死在同一个对象里**，物理上无法只换一个。
  // ② 本表是唯一真值源：`P.bgmFiles` 只给文件名，母带数值一律回这里查。
  //    `BGM_TRIM` / `BGM_TRUE_DUR` 两个标量**保留不动**，第一项直接引用它们 ——
  //    `plan/audio-baseline.py` 的漂移检测正是按这两个名字抓的（自洽 + 与资产一致），
  //    这样改完那份体检仍然全绿，且全程零重复字面量。
  // ③ 新曲入库流程：`npm run audio:baseline` → 读该曲那一行的「时长 / 响度」两列
  //    → trim = 10^((BGM_LUFS_TARGET − 响度)/20) → 在这里加一项（算式写进注释）。
  // ④ `label` 纯粹是选曲控件里的显示名（`80-ui.js` 的 `#sw-bgm`），随便改。
  //    两首的取名由雨桐定（2026-09-25）：**明镜** = 原曲 · **微风** = 另一首候选。
  // ⑤ 文件名同样由雨桐定（2026-09-25 改名）：`bgm-stillwater.mp3` → **bgm-mingjing.mp3**、
  //    `bgm-cand1.mp3` → **bgm-weifeng.mp3** —— 拼音与曲名一一对应，**文件名不再描述来源**
  //    （"stillwater / cand1" 是生成期的临时名，留在库里会让人以为还有候选没接进来）。
  //    🔴 改名会连带动 4 处：本表 `file` · `SW.P.bgmFiles`（00-config.js）·
  //       `plan/audio-baseline.py` 的输入与 expected 集合 · `plan/pw/dist-baseline.txt`
  //       的 sha256 清单（那是 **pw 基线**，由主控重录，本包只报读数）。
  var BGM_TRACKS = [
    {
      file: 'assets/audio/bgm-mingjing.mp3',
      label: '明镜',
      lufsRaw: BGM_LUFS_RAW,          // -15.06（Chrome 内实测；audio-baseline.py 读 -15.10，差 0.04 LU）
      trim: BGM_TRIM,                 // 0.8974 = 10^(-0.94/20)
      trueDur: BGM_TRUE_DUR           // 146.832 s（decodeAudioData 实测的内容时长）
    },
    {
      file: 'assets/audio/bgm-weifeng.mp3',
      label: '微风',
      // 实测（`npm run audio:baseline` · plan/audio-baseline.py，libsndfile 解码）：
      //   172.813 s · 采样峰值 -1.16 dBFS · 真峰值 -1.15 dBTP · 集成响度 -15.40 LUFS
      //   trim = 10^((TARGET-RAW)/20) = 10^((-16.00 - (-15.40))/20) = 10^(-0.03) = 0.9333
      //   母带后真峰值（元素路 = 最坏情形）= 10^(-1.15/20) × 0.9333 = 0.8177 = -1.75 dBTP
      //     → ✅ 仍在 EBU R128 的「交付端 ≤ -1 dBTP」以内（原曲那条是 -1.37 dBTP）
      lufsRaw: -15.40,
      trim: 0.9333,
      trueDur: 172.813
    }
  ];

  // ?bgm=<n>（下标从 0 起）—— **钉死首播曲目**，验收/断言专用。
  //   为什么需要它：需求本身就是「每次进页面随机一首」= 故意不可复现；
  //   而验收又要能稳定复现"放的是哪一首"（例如单独验 cand1 的 trim / trueDur 路径）
  //   → 给一条钉死的路。非法/越界值 → -1（回到随机）。
  //   与 `?debug=1` 同款解析方式，但**不进 SW.P**：它不是运行期参数，是启动开关。
  var BGM_PIN = (function () {
    var m = /[?&]bgm=(\d+)(?:&|$)/.exec(window.location.search);
    if (!m) { return -1; }
    var n = parseInt(m[1], 10);
    return (isFinite(n) && n >= 0) ? n : -1;
  })();

  // 切歌淡变时长（AM-015）。切歌必须「淡出 → 停 → 换 src → 淡入」，
  //   否则 src 切换那一瞬间元素从旧内容跳到新内容 = 爆音（96 §3 ②）。
  //   淡出比淡入快：切歌的反馈要即时；淡入慢一点，让新曲"浮"进来。
  var SWITCH_OUT = 0.22;              // s
  var SWITCH_IN = 0.34;               // s

  // A 大调四和弦循环 —— 慢、暖、无张力。频率是十二平均律 A4=440。
  var CHORDS = [
    [110.00, 164.81, 277.18, 415.30, 493.88],  // Amaj9
    [92.50, 138.59, 220.00, 329.63, 415.30],   // F#m9
    [73.42, 110.00, 185.00, 277.18, 369.99],   // Dmaj7
    [82.41, 123.47, 164.81, 207.65, 277.18]    // E6/9
  ];

  // ------------------------------------------------------------------ 状态
  var ctx = null, inited = false, enabled = true, failed = false;
  var master, limiter, bgmGain, handGain, ambGain, bgmSrc, fileGain;
  var handEnv, handFilter;             // 划水链（持续源）
  var ambBedGain = null;               // 风的连续床
  var wet = null, conv = null;         // 混响
  var anBgm = null, anHand = null;     // 体检用 analyser（串在链路内）
  var noiseBuf = null, pinkBuf = null;
  var rng = null;                      // 唯一随机源（禁止 Math.random）
  var lastSplashT = -1;                // ctx 时间
  var lastDuckT = -1;                  // duck 节流用
  var duckTimer = 0;                   // file:// 下元素直放时的 duck 回升定时器
  var clickCount = 0;                  // 点击声触发次数（断言用：慢拖不该涨）
  var lastBubbleHz = 0;                // 上次拍击的主气泡频率（断言用：拍得重 → 气泡大 → 频率低）
  var slapPool = [], slapIdx = 0, slapReady = false, slapCount = 0;
  var lastHandPeak = 0, lastPeakT = 0;
  // 流水模型状态
  var flowTarget = 0, flowCur = -1, lastMoveT = -1, lastFlowCmdT = -1, flowTimer = 0, lastRoundT = -1;
  var tailing = false;                     // 是否在拖尾中（拖尾音色与常态不同，起手时要恢复）
  var handBody = null, handSpray = null;   // 两层噪声源（低频涌动 + 中高频水花）
  var handBodyLP = null, handBodyGain = null, handSprayGain = null;
  var handLfos = null, handConv = null, handWet = null;
  var flowSeed = 0;                        // 本轮拖动的随机指纹（断言用：多样性）
  var chordIdx = 0, chordTimer = 0, bellTimer = 0, lapTimer = 0;
  var bgmEl = null, bgmMode = 'none';  // 'file' | 'synth' | 'none'
  var bgmReason = '';                  // 回退原因（诊断：file:// 下区分污染 / 加载失败 / 自动播放被拒）
  var duckUntil = 0;
  // ---- UP5 / AM-012 状态 ----
  var handPan = null;                  // 手总线声像（handGain → handPan → limAn → limiter）
  var limAn = null;                    // limiter 输入端体检点（验收 #2：拍击真的进了 limiter）
  var slapGains = [];                  // 每片段的 gain 节点；null = 该片段走元素直放
  var slapSum = null, slapAn = null;   // 拍击求和点 + 体检点（只在非 file:// 建）
  var slapMode = 'none';               // 'graph'（过 limiter）| 'element'（file:// 直放）
  // AM-034 第三段（UP15 · 2026-09-30）：手总线内部**两层各自的电平**增益（治「沙沙盖过 slap」）。
  //   flowGain = 流水层总增益（干路 anHand 后 + 湿路 handWet 后）· slapGain = 拍击层总增益（slapAn 后）。
  //   ⚠ `slapGain`（**单数**，本段新增的层总线）与既有的 `slapGains[]`（**复数**，逐元素的 gain）
  //     **不是同一个东西** —— 后者是 file:// 元素路建图失败时的退回路径，与本段无关。
  //   ⚠ 两个都插在体检点**之后** ⇒ `anHand` / `slapAn` 仍读**原始未缩放**电平 ⇒ `probe()` 语义逐字不变。
  var flowGain = null, slapGain = null;
  var curPan = 0;                      // 最近一次下达的声像值（probe 用）
  var lastSplashX = 0;
  var bgmFade = 1, bgmElDuck = 1;      // 循环淡入淡出系数 / duck 在元素路径上的系数
  // ---- UP9 / AM-010 状态 ----
  // 两座新池的状态收到一个对象里（bird / tick 共用同一套构造函数），避免状态变量平铺扩张。
  //   元素池的核心语义与 slapPool 完全一致：files[i] ↔ pool[i] 一对一，轮询使用，
  //   优先挑空闲元素（理由见 playSlap 的注释：采样带尾巴，硬切会突兀）。
  var birdPool = null;                 // → { el[], gains[], mode, sum, an, ready, idx, count }
  var tickPool = null;
  var birdPan = null;                  // http 下唯一的海鸟声像节点（file:// 下为 null）
  var uiGain = null;                   // UI 音效总线（咔嗒）→ limiter；与 bgm/hand/amb 并列
  var birdTimer = 0, lastTickT = -1;
  var bgmInGraph = false;              // BGM 元素是否已接进 Web Audio 图（http 才可能）
  var loopWraps = 0, loopWatch = 0;    // 回卷次数 / 看门狗句柄
  var lastFoley = { hz: 0, level: 0 }; // 最近一次 foley spray 的读数
  // ---- UP11 / AM-015 状态 ----
  var bgmTrack = null;                 // **选中**的曲目（BGM_TRACKS 里的那一项）；null = 还没定
  var bgmTrackIdx = -1;                // 选中下标；-1 = 音频还没启动 / 还没抽签
  var bgmTrimCur = BGM_TRIM;           // **正在响**的那一首的母带 trim。切歌时只在静音窗口里换
                                       //   （bgmTrack 立刻改 → UI/probe 即时一致；trim 晚 0.22s 跟，
                                       //    避免淡出过程中插进一个 0.34 dB 的电平台阶）
  var bgmPrePicked = false;            // 音频启动**之前**用户就点了选曲 → startBgm 尊重该选择、不再随机
  var bgmSwitching = false;            // 切歌进行中（loopTick 让位，只推切歌包络）
  var bgmSwitchFade = 1;               // 切歌包络：元素路（file://）的乘子，见 elVolApply()
  var bgmSwitchFrom = 1, bgmSwitchTo = 1, bgmSwitchDur = 0, bgmSwitchT0 = 0;
  var bgmSwitchDone = null;            // 本段淡变结束时回调
  var switchSeq = 0;                   // 切歌序号：迟到的回调（旧次）靠它作废

  function now() { return ctx ? ctx.currentTime : 0; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // AM-034 第三段：取 `SW.P` 上的数值字段，非有限值（字段缺失 / 被写坏）退回 dflt。
  //   ⚠ 不能直接 `gain.value = P.flowVolume`：字段缺失 ⇒ undefined ⇒ AudioParam 变 NaN ⇒ 整条链静音。
  function pnum(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }

  // 墙钟（ms）。⚠ 切歌包络**不能**用 ctx.currentTime 做时基：无头 Chrome（SwiftShader）下
  //   音频渲染线程会被主线程饿住 —— `ctx.state === 'running'` 但 currentTime 在起播后 ~1.1s 内
  //   仍是 0（AM-012 ⑩ 的实测）→ 用它计时，包络会永远停在起点、切歌卡在半途。
  function wall() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  // ---------------------------------------------- UP11 / AM-015：曲目解析
  // 按文件名回 BGM_TRACKS 查母带数值；表里没有 → 「未知资产」降级（见 BGM_TRACKS 注释 ②）：
  //   trim 退回 BGM_TRIM、trueDur = 0（= 不做真实时长封顶，退回元素估算式 —— 语义与
  //   AM-012 注释里「换资产后自动退回估算式，不会静音、只是可能留尾静音」完全一致）。
  function trackOf(file) {
    for (var i = 0; i < BGM_TRACKS.length; i++) {
      if (BGM_TRACKS[i].file === file) { return BGM_TRACKS[i]; }
    }
    if (!file) { return null; }
    return {
      file: file,
      label: String(file).split('/').pop().replace(/\.[a-z0-9]+$/i, ''),
      lufsRaw: 0, trim: BGM_TRIM, trueDur: 0
    };
  }

  // 生效曲目表 = `P.bgmFiles` 的顺序与集合 + `BGM_TRACKS` 的数值。
  // 兜底到第一首：「没歌放」是比「放错歌」更差的失败模式，config 被清空也要能开机。
  function trackList() {
    var out = [], f = P.bgmFiles;
    if (f && f.length) {
      for (var i = 0; i < f.length; i++) {
        var t = trackOf(f[i]);
        if (t) { out.push(t); }
      }
    }
    return out.length ? out : [BGM_TRACKS[0]];
  }

  // 母带 trim —— 口径是「**正在响**的那一首」，所以切歌时它在静音窗口里才换（见 bgmTrimCur）。
  function bgmActiveTrim() { return bgmTrimCur; }
  function applyTrackTrim() {
    bgmTrimCur = bgmTrack ? bgmTrack.trim : BGM_TRIM;
    if (bgmSrc) { bgmSrc.gain.value = bgmTrimCur; }
  }

  // 「**选中**曲目」的表值 —— 与上面「**正在响**曲目」的口径成对。
  //   UP11：`bgmTrackIdx`（选中下标）在 `setBgmTrack()` 里**立刻**改，而 `bgmTrack`（含 trim /
  //   trueDur / label）要等 0.22s 的静音窗口才换 —— 所以这两个数在切歌途中**必然不等**，
  //   差着就是"切歌正在路上"。probe 把两个都暴露出来，验收可以直接读这条等式。
  function selectedTrim() {
    var l = trackList();
    return (bgmTrackIdx >= 0 && bgmTrackIdx < l.length) ? +l[bgmTrackIdx].trim : 0;
  }

  // --------------------------------------------------- 缓冲：白噪声 / 粉噪声
  function makeNoise(seconds, pink) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    if (!pink) {
      for (var i = 0; i < len; i++) { d[i] = rng() * 2 - 1; }
    } else {
      // Paul Kellet 粉噪声近似（-3dB/oct）
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var j = 0; j < len; j++) {
        var w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[j] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------- 混响脉冲响应
  function makeIR(seconds, decay, mono) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(mono ? 1 : 2, len, rate);
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (rng() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function src(buf, rate) {
    var s = ctx.createBufferSource();
    s.buffer = buf;
    if (rate) { s.playbackRate.value = rate; }
    return s;
  }

  // 取当前时域峰值（0~1）。只在 probe() 里调用，开销可忽略。
  var peakBuf = null;
  function peakOf(an) {
    if (!an) { return 0; }
    if (!peakBuf || peakBuf.length !== an.fftSize) { peakBuf = new Float32Array(an.fftSize); }
    an.getFloatTimeDomainData(peakBuf);
    var p = 0;
    for (var i = 0; i < peakBuf.length; i++) { var a = Math.abs(peakBuf[i]); if (a > p) { p = a; } }
    return p;
  }

  function panner(v) {
    if (ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = v; return p; }
    return null;   // 老 Safari：直接跳过声像
  }

  function chain() {  // 把一组节点串起来，自动跳过 null（声像缺失时）
    var a = Array.prototype.slice.call(arguments);
    var prev = null;
    for (var i = 0; i < a.length; i++) {
      if (!a[i]) { continue; }
      if (prev) { prev.connect(a[i]); }
      prev = a[i];
    }
    return prev;
  }

  // ------------------------------------------------------------------ 建图
  function build() {
    rng = U.newRng((P.seed ^ 0xA11D10) >>> 0);

    noiseBuf = makeNoise(2.0, false);
    pinkBuf = makeNoise(4.0, true);

    // 总限幅 + 总音量（各总线先各自 trim，再总限幅 —— 避免叠乘削波）
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    limiter.connect(master);
    master.connect(ctx.destination);

    bgmGain = ctx.createGain(); bgmGain.gain.value = P.bgmVolume;
    handGain = ctx.createGain(); handGain.gain.value = P.handVolume;
    ambGain = ctx.createGain(); ambGain.gain.value = P.ambVolume;
    // UP5 / AM-012 ①：手总线加声像节点 —— 拍击与连续流水的左右位置都跟手（x）走。
    //   handPan 缺失（老 Safari 无 createStereoPanner）时 chain() 自动退回 handGain → limiter。
    handPan = panner(0); curPan = 0;
    // UP5 / AM-012 ⑨：limiter **输入端**体检点。手总线的全部声音（采样拍击 + 合成兜底 + 连续
    //   流水 + foley spray）都从这里进 limiter，所以「拍击经过 limiter」不需要靠拓扑推断，
    //   可以直接读这条链路上的实测峰值来证明（验收 #2）。analyser 是直通节点，不影响信号。
    limAn = ctx.createAnalyser(); limAn.fftSize = 1024;
    chain(handGain, handPan, limAn, limiter);
    // UP9 / AM-010：UI 音效总线（咔嗒等界面反馈）—— 与 bgm / hand / amb **并列**进 limiter。
    //   ⚠ 为什么不挂 hand 总线：hand 上有 `handPan`（声像跟手），而刻度尺在画面底部，
    //     拖动刻度尺时并不会产生 splash → 声像会停留在上一次划水的位置（可能满偏），
    //     一声清脆的咔嗒从左声道出来很怪。为什么不挂 amb：amb 是自然层，UI 反馈不属于它。
    uiGain = ctx.createGain(); uiGain.gain.value = P.uiVolume;
    uiGain.connect(limiter);

    bgmGain.connect(limiter); ambGain.connect(limiter);

    // ⚠ 体检点：analyser 串在链路里（不是旁挂 —— 不接到 destination 的节点不会被处理）
    anBgm = ctx.createAnalyser(); anBgm.fftSize = 1024;
    // UP5 / AM-012 ③：BGM 母带 trim 落在这条**总线求和点**上 ——
    //   它同时覆盖文件 BGM（fileGain 进这里）与合成兜底（pad→bgmSrc、湿声→bgmSrc），
    //   语义是"母带增益"，与用户音量 bgmGain(P.bgmVolume) 正交，故不改 bgmGain（契约 §5 读数不变）。
    //   UP11 / AM-015：这里的初值仍是 BGM_TRIM（= 曲目表第 1 首的 trim）；抽签定下曲目后
    //     `startBgm()` 会调 `applyTrackTrim()` 把它改成**生效曲目**的 trim，切歌时再改一次。
    //     副作用（刻意接受）：合成兜底路径（pad → bgmSrc）也被同一个 trim 缩放 —— 改前亦然。
    //     两首的 trim 只差 0.34 dB（0.8974 vs 0.9333），且合成兜底只在文件资产彻底不可用时才响。
    bgmSrc = ctx.createGain(); bgmSrc.gain.value = BGM_TRIM;
    bgmSrc.connect(anBgm); anBgm.connect(bgmGain);

    // 混响（只有 pad 与铃音走湿声，划水保持干声 → 听觉上和音乐分离）
    conv = ctx.createConvolver();
    conv.buffer = makeIR(2.0, 2.6);   // IR 越短越省 CPU；2s 对慢速 pad 已足够
    wet = ctx.createGain(); wet.gain.value = 0.85;
    conv.connect(wet); wet.connect(bgmSrc);

    buildHand();
    buildAmb();
    // 划水拖尾的收尾定时器：鼠标停下后不会再有事件，只能靠它把电平淡到 0
    if (!flowTimer) { flowTimer = window.setInterval(flowTick, FLOW_TICK); }
    // UP5 / AM-012 ④：循环接缝看门狗（曲面首的数字静音）。只做 seek + 20ms 级增益包络。
    if (!loopWatch) { loopWatch = window.setInterval(loopTick, LOOP_TICK); }
    // ⚠ 采样池延迟建：实测启动瞬间同时存在 5 个媒体元素（1 BGM + 4 采样）时，
    //   BGM 会卡在「paused=false 但 currentTime 不推进」——播不动。错峰 2s 就好了。
    window.setTimeout(buildSlap, SLAP_DELAY);
    // UP9 / AM-010：两座新池继续往后错（理由见 BIRD_DELAY / TICK_DELAY 上的注释）。
  //   ⚠ 顺序必须是 tick → bird：第一次拖刻度尺时若 tick 池还没到点，`sfxTick()` 会像
  //     `playSlap()` 那样先手动建一遍 —— 那时 BGM 早已就位，竞争风险小得多。
    window.setTimeout(buildTick, TICK_DELAY);
    window.setTimeout(buildBirds, BIRD_DELAY);
  }

  // UP9 / AM-010：通用元素池建造（bird / tick 共用）。
  //   与 buildSlap 同款协议分流：
  //     http(s)  → 元素 → MediaElementSource → gain[i] → sum → (analyser) → out   （过图，可调电平/声像）
  //     file://  → 元素直放，电平走 el.volume（file:// 下 createMediaElementSource 恒静音）
  //   `out` 为 null（或 file://）时不接图，一律元素直放。
  function buildPool(store, files, out, withAn) {
    if (store && store.el && store.el.length) { return store; }   // 幂等
    var S = { el: [], gains: [], mode: 'element', sum: null, an: null, ready: false, idx: 0, count: 0 };
    if (!IS_FILE && ctx && out) {
      S.sum = ctx.createGain(); S.sum.gain.value = 1;
      if (withAn) { S.an = ctx.createAnalyser(); S.an.fftSize = 1024; S.sum.connect(S.an); }
      (S.an || S.sum).connect(out);
      S.mode = 'graph';
    }
    for (var i = 0; i < files.length; i++) {
      var el;
      try { el = new window.Audio(); } catch (e) { break; }
      el.src = files[i];
      el.preload = 'auto';
      el.volume = S.sum ? 1 : 0;       // graph 路电平交给 Web Audio；元素路起手静音（同 buildSlap）
      el.addEventListener('canplay', function () { S.ready = true; });
      S.el.push(el);
      var g = null;
      if (S.sum) {
        try {
          var node = ctx.createMediaElementSource(el);
          g = ctx.createGain(); g.gain.value = 0;
          node.connect(g); g.connect(S.sum);
        } catch (e2) { g = null; }     // 单个元素建图失败 → 它退回元素直放，其余不受影响
      }
      S.gains.push(g);
    }
    if (S.sum && !S.gains.some(function (v) { return !!v; })) {
      S.mode = 'element';              // 全部接图失败 → 整体退回元素直放
    }
    return S;
  }

  // 从池里挑一个元素：优先「空闲」，退而求其次挑「已加载」。返回 -1 = 一个都还没加载好。
  function pickIdle(S) {
    var pool = S.el, n = pool.length, pick = -1, pickIdle = -1;
    for (var k = 0; k < n; k++) {
      var i = (S.idx + k) % n;
      if (pool[i].readyState < 2) { continue; }
      if (pick < 0) { pick = i; }
      if (pool[i].paused || pool[i].ended) { pickIdle = i; break; }
    }
    var use = pickIdle >= 0 ? pickIdle : pick;
    if (use < 0) { return -1; }
    S.idx = use + 1;
    return use;
  }

  // 统一播一次：返回 false = 没播成（调用方自行决定是否兜底 / 静默）
  function poolPlay(S, rate, amp, busVol) {
    var use = pickIdle(S);
    if (use < 0) { return false; }
    var el = S.el[use];
    try {
      el.pause();
      el.currentTime = 0;
      el.playbackRate = rate;
      var g = S.gains[use];
      if (g) {
        el.volume = 1;                // graph 路：电平全交给 Web Audio，避免双重衰减
        var t = now();
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(clamp(amp, 0, 1), t);
      } else {
        el.volume = clamp(busVol * amp, 0, 1);   // file://：元素直放，自己乘总线音量
      }
      var pr = el.play();
      if (pr && pr['catch']) { pr['catch'](function () { }); }
      S.count++;
      return true;
    } catch (e) { return false; }
  }

  // ---- 咔嗒：UP10 时间刻度尺消费的接口（签名由 90-WAVE5 §5 冻结）----
  function buildTick() {
    tickPool = buildPool(tickPool, P.tickFiles || TICK_FILES, uiGain, true);
  }

  // ---- 海鸟：amb 层的偶发点缀 ----
  function buildBirds() {
    if (birdPool && birdPool.el.length) { birdSchedule(); return; }   // 幂等
    // 声像节点只在 graph 路才有意义（file:// 元素直放没有任何东西进图，panner 无源可处理）。
    //   插在 sum(→an) 与 ambGain 之间：整群鸟共享一个 panner，每次鸣叫前随机改一次。
    birdPan = (!IS_FILE && ctx) ? panner(0) : null;
    if (birdPan) { birdPan.connect(ambGain); }
    birdPool = buildPool(birdPool, P.birdFiles || BIRD_FILES, birdPan || ambGain, true);
    birdSchedule();
  }

  // 排下一次鸣叫。间隔走 `rng` —— 与本项目其它随机需求共用**同一个**随机源（禁 Math.random）。
  function birdSchedule() {
    if (birdTimer) { window.clearTimeout(birdTimer); birdTimer = 0; }
    if (!rng) { return; }
    // 间隔的两个端点都取自 P（控制台改了之后**下一次排期**立即生效 —— 这是验收 #1
    //   「临时把间隔调短」能操作的入口）。缺省值才回落到常量，防止 P 被清空后
    //   setTimeout 收到 NaN 变成「每帧触发」，那会把环境音毁掉。
    var gMin = typeof P.birdGapMin === 'number' ? P.birdGapMin : BIRD_GAP_MIN;
    var gMax = typeof P.birdGapMax === 'number' ? P.birdGapMax : BIRD_GAP_MAX;
    if (!(gMax > gMin)) { gMax = gMin; }
    var wait = (gMin + rng() * (gMax - gMin)) * 1000;
    birdTimer = window.setTimeout(birdBurst, wait);
  }

  function birdBurst() {
    birdSchedule();                   // 先把下一次排上 —— 本轮里任何 return 都不会让排放断链
    if (!ctx || !enabled || !P.birds || !rng) { return; }
    if (ctx.state !== 'running' || !birdPool || !birdPool.el.length) { return; }
    var n = 1 + Math.floor(rng() * BIRD_CALLS_MAX);
    for (var i = 0; i < n; i++) {
      var d = i ? (BIRD_CALL_GAP[0] + rng() * (BIRD_CALL_GAP[1] - BIRD_CALL_GAP[0])) : 0;
      window.setTimeout(birdCall, d * 1000);
    }
  }

  function birdCall() {
    if (!ctx || !enabled || !P.birds || !rng || !birdPool) { return false; }
    buildBirds();                     // 没到延迟时间就被触发 → 立即建（同 playSlap 的兜底）
    if (!birdPool.el.length) { return false; }
    var amp = BIRD_TRIM * (BIRD_DIST_MIN + rng() * (1 - BIRD_DIST_MIN));
    if (birdPan) {
      try { birdPan.pan.setTargetAtTime((rng() * 2 - 1) * BIRD_PAN_MAX, now(), 0.05); } catch (e) { }
    }
    return poolPlay(birdPool, 1 - BIRD_RATE / 2 + rng() * BIRD_RATE, amp, P.ambVolume);
  }

  // 咔嗒：拖时间刻度尺时密集触发，所以**必须**短、干、轻 + 自带节流（见 sfxTick）。
  //   step ∈ [0,1]（默认 0.5）：越大 → 音高略高（±3%）、音量略大（0.45~1.0 倍 TICK_TRIM）。
  function playTick(step) {
    if (!ctx || !enabled || !rng) { return false; }
    buildTick();                      // 还没到延迟时间就被拖了 → 立即建（同 playSlap 的兜底）
    if (!tickPool || !tickPool.el.length) { return false; }
    var s = clamp(step, 0, 1);
    var rate = 1 - TICK_RATE / 2 + rng() * TICK_RATE + (s - 0.5) * TICK_STEP_PITCH;
    var amp = TICK_TRIM * (TICK_STEP_MIN + (1 - TICK_STEP_MIN) * s);
    return poolPlay(tickPool, rate, amp, P.uiVolume);
  }

  // 拍击采样池：每个片段一个元素，轮流用。任一元素 canplay 即置 slapReady。
  //
  // 🔴 UP5 / AM-012 ②：本文件**唯一**按协议分流的地方 —— 这是原来那处"真欠账"：
  //   · http(s)：接进 Web Audio 图 → source → slapGain[i] → slapSum → slapAn → handGain
  //     ⇒ **过 limiter**（handGain → handPan → limiter）、**有声像**。电平全交给 Web Audio，
  //       元素自身 volume 固定 1（否则可能与 slapGain 双重衰减）。
  //   · file://：**原样保留元素直放**。file:// 下 createMediaElementSource 会被判跨源污染、
  //       输出恒静音（WP4 实测过）→ 接图 = 把免构建入口弄哑。电平仍走 el.volume。
  function buildSlap() {
    if (slapPool.length) { return; }
    var files = P.slapFiles || SLAP_FILES;
    if (!IS_FILE && ctx) {
      slapSum = ctx.createGain(); slapSum.gain.value = 1;
      slapAn = ctx.createAnalyser(); slapAn.fftSize = 1024;
      // AM-034 第三段：拍击层总增益（`slapAn` 之后 ⇒ 体检点仍读原始电平，`probe()` 语义不变）
      slapGain = ctx.createGain(); slapGain.gain.value = pnum(P.slapVolume, 1);
      slapSum.connect(slapAn); slapAn.connect(slapGain); slapGain.connect(handGain);
    }
    for (var i = 0; i < files.length; i++) {
      var el;
      try { el = new window.Audio(); } catch (e) { return; }
      el.src = files[i];
      el.preload = 'auto';
      el.volume = slapSum ? 1 : 0;      // graph 路电平交给 Web Audio；元素路起手静音（与改前一致）
      el.addEventListener('canplay', function () { slapReady = true; });
      slapPool.push(el);
      var g = null;
      if (slapSum) {
        try {
          var node = ctx.createMediaElementSource(el);
          g = ctx.createGain(); g.gain.value = 0;
          node.connect(g); g.connect(slapSum);
        } catch (e2) { g = null; }       // 单个元素建图失败 → 它退回元素直放，其余不受影响
      }
      slapGains.push(g);
    }
    slapMode = slapSum ? 'graph' : 'element';
  }

  // UP5 / AM-012 ⑤：foley 分层补片。采样自带 impact（瞬态）与 body（低频厚重），
  //   缺的是**随力度变亮的细碎水花**；只补 spray 这一层，避免叠加把本体糊掉。
  //   带通中心频率随力度上移（1800 → 4200 Hz）→ 划得越猛越"碎"，这是采样路原来没有的速度耦合。
  function foleySpray(lv, idx) {
    if (!ctx || !enabled || !handGain) { return; }
    var t = now() + 0.004;
    var hard = clamp(lv / 1.5, 0, 1);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + 2400 * hard;
    bp.Q.value = 0.7;
    var g = ctx.createGain();
    var amp = clamp(lv * FOLEY_SPRAY, 0, 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(amp, 0.0002), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    var s = src(noiseBuf);
    s.connect(bp); bp.connect(g); g.connect(handGain);
    s.start(t, rng() * 1.5, 0.12);
    s.stop(t + 0.12);
    lastFoley = { hz: Math.round(bp.frequency.value), level: +amp.toFixed(4) };
  }

  // UP5 / AM-012 ②：声像跟手。世界 x → pan。非有限值回中（不把 NaN 灌进 AudioParam）。
  function panTo(x) {
    if (!handPan) { return; }
    if (typeof x !== 'number' || !isFinite(x)) { x = 0; }
    lastSplashX = x;
    var v = clamp(x / PAN_WORLD_REF, -1, 1) * PAN_MAX;
    curPan = v;
    handPan.pan.setTargetAtTime(v, now(), PAN_TAU);
  }

  // 播一次采样。返回 false 表示没播成（调用方要退回气泡模型 —— 保证点击永远有声）
  function playSlap(lv, x) {
    buildSlap();                       // 还没到延迟时间就被点了 → 立即建
    syncVolumes();                     // AM-034 第三段：拍击当次生效
    if (!slapPool.length) { return false; }
    panTo(x);
    // 从上次位置往后找：① 优先「空闲」元素 —— 采样现在带 0.6s 混响尾，
    //   重用正在播的元素会把尾巴硬切掉（正是「结束太突兀」的来源）；② 退而求其次挑已加载的
    var pick = -1, pickIdle = -1;
    for (var k = 0; k < slapPool.length; k++) {
      var i = (slapIdx + k) % slapPool.length;
      if (slapPool[i].readyState < 2) { continue; }
      if (pick < 0) { pick = i; }
      if (slapPool[i].paused || slapPool[i].ended) { pickIdle = i; break; }
    }
    if (pickIdle < 0 && pick < 0) { return false; }   // 全都还没加载好 → 这次让合成兜底，保证点击有声
    var use = pickIdle >= 0 ? pickIdle : pick;        // 全忙时才复用（宁可截断也不能没声）
    slapIdx = use + 1;
    var el = slapPool[use];
    try {
      el.pause();
      el.currentTime = 0;
      el.playbackRate = 1 - SLAP_RATE / 2 + rng() * SLAP_RATE;   // 0.88~1.12 变调
      // 音量：片段已统一峰值，这里只留很窄的力度响应（0.85~1.0），避免"忽大忽小"。
      // UP5 / AM-012 ③：再乘本片段自己的响度配平（4 段峰值同为 0.62 但集成响度跨 2.49 LU）。
      var hard = clamp((lv - 0.55) / 0.35, 0, 1);
      var trim = SLAP_TRIM * SLAP_LUFS_TRIM[use % SLAP_LUFS_TRIM.length];
      var amp = trim * (0.85 + 0.15 * hard);
      var g = slapGains[use];
      if (g) {
        el.volume = 1;                 // 电平全交给 Web Audio（避免与 slapGain 双重衰减）
        g.gain.cancelScheduledValues(now());
        g.gain.setValueAtTime(amp, now());
      } else {
        // file://：元素直放，自己乘总线音量。AM-034 第三段：叠乘 `P.slapVolume`
        //   （该路无 `slapGain` 节点 —— 元素直放不进 Web Audio 图，只能靠 el.volume）。
        el.volume = clamp(P.handVolume * pnum(P.slapVolume, 1) * amp, 0, 1);
      }
      var p = el.play();
      if (p && p['catch']) { p['catch'](function () { }); }
      slapCount++;
      foleySpray(lv, use);
      return true;
    } catch (e) { return false; }
  }

  // 划水链 = 「流水」：两层持续噪声（低频涌动 + 中高频水花）+ 慢 LFO 起伏 + 一路短混响。
  // ⚠ 与旧版的本质区别：包络不再由每个 splash 事件「冲一次」，而是由目标电平指数跟随（见 flowCmd）。
  function buildHand() {
    // ① 低频「涌动」层：粉噪过低通 —— 手推开一整片水的厚重感（缺这层就是"沙沙"不是"流水"）
    handBody = src(pinkBuf); handBody.loop = true;
    handBodyLP = ctx.createBiquadFilter();
    handBodyLP.type = 'lowpass'; handBodyLP.frequency.value = 380; handBodyLP.Q.value = 0.6;
    handBodyGain = ctx.createGain(); handBodyGain.gain.value = 0.55;
    handBody.connect(handBodyLP); handBodyLP.connect(handBodyGain);

    // ② 中高频「水花」层：白噪过带通，中心频率随速度上移（划得快 → 更碎更亮）
    handSpray = src(noiseBuf); handSpray.loop = true;
    handFilter = ctx.createBiquadFilter();
    handFilter.type = 'bandpass';
    handFilter.frequency.value = P.handBand[0];
    handFilter.Q.value = P.handBand[2];        // ⚠ 先定 Q≈0.8 再调增益，顺序反了会啸叫
    handSprayGain = ctx.createGain(); handSprayGain.gain.value = 0.45;
    handSpray.connect(handFilter); handFilter.connect(handSprayGain);

    // ③ 包络：唯一被 playHand 驱动的节点
    handEnv = ctx.createGain(); handEnv.gain.value = 0;
    handBodyGain.connect(handEnv); handSprayGain.connect(handEnv);

    anHand = ctx.createAnalyser(); anHand.fftSize = 1024;
    // AM-034 第三段：干路与湿路都先过 `flowGain` 再进手总线（湿声也必须跟着压，否则
    //   只压干路会剩一条混响尾巴）。`flowGain` 在体检点之后 ⇒ `anHand` 仍读原始电平。
    flowGain = ctx.createGain(); flowGain.gain.value = pnum(P.flowVolume, 1);
    handEnv.connect(anHand); anHand.connect(flowGain); flowGain.connect(handGain);

    // ④ 混响支路：水声用**短**混响（1.2s，衰减快），长混响会糊成一片嗡。
    //    IR 单声道省一半 CPU；湿声不进体检点（混响尾巴会污染 peak 读数）
    handConv = ctx.createConvolver();
    handConv.buffer = makeIR(1.2, 3.4, true);
    handWet = ctx.createGain(); handWet.gain.value = 0.38;
    handEnv.connect(handConv); handConv.connect(handWet); handWet.connect(flowGain);

    // ⑤ 三条互不同步的慢 LFO → 流水的不规则起伏。这是「去同质化」的主力：
    //    固定频谱的噪声 = 机器味；三条 0.2~1Hz 的非同步调制 = 每次听起来都不一样
    // 返回 {osc, amt}：amt 是深度节点，拖尾时要能单独压小（只压主增益会被 LFO 抬回来）
    function lfo(f, amt, param) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.value = amt;
      o.connect(g); g.connect(param); o.start(0);
      return { osc: o, amt: g };
    }
    handLfos = {
      a: lfo(0.37, 0.30, handBodyGain.gain),     // 涌动：慢起伏
      b: lfo(0.61, 260, handFilter.frequency),   // 频谱游走：±260Hz
      c: lfo(0.23, 0.22, handSprayGain.gain)     // 水花疏密
    };

    handBody.start(0, rng() * 1.5);
    handSpray.start(0, rng() * 1.5);
  }

  // AM-034 第三段：把 `SW.P` 的三个音量字段灌进对应增益节点。
  //   在 `flowCmd()` 与 `playSlap()` 开头各调一次 ⇒ 拖水 / 拍击时改 `?debug=1` 滑杆**当次即生效**
  //   （**不新增 `SW.audio` 接口** —— 契约 §2.1 冻结签名一字不动）。
  //   默认值 1.00 / 1.00 ⇒ 与加这两个节点之前**逐位等价**（零回归，判据 1）。
  function syncVolumes() {
    if (handGain) { handGain.gain.value = pnum(P.handVolume, handGain.gain.value); }
    if (flowGain) { flowGain.gain.value = pnum(P.flowVolume, 1); }
    if (slapGain) { slapGain.gain.value = pnum(P.slapVolume, 1); }
  }

  // 下达包络目标。setTargetAtTime 从「当前值」指数逼近 —— 连续调用不会跳变，
  // 天然就是淡入（上升）与淡出（下降），不需要 ramp 也不会产生脉冲。
  function flowCmd(t) {
    if (!handEnv) { return; }
    syncVolumes();                     // AM-034 第三段：拖水当次生效
    handEnv.gain.setTargetAtTime(flowTarget, t, flowTarget > flowCur ? FLOW_UP_TAU : FLOW_DN_TAU);
    flowCur = flowTarget;
    lastFlowCmdT = t;
  }

  // 收尾：鼠标停下后**没有事件可来**，只能靠定时器把目标降为 0 → 拖尾淡出
  function flowTick() {
    if (!ctx || !handEnv || ctx.state !== 'running') { return; }
    if (lastMoveT < 0 || flowTarget === 0) { return; }
    var t = now();
    if (t - lastMoveT > FLOW_HOLD) { flowTarget = 0; tailShape(t); flowCmd(t); tailing = true; }
  }

  // UP5 / AM-012 ④：循环接缝看门狗。
  //   实测（plan/_up5-measure2.js）：曲首 0~0.10s 是**数字静音**、0.108s 才有首个有效样本；
  //   曲尾一直有声。所以 `el.loop = true` 会每 146.8s 塌一次 ~100ms 静音（不是爆音，是"呼吸"）。
  //   修法：手动区间 [LOOP_IN, dur-LOOP_TAIL] + **等长**的淡出/淡入（对称包络 → 接缝两侧能量天然相等）。
  // 出点 = min(元素 duration, 已缓冲末端) − LOOP_TAIL
  //   ⚠ 元素的 `duration` 是**按码率估算**的，可能比真实音频长。实测本资产：
  //     · http（带 Range）：duration = 146.832s = decodeAudioData 的真实长度 ✅
  //     · file://（**交付形态**）：duration = **147.164s**（估多了 0.332s），而 buffered 末端 ≈ 146.80s
  //   → 直接用 `duration − LOOP_TAIL` 会让出点落进末尾那段**没有数据的空区**，
  //     每圈多出一次 ~0.3s 数字静音 —— 与曲首那 100ms 静音同类，只是更隐蔽。
  //     故用 `buffered` 末端封顶。
  //   ⚠ 守卫：只在已缓冲末端「贴住」duration（差值 < 1.5s）时才采信该上限。
  //     否则（慢网、只缓冲到前 60s）会把出点提前到缓冲边界 → 每圈只剩前一段，绝对不能做。
  //     这个上限在所有情形下都**不劣于**原式：缓冲已到尾部时两者取小，未到尾部时原样回退。
  var loopOutSec = 0, bufferedEndSec = 0, bgmTrue = 0;   // bgmTrue：真实时长封顶是否生效（诊断用）
  function loopOut(dur) {
    var est = dur - LOOP_TAIL;
    // ① 真实内容时长封顶（**up5 的关键修复**）：file:// 下元素 duration 偏长 → 尾部会塌静音。
    //    UP11 / AM-015：封顶值改为**生效曲目的** trueDur —— 守卫语义不变（"仍是同一份资产"）：
    //    元素时长与表里那个值相差 < BGM_TRUE_GUARD(1.0s) 才采信；换曲/换资产后自动退回估算式。
    var td = bgmTrack ? bgmTrack.trueDur : 0;
    if (td > 0 && Math.abs(dur - td) < BGM_TRUE_GUARD) {
      est = Math.min(est, td - LOOP_TAIL);
      bgmTrue = 1;
    } else { bgmTrue = 0; }
    // ② 已缓冲末端封顶（http 下 Range 流式播放时有用；file:// 下 buffered 报的是估算值，等价于 ① 已覆盖的情形）
    try {
      var b = bgmEl.buffered;
      if (b && b.length) {
        var be = b.end(b.length - 1);
        bufferedEndSec = be;
        if (be > LOOP_IN + 5 && (dur - be) < 1.5) { est = Math.min(est, be - LOOP_TAIL); }
      }
    } catch (e) { /* buffered 在某些状态会抛，忽略 */ }
    return est;
  }

  // ------------------------------------------------ UP11 / AM-015：切歌
  // 复用**同一个** `<audio>` 元素、只换它的 `.src`。为什么不新建元素：
  //   `createMediaElementSource` 是**按元素**建的 —— 换了元素就得重建 SourceNode，
  //   而"重建"必然带来一次"要不要重新接图"的判定，那正是「别接两次」这个坑的来源
  //   （接两次 → 同一路信号被加两遍 → 峰值翻倍）。同一个元素改 src 后 SourceNode 依然有效，
  //   `bgmInGraph` 于是**不需要重新评估**。
  // 两路分化（与 loopTick 的循环淡入淡出同款）：
  //   http 图路     → fileGain 的 AudioParam linearRamp（采样级精确）
  //   file:// 元素路 → 靠 loopWatch(5ms) 逐级写 el.volume（元素不进图，只有这一条路）
  // 两路都由 wall() 计时决定"这一段淡变结束"，所以时序一致、回调时机一致。
  function switchRamp(to, dur, done) {
    bgmSwitching = true;              // ⚠ 必须在这里置位：切歌是**两段**（淡出→淡入），
                                      //   第二段由第一段的回调发起；若只在 setBgmTrack 里置一次，
                                      //   第一段收尾时 switchTick 会把它清掉 → 第二段没人推进
                                      //   → bgmSwitching 卡在 false、但包络停在 0（切歌后音量恒 0）。
    bgmSwitchFrom = bgmSwitchFade;
    bgmSwitchTo = to;
    bgmSwitchDur = dur > 0 ? dur : 0.001;
    bgmSwitchT0 = wall();
    bgmSwitchDone = done || null;
    if (bgmInGraph && fileGain) {
      // 图路：电平交给 AudioParam。bgmSwitchFade 只是**元素路**的乘子，这里同步成终值无副作用
      //  （elVolApply 在 graph 下直接写 volume = 1，根本不读它）。
      bgmSwitchFade = to;
      var tt = now();
      fileGain.gain.cancelScheduledValues(tt);
      fileGain.gain.setValueAtTime(fileGain.gain.value, tt);
      fileGain.gain.linearRampToValueAtTime(to, tt + bgmSwitchDur);
    }
  }

  // 由 loopWatch 驱动（切歌期间 loopTick 让位给它）。每 5ms 一档 → 0.34s 的淡变有 ~68 档，
  //   相邻 Δgain ≤ 0.02（对比循环那 40ms/8 级的 0.125）→ 元素路也听不出台阶。
  function switchTick() {
    var t = (wall() - bgmSwitchT0) / 1000 / bgmSwitchDur;
    if (t >= 1) { t = 1; }
    bgmSwitchFade = bgmSwitchFrom + (bgmSwitchTo - bgmSwitchFrom) * t;
    if (!bgmInGraph) { elVolApply(); }
    if (t < 1) { return; }
    bgmSwitchFade = bgmSwitchTo;
    var done = bgmSwitchDone;
    bgmSwitchDone = null;
    bgmSwitching = false;
    if (done) { done(); }
  }

  function loopTick() {
    // AM-015：切歌优先，且**与 bgmMode 无关** —— 首次校验（check()）还没落地时
    //   也可能发生切歌，那时 bgmMode 仍是 'none'，若先判它就会让包络永远推不完。
    if (bgmSwitching) { switchTick(); return; }
    if (!bgmEl || bgmMode !== 'file' || !enabled || bgmEl.paused) { return; }
    var dur = bgmEl.duration;
    if (!isFinite(dur) || dur <= LOOP_IN + LOOP_TAIL + 1) { return; }
    var out = loopOut(dur); loopOutSec = out;
    var t = bgmEl.currentTime;
    if (t >= out) {                      // 到出点 → 回卷
      try { bgmEl.currentTime = LOOP_IN; } catch (e) { return; }
      loopWraps++;
      t = LOOP_IN;
    }
    var rel = t - LOOP_IN;               // 入点后爬升
    var f = rel < LOOP_FADE_IN ? Math.max(0, rel / LOOP_FADE_IN) : 1;
    var left = out - t;                  // 出点前下落
    if (left < LOOP_FADE_OUT) { f = Math.min(f, Math.max(0, left / LOOP_FADE_OUT)); }
    if (f === bgmFade) { return; }
    bgmFade = f;
    elVolApply();
    if (bgmInGraph && fileGain) {        // graph 路：用 AudioParam 精确插值，比 20ms 步进平滑
      var tt = now();
      fileGain.gain.cancelScheduledValues(tt);
      fileGain.gain.setValueAtTime(fileGain.gain.value, tt);
      fileGain.gain.linearRampToValueAtTime(f, tt + LOOP_TICK / 1000);
    }
  }

  // BGM 元素路径的电平：**只有一个出口** —— 生效曲目的母带 trim × duck 系数 × 循环淡入淡出 × 切歌包络
  function bgmBase() { return clamp(P.bgmVolume * bgmActiveTrim(), 0, 1); }
  function elVolApply() {
    if (!bgmEl) { return; }
    // graph 路电平全由 Web Audio 负责（bgmSrc/fileGain），元素 volume 必须固定 1 → 防双重衰减
    if (bgmInGraph) { bgmEl.volume = 1; return; }
    bgmEl.volume = clamp(bgmBase() * bgmElDuck * bgmFade * bgmSwitchFade, 0, 1);
  }

  // 拖尾音色：高频水花先收、低频涌动留下并下扫 → 听感是「水波回落」而不是「沙沙的风」
  function tailShape(t) {
    if (handSprayGain) { handSprayGain.gain.setTargetAtTime(TAIL_SPRAY, t, 0.16); }
    if (handLfos) { handLfos.c.amt.gain.setTargetAtTime(TAIL_SPRAY_LFO, t, 0.16); }
    if (handBodyGain) { handBodyGain.gain.setTargetAtTime(TAIL_BODY, t, 0.18); }
    if (handBodyLP) { handBodyLP.frequency.setTargetAtTime(TAIL_BODY_LP, t, 0.30); }
    if (handFilter) { handFilter.frequency.setTargetAtTime(P.handBand[0] * 0.8, t, 0.25); }
  }

  // 重新起手：把拖尾期间压下去的参数恢复（τ=0.12 平滑回弹，避免跳变爆音）
  function restoreShape(t) {
    if (handSprayGain) { handSprayGain.gain.setTargetAtTime(0.45, t, 0.12); }
    if (handLfos) { handLfos.c.amt.gain.setTargetAtTime(0.22, t, 0.12); }
    if (handBodyGain) { handBodyGain.gain.setTargetAtTime(0.55, t, 0.12); }
  }

  // 每一轮新拖动重新洗牌（不重建节点 —— 持续源重启会爆音，只改速率/频率）
  function reshuffle(t) {
    if (!handLfos || !handSpray) { return; }
    flowSeed = Math.floor(rng() * 1e6);
    handLfos.a.osc.frequency.setTargetAtTime(0.22 + rng() * 0.40, t, 0.30);
    handLfos.b.osc.frequency.setTargetAtTime(0.40 + rng() * 0.55, t, 0.30);
    handLfos.c.osc.frequency.setTargetAtTime(0.15 + rng() * 0.35, t, 0.30);
    // 循环噪声变速 → 纹理变化（噪声无音高，听不出变调，只觉得"换了一片水"）
    handSpray.playbackRate.setTargetAtTime(0.82 + rng() * 0.36, t, 0.40);
    handBody.playbackRate.setTargetAtTime(0.88 + rng() * 0.24, t, 0.40);
  }

  // 环境链：连续的风（粉噪 + 慢 LFO）+ 离散的水拍岸（§3：不做"更响的床"）
  function buildAmb() {
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.5;

    ambBedGain = ctx.createGain();
    ambBedGain.gain.value = 0.45;

    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.06;
    var lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.30;
    lfo.connect(lfoAmt); lfoAmt.connect(ambBedGain.gain);   // 0.45 ± 0.30 缓慢起伏
    lfo.start(0);

    lp.connect(ambBedGain); ambBedGain.connect(ambGain);
    var s = src(pinkBuf); s.loop = true; s.connect(lp); s.start(0);
  }

  // --------------------------------------------------------------- BGM 合成
  // 慢速 pad：正弦 + 三角（八度上）微失谐，4s 起 / 4.5s 落，低通 + 慢速滤波 LFO
  function padVoice(freq, t0, dur, pan, level) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level, t0 + PAD_ATTACK);
    g.gain.setValueAtTime(level, t0 + dur - PAD_RELEASE);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    var lp = ctx.createBiquadFilter();
    // 静态低通（不再挂 LFO 振荡器：每个和弦省 5 个节点，这是卡顿的主因之一）
    lp.type = 'lowpass'; lp.frequency.value = 950 + (freq % 37) * 8; lp.Q.value = 0.4;

    var pan1 = panner(pan);
    var tail = chain(lp, g, pan1) || g;
    tail.connect(bgmSrc);
    var send = ctx.createGain(); send.gain.value = 0.4;
    tail.connect(send); send.connect(conv);

    var voices = [
      { type: 'sine', mul: 1, lvl: 1.0, det: -5 },
      { type: 'triangle', mul: 2, lvl: 0.30, det: +6 }
    ];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      var o = ctx.createOscillator();
      o.type = v.type;
      o.frequency.value = freq * v.mul;
      o.detune.value = v.det;
      var vg = ctx.createGain(); vg.gain.value = v.lvl;
      o.connect(vg); vg.connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.2);
    }
  }

  function scheduleChord(idx, t0) {
    var notes = CHORDS[idx % CHORDS.length];
    for (var i = 0; i < notes.length; i++) {
      // 低音稍响、高音稍弱；左右交替铺开
      var level = 0.075 * (i === 0 ? 1.25 : (1 - i * 0.13));
      padVoice(notes[i], t0, CHORD_DUR + PAD_RELEASE, (i % 2 ? 0.35 : -0.35) + (rng() - 0.5) * 0.2, level);
    }
  }

  function chordLoop() {
    if (!ctx) { return; }
    var t0 = Math.max(now() + 0.05, chordNextT);
    scheduleChord(chordIdx, t0);
    chordIdx++;
    chordNextT = t0 + CHORD_STEP;
    // 提前 2s 预约下一个（后台标签页 setTimeout 被节流到 1s 也不会断）
    var wait = Math.max(0.2, (chordNextT - now() - 2.0)) * 1000;
    chordTimer = window.setTimeout(chordLoop, wait);
  }
  var chordNextT = 0;

  // 钢琴/铃状点缀：和弦内的随机音，快起慢落，重混响
  function bell() {
    if (!ctx || !enabled) { return; }
    var notes = CHORDS[(chordIdx - 1 + CHORDS.length) % CHORDS.length];
    var f = notes[1 + Math.floor(rng() * (notes.length - 1))] * (rng() < 0.4 ? 2 : 1);
    var t0 = now() + 0.03;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);

    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.3;
    var pan1 = panner((rng() * 2 - 1) * 0.6);
    var tail = chain(lp, g, pan1) || g;
    tail.connect(bgmSrc);
    var send = ctx.createGain(); send.gain.value = 0.7;
    tail.connect(send); send.connect(conv);

    var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    var o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2.01;
    var g2 = ctx.createGain(); g2.gain.value = 0.22;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    o1.start(t0); o1.stop(t0 + 2.8);
    o2.start(t0); o2.stop(t0 + 2.8);

    bellTimer = window.setTimeout(bell, (3.5 + rng() * 4.0) * 1000);
  }

  // 水拍岸：粉噪片段过带通，0.5s 起 / 2.2s 落（离散事件，不做成床）
  function lap() {
    if (!ctx || !enabled) { return; }
    var t0 = now() + 0.03;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300 + rng() * 400;
    bp.Q.value = 0.6;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.30 + rng() * 0.15, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.7);

    var pan1 = panner((rng() * 2 - 1) * 0.7);
    var tail = chain(bp, g, pan1) || g;
    tail.connect(ambGain);

    var s = src(pinkBuf, 0.85 + rng() * 0.3);
    s.connect(bp);
    s.start(t0, rng() * 3.0, 3.2);
    s.stop(t0 + 3.2);

    lapTimer = window.setTimeout(lap, (5 + rng() * 8) * 1000);
  }

  // ----------------------------------------------------------- BGM：文件模式
  // 🔴 file:// 下 createMediaElementSource 会被判定为跨源污染、输出恒为静音
  //    （实测：readyState=4 / err=0 / duration 正常 / currentTime 会走，但 analyser 峰值恒为 0，
  //     回退原因 = "silent (cross-origin tainted)"）。这是浏览器安全策略，绕不过去。
  //    所以 file:// 下**不接** Web Audio 图，让 <audio> 元素自己播；
  //    duck / 总开关改用 el.volume 与 play/pause 手动实现，语义与合成模式一致。
  //    代价：file:// 的 BGM 不过 limiter（BGM 本身平稳、不需要限幅，可接受）。
  //    http(s) 下无此限制 → 仍走 createMediaElementSource，可过 limiter 并接 analyser 体检。
  function tryFileBgm() {
    // UP11 / AM-015：曲目由 startBgm() 抽签/选定后写进 bgmTrack，这里只认它。
    //   旧的 `P.bgmFile` 单值字段已被 `P.bgmFiles` 列表取代（契约 §6）。
    var url = bgmTrack ? bgmTrack.file : null;
    if (!url) { return startSynthBgm(); }
    var el;
    try { el = new window.Audio(); } catch (e) { return startSynthBgm(); }
    bgmEl = el;
    el.src = url;                       // ⚠ 别漏：不设 src 就没有 error 事件，兜底永远不触发
    // UP5 / AM-012 ④：**不再**用 el.loop —— 实测曲首有 ~100ms 数字静音，硬件 loop 会每
    //   146.8s 塌一次静音。改由 loopTick() 做手动区间 [LOOP_IN, dur-LOOP_TAIL]。
    el.loop = false;
    el.preload = 'auto';
    el.volume = clamp(P.bgmVolume, 0, 1);   // loopTick/elVolApply 起来后会按 bgmBase() 覆盖
    // ⚠ 只在 http(s) 下加 crossOrigin：file:// 加它会直接导致加载失败
    if (/^https?:/i.test(url)) { el.crossOrigin = 'anonymous'; }

    var isFile = IS_FILE;
    var an = null;
    if (!isFile) {
      try {
        var node = ctx.createMediaElementSource(el);
        fileGain = ctx.createGain(); fileGain.gain.value = 1;
        an = ctx.createAnalyser(); an.fftSize = 1024;
        node.connect(an); an.connect(fileGain); fileGain.connect(bgmSrc);
        // UP5 / AM-012 ③：接图成功后**元素 volume 固定 1** —— 电平全交给 Web Audio
        //   （bgmSrc 带母带 trim、bgmGain 带用户音量）。改前这里用的是 P.bgmVolume，
        //   若浏览器把元素 volume 也应用在 MediaElementSource 上，就会出现**双重衰减**。
        bgmInGraph = true;
        el.volume = 1;
      } catch (e) { an = null; bgmInGraph = false; }   // 建图失败就退回元素直放
    }
    // UP11 / AM-015：把母带 trim 立刻落到元素上。
    //   🔴 这里补 `elVolApply()` 修的是一个**沿用至今的既有缺陷**：`loopTick` 只在
    //     `bgmMode === 'file'` 后才写 el.volume，而 bgmMode 要等 `check()`（起播后 ~0.9s）
    //     才置位 —— 那时 currentTime 已越过 LOOP_FADE_IN，循环包络恒为 1、`f === bgmFade`
    //     于是**每次都提前 return**，`elVolApply()` 一次都不会被执行 →
    //     元素一直停在上面那行 `el.volume = P.bgmVolume`（0.60），**比母带目标响 0.94 dB**，
    //     直到第一次 duck 或第一圈回卷才被纠正。
    //     本包把它变成必现问题：不修的话"选曲后响度对齐"就只在第一次交互之后才成立。
    //     （图路不受影响：那条路上电平由 bgmSrc 的 trim 负责，元素 volume 恒 1。）
    elVolApply();
    // 起播就跳到入点（跳过曲首数字静音）；回卷由 loopTick 负责
    el.addEventListener('loadedmetadata', function () {
      try { if (el.currentTime < LOOP_IN) { el.currentTime = LOOP_IN; } } catch (e) { /* 忽略 */ }
    });
    // UP5 / AM-012 ④兜底：万一元素先自然结束（资产被换、估算时长偏短、回卷被打断），
    //   就手动回到入点续播 —— 避免「音乐永久停住」这种最差失败模式。
    el.addEventListener('ended', function () {
      if (bgmMode !== 'file' || !enabled) { return; }
      try { el.currentTime = LOOP_IN; } catch (e) { return; }
      loopWraps++;
      try { var pr = el.play(); if (pr && pr['catch']) { pr['catch'](function () { }); } } catch (e) { /* 忽略 */ }
    });

    var settled = false;
    var taintTries = 0;                 // 「是否真出声」这条判据自己的耐心额度（见下）
    function fallback(reason) {
      if (settled) { return; }
      settled = true;
      bgmReason = reason;
      if (fileGain) { fileGain.gain.value = 0; }
      try { el.pause(); } catch (e) { /* 忽略 */ }
      console.warn('[still_water] BGM 文件不可用（' + reason + '），退回程序化合成');
      startSynthBgm();
    }
    el.addEventListener('error', function () { fallback('load error'); });

    var playP = el.play();
    if (playP && playP['catch']) { playP['catch'](function () { fallback('autoplay rejected'); }); }

    // ⚠ 体检必须由「能播了」事件驱动，不能用固定延时：3.2MB 的 mp3 在慢机器上
    //   1.2s 时 readyState 才 1（HAVE_METADATA），固定延时体检必然误判成"没加载"。
    //   canplay/playing 之后再留 400ms 让 currentTime 真的走起来，判据才稳。
    var tries = 0;
    function check() {
      if (settled) { return; }
      try {
        if (el.error) { return fallback('media error ' + (el.error.code || '?')); }
        // ⚠ canplay 只代表"数据够了"，不代表"开始播了" —— play() 是异步的。
        //   带 --allow-file-access-from-files 时加载快、起播早，所以之前没暴露这个误判。
        //   这里轮询等真正起播，最多 6s；真被拒的话 play() 的 promise 会先 reject，不用等满。
        // ⚠ 起播判负前必须给足耐心：慢机器上 3.2MB mp3 解码 + 首帧渲染会把起播推后好几秒。
        //   判负的代价很大 —— 会永久退回合成 pad（settled 是一次性的），用户听到的就不是真曲子了。
        //   30 × 500ms = 15s；真被拒时 play() 的 promise 会先 reject，不用等满。
        if (el.paused || !(el.currentTime > 0)) {
          if (++tries < 30) { window.setTimeout(check, 500); return; }
          return fallback('not playing (paused=' + el.paused + ', t=' + el.currentTime + ')');
        }
        if (an) {                        // http 下接了图 → 再验一次真的出声（防污染）
          // 🔴 UP5 / AM-012 ⑩：**音频图没跑起来时，analyser 读数恒为 0，体检毫无意义**。
          //   实测（无头 Chrome + SwiftShader 软件渲染）：`ctx.resume()` 已 resolve、
          //   `ctx.state==='running'`，但音频渲染线程的量子定时器被主线程饿住，
          //   `ctx.currentTime` 在起播后 ~1.1s 内仍是 **0**（probe 读数 ctxTime=0.0）→
          //   analyser 全 0 → 被判成 `silent (tainted)` → **永久退回合成 pad**（真曲子丢失）。
          //   真机 GPU 不忙时不一定触发，但这属于「误判一次就永久降级」的高代价分支，必须兜住：
          //   图没起来就继续等，等不到才判负。等的时候不消耗 `tries` 的额度（那条管起播）。
          if (!ctx || ctx.state !== 'running' || !(ctx.currentTime > 0)) {
            if (++taintTries < 40) { window.setTimeout(check, 250); return; }
            return fallback('ctx not running (state=' + (ctx ? ctx.state : '?') + ', t=' + (ctx ? ctx.currentTime : 0) + ')');
          }
          var buf = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(buf);
          var peak = 0;
          for (var i = 0; i < buf.length; i++) { var a = Math.abs(buf[i]); if (a > peak) { peak = a; } }
          if (peak < 1e-4) {
            // 图在跑、元素在播、analyser 却全 0 → 才是真的跨源污染。多给一次机会再定论。
            if (++taintTries < 3) { window.setTimeout(check, 400); return; }
            return fallback('silent (tainted)');
          }
        }
        bgmMode = 'file';               // ⚠ 只在这里置 'file'：不能写在事件外，会覆盖 fallback 的 'synth'
      } catch (e) { fallback('probe failed'); }
    }
    el.addEventListener('playing', function () { window.setTimeout(check, 300); });
    window.setTimeout(check, 900);       // 首检（若尚未起播，check 内部会自己轮询续等）
  }

  function startSynthBgm() {
    if (bgmMode === 'synth') { return; }
    bgmMode = 'synth';
    chordIdx = 0;
    chordNextT = now() + 0.15;
    chordLoop();
    bellTimer = window.setTimeout(bell, 2500);
  }

  // UP11 / AM-015：进页面**随机一首**。
  //   随机源仍是本项目的 mulberry32（`SW.util.newRng`），但**另开一条独立流**、不复用 `rng`：
  //     ① 需求就是「每次进页面换一首」，而 `rng` 的种子是固定值 `P.seed`（世界的随机性
  //        必须逐位可复现）→ 用 `rng` 抽签会**永远抽到同一首**，需求直接落空。
  //     ② 独立成流还白赚一个好处：抽签**不消耗** `rng` 的取值序列 → 水面 / 波纹 / 海鸟那一整套
  //        既有随机数一个都不动（否则 20-determinism 的逐帧逐位复现会被这一抽打乱）。
  //   种子里掺墙钟 → 每次加载不同；`?bgm=<n>`（BGM_PIN）可钉死下标，供验收 / 断言复现。
  //   ⚠ 不是 Math.random（全项目禁用），仍是同一个 mulberry32。
  function startBgm() {
    var list = trackList();
    var idx;
    if (bgmPrePicked && bgmTrackIdx >= 0 && bgmTrackIdx < list.length) {
      idx = bgmTrackIdx;                      // 首次手势前用户就点过选曲 → 尊重他的选择，不抽签
    } else if (BGM_PIN >= 0 && BGM_PIN < list.length) {
      idx = BGM_PIN;                          // ?bgm=<n> 钉死
    } else if (list.length > 1) {
      var pickRng = U.newRng((P.seed ^ (Date.now() & 0x7fffffff)) >>> 0);
      idx = Math.floor(pickRng() * list.length) % list.length;
    } else {
      idx = 0;
    }
    bgmTrackIdx = idx;
    bgmTrack = list[idx];
    applyTrackTrim();                         // 起播前定下母带 trim（此刻还没有声音 → 无台阶问题）
    var mode = P.audioMode;
    if (mode === 'synth') { startSynthBgm(); return; }
    tryFileBgm();   // 'file' 与 'auto' 同路：auto 时 tryFileBgm 内部会退回合成
  }

  // --------------------------------------------------------------- 对外 API
  var api = {
    ready: false,

    init: function () {
      if (inited || failed) { return api.ready; }
      if (P.audioMode === 'off') { failed = true; return false; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return false; }
        ctx = new AC();
      } catch (e) {
        failed = true; console.warn('[still_water] AudioContext 创建失败', e); return false;
      }

      try { build(); } catch (e) { failed = true; console.warn('[still_water] 音频图构建失败', e); return false; }

      var self = this;
      var go = function () {
        if (ctx.state === 'suspended') { ctx.resume()['catch'](function () { /* 忽略 */ }); }
        startBgm();
        lapTimer = window.setTimeout(lap, 3000);
        self.ready = true; api.ready = true;
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(go)['catch'](go);
      } else { go(); }
      inited = true;
      return api.ready;
    },

    setEnabled: function (bool) {
      enabled = !!bool;
      if (!master) { return enabled; }
      var t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(enabled ? 1 : 0, t + 0.08);
      // file:// 下 BGM 是元素直放，不过 master → 总开关要单独作用在元素上
      if (bgmMode === 'file' && bgmEl) {
        try {
          if (enabled) { var p = bgmEl.play(); if (p && p['catch']) { p['catch'](function () { }); } }
          else { bgmEl.pause(); }
        } catch (e) { /* 忽略 */ }
      }
      return enabled;
    },

    // 划水：连续「流水」。事件只更新目标电平 + 刷新活动时间，包络交给指数跟随（§4.2）
    // UP5 / AM-012：新增可选第 2 参 x（世界坐标）→ 声像跟手。**旧调用方少传一个也照常工作**。
    playHand: function (speed01, x) {
      if (!ctx || !enabled || !handEnv) { return; }
      var t = now();
      var s = clamp(speed01, 0, 1);
      panTo(x);                        // 拖动与点击共用：手在画面左边 → 声音也偏左

      // 新的一轮拖动（距上次 >0.6s）→ 洗牌 LFO 与噪声纹理，避免每次听起来一模一样
      if (lastRoundT < 0 || t - lastRoundT > 0.6) { reshuffle(t); lastRoundT = t; }
      if (tailing) { restoreShape(t); tailing = false; }   // 上一次拖尾把水花层压下去了 → 抬回来

      flowTarget = FLOW_MIN + (FLOW_MAX - FLOW_MIN) * s;
      lastMoveT = t;
      lastHandPeak = flowTarget;      // 断言读数：快划目标电平 > 慢划
      lastPeakT = t;

      // 中心频率随速度上移（τ 放大到 0.15/0.20 —— 频谱跳变太快会听出"咔"）
      handFilter.frequency.setTargetAtTime(lerp(P.handBand[0], P.handBand[1], s), t, 0.15);
      if (handBodyLP) { handBodyLP.frequency.setTargetAtTime(lerp(300, 720, s), t, 0.20); }

      // 节流下达：拖动 33ms 一次事件，没必要每次都排自动化
      if (t - lastFlowCmdT >= FLOW_THROTTLE) { flowCmd(t); }

      // 点击：间隔够大 **且** 速度够高才算点击（§4.1 音色分离）。
      // 只判间隔会把「慢拖」误判成一串点击 → 听起来像打架子鼓。
      if ((lastSplashT < 0 || t - lastSplashT > CLICK_GAP) && s >= CLICK_MIN_SPEED) {
        click(t, 0.30 + 0.20 * s, x);
      }
      lastSplashT = t;
      api.duck();
    },

    // BGM 让位：速降 P.duckDown，缓升 P.duckUp。连续拖动时不断续期 → 一直让位，
    // 最后一次 splash 后 0.7s 自行回升（§8「忘记 duck 恢复」坑）
    duck: function () {
      if (!ctx || !bgmGain) { return; }
      var t = now();
      // ⚠ 节流：拖动时 splash 每 33ms 一次，每次重排 4 条自动化 = 每秒 120 条事件。
      //   已在低位且回升点还远 → 这次什么都不做（duckUntil 已经把让位时间排好了）。
      if (t - lastDuckT < 0.15 && duckUntil - t > 0.20) { return; }
      lastDuckT = t;

      var base = P.bgmVolume;
      var low = base * (1 - P.duckAmount);
      // ⚠ 旧版这里写的是 `if (up < duckUntil) up = duckUntil;` —— 那会让回升点**无限累积**：
      //   每次执行都把回升点往后推 duckUp（0.7s），连续拖动 3s 松手后 BGM 要等十几秒才回来。
      //   「不重复往下压」已经由下面的 Math.max(g.value, low) 保证了，那行既多余又有害。
      //   回升点必须始终从「本次事件」算起 —— 松手后 duckDown+duckUp 秒回升。
      var up = t + P.duckDown;
      var g = bgmGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, low), t);
      g.linearRampToValueAtTime(low, t + P.duckDown);
      g.setValueAtTime(low, up);
      g.linearRampToValueAtTime(base, up + P.duckUp);
      duckUntil = up + P.duckUp;

      // file:// 下 BGM 是元素直放、不经过 bgmGain → 把同一条让位曲线手动写到 el.volume。
      // UP5 / AM-012：这里只改「duck 系数」这一个乘子，最终电平仍由 elVolApply() 统一出口算，
      //   避免与母带 trim / 循环淡入淡出打架（三处各写一次 el.volume 是上一版的老问题）。
      if (bgmMode === 'file' && bgmEl && !bgmInGraph) {
        bgmElDuck = clamp(1 - P.duckAmount, 0, 1);
        elVolApply();
        if (duckTimer) { window.clearTimeout(duckTimer); }
        duckTimer = window.setTimeout(function () {
          duckTimer = 0;
          bgmElDuck = 1;
          elVolApply();
        }, (P.duckDown + P.duckUp) * 1000);
      }
    },

    // UP9 / AM-010：时间刻度尺的咔嗒声（UP10 消费）。签名由 90-WAVE5.md §5 **冻结**，
    //   不得单方面修改 —— UP10 已按这个签名写好了。
    //   step  number  0~1 的力度/音高提示，可选，默认 0.5
    //   返回  boolean 真的出声了才 true（未就绪 / 静音 / 被节流 → false，且**不抛错**）
    sfxTick: function (step) {
      if (!ctx || !enabled) { return false; }
      var t = now();
      // 节流：≤25ms 内的重复调用只出一声。拖动刻度尺时事件密度可达 ~30Hz，
      //   不节流会让两声叠在一起 —— 又长又闷的尾音会叠成连续的"沙沙"，那就是反面效果。
      if (lastTickT >= 0 && t - lastTickT < TICK_THROTTLE) { return false; }
      if (!playTick(typeof step === 'number' && isFinite(step) ? step : 0.5)) { return false; }
      lastTickT = t;
      return true;
    },

    // UP11 / AM-015：BGM 选曲（`80-ui.js` 的 `#sw-bgm` 消费）。
    //   bgmInfo()       曲目表 + 当前下标 + 切歌能力。**音频未启动时也可调**（曲目表来自 SW.P，
    //                   此时 idx = -1）—— UI 在 boot 期（还没第一次手势）就要把胶囊画出来。
    //   setBgmTrack(i)  0 起下标；返回 boolean（true = 已切 / 已记下意图）。
    //     音频启动**之前**调 → 只记下意图（bgmPrePicked），startBgm 会用它取代随机抽签；
    //     合成兜底模式（文件资产已判死）→ 返回 false（没有文件元素可切，且**不抛错**）。
    bgmInfo: function () {
      var list = trackList(), arr = [];
      for (var i = 0; i < list.length; i++) {
        arr.push({ file: list[i].file, label: list[i].label });
      }
      return {
        count: list.length,
        idx: bgmTrackIdx,                     // -1 = 还没定（音频未启动）
        label: bgmTrack ? bgmTrack.label : '',
        file: bgmTrack ? bgmTrack.file : '',
        tracks: arr,
        mode: bgmMode,                        // 'file' 可切 | 'synth' 兜底切不动 | 'none' 未启动
        switching: bgmSwitching,
        pinned: BGM_PIN
      };
    },

    setBgmTrack: function (i) {
      var list = trackList();
      i = (typeof i === 'number' && isFinite(i)) ? Math.floor(i) : -1;
      if (i < 0 || i >= list.length) { return false; }
      if (bgmSwitching) { return false; }          // 上一切歌还没落地，这次丢给调用方重试
      if (!bgmEl) {                                // 音频还没启动 → 只记意图（见 startBgm）
        bgmTrackIdx = i; bgmTrack = list[i]; bgmPrePicked = true;
        return true;
      }
      if (bgmMode === 'synth') { return false; }   // 文件资产已判死、退回合成 → 没有可切的元素
      if (bgmTrackIdx === i && bgmTrack && bgmTrack.file === list[i].file) { return true; }
      var t = list[i];
      bgmTrackIdx = i;                             // 选中态**立刻**生效 → UI/probe 即时一致
      var seq = ++switchSeq;
      // bgmSwitching 由 switchRamp() 置位（它是两段式，第二段也要靠它驱动 —— 见该函数注释）
      // 循环包络先归 1：切歌期间 loopTick 让位、不会更新它；若留着切换前的中间值，
      //   元素路的 el.volume 会多乘一个陈旧系数（新曲起播音量偏低）。切歌结束后 loopTick
      //   会按新元素的 currentTime 重算（≈1）→ 不会产生跳变。
      bgmFade = 1;
      switchRamp(0, SWITCH_OUT, function () {
        if (seq !== switchSeq) { return; }         // 迟到的旧次回调作废
        bgmTrack = t;                              // 真正生效（trim 也随之，见下一行）
        try { bgmEl.pause(); } catch (e) { /* 忽略 */ }
        try { bgmEl.currentTime = 0; } catch (e) { /* 忽略 */ }
        try { bgmEl.src = t.file; } catch (e) { /* 忽略 */ }
        applyTrackTrim();                          // 在静音窗口里换母带增益 → 不产生电平台阶
        try { bgmEl.load(); } catch (e) { /* 显式 load：确保 loadedmetadata 重发 */ }
        // 元素上已有的 loadedmetadata 监听会把 currentTime 落到 LOOP_IN（跳过曲首数字静音）
        if (!enabled) {                            // 静音中不抢播（setEnabled(false) 已把元素 pause 了）
          switchRamp(1, 0.001, null);
          return;
        }
        var played = false;
        var onPlaying = function () {
          bgmEl.removeEventListener('playing', onPlaying);
          if (seq !== switchSeq) { return; }
          played = true;
          switchRamp(1, SWITCH_IN, null);          // 淡入挂在"真的开始出声"上，不挂在 play() 的返回上
        };
        bgmEl.addEventListener('playing', onPlaying);
        var p = bgmEl.play();
        if (p && p['catch']) { p['catch'](function () { }); }
        // 兜底：个别浏览器在 readyState 已足够时不再重发 playing → 到点也把淡入放掉。
        //   否则 bgmSwitching 会永远挂着、loopTick 一直让位（**循环看门狗静默失效**）。
        //   宁可放弃这一次淡入，也不能让循环逻辑停摆。
        window.setTimeout(function () {
          if (seq !== switchSeq || played) { return; }
          bgmEl.removeEventListener('playing', onPlaying);
          switchRamp(1, SWITCH_IN, null);
        }, 900);
      });
      return true;
    },

    suspend: function () {
      if (!ctx) { return; }
      if (bgmEl) { try { bgmEl.pause(); } catch (e) { /* 忽略 */ } }
      ctx.suspend()['catch'](function () { /* 忽略 */ });
    },

    resume: function () {
      if (!ctx) { return; }
      ctx.resume()['catch'](function () { /* 忽略 */ });
      if (bgmEl && enabled) { var p = bgmEl.play(); if (p && p['catch']) { p['catch'](function () { }); } }
    },

    probe: function () {
      if (!ctx) { return { state: 'none', bgmGain: 0, handGain: 0, ambGain: 0, lastHandPeak: 0 }; }
      var bgmPeak = peakOf(anBgm), handPk = peakOf(anHand);
      return {
        state: ctx.state || 'none',
        bgmGain: bgmGain ? bgmGain.gain.value : 0,
        handGain: handGain ? handGain.gain.value : 0,
        ambGain: ambGain ? ambGain.gain.value : 0,
        lastHandPeak: lastHandPeak,
        // 以下为 WP4 附加读数（非 §5 要求）
        ctxTime: now(),          // 音频钟：断言要按它等，不能按墙钟（无头环境两者不同步）
        bgmPeak: bgmPeak,        // 体检：这两条不为 0 才说明真的出声了
        handPeak: handPk,
        clicks: clickCount,
        mode: bgmMode,
        reason: bgmReason,
        enabled: enabled,
        handEnv: handEnv ? handEnv.gain.value : 0,
        handFreq: handFilter ? handFilter.frequency.value : 0,
        flowTarget: flowTarget,                              // 当前目标电平（拖尾期间会降为 0）
        flowSeed: flowSeed,                                  // 本轮拖动的随机指纹（多样性断言用）
        handWet: handWet ? handWet.gain.value : 0,           // 混响湿声量（0 = 没接混响）
        handSprayRate: handSpray ? handSpray.playbackRate.value : 0,
        // 拖尾音色判据：水花层被压低（spray）、涌动层抬起（body）→ 是水波不是风
        sprayLevel: handSprayGain ? handSprayGain.gain.value : 0,
        bodyLevel: handBodyGain ? handBodyGain.gain.value : 0,
        bodyLP: handBodyLP ? handBodyLP.frequency.value : 0,
        bubbleHz: lastBubbleHz,         // 主气泡频率（拍得重 → 更低）
        slapReady: slapReady,           // 拍击采样是否可用
        slaps: slapCount,               // 采样实际播放次数（断言用：点了就该涨）
        slapDur: slapPool.length ? slapPool[0].duration : 0,   // 采样时长（含烘进去的混响尾）
        // ---- UP5 / AM-012 附加读数（供 §3 验收 #2/#3/#4/#6）----
        slapMode: slapMode,             // 'graph'（过 limiter+声像）| 'element'（file:// 直放）
        slapRouted: slapGains.length - slapGains.filter(function (v) { return !v; }).length,
        slapAnPeak: slapAn ? peakOf(slapAn) : 0,     // 拍击**在 Web Audio 图内**的实测峰值
        limInPeak: limAn ? peakOf(limAn) : 0,        // limiter **输入端**实测峰值（验收 #2 直读证明）
        handPan: handPan ? +handPan.pan.value.toFixed(4) : null,   // 实际声像（-1..1）
        handPanCmd: +curPan.toFixed(4),              // 最近下达的目标声像
        handPanCmdRaw: curPan,                       // 同上，**全精度**（验收 #4 用它做严格单调/误差断言）
        bgmTrim: +bgmActiveTrim().toFixed(4),   // **正在响**那一首的母带 trim（验收 #3：raw + 20log10(trim) 应命中 -16）
                                                //   UP11 / AM-015：不再是常量 BGM_TRIM —— 随选中的曲目变
        bgmSrcGain: bgmSrc ? +bgmSrc.gain.value.toFixed(4) : 0,   // 总线上的实际 trim（应 === bgmTrim）
        bgmFade: +bgmFade.toFixed(4),   // 循环淡入淡出当前系数
        bgmElDuck: +bgmElDuck.toFixed(4),   // duck 在**元素路径**上的系数（验收 #5：元素音量 = bgmVolume×trim×duck×fade×switchFade）
        bgmSwitchFade: +bgmSwitchFade.toFixed(4),   // UP11：切歌包络（元素路的乘子；静止恒 1）
        loopIn: LOOP_IN, loopTail: LOOP_TAIL, loopFadeOut: LOOP_FADE_OUT, loopFadeIn: LOOP_FADE_IN,
        loopWraps: loopWraps,
        loopOut: +loopOutSec.toFixed(3),        // 运行期实际出点（回卷阈值）
        bgmTrueDur: bgmTrack ? bgmTrack.trueDur : 0, bgmTrueCapped: bgmTrue,
        // 真实内容时长封顶（1 = 生效；0 = 资产已换 / 未知曲目、退回估算式）。
        // UP11：封顶值改为**生效曲目的** trueDur；未知曲目为 0 → 与"换资产后自动降级"同一条路。
        // ---- UP11 / AM-015 附加读数（供 96 §5 验收 #1/#2/#4）----
        bgmTrackIdx: bgmTrackIdx,                    // 选中下标（-1 = 音频未启动）
        bgmTrackLabel: bgmTrack ? bgmTrack.label : '',
        bgmTrackSrc: bgmTrack ? bgmTrack.file.split('/').pop() : '',
        bgmTrackCount: trackList().length,
        bgmTrackTrim: selectedTrim(),                // **选中**曲目的表值（立刻变）。
        //   ⚠ 与上面 `bgmTrim`（**正在响**的那一首）不是一回事：切歌途中两者不等，
        //     相等了才说明静音窗口里的母带切换已经落地。UP11 前这个字段读的是 bgmTrack.trim，
        //     与 bgmTrim 完全重合、证明不了任何事 —— AM-015 一并订正。
        bgmSwitching: bgmSwitching,                  // 切歌进行中
        bgmPin: BGM_PIN,                             // ?bgm=<n> 钉选（-1 = 走随机）
        durEst: bgmEl ? +bgmEl.duration.toFixed(3) : 0,   // 元素报的时长（估算值，file:// 下偏长）
        bufferedEnd: +bufferedEndSec.toFixed(3),          // 已缓冲末端（封顶用；也是真实数据末端的代理）
        limiterReduction: limiter ? limiter.reduction : 0,   // dB，<0 即限幅器真的在动作
        foleySpray: lastFoley,          // 采样路补的水花层（⑤）
        // ---- UP9 / AM-010 附加读数（供 94 §4 验收 #1/#2/#6）----
        birds: birdPool ? birdPool.count : 0,        // 海鸟实际播放次数（file:// 下唯一的"出声"证据）
        birdReady: birdPool ? birdPool.ready : false,
        birdMode: birdPool ? birdPool.mode : 'none', // 'graph'（过图+声像）| 'element'（file:// 直放）
        birdAnPeak: (birdPool && birdPool.an) ? peakOf(birdPool.an) : 0,
        birdPan: birdPan ? +birdPan.pan.value.toFixed(4) : null,
        birdTrim: BIRD_TRIM,
        tickTrim: TICK_TRIM,
        ticks: tickPool ? tickPool.count : 0,        // 咔嗒实际播放次数
        tickReady: tickPool ? tickPool.ready : false,
        tickMode: tickPool ? tickPool.mode : 'none',
        tickAnPeak: (tickPool && tickPool.an) ? peakOf(tickPool.an) : 0,
        uiGain: uiGain ? uiGain.gain.value : 0,
        fileProto: IS_FILE, bgmInGraph: bgmInGraph,
        // BGM 文件诊断：区分「加载失败 / 自动播放被拒 / 跨源污染」三种回退原因
        bgmEl: bgmEl ? {
          readyState: bgmEl.readyState, currentTime: bgmEl.currentTime, volume: bgmEl.volume,
          paused: bgmEl.paused, duration: bgmEl.duration,
          err: bgmEl.error ? bgmEl.error.code : 0,
          src: bgmEl.currentSrc ? bgmEl.currentSrc.split('/').pop() : ''
        } : null
      };
    }
  };

  // ------------------------------------------------------------ 气泡（Minnaert）
  // 单个气泡 = 被困空气的体积脉动：p(t) = A·sin(2πft)·e^(-βt)
  //   f 由气泡半径决定（Minnaert 1933），**固定**，不扫频；β 是阻尼（小气泡 f 高、衰减快）。
  //   纯正弦、无谐波 —— 水声是「很多个音高不同的气泡叠加」，不是一个共振体。
  function bubble(t, f, tau, level, bend, out) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    if (bend > 0) {
      // 气泡上浮 → 半径变 → 音调微升（"blooink"）。3%~8% 就够，多了变鸟叫
      o.frequency.exponentialRampToValueAtTime(f * (1 + bend), t + tau * 1.5);
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), t + 0.004);  // 瞬发起音（气泡是瞬间被激发）
    g.gain.exponentialRampToValueAtTime(0.0001, t + tau);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + tau + 0.03);
    return g;
  }

  // 拍击水面 = 「ta -(静默)- po」两段式。
  // ⚠ 前两版是 180→60Hz、320→160Hz 的**下扫正弦** —— 那在合成教科书里就是 kick drum；
  //   纯正弦 + 明确且稳定的音高 = 敲玻璃/不锈钢的听感来源。水根本没有音高。
  //   真实水面要 35~125ms 才闭合、把空气截断成气泡 —— 这段「静默 gap」正是 plop 的真实感来源。
  //   （依据：van den Doel《Physically-based Models for Liquid Sounds》；Minnaert 1933）
  var SLAP_TRANSIENT = 0.014;          // 「ta」瞬态时长
  var BUBBLE_GAP_HARD = 0.040;         // 拍得重 → 水面闭合快
  var BUBBLE_GAP_SOFT = 0.110;         // 拍得轻 → 闭合慢
  var BUBBLE_F_SOFT = 330;             // 小扰动 → 小气泡 → 高频
  var BUBBLE_F_HARD = 175;             // 大扰动 → 大气泡 → 低频

  function click(t, level, x) {
    clickCount++;
    var lv = clamp(level, 0, 1.5);

    // ① 采样优先：真实水声，一次性解决「像拍不锈钢」的问题（合成再怎么调都有音高感）。
    //    失败才往下走气泡合成 —— 那条路是兜底，不是默认。
    if (slapReady && playSlap(lv, x)) { return; }

    var hard = clamp(lv / 1.5, 0, 1);              // 0=轻拍 1=重拍

    // ① 「ta」撞击瞬态：宽频噪声爆发，低通 Q≤0.5（无峰值）。带通会立刻变成「敲」
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.4;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(Math.max(lv * 0.55, 0.0002), t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + SLAP_TRANSIENT + 0.05);
    var n = src(noiseBuf);
    n.connect(lp); lp.connect(ng); ng.connect(handGain);
    n.start(t, rng() * 1.5, SLAP_TRANSIENT + 0.08);
    n.stop(t + SLAP_TRANSIENT + 0.08);

    // ② 「po」主气泡：gap 之后才响。物理一致性 —— 扰动越大，气泡越大，Minnaert 频率越低
    var gap = lerp(BUBBLE_GAP_SOFT, BUBBLE_GAP_HARD, hard);
    var f0 = lerp(BUBBLE_F_SOFT, BUBBLE_F_HARD, hard) * (0.92 + rng() * 0.16);  // ±8% 抖动：同音高重复=机器味
    lastBubbleHz = f0;
    bubble(t + gap, f0, 0.20, lv * 0.62, 0.05, handGain);

    // ②b 气泡分裂：大气泡会碎成小子气泡、由表面张力激发 → 紧随其后的一对。
    //    这是「音高被糊掉」的关键：单一纯正弦 = 明确音高 = 不锈钢；
    //    2~3 个非整数倍频同时衰减 = 没有可辨认的音高 = 水。
    var split = 1 + Math.floor(rng() * 2);
    for (var j = 0; j < split; j++) {
      bubble(t + gap + 0.012 + rng() * 0.03,
             f0 * (1.4 + rng() * 0.8),
             0.09 + rng() * 0.05,
             lv * 0.26, 0.04, handGain);
    }

    // ③ droplets：后落的小水珠 → 高频小气泡，随机延迟、极短衰减（>30ms 就开始"叮"了）
    var k = 2 + Math.floor(rng() * 3);
    for (var i = 0; i < k; i++) {
      bubble(t + 0.08 + rng() * 0.18,
             900 + rng() * 1600,
             0.014 + rng() * 0.020,
             lv * (0.07 + rng() * 0.10), 0.06, handGain);
    }

    // ④ 水体余韵：极低频一小段 —— 给「量感/体积」，不是音高
    var bl = ctx.createBiquadFilter();
    bl.type = 'lowpass'; bl.frequency.value = 130; bl.Q.value = 0.5;
    var bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(Math.max(lv * 0.22, 0.0002), t + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    var bn = src(pinkBuf);
    bn.connect(bl); bl.connect(bg); bg.connect(handGain);
    bn.start(t, rng() * 3, 0.36);
    bn.stop(t + 0.36);
  }

  // ------------------------------------------------------ splash 订阅（§3）
  // 唯一的信息来源：SW.bus 的 splash 事件。不直接调 SW.input / SW.ripple。
  // UP5 / AM-012：payload 里**本来就带 `x`**（`70-input.js:54` → {x, z, speed01}）——
  //   所以声像不需要任何跨模块新增字段，`70-input.js` 一个字节都不用改。
  SW.bus.on('splash', function (p) {
    if (!api.ready) { return; }
    var s = (p && typeof p.speed01 === 'number') ? p.speed01 : 0;
    var x = (p && typeof p.x === 'number') ? p.x : 0;
    api.playHand(s, x);
  });

  SW.audio = api;
})(window.SW = window.SW || {}, window);
