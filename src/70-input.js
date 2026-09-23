// src/70-input.js —— 所有者：WP2
// 签名逐字对齐 01-CONTRACT.md §2.7：{ init(dom), probe() }
//
// 冻结的渲染循环里没有 SW.input.update()，所以速度的一阶低通放在**事件回调里**
// （用事件时间戳求 dt），停止移动时的衰减放在 probe() 里按经过时间补。
//
// 鼠标与触摸走同一条 Pointer Events 路径（WP2 §6）。
(function (SW, window, document) {
  'use strict';
  var THREE = window.THREE;

  var SPEED_REF = 8.0;        // 世界单位/秒 → speed01 = 1 的参考速度
  var MAX_DT = 0.10;          // 两次事件间隔的上限（切后台回来时别算出个天文速度）

  var dom = null;
  var plane = null, ray = null, hit = null, ndc = null;
  var down = false;
  var worldX = 0, worldZ = 0, hasHit = false;
  var speed01 = 0;
  var lastMoveT = 0;
  var lastEmitT = 0, lastEmitX = 0, lastEmitZ = 0;
  var prevX = 0, prevZ = 0, prevT = 0, hasPrev = false;

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function toWorld(clientX, clientY) {
    var cam = SW.scene.camera;
    if (!cam || !dom) { return false; }
    var r = dom.getBoundingClientRect();
    if (!r.width || !r.height) { return false; }
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    var p = ray.ray.intersectPlane(plane, hit);
    if (!p) { return false; }
    worldX = hit.x; worldZ = hit.z;
    hasHit = true;
    return true;
  }

  // 一阶低通：v += (target − v)·(1 − e^(−k·dt))，k = P.cursorDamp
  function filterSpeed(target, dt) {
    var k = Math.max(0.5, SW.P.cursorDamp || 14);
    var a = 1 - Math.exp(-k * Math.min(dt, MAX_DT));
    speed01 += (target - speed01) * a;
    if (speed01 < 0) { speed01 = 0; }
    if (speed01 > 1) { speed01 = 1; }
  }

  function emitAt(x, z, amp, sp) {
    SW.ripple.emit(x, z, amp);
    if (SW.P.splash) { SW.bus.emit('splash', { x: x, z: z, speed01: sp }); }
  }

  function onDown(e) {
    if (!toWorld(e.clientX, e.clientY)) { return; }
    down = true;
    var t = now();
    prevX = worldX; prevZ = worldZ; prevT = t; hasPrev = true;
    lastMoveT = t;
    lastEmitX = worldX; lastEmitZ = worldZ; lastEmitT = t;
    // 点击 = 强涟漪。速度取 1（§6 表格：click → speed01 = 1）
    speed01 = 1;
    emitAt(worldX, worldZ, SW.P.rippleAmp * SW.P.clickAmp, 1);
    try { dom.setPointerCapture && dom.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  }

  function onMove(e) {
    if (!toWorld(e.clientX, e.clientY)) { return; }
    var t = now();
    lastMoveT = t;

    if (hasPrev) {
      var dt = (t - prevT) / 1000;
      if (dt > 0) {
        var d = Math.sqrt((worldX - prevX) * (worldX - prevX) + (worldZ - prevZ) * (worldZ - prevZ));
        if (dt > MAX_DT) { dt = MAX_DT; }
        filterSpeed(Math.min(1, (d / dt) / SPEED_REF), dt);
      }
    }
    prevX = worldX; prevZ = worldZ; prevT = t; hasPrev = true;

    // 拖动：沿轨迹限流发射小涟漪（§6：位移 ≥ dragStep 且间隔 ≥ dragMinInterval）
    if (down) {
      var dx = worldX - lastEmitX, dz = worldZ - lastEmitZ;
      var dist = Math.sqrt(dx * dx + dz * dz);
      var gap = (t - lastEmitT) / 1000;
      if (dist >= SW.P.dragStep && gap >= SW.P.dragMinInterval) {
        // 0.35 的下限：慢慢划也要看得见波纹，speed01 只负责"划得快的更明显"
        emitAt(worldX, worldZ, SW.P.rippleAmp * (0.35 + 0.65 * speed01), speed01);
        lastEmitX = worldX; lastEmitZ = worldZ; lastEmitT = t;
      }
      if (e.cancelable) { e.preventDefault(); }
    }
  }

  function onUp() {
    down = false;
    hasPrev = false;
    speed01 = 0;
  }

  SW.input = {
    init: function (el) {
      dom = el;
      var waterY = (SW.scene.CAM && typeof SW.scene.CAM.waterY === 'number') ? SW.scene.CAM.waterY : 1.55;
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterY);
      ray = new THREE.Raycaster();
      hit = new THREE.Vector3();
      ndc = new THREE.Vector2();

      // 触屏拖动必须关掉默认手势（不能改 index.html，这里在运行时写内联样式）
      if (dom.style) { dom.style.touchAction = 'none'; }

      dom.addEventListener('pointerdown', onDown, false);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp, false);
      window.addEventListener('pointercancel', onUp, false);
      return this;
    },

    probe: function () {
      // 指针停下后没有 move 事件 → 在这里按经过时间补衰减
      if (!down && speed01 > 0) {
        var dt = (now() - lastMoveT) / 1000;
        if (dt > 0) {
          var k = Math.max(0.5, SW.P.cursorDamp || 14);
          speed01 *= Math.exp(-k * Math.min(dt, 1));
          if (speed01 < 0.002) { speed01 = 0; }
        }
      }
      return {
        worldX: worldX,
        worldZ: worldZ,
        speed01: speed01,
        dragging: down
      };
    }
  };
})(window.SW = window.SW || {}, window, document);
