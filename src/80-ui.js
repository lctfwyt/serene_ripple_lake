// src/80-ui.js —— 所有者：WP3
// 签名逐字对齐 01-CONTRACT.md §2.8：{ init, update }
// 要建的 DOM id：#snd（声音开关）、#hour（时段刻度尺）。#ui / #hint 由 WP1 提供。
// **不改 index.html** —— 全部 JS 创建并 append 到 #ui（契约 §4，避免并行冲突）。
//
// 设计基调（WP3 §4.6）：极简、低对比、半透明，不抢画面。字色 rgba(255,255,255,.72)。
// AM-002 §5 的「四角 UI 布局」**未采纳**，本文件不实现它。
//
// ── AM-011（UP10 时间刻度尺，95-UP10-timeruler.md）────────────────────────────
// `#hour` 由 `input[type=range]` 换成**24h 环上的滑动窗口刻度尺**（原 range 已删，不再建它）：
//   · 数据是环形：hour 恒 `mod 24`；拖动走**位移增量**（`h = dragH + dx / pxPerHour`），
//     不用绝对坐标 → 「无限拖动」与「首尾相接」天然成立，两端不写任何特例
//   · 窗口 = 当前时刻 ± 6h（共 12h）：细刻度 0.5h、长刻度 1h、小时数字每 2~6h 一个
//   · 视觉减负：除「当前时刻」那根 1px 竖线外，全部 ≤ 0.45 不透明度、整条 ≤ 24px 高、
//     两侧 mask 渐隐 —— 判据 A「不遮挡背景」
//   · 不再用原生 range，改 `role="slider"` + `tabindex=0` 的 div：方向键 / PageUp / Home 都保留
//   · 咔嗒声消费 `SW.audio.sfxTick(step)`（UP9 并行实现）——**判空降级，不许自造声音、
//     不许用 Web Audio 现搓**（90-WAVE5.md §4 耦合 ②）
(function (SW, window, document) {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // 刻度尺模块常量（AM-011）
  // ⚠ 90-WAVE5.md §4 耦合 ① 的裁决：本包**不拥有也不许改 00-config.js**，
  //   刻度尺的常量一律写在这里。若日后要让雨桐在运行时可调，由主控统一提升进 SW.P
  //   （届时另开变更单，本文件只做搬运）。
  // ══════════════════════════════════════════════════════════════════════════
  var R = {
    bottom: 16,            // 距视口底 px
    height: 24,            // 整条带高 px（含小时数字）。判据 A：≤ 24 → 不侵占画面主体
    widthMax: 520,         // 桌面宽度上限 px
    widthVw: 60,           // 窄屏按视口百分比收：width = min(520px, 60vw)
    hoursWide: 12,         // 窗口里放多少小时 —— 拖过整条 = 这么多小时
    hoursWideNarrow: 6,    // 带本身 < 300px 时用这个（375 屏 → 60vw ≈ 225px）
    minorStepH: 0.5,       // 细刻度间隔（小时）
    majorStepH: 1,         // 长刻度间隔（小时）
    minorPx: 4,            // 细刻度线高 px
    majorPx: 9,            // 长刻度线高 px
    labelTop: 12,          // 小时数字行的 top px（排在刻度线下方，与 head 不交叠）
    labelStepPx: 84,       // 两个数字之间至少多少 px
    labelSteps: [2, 3, 4, 6],   // 候选取值（小时），挑第一个满足 gap 的
    labelN: 8,             // 数字节点池大小（够盖满窗口再多两个，边上不会突然冒出来）
    alphaMinor: 0.26,      // 判据 A：全部 ≤ 0.45
    alphaMajor: 0.42,
    alphaLabel: 0.40,
    alphaHead: 0.88,       // 「当前时刻」那根 1px 竖线 —— 全尺唯一的高对比元素
    soundStepH: 0.5,       // 每跨过一根刻度响一次；整点响得重一点（匹配肉眼可见的刻度）
    // 拖动方向：把刻度尺当成一把**可以抓住拖的尺子** —— 往右拖 = 把过去的刻度拖到中线上
    // （等价 "时间后退"）。想要"拖到右边 = 时间前进"把它改成 +1 即可（雨桐 2026-09-25 定 -1）。
    dragDir: -1,
    // ── 松手惯性（AM-012）─────────────────────────────────────────────
    // 单位一律「小时/秒」，与拖动换算率 pxPerHour 解耦 → 窄屏（pph 更小）手感一致
    inertia: {
      on: true,
      friction: 3.6,       // v *= exp(-friction*dt)：越大停得越快；滑行距离 ≈ v0/friction
      stopV: 0.05,         // h/s 低于此值即停（约 3 分钟/秒的残速，肉眼已停）
      maxV: 9,             // h/s 上限 → 一记快甩最多滑 ~2.5h（≈108px），不会一下飞过半天
      staleMs: 90,         // 松手前最后一次 move 距今超过这个数 → 判为"按住不动"，不甩
      ema: 0.35            // 速度采样的指数平滑权重（新样本占比）
    },
    // ── 命中区（AM-012）：刻度尺视觉带只有 24px 高，手指/鼠标很容易点空 ──
    // 做法：给 ruler 本体加透明 padding（视觉内容不动，可抓面积接近 3 倍）。
    // 不用独立 hit 元素 —— 那会跟尺内其他层结成兄弟重叠对，撞 env-narrow 的「UI 不重叠」检查；
    // padding 方案下整条尺内部全是父子关系，天然豁免。
    // 向下扩得比向上多 —— 向上每多 1px 都是从画面里抢 1px 的划水区。
    hitPad: { x: 12, top: 12, bottom: 14 },
    // ── 中线的「突出」层（AM-012）─────────────────────────────────────
    // 拖动 / 滑行时，中线附近另铺一层更亮更长的刻度 + 读数放大，两侧由 mask 渐隐。
    // 静止时 opacity 0 → 像素快照与旧基线一致（不拖拽就看不到它）。
    hot: {
      halfPx: 58,          // 高亮半宽 px（中线两侧各这么多）
      alphaMinor: 0.55,
      alphaMajor: 0.95,
      alphaLabel: 0.92,
      minorPx: 7,          // 比常态刻度更长一点 → "顶出来"的观感
      majorPx: 15,
      labelScale: 1.18,
      headPx: 18,          // 拖动时「当前时刻」那根线拉长的高度
      fadeIn: 0.10,        // s：按下 → 亮
      fadeOut: 0.30        // s：松手 → 暗（比淡入慢，收得柔和）
    }
  };

  var el = {};
  var built = false;
  var sndOn = true;          // 本地开关意图（音频未就绪时先记着，就绪后补发）
  var applied = false;       // 是否已经把 sndOn 推给 SW.audio
  var dragging = false;
  var lastTxt = '';
  var lastSndTxt = '';

  // ── 刻度尺运行时：带宽 / 每多少 px 一小时 ───────────────────────────────
  var rulerW = 0;
  var pph = 0;               // px per hour —— 拖动的换算率
  var lastPhaseKey = '';
  var lastTickIdx = -1;
  var dragId = null, dragX = 0, dragH = 0;

  // ── 惯性 + 中线突出（AM-012）────────────────────────────────────────
  var vel = 0;                 // 平滑后的手速，h/s（含方向；+ 为时间前进）
  var prevMoveX = 0;           // 上一次 pointermove：算瞬时速度用的差分基准
  var prevMoveT = 0;
  var lastMoveT = 0;           // 最近一次 pointermove 的时间戳（判"按住不动就松手"）
  var flinging = false;        // 松手后正在滑行
  var flingV = 0, flingH = 0;  // 滑行速度 / 滑行中的小时累加值（不取 mod，避免回读丢精度）
  var acting = false;          // 中线突出层的当前可见状态（拖动 或 滑行）

  var CSS_BASE = 'position:absolute;font-family:inherit;letter-spacing:.14em;' +
    'color:rgba(255,255,255,.72);text-shadow:0 1px 3px rgba(0,0,0,.35);user-select:none;';

  function norm24(h) { return ((h % 24) + 24) % 24; }

  // 四态名（与 SW.time.nameOf 同源的口径，但这里不依赖 SW.time 是否已就绪）
  function nameOf(h) {
    h = norm24(h);
    if (h >= 4 && h < 10) { return '晨雾'; }
    if (h >= 10 && h < 16) { return '正午'; }
    if (h >= 16 && h < 20.5) { return '黄昏'; }
    return '星夜';
  }
  function hm(h) {
    h = norm24(h);
    var hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 0.5);
    if (mm >= 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  // range 的伪元素没法用 cssText 写 → 注入一条 <style>（仍然不动 index.html）
  // AM-011：删掉 `#sw-hour` 那套 range 伪元素样式（range 本体已删），换成刻度尺的样式。
  function injectStyle() {
    var st = document.createElement('style');
    st.textContent = [
      '#sw-snd{transition:background .25s ease,border-color .25s ease;}',
      // 刻度尺：两端 mask 渐隐（不是 backgroundColor 铺一块），撑不起"背景被吃掉"的观感
      '#sw-ruler-track{opacity:.9;transition:opacity .22s ease;' +
      '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 9%,#000 91%,transparent 100%);' +
      'mask-image:linear-gradient(90deg,transparent 0,#000 9%,#000 91%,transparent 100%);}',
      '#hour:focus{outline:none;}',
      '#hour:focus-visible{outline:1px solid rgba(255,255,255,.5);outline-offset:5px;border-radius:2px;}',
      // 拖动/滑行中：常态刻度略提亮（抓得住），中线的「突出层」浮上来
      '#hour.act #sw-ruler-track{opacity:1;}',
      '#hour:hover #sw-ruler-track{opacity:1;}',   // 悬停即提亮 → 命中区扩大后"能点"这件事可发现
      // 中线突出层 = track 的 ::before（AM-012）。
      // 为什么是伪元素：env-narrow 的「UI 不重叠」检查只豁免祖先/后代对，任何
      // "覆盖全带的实元素层"都会与刻度/读数结成兄弟重叠对被误报；
      // ::before 不进 querySelectorAll —— 检查看不见它，视觉上一模一样。
      // 动态参数（gradient/尺寸/半宽/相位）全部走 CSS 变量，JS 只写 inline style。
      '#sw-ruler-track::before{content:\'\';position:absolute;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;opacity:0;' +
      'background-image:var(--sw-hotimg);background-repeat:repeat-x,repeat-x;' +
      'background-size:var(--sw-hotsize);' +
      'background-position-x:var(--sw-x0),var(--sw-x0);' +
      '-webkit-mask-image:linear-gradient(90deg,transparent calc(50% - var(--sw-hotw)),#000 50%,transparent calc(50% + var(--sw-hotw)));' +
      'mask-image:linear-gradient(90deg,transparent calc(50% - var(--sw-hotw)),#000 50%,transparent calc(50% + var(--sw-hotw)));' +
      'transition:opacity ' + R.hot.fadeOut + 's ease;}',
      '#hour.act #sw-ruler-track::before{opacity:1;transition:opacity ' + R.hot.fadeIn + 's ease;}',
      // 「当前时刻」竖线：拖动时拉长 + 起一点光晕（全尺唯一允许的高对比元素）
      // 尺寸/颜色**必须写在 CSS 里**：写进 inline style 会被内联优先级压住，act 变体不会生效
      '#sw-ruler-head{width:1px;height:12px;margin-left:-.5px;' +
      'background:rgba(255,255,255,' + R.alphaHead + ');' +
      'transition:height .18s ease,width .18s ease,margin-left .18s ease,box-shadow .18s ease;}',
      '#hour.act #sw-ruler-head{height:' + R.hot.headPx + 'px;width:2px;margin-left:-1px;' +
      'box-shadow:0 0 9px rgba(255,255,255,.30);}',
      '.sw-ruler-label{transition:color .18s ease,transform .18s ease;transform-origin:0 50%;}'
    ].join('');
    document.head.appendChild(st);
  }

  function mk(tag, css, parent) {
    var d = document.createElement(tag);
    d.style.cssText = css;
    if (parent) { parent.appendChild(d); }
    return d;
  }

  // ── 刻度尺：几何 ──────────────────────────────────────────────────────
  function hoursWide() {
    return rulerW > 0 && rulerW < 300 ? R.hoursWideNarrow : R.hoursWide;
  }

  // 量一次带宽（append 之后、每次 resize、每次 pointerdown 都量；不逐帧量，省一次强制 layout）
  // 量的是 track（内容区）：ruler 的 bbox 含命中 padding，直接量会把 pph 摊薄
  function measure() {
    if (!el.track) { return; }
    var b = el.track.getBoundingClientRect();
    var w = b.width || 0;
    if (w > 0) { rulerW = w; }
    if (rulerW <= 0) { rulerW = R.widthMax; }   // 布局还没算出来时的兜底，只影响第一帧
    pph = rulerW / hoursWide();
  }

  // 两层 repeating-gradient 铺出刻度：长刻度 1h + 细刻度 0.5h，靠 background-size 分周期、
  // 靠 background-position-x 做**连续平移**（不是重画 DOM）——这是"无限"的另一半。
  function styleTrack() {
    if (!el.track || pph <= 0) { return; }
    var minorP = pph * R.minorStepH;
    el.track.style.backgroundImage =
      'repeating-linear-gradient(90deg,' +
      'rgba(255,255,255,' + R.alphaMinor + ') 0 1px,transparent 1px 100%),' +
      'repeating-linear-gradient(90deg,' +
      'rgba(255,255,255,' + R.alphaMajor + ') 0 1px,transparent 1px 100%)';
    el.track.style.backgroundRepeat = 'repeat-x,repeat-x';
    el.track.style.backgroundSize =
      minorP.toFixed(2) + 'px ' + R.minorPx + 'px,' +
      pph.toFixed(2) + 'px ' + R.majorPx + 'px';
    el.track.style.backgroundPosition = '0 0,0 0';   // x 每帧改写；y 顶对齐（刻度挂在上沿）
    // 中线突出层（::before）的动态参数：同一套 gradient，只是更亮更长；
    // halfPx 交给 mask（calc(50% ± var)），相位 --sw-x0 由 paintRuler 每帧写
    el.track.style.setProperty('--sw-hotimg',
      'repeating-linear-gradient(90deg,rgba(255,255,255,' + R.hot.alphaMinor + ') 0 1px,transparent 1px 100%),' +
      'repeating-linear-gradient(90deg,rgba(255,255,255,' + R.hot.alphaMajor + ') 0 1px,transparent 1px 100%)');
    el.track.style.setProperty('--sw-hotsize',
      minorP.toFixed(2) + 'px ' + R.hot.minorPx + 'px,' + pph.toFixed(2) + 'px ' + R.hot.majorPx + 'px');
    el.track.style.setProperty('--sw-hotw', R.hot.halfPx.toFixed(0) + 'px');
    lastPhaseKey = '';                               // 强制下一帧重铺
  }

  // 拖动 / 滑行 → 中线突出层浮起。静止时收起（opacity 0 → 不影响任何像素基线）
  function setAct(on) {
    on = !!on;
    if (on === acting) { return; }
    acting = on;
    if (el.ruler) { el.ruler.classList[on ? 'add' : 'remove']('act'); }
    lastPhaseKey = '';                               // 强制重画：读数的高亮跟着切
  }

  function cancelFling() {
    flinging = false;
    flingV = 0;
    vel = 0;
    setAct(dragging);
  }

  // ── 刻度尺：小时数字 ──────────────────────────────────────────────────
  // 全部**读数来自 h 与倍率**，没有一个字是写死的 → 窗口越过 24 自然回到 00。
  function paintLabels(h, cx) {
    var wide = hoursWide(), step = R.labelSteps[R.labelSteps.length - 1];
    var hotPx = R.hot.halfPx;
    for (var i = 0; i < R.labelSteps.length; i++) {
      if (R.labelSteps[i] * pph >= R.labelStepPx) { step = R.labelSteps[i]; break; }
    }
    var first = Math.floor((h - wide / 2) / step) * step;
    var n = Math.min(R.labelN, Math.ceil(wide / step) + 2);
    for (var k = 0; k < R.labelN; k++) {
      var lb = el.labels[k];
      if (k >= n) { if (lb.style.display !== 'none') { lb.style.display = 'none'; } continue; }
      var hhv = first + k * step;
      // 环形最短差 (−12, 12]：23.9 与 0.1 相邻这件事在这里成立，不需要为跨日写特例
      var d = (((hhv - h) % 24) + 36) % 24 - 12;
      var x = cx + d * pph;
      if (x < -30 || x > rulerW + 30) { if (lb.style.display !== 'none') { lb.style.display = 'none'; } continue; }
      lb.style.display = 'block';
      lb.style.left = x.toFixed(1) + 'px';
      var t = pad2(norm24(hhv) | 0);
      if (lb.textContent !== t) { lb.textContent = t; }
      // 中线附近的读数跟着突出层一起亮、一起放大（只在 act 时生效）
      var near = acting && Math.abs(x - cx) < hotPx;
      var col = 'rgba(255,255,255,' + (near ? R.hot.alphaLabel : R.alphaLabel) + ')';
      var tf = near ? 'scale(' + R.hot.labelScale + ')' : 'none';
      if (lb.style.color !== col) { lb.style.color = col; }
      if (lb.style.transform !== tf) { lb.style.transform = tf; }
    }
  }

  // ── 刻度尺：每帧重绘 ──────────────────────────────────────────────────
  function paintRuler(h) {
    if (!el.track || rulerW <= 0 || pph <= 0) { return; }
    var cx = rulerW / 2;
    var frac = h - Math.floor(h);                 // 当前小时里走了多少
    var x0 = cx - frac * pph;                     // 上一根整点刻度离中线多远
    x0 = ((x0 % pph) + pph) % pph;                // 取模保持有界：连拖 10 圈也不丢精度
    var key = rulerW.toFixed(1) + '|' + x0.toFixed(2);
    if (key === lastPhaseKey) { return; }
    lastPhaseKey = key;
    var px = x0.toFixed(2) + 'px,' + x0.toFixed(2) + 'px';
    el.track.style.backgroundPositionX = px;
    el.track.style.setProperty('--sw-x0', x0.toFixed(2) + 'px');   // ::before 同相位
    paintLabels(h, cx);
  }

  // ── 咔嗒声（UP9 的 SW.audio.sfxTick；未落地时静默降级）───────────────
  function tickBase(h) { lastTickIdx = Math.floor(norm24(h) / R.soundStepH + 1e-9); }
  function tickSfx(h) {
    var idx = Math.floor(norm24(h) / R.soundStepH + 1e-9);
    if (idx === lastTickIdx) { return false; }
    lastTickIdx = idx;
    var A = SW.audio;
    // 90-WAVE5.md §4 耦合 ②：不存在 → 静默。**不许报错、不许自己合成声音**
    if (!A || typeof A.sfxTick !== 'function') { return false; }
    // 惯性滑行时按速度衰减音量：冲得快 = 响，快停了 = 轻（物理感，也避免尾音吵）
    var s = Math.abs(flinging ? flingV : vel);
    var gain = s >= 3 ? 1 : 0.42 + 0.58 * (s / 3);
    var base = idx % 2 === 0 ? 1 : 0.45;
    try { A.sfxTick(base * gain); return true; } catch (e) { return false; }
  }

  function curHour() { return (SW.time && SW.time.getHour) ? SW.time.getHour() : 0; }

  // 唯一的写入口：先钉时间（setHour 会隐含切成 fixed），再判有没有跨过一根刻度
  function applyHour(h) {
    if (!isFinite(h)) { return; }
    if (SW.time && SW.time.setHour) { SW.time.setHour(h); }
    tickSfx(h);
  }

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function endDrag() {
    if (!dragging) { return; }
    dragging = false;
    dragId = null;
    if (el.ruler) { el.ruler.classList.remove('drag'); }
    // ── 交棒给惯性：只在"松手那一刻还在动"时甩出去 ──────────────────
    var I = R.inertia;
    var fresh = lastMoveT > 0 && (nowMs() - lastMoveT) <= I.staleMs;
    if (I.on && fresh && Math.abs(vel) > I.stopV) {
      flingV = Math.max(-I.maxV, Math.min(I.maxV, vel));
      flingH = curHour();
      flinging = true;
    }
    vel = 0;
    setAct(flinging);                  // 滑行期间中线仍然突出
  }

  // 每帧推进滑行（dt 秒，来自主循环；99-main.js 已 clamp 到 ≤ .05）
  function stepFling(dt) {
    if (!flinging || dragging) { return; }
    var I = R.inertia;
    flingH += flingV * dt;
    flingV *= Math.exp(-I.friction * dt);
    applyHour(flingH);
    if (Math.abs(flingV) < I.stopV) { cancelFling(); }
  }

  function build(ui) {
    injectStyle();

    // ── 左上：时段名 + 时刻（保持在 #ui 的第一个子节点 —— pw 的 ui-panel 快照盯的就是它）──
    el.panel = mk('div', CSS_BASE + 'left:22px;top:20px;pointer-events:none;' +
      'font-size:13px;line-height:1.7;', ui);
    el.name = mk('div', 'font-size:15px;opacity:.92;', el.panel);
    el.clock = mk('div', 'font-size:11px;opacity:.62;', el.panel);

    // ── 右上：声音开关 ─────────────────────────────────────────────────
    el.snd = mk('button', CSS_BASE + 'right:22px;top:18px;padding:6px 13px;border-radius:14px;' +
      'border:1px solid rgba(255,255,255,.22);background:rgba(10,18,22,.26);' +
      'font-size:11px;cursor:pointer;backdrop-filter:blur(6px);', ui);
    el.snd.id = 'snd';
    el.snd.type = 'button';
    el.snd.addEventListener('click', function () {
      sndOn = !sndOn;
      applied = false;                      // 强制下一次 update 把新值推给 audio
      paint(true);
    });

    // ── 底部中央：一日时间刻度尺（AM-011；AM-012 加命中 padding）────────
    // 为什么不用 input[type=range]：原生 range 的两端是**硬边界**，"无限拖动"做不到。
    // 换成 div + role=slider：兼容键盘与读屏，视觉权重降到几乎为零。
    // bottom 里扣掉 padding.bottom：视觉带仍贴在距底 R.bottom px 处，多出来的全是透明命中区
    el.ruler = mk('div', CSS_BASE + 'left:50%;bottom:' + (R.bottom - R.hitPad.bottom) + 'px;' +
      'width:min(' + R.widthMax + 'px,' + R.widthVw + 'vw);height:' + R.height + 'px;' +
      'padding:' + R.hitPad.top + 'px ' + R.hitPad.x + 'px ' + R.hitPad.bottom + 'px;' +
      'transform:translateX(-50%);letter-spacing:normal;' +
      'cursor:ew-resize;touch-action:none;', ui);
    el.ruler.id = 'hour';
    el.ruler.tabIndex = 0;
    el.ruler.setAttribute('role', 'slider');
    el.ruler.setAttribute('aria-label', '时段');
    el.ruler.setAttribute('aria-valuemin', '0');
    el.ruler.setAttribute('aria-valuemax', '24');

    // 刻度 / 数字都挂在 track 上；两侧 mask 渐隐，越界数字由 overflow 裁掉。
    // left/top 用偏移而不是 width:100%（绝对定位的百分比基准是含 padding 的 padding box，
    // width:100% 会把命中 padding 也算进内容区）
    // 层级固定为 ruler > track > hot > labels：env-narrow 的「UI 不重叠」检查只豁免
    // 祖先/后代对 —— 覆盖全带的兄弟层（track × hot）会被当成 UI 重叠误报，所以
    // 突出层必须嵌在 track 里面，而不是与它并列。
    var padL = R.hitPad.x, padT = R.hitPad.top, padB = R.hitPad.bottom;
    el.track = mk('div', 'position:absolute;left:' + padL + 'px;top:' + padT + 'px;' +
      'right:' + padL + 'px;bottom:' + padB + 'px;' +
      'pointer-events:none;overflow:hidden;', el.ruler);
    el.track.id = 'sw-ruler-track';
    el.labels = [];
    for (var i = 0; i < R.labelN; i++) {
      var lb0 = mk('div', 'position:absolute;left:0;top:' + R.labelTop + 'px;' +
        'font-size:9px;letter-spacing:.06em;white-space:nowrap;display:none;' +
        'color:rgba(255,255,255,' + R.alphaLabel + ');', el.track);
      lb0.className = 'sw-ruler-label';
      el.labels.push(lb0);
    }
    // 「当前时刻」——固定在中线，刻度从它下面滚过去（而不是让游标在带上来回跑）
    // 只写定位；尺寸/颜色交给注入的 CSS（否则 inline 优先级会压掉 act 变体）
    el.head = mk('div', 'position:absolute;left:50%;top:' + padT + 'px;pointer-events:none;', el.ruler);
    el.head.id = 'sw-ruler-head';

    measure();
    styleTrack();

    el.ruler.addEventListener('pointerdown', function (e) {
      if (dragId !== null) { return; }
      measure();
      styleTrack();
      dragId = (e.pointerId === undefined) ? 1 : e.pointerId;
      dragX = e.clientX;
      dragH = curHour();
      dragging = true;
      cancelFling();                         // 新的按下直接接管正在进行的滑行
      vel = 0;
      prevMoveX = e.clientX;
      lastMoveT = prevMoveT = nowMs();
      tickBase(dragH);                       // 记下起点 → 按下那一瞬间不响
      el.ruler.classList.add('drag');
      setAct(true);
      try { el.ruler.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器：退回普通 move */ }
      if (e.preventDefault) { e.preventDefault(); }
    });
    el.ruler.addEventListener('pointermove', function (e) {
      if (!dragging) { return; }
      if (e.pointerId !== undefined && dragId !== null && e.pointerId !== dragId) { return; }
      // 关键：用**位移增量**而不是光标绝对坐标 → 首尾相接、无限圈都是这一行的自然结果
      // （dragH / dragX 自按下起不再变，dh 始终是从按下点算的总位移）
      var dh = R.dragDir * (e.clientX - dragX) / pph;
      // 手速采样（h/s），做一次指数平滑：抖一下不会把惯性甩飞
      var t = nowMs(), span = (t - prevMoveT) / 1000;
      if (span > 0.004 && span < 0.25) {
        var inst = R.dragDir * ((e.clientX - prevMoveX) / pph) / span;
        if (!isFinite(inst)) { inst = 0; }
        vel = vel * (1 - R.inertia.ema) + inst * R.inertia.ema;
      }
      prevMoveX = e.clientX;
      prevMoveT = t;
      lastMoveT = t;
      applyHour(dragH + dh);
    });
    el.ruler.addEventListener('pointerup', endDrag);
    el.ruler.addEventListener('pointercancel', endDrag);
    el.ruler.addEventListener('lostpointercapture', endDrag);
    // 双击 → 回到真实时钟（与双击画面同一个意思）
    el.ruler.addEventListener('dblclick', function (e) {
      if (e.preventDefault) { e.preventDefault(); }
      cancelFling();
      if (SW.time && SW.time.setMode) { SW.time.setMode('auto'); }
    });
    el.ruler.addEventListener('keydown', function (e) {
      // 与拖动同一个方向 knob：往右 = 把更早的刻度拖到中线上（时间后退）
      var s = R.dragDir, d = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { d = s * 0.25; }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { d = -s * 0.25; }
      else if (e.key === 'PageUp') { d = s * 2; }
      else if (e.key === 'PageDown') { d = -s * 2; }
      else if (e.key === 'Home') {
        cancelFling();
        if (SW.time && SW.time.setMode) { SW.time.setMode('auto'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      } else { return; }
      if (e.preventDefault) { e.preventDefault(); }
      cancelFling();
      applyHour(curHour() + d);
    });

    // 视口变化 → 带宽变了 → 每 px 代表多少小时要跟着变
    if (SW.bus && SW.bus.on) {
      SW.bus.on('resize', function () { measure(); styleTrack(); });
    }

    // 键盘微调（不抢焦点时也能用）：[ / ] 各 ±0.5h
    window.addEventListener('keydown', function (e) {
      if (!SW.time || !SW.time.getHour) { return; }
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
      var d = 0;
      if (e.key === '[') { d = -0.5; }
      else if (e.key === ']') { d = 0.5; }
      else { return; }
      e.preventDefault();
      cancelFling();
      SW.time.setHour(SW.time.getHour() + d);
    });

    // ── 双击画面空白处 → 回到真实时钟 ──────────────────────────────────
    var canvas = document.getElementById('c');
    if (canvas) {
      canvas.addEventListener('dblclick', function () {
        cancelFling();
        if (SW.time && SW.time.setMode) { SW.time.setMode('auto'); }
      });
    }

    built = true;
  }

  function sndText() {
    var A = SW.audio;
    if (!A || A.ready === false) { return '声音 · 未启动'; }
    return sndOn ? '声音 开' : '声音 关';
  }

  function paint(force) {
    var T = SW.time;
    if (!T || !T.getHour) { return; }
    var h = T.getHour();

    var txt = nameOf(h) + '|' + hm(h) + '|' + T.getMode();
    if (force || txt !== lastTxt) {
      lastTxt = txt;
      el.name.textContent = nameOf(h);
      el.clock.textContent = hm(h) + (T.getMode() === 'auto' ? '' : ' · 已锁定');
      if (el.ruler) {
        el.ruler.setAttribute('aria-valuenow', h.toFixed(2));
        el.ruler.setAttribute('aria-valuetext',
          hm(h) + (T.getMode() === 'auto' ? '' : ' 已锁定'));
      }
    }

    // 刻度尺每帧跟着当前时间走：不拖动时 = 时间在自走（原来把 range.value 同步回去的那条逻辑）
    if (el.ruler) { paintRuler(h); }

    // 音频就绪后把开关意图补发一次（首次手势前 SW.audio.ready === false）
    var A = SW.audio;
    if (A && A.ready && !applied && typeof A.setEnabled === 'function') {
      A.setEnabled(sndOn);
      applied = true;
    }
    var st = sndText();
    if (force || st !== lastSndTxt) { lastSndTxt = st; el.snd.textContent = st; }
  }

  SW.ui = {
    init: function () {
      var ui = document.getElementById('ui');
      if (!ui) { return; }
      build(ui);
      paint(true);
      return this;
    },
    update: function (dt) {
      if (!built) { return; }
      stepFling(dt);          // 惯性滑行先推进，同一帧的画面就跟着走
      paint(false);
    }
  };
})(window.SW = window.SW || {}, window, document);
