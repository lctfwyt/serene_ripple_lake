// src/00-config.js —— 所有者：WP1
// 内容：全局参数表 SW.P（契约 §6，字段冻结，其它 WP 只读）/ 事件总线 SW.bus（§3）/ 工具函数
// 其它 WP：只读。不要在此新增字段，需要新字段走 01-CONTRACT.md 「变更记录」。
(function (SW, window) {
  'use strict';

  // ---------------------------------------------------------------- §6 参数表
  // ⚠ 字段名与顺序与 01-CONTRACT.md §6 完全一致，不得增删。
  var P = {
    // 时间
    timeMode: 'auto', hoursOffset: 0, fixedHour: 12.5,

    // 波纹
    fieldSize: 512, rippleSpeed: 3.2, rippleLifetime: 4.5,
    rippleWaveK: 9.0, rippleAmp: 0.09, rippleDecay: 0.996,
    normalGain: 2.4, clickAmp: 1.8,
    dragStep: 0.35, dragMinInterval: 0.033, cursorDamp: 14,

    // 鹅卵石 —— AM-004 整段重写（删 pebbleCount / pebbleArea / pebbleScale）
    pebbleCountNear: 88, pebbleCountFar: 150, pebbleLodZ: -11,
    pebbleFieldZ: [-3.0, -24.0], pebbleFieldHalfW: [4.51, 14.85],
    // AM-007 A（两轮）：**两层必须取同一个区间** —— 同区间 = 同尺寸分布，
    //   LOD 分界（z=−11）两侧才在世界尺度上连续，屏幕上由透视自然收小。
    //   第一轮（04:20）只改了 far → midRatio 1.393、只完成一半；
    //   第二轮（04:25）near 一并补到同区间 → midRatio 1.000。
    //   ⚠ 以后要调必须**成对调**，只动一层会立刻造出「远层比近层大」的倒挂。
    pebbleScaleNear: [0.20, 0.58], pebbleScaleFar: [0.20, 0.58],
    pebbleFlatten: 0.55, pebbleRough: [0.22, 0.80],
    pebbleNoiseFreq: 1.7, pebbleNoiseAmp: 0.22,
    pebblePalette: [
      ['#4f5b57', 0.16], ['#78857f', 0.30], ['#9a9f95', 0.27],
      ['#b8a992', 0.17], ['#d8d7cc', 0.10]
    ],
    seed: 20260923,

    // 水下 —— 雨桐 2026-09-24 直裁：关掉 caustic（湖底那层"水波黑影"）
    // causticDayMod（AM-005）：causticStrength 改为「峰值」，运行时按昼夜因子缩放 ——
    //   水下光斑的强弱由水面接收的太阳辐照度决定，正午最强、晨昏中、夜里几乎为零。
    //   实测（4 时段只留湖底平面的亮度 std）：固定强度 晨25.4/午28.5/昏30.7/夜33.1（夜间反而最强，反了）；
    //   调制后 晨16.9/午28.4/昏17.4/夜10.2（正午最强、夜间最弱，与物理一致）。
    caustics: false, causticScale: 0.12, causticSpeed: 0.05, causticStrength: 0.5,
    causticDayMod: true, causticNightFloor: 0.08,

    // 光照 / 后期
    toneMapped: 'ACES', exposure: 1.0,

    // 后期处理 —— AM-009 新增（UP2 落地；WP1 无活跃窗口，主控已预批参数组）
    // bloom 阈值 0.85 抬高到线性 HDR 高光域 → 只吃反光柱/镜面高光，中低亮度不受影响；
    // vignette/grain 都很轻（grain 在线性光域、随亮度缩放；?nopost=1 可运行时整链关闭）。
    bloom: true, bloomStrength: 0.55, bloomRadius: 0.40, bloomThreshold: 0.85,
    vignetteAmp: 0.16, grainAmp: 0.02,

    // 交互
    splash: true, cameraSway: false, swayAmp: 0.002,

    // 音频
    audioMode: 'auto', bgmVolume: 0.60, handVolume: 0.80, ambVolume: 0.50,
    duckAmount: 0.45, duckDown: 0.05, duckUp: 0.70,
    handBand: [400, 1400, 0.8], handDecay: 0.62,
    bgmFile: 'assets/audio/bgm-stillwater.mp3',

    // 反光路径（glitter path）—— AM-002 新增
    // AM-006（2026-09-24）：收窄夜间白光范围。
    //   glitterDetail 0.35 → 0.16：细节法线 RMS 斜率 19° → 约 9°，
    //     仍大于 GGX 瓣宽但只 1.6 倍 → 远离镜面线的「误中」概率大幅下降，
    //     碎白光从「撒满整片水面」收束到镜面柱附近。再小会退回「光滑塑料带」。
    //   glitterRough 0.045 → 0.065：单颗高光从针尖变成小圆斑，
    //     收窄后柱不至于断成断续的点，读起来是「一条连续的月光带」。
    glitterDetail: 0.16, glitterRough: 0.065, glitterJitter: 0.15,
    // glitterDetail: 0.10, glitterRough: 0.3, glitterJitter: 0.15,

    // 调试
    debug: false
  };

  // ?debug=1 → 打开 debug 面板。参数表本身保持字面量不变，这里只改运行时值。
  P.debug = /[?&]debug=1(?:&|$)/.test(window.location.search);

  SW.P = P;

  // 只读默认快照。UI 的「重置」按钮调 SW.resetP()：
  // 它是原地改 SW.P 的**同一个对象**，所以各处持有的 SW.P 引用不会失效。
  SW.P0 = JSON.parse(JSON.stringify(P));
  SW.resetP = function () {
    var d = JSON.parse(JSON.stringify(SW.P0));
    for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) { SW.P[k] = d[k]; } }
    SW.P.debug = P.debug; // 启动参数（?debug=1）不参与重置
    return SW.P;
  };

  // ------------------------------------------------------- §3 事件总线（冻结）
  SW.bus = {
    m: {},
    on: function (k, f) { (this.m[k] = this.m[k] || []).push(f); return f; },
    off: function (k, f) {
      var a = this.m[k]; if (!a) { return; }
      var i = a.indexOf(f); if (i >= 0) { a.splice(i, 1); }
    },
    emit: function (k, p) {
      var a = this.m[k]; if (!a) { return; }
      var s = a.slice();
      for (var i = 0; i < s.length; i++) {
        try { s[i](p); } catch (e) { console.error('[SW.bus] handler error on "' + k + '"', e); }
      }
    }
  };

  // ----------------------------------------------------------------- 工具函数
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  // 唯一随机源。渲染路径上禁止 Math.random()（否则断言不可复现）。
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  SW.util = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    mix3: mix3,
    mulberry32: mulberry32,
    // 固定 seed → 独立可复现的随机流（互不干扰，便于各自加流）
    newRng: function (seed) { return mulberry32(((seed >>> 0) ^ 0x9E3779B9) >>> 0); },
    // 在 [a,b) 区间取数
    range: function (rng, a, b) { return a + (b - a) * rng(); },
    // 判断关键数值里有没有 NaN（SW.debug 的 anyNaN 用）
    anyNaN: function (vals) {
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (v === null || v === undefined) { continue; }
        if (typeof v === 'number' && !isFinite(v)) { return true; }
        if (v.isVector3 || (typeof v.x === 'number' && typeof v.y === 'number')) {
          if (!isFinite(v.x) || !isFinite(v.y) || (v.z !== undefined && !isFinite(v.z))) { return true; }
        }
        if (v.isColor) { if (!isFinite(v.r) || !isFinite(v.g) || !isFinite(v.b)) { return true; } }
      }
      return false;
    }
  };

})(window.SW = window.SW || {}, window);
