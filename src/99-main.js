// src/99-main.js —— 所有者：WP1
// 契约 §2.10：SW.boot() + 冻结的渲染循环。
(function (SW, window, document) {
  'use strict';

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  // 非关键模块：坏了只警告，不要连带白屏
  function safe(name, fn) {
    try { fn(); } catch (e) { console.warn('[still_water] ' + name + ' init failed (非致命)', e); }
  }

  SW.boot = function () {
    var t0 = (window.performance && performance.now) ? performance.now() : 0;

    if (!window.THREE) { throw new Error('THREE 未加载：检查 vendor/three.min.js'); }
    if (!hasWebGL()) { throw new Error('WebGL 不可用'); }

    var canvas = document.getElementById('c');
    if (!canvas) { throw new Error('#c canvas 不存在'); }

    // ① 场景（必须成功：它是后面一切的前提）
    SW.scene.init(canvas);
    var renderer = SW.scene.renderer, scene = SW.scene.scene, camera = SW.scene.camera;

    // ② 其余模块（顺序 = 依赖顺序）
    safe('ripple', function () { SW.ripple.init(renderer); });
    safe('lakebed', function () { SW.lakebed.init(scene); });
    safe('water', function () { SW.water.init(scene, camera); });
    safe('input', function () { SW.input.init(canvas); });
    safe('ui', function () { SW.ui.init(); });
    safe('debug', function () { SW.debug.init(); });

    // ③ 先推一帧 TimeState，避免第一帧光照/雾是默认值
    SW.scene.applyTimeState(SW.time.current());

    // ④ 首次手势：提示消失 + 创建 AudioContext（契约 §2.1：init 必须在手势后调用）
    var hint = document.getElementById('hint');
    var gestured = false;
    function onGesture() {
      if (gestured) { return; }
      gestured = true;
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      window.removeEventListener('touchstart', onGesture, true);
      if (hint) { hint.classList.remove('on'); }
      safe('audio', function () { SW.audio.init(); });
    }
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    window.addEventListener('touchstart', onGesture, true);

    // ⑤ 首页提示
    if (hint) { window.setTimeout(function () { if (!gestured) { hint.classList.add('on'); } }, 900); }

    SW.ready = true;
    SW.bootMs = ((window.performance && performance.now) ? performance.now() : 0) - t0;
    SW.bus.emit('ready');

    // ⑥ 渲染循环（冻结：顺序不得调整）
    function frame() {
      var d0 = Math.min(SW.scene.clock.getDelta(), 0.05);
      // WP1 附加：?debug=1 时 SW.debug 可钉住 dt（clock(t) / hold(true)）；默认原样返回 d0
      var dt = SW.debug.dtFor(d0);
      SW.time.update(dt);
      SW.scene.applyTimeState(SW.time.current());
      SW.ripple.step(dt);
      SW.water.update(dt);
      SW.scene.render(dt);
      SW.ui.update(dt);
      SW.debug.update(dt);
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);

    return true;
  };
})(window.SW = window.SW || {}, window, document);
