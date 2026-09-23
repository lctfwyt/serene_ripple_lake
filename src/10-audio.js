// src/10-audio.js —— 所有者：WP4
// 签名逐字对齐 01-CONTRACT.md §2.1：{ ready, init, setEnabled, playHand, duck, suspend, resume, probe }
//
// 三总线：bgm（音乐床，被 hand duck） / hand（划水 + 点击） / amb（水拍岸 + 风）
//   source ──┬── bgm  (Gain) ──┐
//            ├── hand (Gain) ──┼──→ limiter ──→ master ──→ destination
//            └── amb  (Gain) ──┘
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
  // 片段集：从 slap.mp3（29s 连续戏水）里按「低频能量占比」自动挑出的 4 个低沉厚重片段，
  //   每个 0.55s，已统一峰值 + 淡入淡出（生成脚本见 plan/_STATUS.md 的 WP4-sfx2 记录）。
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

  function now() { return ctx ? ctx.currentTime : 0; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

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
    bgmGain.connect(limiter); handGain.connect(limiter); ambGain.connect(limiter);

    // ⚠ 体检点：analyser 串在链路里（不是旁挂 —— 不接到 destination 的节点不会被处理）
    anBgm = ctx.createAnalyser(); anBgm.fftSize = 1024;
    bgmSrc = ctx.createGain(); bgmSrc.gain.value = 1;
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
    // ⚠ 采样池延迟建：实测启动瞬间同时存在 5 个媒体元素（1 BGM + 4 采样）时，
    //   BGM 会卡在「paused=false 但 currentTime 不推进」——播不动。错峰 2s 就好了。
    window.setTimeout(buildSlap, SLAP_DELAY);
  }

  // 拍击采样池：每个片段一个元素，轮流用。任一元素 canplay 即置 slapReady。
  function buildSlap() {
    if (slapPool.length) { return; }
    var files = P.slapFiles || SLAP_FILES;
    for (var i = 0; i < files.length; i++) {
      var el;
      try { el = new window.Audio(); } catch (e) { return; }
      el.src = files[i];
      el.preload = 'auto';
      el.volume = 0;
      el.addEventListener('canplay', function () { slapReady = true; });
      slapPool.push(el);
    }
  }

  // 播一次采样。返回 false 表示没播成（调用方要退回气泡模型 —— 保证点击永远有声）
  function playSlap(lv) {
    buildSlap();                       // 还没到延迟时间就被点了 → 立即建
    if (!slapPool.length) { return false; }
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
      // 音量：片段已统一峰值，这里只留很窄的力度响应（0.85~1.0），避免"忽大忽小"
      var hard = clamp((lv - 0.55) / 0.35, 0, 1);
      el.volume = clamp(P.handVolume * SLAP_TRIM * (0.85 + 0.15 * hard), 0, 1);
      var p = el.play();
      if (p && p['catch']) { p['catch'](function () { }); }
      slapCount++;
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
    handEnv.connect(anHand); anHand.connect(handGain);

    // ④ 混响支路：水声用**短**混响（1.2s，衰减快），长混响会糊成一片嗡。
    //    IR 单声道省一半 CPU；湿声不进体检点（混响尾巴会污染 peak 读数）
    handConv = ctx.createConvolver();
    handConv.buffer = makeIR(1.2, 3.4, true);
    handWet = ctx.createGain(); handWet.gain.value = 0.38;
    handEnv.connect(handConv); handConv.connect(handWet); handWet.connect(handGain);

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

  // 下达包络目标。setTargetAtTime 从「当前值」指数逼近 —— 连续调用不会跳变，
  // 天然就是淡入（上升）与淡出（下降），不需要 ramp 也不会产生脉冲。
  function flowCmd(t) {
    if (!handEnv) { return; }
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
    var url = P.bgmFile;
    if (!url) { return startSynthBgm(); }
    var el;
    try { el = new window.Audio(); } catch (e) { return startSynthBgm(); }
    bgmEl = el;
    el.src = url;                       // ⚠ 别漏：不设 src 就没有 error 事件，兜底永远不触发
    el.loop = true;
    el.preload = 'auto';
    el.volume = clamp(P.bgmVolume, 0, 1);
    // ⚠ 只在 http(s) 下加 crossOrigin：file:// 加它会直接导致加载失败
    if (/^https?:/i.test(url)) { el.crossOrigin = 'anonymous'; }

    var isFile = /^file:/i.test(window.location.href);
    var an = null;
    if (!isFile) {
      try {
        var node = ctx.createMediaElementSource(el);
        fileGain = ctx.createGain(); fileGain.gain.value = 1;
        an = ctx.createAnalyser(); an.fftSize = 1024;
        node.connect(an); an.connect(fileGain); fileGain.connect(bgmSrc);
      } catch (e) { an = null; }        // 建图失败就退回元素直放
    }

    var settled = false;
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
          var buf = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(buf);
          var peak = 0;
          for (var i = 0; i < buf.length; i++) { var a = Math.abs(buf[i]); if (a > peak) { peak = a; } }
          if (peak < 1e-4) { return fallback('silent (tainted)'); }
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

  function startBgm() {
    var mode = P.audioMode;
    if (mode === 'synth') { startSynthBgm(); return; }
    if (mode === 'file') { tryFileBgm(); return; }
    tryFileBgm();   // 'auto'：文件能出声就用，否则 tryFileBgm 内部会退回合成
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
    playHand: function (speed01) {
      if (!ctx || !enabled || !handEnv) { return; }
      var t = now();
      var s = clamp(speed01, 0, 1);

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
        click(t, 0.30 + 0.20 * s);
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

      // file:// 下 BGM 是元素直放、不经过 bgmGain → 把同一条让位曲线手动写到 el.volume
      if (bgmMode === 'file' && bgmEl) {
        bgmEl.volume = clamp(low, 0, 1);
        if (duckTimer) { window.clearTimeout(duckTimer); }
        duckTimer = window.setTimeout(function () {
          duckTimer = 0;
          if (bgmEl) { bgmEl.volume = clamp(P.bgmVolume, 0, 1); }
        }, (P.duckDown + P.duckUp) * 1000);
      }
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

  function click(t, level) {
    clickCount++;
    var lv = clamp(level, 0, 1.5);

    // ① 采样优先：真实水声，一次性解决「像拍不锈钢」的问题（合成再怎么调都有音高感）。
    //    失败才往下走气泡合成 —— 那条路是兜底，不是默认。
    if (slapReady && playSlap(lv)) { return; }

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
  SW.bus.on('splash', function (p) {
    if (!api.ready) { return; }
    var s = (p && typeof p.speed01 === 'number') ? p.speed01 : 0;
    api.playHand(s);
  });

  SW.audio = api;
})(window.SW = window.SW || {}, window);
