// src/20-time.js —— 所有者：WP3
// 签名逐字对齐 01-CONTRACT.md §2.2；TimeState 字段表见 §2.2（含 AM-002 追加的 glitterGain / glitterColor）
//
// 已应用的变更单：
//   AM-001 §4.3 —— 天空已移出画面：四态差异全部落在「水面 + 雾色 + 光照」上；
//                  skyTop / skyBottom 由 fogColor 派生（不单独调参）；starAlpha 保留字段但刻意不取 ≥0.995
//                  （WP1 的 30-scene.js 里 starAlpha ≥ 0.995 会把天空网格隐藏，远景会失去背景兜底）。
//   AM-002 §7.3 —— TimeState 加 glitterGain / glitterColor，四个必有时段键一个不缺。
//   AM-003 §6.1 —— 反光柱可行域（本文件承载该变更的全部动作）：
//                  ① sunElev 改成 keyframe 直给，废掉 WP3 §4.4 的正弦公式（它会给出负值 → 柱为 0）
//                  ② 仰角表：晨雾 24° / 正午 64° / 黄昏 22° / 星夜 28°，中间点单调、恒正
//                  ③ 方位设计值：晨雾 −8° / 正午 0° / 黄昏 +8° / 星夜 0°
//                  ④ hHalf 夹取放进 getState() 内部（不是 applyTimeState 阶段），resize 时重算
//                  ⑤ 夜间不归零：sunIntensity ≥ 0.6 + 冷色月光
//   AM-007 §3-B —— 晨雾补暖调：**只动 h=5.50 一个 keyframe 的 fog 色**
//                  （[0.66,0.024,238] → [0.66,0.0065,95]）。全图 R−B 实测 −23.8 → +2.80，
//                  亮度 129.9 → 129.5（不变）。相邻 keyframe 一个未动 → 环形插值其余部分零影响。
//                  ⚠ fog 色相步长 38° → 159°，与 WP5 断言 #5（< 60°）冲突，见该 keyframe 处的注记。
//
// ⚠ 与 AM-001 §4.3 第 5 条的冲突：那条要求「夜间 sunElev<0 时 sunIntensity=0」。
//   AM-003 §2 已裁决**以 AM-003 为准** —— 夜间要的是一颗挂在地平线之上 22~30° 的月亮，
//   归零会让整条反光柱消失。新的假光防线是「**sunElev 永不为负**」（本文件所有键恒正）。
//
// ⚠ glitterGain 取值：AM-002 §2.3 给的是 0.35/0.15/0.85/1.00，AM-003 §6.1 改成 0.30/0.15/0.35/1.20。
//   以 AM-003 为准 —— 理由是低仰角的镜面项天然极强（22° 的 shape 7.63 vs 28° 的 2.50），
//   若黄昏也按 0.85 给，昏/夜亮度比会到 3.7 倍，不是「昏 ≈ 夜」。
(function (SW, window) {
  'use strict';

  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function norm24(h) { return ((h % 24) + 24) % 24; }
  // 角度差归一到 (−180, 180] —— 色相最短弧插值的前提
  function wrap180(d) { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; }

  // ══════════════════════════════════════════════ §9 共享常量（只读，不得自行改）
  // 相机在 (0, CAM_Y=5.9, CAM_Z=3.4)、lookAt (0, WATER_Y=1.55, CAM_Z − CAM_LOOKAHEAD)
  // → 水平朝向恒为 −Z。three 的 Spherical(x = sinθ, z = cosθ) 下，−Z 对应 θ = π。改机位走变更单。
  var CAM_FORWARD_AZ = Math.PI;
  var CAM_FOV_FALLBACK = 34;           // 只在 SW.scene.CAM 还没建好时用（正常读 §9 的共享常量）
  var AZ_HALF_MAX = 22;                // AM-003 §3：16:9 下的封顶偏角
  var AZ_HALF_MIN = 7;                 // AM-003 §3：竖屏保底下限
  var AZ_HALF_MARGIN = 6;              // AM-003 §3：距画面边留 6°

  // ── AM-003 §3 / §6.1-4：方位扇区随宽高比夹取 ──────────────────────────────
  // hHalf = atan( tan(fov/2) × aspect )。柱的方位安全区就等于 hHalf，它不是常数：
  //   16:9 桌面 28.03° → k 22°   ·  16:10 笔记本 25.66° → k 19.7°
  //   方形 16.40° → k 10.4°      ·  竖屏 12.73° → k 7°
  // 夹取必须在 getState() 内部做（否则 probe().sunAz 与实际光源位置不一致，WP5 会读到没夹过的值）。
  var azHalfDeg = null;
  function recomputeAzHalf() {
    var fov = (SW.scene && SW.scene.CAM && SW.scene.CAM.fov) || CAM_FOV_FALLBACK;
    var cam = SW.scene && SW.scene.camera;
    var aspect = (cam && cam.aspect > 0 && isFinite(cam.aspect)) ? cam.aspect : 16 / 9;
    var hHalf = Math.atan(Math.tan(fov * 0.5 * D2R) * aspect) / D2R;
    azHalfDeg = Math.min(AZ_HALF_MAX, Math.max(AZ_HALF_MIN, hHalf - AZ_HALF_MARGIN));
    return azHalfDeg;
  }
  function azHalf() { return (azHalfDeg === null) ? recomputeAzHalf() : azHalfDeg; }

  // 光源方位角 = 相机朝向 + clamp(设计偏角, ±k)
  function sunAzAt(azDeg) {
    var k = azHalf();
    return CAM_FORWARD_AZ + clamp(azDeg, -k, k) * D2R;
  }

  // ══════════════════════════════════════════════ OKLCH → 线性 sRGB
  // 为什么用 OKLCH：感知均匀，色相走最短弧插值时不会「中间发灰 / 发绿」。
  // 输出是**线性** sRGB —— 与 30-scene.js 的 setRGB / 天空 shader 的工作空间一致。
  function oklch(L, C, H) {
    var a = C * Math.cos(H * D2R), b = C * Math.sin(H * D2R);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    ];
  }
  // LCH 三元组插值：L / C 线性，H 走最短弧
  function mixLCH(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), a[2] + wrap180(b[2] - a[2]) * t];
  }
  function rgbOf(lch) { return oklch(lch[0], lch[1], lch[2]); }

  // ══════════════════════════════════════════════ keyframe 表（环，按小时升序）
  // 四个必有时段：5.5 晨雾 · 12.5 正午 · 18.5 黄昏 · 22.5 星夜。其余是过渡点。
  //
  // 色相路径（决定「过渡会不会脏」）：
  //   水面 / 雾 / 半球光 走同一条基准色相：252 → 232 → 208 → 190 → 165 → 128 → 92 → 130 → 162 → 196 → 222 → 240
  //   （冷蓝夜 → 青绿昼 → 金黄黄昏 → 经青绿回冷蓝），相邻步 ≤ 38°。
  //   sun / glitter 走另一条（光色：晨昏暖、正午白、夜冷白偏蓝），相邻步 ≤ 52°。
  //   夜里 22.5 → 2.0 → 4.0 是光色由冷转暖的翻转段，彩度刻意压到 0.008~0.030，
  //   让它读成「冷白月光 → 白 → 暖白晨光」而不是明显绕色。
  //
  // 字段：
  //   h 小时 · n 名 · az 方位设计偏角(度，相对相机朝向；+ = 右) · elev 光源高度角(度，**恒正**)
  //   sunI 主光强度（夜间 = 月光，≥0.6）· hemiI · fogD · wRough · expo
  //   star（AM-001 后无画面贡献）· gGain 反光强度
  //   sun/sky/gnd/fog/wat/gli = [L, C, H](OKLCH)
  var KEYS = [
    { h: 2.00, n: '子夜', az: -2, elev: 30.0, sunI: 0.70, hemiI: 0.42, fogD: 0.060, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 1.15,
      sun: [0.88, 0.016, 198], sky: [0.58, 0.038, 262], gnd: [0.30, 0.030, 227],
      fog: [0.48, 0.030, 258], wat: [0.285, 0.042, 252], gli: [0.92, 0.018, 198] },

    { h: 4.00, n: '破晓前', az: -4, elev: 26.0, sunI: 0.68, hemiI: 0.46, fogD: 0.070, wRough: 0.10, expo: 0.94, star: 0.45, gGain: 1.00,
      sun: [0.88, 0.008, 146], sky: [0.60, 0.036, 258], gnd: [0.31, 0.028, 223],
      fog: [0.50, 0.030, 254], wat: [0.300, 0.038, 248], gli: [0.92, 0.010, 146] },

    { h: 5.50, n: '晨雾', az: -8, elev: 24.0, sunI: 0.90, hemiI: 0.75, fogD: 0.078, wRough: 0.18, expo: 1.00, star: 0.05, gGain: 0.30,
      sun: [0.88, 0.058, 95], sky: [0.70, 0.030, 242], gnd: [0.36, 0.024, 207],
      // AM-007 §3-B：雾色由冷青蓝 [0.66,0.024,238] 改为与**本键 sun/gli 同色相**的暖黄 [0.66,0.0065,95]。
      //   色度为什么不是 §3 建议的 0.030：实测该旋钮比预设灵敏约 50×（C=0.030/H=70 → R−B +24.9），
      //   0.030 会远超判据上限 +4。L 保持 0.66 → 全图亮度 129.5（改前 129.9）不变，只换色偏。
      //   ⚠ 副作用：fog 色相步长 38° → 159°，越过 WP5 断言 #5 的 <60°（加权后 0.91→1.03 基本不变）。
      fog: [0.66, 0.0065, 95], wat: [0.355, 0.030, 232], gli: [0.94, 0.034, 95] },

    { h: 9.00, n: '上午', az: -5, elev: 46.0, sunI: 1.70, hemiI: 0.90, fogD: 0.055, wRough: 0.13, expo: 1.03, star: 0.00, gGain: 0.22,
      sun: [0.91, 0.040, 80], sky: [0.78, 0.042, 218], gnd: [0.42, 0.034, 183],
      fog: [0.74, 0.034, 214], wat: [0.425, 0.046, 208], gli: [0.95, 0.028, 80] },

    { h: 12.50, n: '正午', az: 0, elev: 64.0, sunI: 2.10, hemiI: 0.95, fogD: 0.042, wRough: 0.10, expo: 1.05, star: 0.00, gGain: 0.15,
      sun: [0.92, 0.012, 100], sky: [0.84, 0.048, 200], gnd: [0.48, 0.040, 165],
      fog: [0.80, 0.042, 196], wat: [0.520, 0.058, 190], gli: [0.97, 0.008, 100] },

    { h: 15.50, n: '午后', az: 4, elev: 47.0, sunI: 1.85, hemiI: 0.90, fogD: 0.048, wRough: 0.11, expo: 1.02, star: 0.00, gGain: 0.24,
      sun: [0.91, 0.030, 130], sky: [0.80, 0.046, 175], gnd: [0.45, 0.038, 140],
      fog: [0.77, 0.040, 171], wat: [0.470, 0.055, 165], gli: [0.96, 0.018, 130] },

    { h: 17.50, n: '斜阳', az: 7, elev: 33.0, sunI: 1.55, hemiI: 0.82, fogD: 0.055, wRough: 0.12, expo: 1.00, star: 0.00, gGain: 0.30,
      sun: [0.90, 0.062, 112], sky: [0.74, 0.050, 138], gnd: [0.42, 0.038, 103],
      fog: [0.72, 0.042, 134], wat: [0.430, 0.052, 128], gli: [0.95, 0.050, 112] },

    { h: 18.50, n: '黄昏', az: 8, elev: 22.0, sunI: 1.30, hemiI: 0.78, fogD: 0.062, wRough: 0.13, expo: 0.98, star: 0.05, gGain: 0.35,
      sun: [0.88, 0.078, 78], sky: [0.68, 0.058, 102], gnd: [0.40, 0.040, 67],
      fog: [0.66, 0.048, 98], wat: [0.400, 0.050, 92], gli: [0.94, 0.090, 78] },

    { h: 19.75, n: '暮色', az: 6, elev: 23.5, sunI: 0.80, hemiI: 0.62, fogD: 0.068, wRough: 0.12, expo: 0.96, star: 0.35, gGain: 0.55,
      sun: [0.86, 0.048, 50], sky: [0.58, 0.038, 140], gnd: [0.35, 0.026, 105],
      fog: [0.56, 0.030, 136], wat: [0.360, 0.030, 130], gli: [0.93, 0.075, 50] },

    { h: 20.50, n: '晚霞', az: 4, elev: 25.0, sunI: 0.74, hemiI: 0.56, fogD: 0.070, wRough: 0.11, expo: 0.95, star: 0.55, gGain: 0.75,
      sun: [0.86, 0.030, 20], sky: [0.54, 0.034, 172], gnd: [0.32, 0.026, 137],
      fog: [0.52, 0.030, 168], wat: [0.330, 0.034, 162], gli: [0.92, 0.045, 20] },

    { h: 21.35, n: '蓝调', az: 1, elev: 26.5, sunI: 0.72, hemiI: 0.50, fogD: 0.068, wRough: 0.10, expo: 0.94, star: 0.60, gGain: 1.00,
      sun: [0.88, 0.014, 345], sky: [0.52, 0.034, 206], gnd: [0.30, 0.028, 171],
      fog: [0.49, 0.030, 202], wat: [0.305, 0.038, 196], gli: [0.92, 0.014, 345] },

    { h: 22.00, n: '入夜', az: 0, elev: 27.0, sunI: 0.71, hemiI: 0.45, fogD: 0.064, wRough: 0.09, expo: 0.93, star: 0.60, gGain: 1.10,
      sun: [0.88, 0.020, 300], sky: [0.57, 0.036, 232], gnd: [0.30, 0.030, 197],
      fog: [0.48, 0.030, 228], wat: [0.292, 0.040, 222], gli: [0.92, 0.028, 300] },

    { h: 22.50, n: '星夜', az: 0, elev: 28.0, sunI: 0.70, hemiI: 0.42, fogD: 0.060, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 1.20,
      sun: [0.88, 0.034, 250], sky: [0.58, 0.038, 250], gnd: [0.30, 0.030, 215],
      fog: [0.47, 0.030, 246], wat: [0.288, 0.042, 240], gli: [0.92, 0.048, 250] }
  ];

  // ------------------------------------------------------------ 组装 TimeState
  function buildState(hour) {
    var h = norm24(hour);
    var n = KEYS.length, i = n - 1, k;
    for (k = 0; k < n; k++) { if (KEYS[k].h <= h) { i = k; } else { break; } }
    var a = KEYS[i], b = KEYS[(i + 1) % n];

    var h0 = a.h, h1 = b.h; if (h1 <= h0) { h1 += 24; }
    var hh = h; if (hh < h0) { hh += 24; }
    var t = smoothstep((hh - h0) / (h1 - h0));

    var fog = mixLCH(a.fog, b.fog, t);
    return {
      // 方位：设计偏角经 hHalf 夹取（AM-003 §3）。夹取在这里做，probe().sunAz 才和实际光源一致。
      sunAz: sunAzAt(lerp(a.az, b.az, t)),
      // 仰角：keyframe 直给，rad。所有键恒正 —— 这是 AM-003 §2 的假光防线。
      sunElev: lerp(a.elev, b.elev, t) * D2R,
      sunColor: rgbOf(mixLCH(a.sun, b.sun, t)),
      sunIntensity: lerp(a.sunI, b.sunI, t),
      hemiSky: rgbOf(mixLCH(a.sky, b.sky, t)),
      hemiGround: rgbOf(mixLCH(a.gnd, b.gnd, t)),
      hemiIntensity: lerp(a.hemiI, b.hemiI, t),
      fogColor: rgbOf(fog),
      fogDensity: lerp(a.fogD, b.fogD, t),
      waterColor: rgbOf(mixLCH(a.wat, b.wat, t)),
      waterRough: lerp(a.wRough, b.wRough, t),
      waterMetal: 0.0,
      // AM-001 §4.3：天空已移出画面 → 由雾色派生，不为它单独调参。
      // 真露出一点也不会和远景打架。**不要为这两个字段加班。**
      skyTop: oklch(fog[0] * 0.80, fog[1] * 0.90, fog[2] + 4),
      skyBottom: oklch(Math.min(1, fog[0] * 1.04), fog[1], fog[2] - 4),
      exposure: lerp(a.expo, b.expo, t),
      starAlpha: lerp(a.star, b.star, t),
      // AM-002 §7.3 / AM-003 §6.1：反光路径强度与色温（夜最强、正午最弱）
      glitterGain: lerp(a.gGain, b.gGain, t),
      glitterColor: rgbOf(mixLCH(a.gli, b.gli, t))
    };
  }

  // ------------------------------------------------------------ 运行时状态
  var cur = null;
  var lastHour = NaN;
  var hourNow = 0;
  var cbs = [];

  function mode() { return (SW.P && SW.P.timeMode === 'fixed') ? 'fixed' : 'auto'; }
  function realHour() {
    var d = new Date();
    return norm24(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + ((SW.P && SW.P.hoursOffset) || 0));
  }
  function targetHour() { return mode() === 'fixed' ? norm24((SW.P && SW.P.fixedHour) || 0) : realHour(); }

  // 只有小时真的推进了才重建状态对象 —— 否则 WP1 的 applyTimeState 会 60 次/秒刷 'timechange'
  var EPS_H = 0.001;   // ≈ 3.6 秒；这段时间里太阳位移 < 0.001 rad，肉眼不可见
  function refresh(force) {
    var h = targetHour();
    if (!force && cur && Math.abs(h - lastHour) < EPS_H) { hourNow = h; return false; }
    hourNow = h; lastHour = h;
    cur = buildState(h);
    return true;
  }
  function fire() {
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](cur); } catch (e) { console.error('[SW.time] onChange handler error', e); }
    }
    // 契约 §3：timechange 由 WP3 emit。WP1 的 applyTimeState 也会 emit 一次（同源、幂等），
    // 监听器请按幂等实现。
    SW.bus.emit('timechange', cur);
  }

  // URL ?hour=18.5 → 直接进 fixed
  (function applyUrl() {
    var m = /[?&]hour=(-?\d+(?:\.\d+)?)/.exec(window.location.search);
    if (!m) { return; }
    var v = parseFloat(m[1]);
    if (!isFinite(v)) { return; }
    SW.P.timeMode = 'fixed';
    SW.P.fixedHour = norm24(v);
  })();

  // 视口变化时重算方位夹取区（AM-003 §6.1-4）
  if (SW.bus && SW.bus.on) { SW.bus.on('resize', recomputeAzHalf); }

  SW.time = {
    // —— 冻结签名（§2.2）——
    getState: function (hour) { return buildState(hour); },
    current: function () { if (!cur) { refresh(true); } return cur; },
    setMode: function (m) {
      m = (m === 'fixed') ? 'fixed' : 'auto';
      if (SW.P.timeMode === m) { return m; }
      SW.P.timeMode = m;
      refresh(true); fire();
      return m;
    },
    getMode: function () { return mode(); },
    setHour: function (h) {
      h = norm24(parseFloat(h));
      if (!isFinite(h)) { return hourNow; }
      SW.P.fixedHour = h;
      SW.P.timeMode = 'fixed';       // 隐含切到 fixed
      refresh(true); fire();
      return h;
    },
    update: function (dt) { if (refresh(false)) { fire(); } },
    onChange: function (cb) { if (typeof cb === 'function') { cbs.push(cb); } return cb; },

    // —— 附加（非冻结接口，供 WP5 断言 / 90-debug 用）——
    getHour: function () { if (!cur) { refresh(true); } return hourNow; },   // 90-debug.js 的 hours() 优先读它
    KEYS: KEYS,
    // §4.3 色相步长自检：每个颜色字段在相邻 keyframe 之间的最大色相步长（度）
    maxHueStep: function () {
      var fld = ['sun', 'sky', 'gnd', 'fog', 'wat', 'gli'], out = {};
      for (var f = 0; f < fld.length; f++) {
        var m = 0, k = fld[f];
        for (var i = 0; i < KEYS.length; i++) {
          var a = KEYS[i][k], b = KEYS[(i + 1) % KEYS.length][k];
          var d = Math.abs(wrap180(b[2] - a[2]));
          if (d > m) { m = d; }
        }
        out[k] = +m.toFixed(2);
      }
      return out;
    },
    // 当前方位夹取区（度）。AM-003 §5.3 第 8 条要用它算判据。
    azHalfDeg: function () { return azHalf(); },
    hHalfDeg: function () {
      var fov = (SW.scene && SW.scene.CAM && SW.scene.CAM.fov) || CAM_FOV_FALLBACK;
      var cam = SW.scene && SW.scene.camera;
      var aspect = (cam && cam.aspect > 0 && isFinite(cam.aspect)) ? cam.aspect : 16 / 9;
      return Math.atan(Math.tan(fov * 0.5 * D2R) * aspect) / D2R;
    },
    // sunAz 相对相机朝向的实际偏离（度，已夹取）。断言 #8 读它。
    azOffsetDeg: function (h) {
      var s = (h === undefined) ? (cur || (cur = buildState(hourNow))) : buildState(h);
      return wrap180((s.sunAz - CAM_FORWARD_AZ) / D2R);
    },
    // 镜面点到相机的水平距离 4.35/tan(elev)。落在 [4.83, 30.95] 内 → 柱在画面里（16:9 口径）。
    mirrorDist: function (h) {
      var s = (h === undefined) ? (cur || (cur = buildState(hourNow))) : buildState(h);
      return 4.35 / Math.tan(s.sunElev);
    },
    // 当前所处的时段名（四态）
    nameOf: function (h) {
      h = norm24(h === undefined ? hourNow : h);
      if (h >= 4 && h < 10) { return '晨雾'; }
      if (h >= 10 && h < 16) { return '正午'; }
      if (h >= 16 && h < 20.5) { return '黄昏'; }
      return '星夜';
    }
  };
})(window.SW = window.SW || {}, window);
