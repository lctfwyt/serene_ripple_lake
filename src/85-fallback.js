// src/85-fallback.js —— 所有者：WP5（本文件由 WP5 整文件替换 WP1 的空壳 stub）
//
// 三层降级（50-WP5-polish-verify.md §3）：
//   ① §3.1 prefers-reduced-motion: reduce  —— 停止环境自走，保留显式交互
//   ② §3.2 WebGL 不可用                    —— 显示 #fallback 静态渐变，不白屏、不污染 console
//   ③ §3.3 移动端一次性自动降级             —— DPR / 波纹场 / 砾石数 / caustics
//
// ⚠ 时机是本文件成立的全部前提：
//   index.html 的脚本顺序是 … 80-ui → **85-fallback** → 90-debug → 99-main → 内联 SW.boot()。
//   所以本文件在**所有模块 init() 之前**执行 —— 对 SW.P 的写入会被各模块首次读取到。
//   放到 boot 之后再改 SW.P 是无效的（`fieldSize` 决定涟漪 RT 尺寸、`pebbleCount*` 决定实例数，
//   都是 init 时一次性消费的参数）。
//
// ⚠ 本文件**不改任何其它 WP 的文件**，只做三件事：写 SW.P、读 SW.time 的两个公开方法、
//   在 SW 上装一个 boot 拦截器。所有对外痕迹收敛在 `SW.fallback` 这一个只读对象上。
(function (SW, window, document) {
  'use strict';

  var info = {
    reducedMotion: false,
    mobile: false,
    webgl: true,
    bootWrapped: false,
    reason: '',
    applied: []
  };

  function mark(k) { info.applied.push(k); }

  // ==================================================== 环境探测（一次性，不做动态降级）

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // §3.3 判定依据：屏幕宽度 < 768px 或 navigator.hardwareConcurrency <= 4
  function isMobileClass() {
    var narrow = (window.innerWidth || 0) < 768;
    var few = (window.navigator && typeof window.navigator.hardwareConcurrency === 'number')
      ? window.navigator.hardwareConcurrency <= 4 : false;
    return { on: narrow || few, narrow: narrow, few: few };
  }

  // 与 99-main.js 的 hasWebGL() 同一判据（那边也会抛，但那时已经晚了：boot 已经跑了一半）
  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  // ==================================================== §3.1 prefers-reduced-motion

  // 本项目**没有空闲自动涟漪源**（核实：`50-ripple.js` 无 idle/auto emit，`70-input.js` 是全库
  // 唯一的 `SW.ripple.emit()` 调用方）。所以「自动涌动」实际只有三项，逐项处理：
  //   ① 时间流逝      → 锁在当前小时（切 fixed，走时停止）
  //   ② 相机呼吸位移  → 关
  //   ③ 水面自走相位  → 钉住 `SW.water.uniforms.uTime`（见 freezeAmbient）
  // 「只响应显式点击」是**保留**项：点击/拖动的涟漪与拍击声一律照旧 —— 涟漪的推进在
  // `SW.ripple.step(dt)`，与 uTime 无关，所以钉 uTime 不会连带冻掉交互。
  function applyReducedMotion() {
    var P = SW.P;
    if (!P) { return; }

    if (P.cameraSway) { P.cameraSway = false; mark('cameraSway=off'); }
    // 防御性冗余：uTime 若因故没钉住，jitter=0 至少把细节法线的相位推进降速 40%
    if (P.glitterJitter) { P.glitterJitter = 0; mark('glitterJitter=0'); }

    var T = SW.time;
    if (T && T.getMode && T.setMode && T.setHour) {
      // 尊重显式意图：URL 给了 `?hour=` 时 20-time.js 已经把模式切成 fixed，不要覆盖它
      if (T.getMode() === 'auto') {
        var h = (T.getHour && isFinite(T.getHour())) ? T.getHour() : 12.5;
        T.setMode('fixed');
        T.setHour(h);
        mark('time=fixed@' + (+h).toFixed(2));
      } else {
        mark('time=already-fixed');
      }
    }
    freezeAmbient();
    mark('uTime=frozen(pending ready)');
  }

  // 把水面 shader 的自走相位钉住。
  //   为什么不能在 load 时做：`SW.water` 由 99-main.js 在 boot 里 init，本文件更早执行。
  //   为什么挂在 `ready`：99-main.js 在 `SW.bus.emit('ready')` **之后**才 requestAnimationFrame(frame)，
  //     所以此时替换 update 一定被渲染循环用到，且晚于 water.init（uniforms 已存在）。
  //   为什么包 update 而不是冻结 dt：冻 dt 会同时冻掉 `SW.ripple.step()` —— 那样连点击都不出涟漪，
  //     直接违反「只响应显式点击」。`SW.water.update` / `uniforms` 都是契约 §2.6 公开的接口，
  //     这里只做「调用之后回钉一个值」，不改任何其它 WP 的文件。
  function freezeAmbient() {
    if (!SW.bus || !SW.bus.on) { return; }
    SW.bus.on('ready', function () {
      var W = SW.water;
      if (!W || typeof W.update !== 'function' || !W.uniforms || !W.uniforms.uTime) { return; }
      if (W.__rmFrozen) { return; }
      var orig = W.update, t0 = W.uniforms.uTime.value || 0;
      W.update = function (dt) {
        orig.call(W, dt);
        if (W.uniforms.uTime) { W.uniforms.uTime.value = t0; }
      };
      W.__rmFrozen = true;
      info.applied.push('uTime=' + t0.toFixed(3));
    });
  }

  // ==================================================== §3.3 移动端降级

  function applyMobile() {
    var P = SW.P;
    if (!P) { return; }

    // 波纹场 512 → 256：涟漪 RT 的边长是 init 时定死的，必须在此之前改
    P.fieldSize = 256;
    // 砾石实例数（AM-004 之后 `pebbleCount` 键已不存在，拆成两层）
    P.pebbleCountNear = 50;
    P.pebbleCountFar = 70;
    // caustics —— AM-007 §4 已裁：桌面与移动**一律 false**，条款关闭（这里只是显式声明不反转）
    P.caustics = false;
    mark('fieldSize=256');
    mark('pebbles=50+70');
    mark('caustics=false');

    // ⚠ 与 §3.3 表格的**一处有意偏离**：`splash` 不关。
    //   理由：本项目没有 splash 粒子系统 —— 全库 `P.splash` 只有一个消费点
    //   （`70-input.js:54` 决定要不要 emit `splash` 事件），而该事件唯一的订阅者是
    //   `10-audio.js` 的点击/划水声。关掉它 = **移动端静音**，省不下任何渲染开销。
    //   代价与收益方向相反，故保留 `true`。（若确实要关：把下面一行改成 `P.splash = false`）
    mark('splash=keep(无粒子系统,仅门控音效)');

    // DPR 上限 2 → 1.5。
    //   `30-scene.js`（WP1 的文件，WP5 不得改）写死为 `Math.min(devicePixelRatio, 2)`，
    //   且 init / resize 两处都读 `window.devicePixelRatio`。
    //   → 在窗口对象上把这一个读数夹到 1.5，效果与改源码等价，且不碰任何文件。
    try {
      var dpr = window.devicePixelRatio || 1;
      if (dpr > 1.5) {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          get: function () { return 1.5; }
        });
        mark('dpr=1.5');
      } else {
        mark('dpr=' + dpr + '(<=1.5,无需夹)');
      }
    } catch (e) {
      mark('dpr=夹取失败,保持原值');
    }
  }

  // ==================================================== §3.2 WebGL 兜底

  function showFallback(msg) {
    var f = document.getElementById('fallback');
    var c = document.getElementById('c');
    var ui = document.getElementById('ui');
    var hint = document.getElementById('hint');
    if (f) {
      f.classList.add('on');
      if (!f.firstChild) {
        // index.html 的 #fallback 是一条纯 CSS 渐变（无文字）。补一行说明，
        // 否则用户只看到一片渐变色，不知道发生了什么。
        var tag = document.createElement('div');
        tag.textContent = '静水 · still water';
        tag.setAttribute('style', [
          'position:absolute', 'left:0', 'right:0', 'bottom:9%',
          'text-align:center', 'color:rgba(255,255,255,.80)',
          'font:13px/1.9 "PingFang SC","Microsoft YaHei",system-ui,sans-serif',
          'letter-spacing:.16em', 'pointer-events:none'
        ].join(';'));
        var why = document.createElement('div');
        why.textContent = msg || '此浏览器不支持 WebGL，已切换为静态画面';
        why.setAttribute('style', [
          'position:absolute', 'left:0', 'right:0', 'bottom:calc(9% + 22px)',
          'text-align:center', 'color:rgba(255,255,255,.62)',
          'font:12px/1.8 "PingFang SC","Microsoft YaHei",system-ui,sans-serif',
          'letter-spacing:.10em', 'pointer-events:none'
        ].join(';'));
        f.appendChild(why); f.appendChild(tag);
      }
    }
    if (c) { c.style.display = 'none'; }
    if (ui) { ui.style.display = 'none'; }
    if (hint) { hint.classList.remove('on'); }
  }

  // 99-main.js 在内联脚本执行到 `SW.boot()` 的**前一刻**才把自己的实现赋给 SW.boot
  // （本文件先加载），所以在这里装一个访问器副作用：谁往 SW.boot 赋值，都自动包一层
  // 「先探 WebGL、再 try/catch」。这样：
  //   · WebGL 缺失 → 不进入任何模块 init，不抛异常 → console **零报错**（只有一条 warn）
  //   · 真实启动失败 → 同样落到渐变兜底，而不是白屏
  // 失败时退回 index.html 自带的 try/catch 兜底（那条路会打一条 console.error，功能不受影响）。
  function wrapBoot() {
    var real = null;
    try {
      Object.defineProperty(SW, 'boot', {
        configurable: true,
        get: function () { return real; },
        set: function (fn) {
          if (typeof fn !== 'function') { real = fn; return; }
          real = function () {
            if (!hasWebGL()) {
              info.webgl = false;
              info.reason = 'WebGL 不可用';
              console.warn('[still_water] WebGL 不可用 → 静态渐变兜底（未执行任何模块 init）');
              showFallback('此浏览器不支持 WebGL，已切换为静态画面');
              return false;
            }
            try {
              return fn.apply(SW, arguments);
            } catch (e) {
              info.reason = 'boot 失败: ' + (e && e.message ? e.message : e);
              console.warn('[still_water] boot 失败 → 静态渐变兜底', e);
              showFallback('初始化失败，已切换为静态画面');
              return false;
            }
          };
        }
      });
      info.bootWrapped = true;
    } catch (e) {
      info.bootWrapped = false;
    }
  }

  // ==================================================== 执行

  if (prefersReducedMotion()) { info.reducedMotion = true; applyReducedMotion(); }

  var mb = isMobileClass();
  if (mb.on) {
    info.mobile = true;
    info.mobileWhy = mb.narrow ? 'innerWidth<768' : ('hardwareConcurrency<=4');
    applyMobile();
  }

  info.webgl = hasWebGL();
  wrapBoot();   // 无论 WebGL 是否可用都装：真实启动失败也能兜底

  // WebGL 不可用时**立刻**铺兜底（不必等 boot）—— 少一帧白闪。
  // idempotent：boot 拦截器里还会再调一次，不会重复插入文字节点。
  if (!info.webgl) {
    info.reason = 'WebGL 不可用';
    showFallback('此浏览器不支持 WebGL，已切换为静态画面');
  }

  SW.fallback = info;
})(window.SW = window.SW || {}, window, document);
