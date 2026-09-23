// src/90-debug.js —— 所有者：WP1
// 契约 §2.9 + §5。**仅在 ?debug=1 时挂载**：默认不创建任何 DOM，也不暴露 window.__probe。
(function (SW, window, document) {
  'use strict';

  var enabled = false;
  var panel = null, pre = null;
  var frames = 0, acc = 0, lastAcc = 0;
  var fps = 0, frameMs = 0;
  var lastPaint = 0;
  var dtLock = null;      // clock(t)：每帧固定 dt
  var held = false;       // hold(true)：冻结过渡（dt 置 0）

  function fmt(n, d) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(d) : String(n); }

  // ================= AM-001 §5.1：机位 / 地平线读数 =================
  // 雾色感知亮度：three 的 fogColor uniform 被 getRGB(target, outputColorSpace) 转成了
  // **输出色彩空间（sRGB）**，并且在 fog_fragment 里是在 tonemapping **之后**混合的 ——
  // 所以全雾像素 = 直接 sRGB 编码的 fog.color，**不经过 ACES**。这里照此复算。
  function srgbEnc(v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function fogL() {
    var c = SW.scene.fog && SW.scene.fog.color;
    if (!c) { return 0; }
    return 255 * (0.2126 * srgbEnc(c.r) + 0.7152 * srgbEnc(c.g) + 0.0722 * srgbEnc(c.b));
  }

  // 画面顶两行的平均亮度。readPixels 的 y=0 在底部 → 取 y = h-2 起的 2 行。
  // 需要同帧内先 render 一次（否则 drawingBuffer 已被合成器清掉）。
  // ⚠ 这次额外 render 会重置 renderer.info → 调用方必须**先**快照 calls/tris。
  var _topCache = { t: -1e9, v: 0 };
  function topRowL() {
    var now = (window.performance && performance.now) ? window.performance.now() : Date.now();
    if (now - _topCache.t < 300) { return _topCache.v; }
    var r = SW.scene.renderer;
    if (!r || !SW.scene.scene || !SW.scene.camera) { return 0; }
    var gl = r.getContext();
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w < 1 || h < 2) { return 0; }
    var buf = new Uint8Array(w * 2 * 4);
    r.render(SW.scene.scene, SW.scene.camera);
    gl.readPixels(0, h - 2, w, 2, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    var s = 0;
    for (var i = 0; i < w * 2; i++) {
      s += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    }
    _topCache = { t: now, v: s / (w * 2) };
    return _topCache.v;
  }

  // ================= AM-004 §5：鹅卵石场读数 =================
  // 可见梯形：NDC 四角射线 ∩ y = 0（与建场同一套算法，见 40-lakebed.js halfWidthFn）
  // 实测 16:9（--window-size=1306,820 → 画布 1280×720）：近边 z −3.15 半宽 4.58 →
  // 远边 z −38.6 半宽 22.04。窄窗口会变，所以每次都重算，不写死。
  function visibleTrapezoid() {
    if (!window.THREE || !SW.scene.camera) { return null; }
    var THREE = window.THREE, cam = SW.scene.camera;
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var rc = new THREE.Raycaster(), hit = new THREE.Vector3();
    function rayZ(ny) {
      rc.setFromCamera(new THREE.Vector2(0, ny), cam);
      return rc.ray.intersectPlane(plane, hit) ? hit.z : null;
    }
    function rayX(ny) {
      rc.setFromCamera(new THREE.Vector2(1, ny), cam);
      return rc.ray.intersectPlane(plane, hit) ? Math.abs(hit.x) : null;
    }
    var nz = rayZ(-1), nhw = rayX(-1), fz = rayZ(1), fhw = rayX(1);
    if (nz === null || nhw === null || fz === null || fhw === null) { return null; }
    if (Math.abs(fz - nz) < 1e-6) { return null; }
    return { nearZ: nz, nearHW: nhw, farZ: fz, farHW: fhw };
  }

  // 清晰带 z ∈ [−3, −14]（AM-004 §2.2：面积 158.8 单位²，预期密度 0.73 颗/单位²）
  var CLEAR_Z0 = -3.0, CLEAR_Z1 = -14.0;
  function pebbleStats() {
    var empty = { inView: 0, density: 0, tintSpread: 0, near: 0, far: 0, total: 0 };
    var lb = SW.lakebed, THREE = window.THREE;
    if (!lb || !THREE) { return empty; }
    var near = lb.pebbles, far = lb.pebblesFar, meshes = [near, far], a, i;

    var t = visibleTrapezoid(), hwAt = null;
    if (t) {
      var k = (t.farHW - t.nearHW) / (t.farZ - t.nearZ);
      hwAt = function (z) { return t.nearHW + k * (z - t.nearZ); };
    }
    // 清晰带面积 = 2 × 平均半宽 × dz
    var clearArea = hwAt ? (hwAt(CLEAR_Z0) + hwAt(CLEAR_Z1)) * (CLEAR_Z0 - CLEAR_Z1) : 0;

    var m = new THREE.Matrix4();
    var inView = 0, inClear = 0, mn = 1e9, mx = -1e9;
    for (a = 0; a < meshes.length; a++) {
      var im = meshes[a]; if (!im) { continue; }
      for (i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        var x = m.elements[12], z = m.elements[14];
        if (hwAt) {
          if (z <= CLEAR_Z0 && z >= CLEAR_Z1 && Math.abs(x) <= hwAt(z)) { inClear++; }
          if (z <= t.nearZ && z >= t.farZ && Math.abs(x) <= hwAt(z)) { inView++; }
        }
      }
      // aTint 存的是**线性**值 → 先编码回 sRGB 再算感知亮度（口径与 AM-004 §2.3 一致）
      var ta = im.geometry && im.geometry.attributes ? im.geometry.attributes.aTint : null;
      if (ta) {
        for (i = 0; i < im.count; i++) {
          var lum = 0.2126 * srgbEnc(ta.array[i * 3]) +
                    0.7152 * srgbEnc(ta.array[i * 3 + 1]) +
                    0.0722 * srgbEnc(ta.array[i * 3 + 2]);
          if (lum < mn) { mn = lum; }
          if (lum > mx) { mx = lum; }
        }
      }
    }
    if (mn > mx) { mn = 0; mx = 0; }
    return {
      inView: inView,
      density: clearArea > 0 ? inClear / clearArea : 0,
      tintSpread: mx - mn,
      near: near ? near.count : 0,
      far: far ? far.count : 0,
      total: (near ? near.count : 0) + (far ? far.count : 0)
    };
  }

  function camPitchDeg() {
    if (!window.THREE || !SW.scene.camera) { return 0; }
    var d = new window.THREE.Vector3();
    SW.scene.camera.getWorldDirection(d);
    return Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
  }

  // 当前小时：优先用 WP3 若暴露的 getHour()，否则退回本地时钟/P.fixedHour 推算
  function hours() {
    var T = SW.time;
    if (T && typeof T.getHour === 'function') {
      var v = T.getHour();
      if (typeof v === 'number' && isFinite(v)) { return v; }
    }
    if (T && T.getMode && T.getMode() === 'fixed') { return SW.P.fixedHour; }
    var d = new Date();
    var h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + (SW.P.hoursOffset || 0);
    return ((h % 24) + 24) % 24;
  }

  function waterUniformsNaN() {
    var u = SW.water && SW.water.uniforms; if (!u) { return false; }
    var vals = [];
    for (var k in u) {
      if (!Object.prototype.hasOwnProperty.call(u, k)) { continue; }
      var v = u[k] && ('value' in u[k]) ? u[k].value : u[k];
      if (v && v.isVector3) { vals.push(v); }
      else if (v && v.isVector2) { vals.push(v); }
      else if (v && v.isColor) { vals.push(v); }
      else if (typeof v === 'number') { vals.push(v); }
    }
    return SW.util.anyNaN(vals);
  }

  var dbg = {
    enabled: false,

    init: function () {
      enabled = !!SW.P.debug;
      this.enabled = enabled;
      if (!enabled) { return this; }

      panel = document.createElement('div');
      panel.id = 'dbg';
      panel.style.cssText = [
        'position:fixed', 'left:10px', 'top:10px', 'z-index:9',
        'padding:8px 10px', 'border-radius:6px',
        'background:rgba(8,14,18,.72)', 'color:#d8e6ea',
        'font:11px/1.5 ui-monospace,Consolas,Menlo,monospace',
        'white-space:pre', 'pointer-events:none', 'letter-spacing:.02em'
      ].join(';');
      pre = document.createElement('div');
      panel.appendChild(pre);
      document.body.appendChild(panel);

      // 只有 debug 模式才暴露；契约 §5 明确要求默认不得暴露
      window.__probe = function () { return SW.debug.probe(); };
      window.__seek = function (h) { return SW.debug.seek(h); };
      window.__clock = function (t) { return SW.debug.clock(t); };
      window.__hold = function (b) { return SW.debug.hold(b); };
      return this;
    },

    update: function (dt) {
      if (!enabled) { return; }
      frames++; acc += dt;
      if (acc - lastAcc >= 0.25 || frames >= 60) {
        if (acc - lastAcc > 0) { fps = frames / (acc - lastAcc); }
        frameMs = 1000 / (fps || 1);
        frames = 0; lastAcc = acc;
      }
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      if (now - lastPaint > 220) { lastPaint = now; this._paint(); }
    },

    _paint: function () {
      if (!pre) { return; }
      var p = this.probe();
      pre.textContent = [
        'fps ' + fmt(p.fps, 1) + '   ' + fmt(p.frameMs, 1) + 'ms',
        'calls ' + p.calls + '   tris ' + p.tris,
        'camY ' + fmt(p.camY, 2) + '  pitch ' + fmt(p.camPitchDeg, 2) + '°  horizonRow ' + fmt(p.horizonRow, 3),
        'topRowL ' + fmt(p.topRowL, 1) + '  fogL ' + fmt(p.fogL, 1),
        'hour ' + fmt(p.hours, 3) + '  ' + p.timeMode,
        'sun ' + fmt(p.sunAz, 3) + ' / ' + fmt(p.sunElev, 3) +
          '  glit ' + fmt(p.glitterGain, 2) + ' / ' + fmt(p.glitterSpec, 2),
        'pebble ' + p.pebbles + ' (n' + p.pebbleCountNear + '/f' + p.pebbleCountFar + ')' +
          '  inView ' + p.pebbleInView + '  dens ' + fmt(p.pebbleDensity, 3) +
          '  tint±' + fmt(p.pebbleTintSpread, 3),
        'ripple ' + p.rippleActive + '  refract ' + p.refract,
        'ptr ' + fmt(p.ptrWorld.x, 2) + ',' + fmt(p.ptrWorld.z, 2) + '  v ' + fmt(p.ptrSpeed, 2),
        'audio ' + p.audioCtx + '  bgm ' + fmt(p.bgmGain, 2),
        'webgl ' + p.webgl + '  NaN ' + p.anyNaN + '  rm ' + p.reduceMotion
      ].join('\n');
    },

    // ---------------------------------------------------------- §5 读数表
    probe: function () {
      var r = SW.scene.renderer;
      var info = r && r.info ? r.info.render : { calls: 0, triangles: 0 };
      // ⚠ 先快照：下面的 topRowL() 会额外渲染一次，renderer.info 会被重置
      var calls = info.calls || 0, tris = info.triangles || 0;
      var st = SW.scene.appliedState || (SW.time && SW.time.current && SW.time.current()) || null;
      var ip = (SW.input && SW.input.probe) ? SW.input.probe() : { worldX: 0, worldZ: 0, speed01: 0 };
      var ap = (SW.audio && SW.audio.probe) ? SW.audio.probe() : { state: 'none', bgmGain: 0 };
      var wp = (SW.water && SW.water.probe) ? SW.water.probe() : { refract: false };
      var rp = (SW.ripple && SW.ripple.probe) ? SW.ripple.probe() : { active: 0 };
      var ps = pebbleStats();
      var pfz = SW.P.pebbleFieldZ || [0, 0];

      return {
        fps: fps || 0,
        frameMs: frameMs || 0,
        calls: calls,
        tris: tris,
        hours: hours(),
        timeMode: (SW.time && SW.time.getMode) ? SW.time.getMode() : SW.P.timeMode,
        rippleActive: (SW.ripple && typeof SW.ripple.active === 'number') ? SW.ripple.active : (rp.active || 0),
        ptrWorld: { x: ip.worldX || 0, z: ip.worldZ || 0 },
        ptrSpeed: ip.speed01 || 0,
        sunAz: st ? st.sunAz : 0,
        sunElev: st ? st.sunElev : 0,
        // —— AM-002 §5：反光路径（WP3 上报 probe 缺这两个，WP5 的 #7 断言依赖）——
        glitterGain: (st && typeof st.glitterGain === 'number') ? st.glitterGain : 0,
        glitterSpec: (typeof wp.glitterSpec === 'number') ? wp.glitterSpec : 0,
        audioCtx: ap.state || 'none',
        bgmGain: ap.bgmGain || 0,
        reduceMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
        webgl: !!(r && r.getContext && r.getContext()),
        anyNaN: waterUniformsNaN() ||
          SW.util.anyNaN([SW.scene.camera, SW.scene.camera.position, SW.scene.camera.rotation,
            SW.scene.sun.position, SW.scene.fog.density, r ? r.toneMappingExposure : 1]),
        refract: !!wp.refract,
        // —— AM-001 §5.1：机位 / 地平线（已登记进 01-CONTRACT.md §5）——
        camY: SW.scene.camera.position.y,
        camPitchDeg: camPitchDeg(),
        horizonRow: 0.5 - camPitchDeg() / SW.scene.camera.fov,
        topRowL: topRowL(),
        fogL: fogL(),
        // —— AM-004 §5：鹅卵石场（判据 #1/#2 依赖）——
        pebbleCountNear: ps.near,
        pebbleCountFar: ps.far,
        pebbleInView: ps.inView,
        pebbleDensity: ps.density,
        pebbleTintSpread: ps.tintSpread,
        pebbleFieldZ: [pfz[0], pfz[1]],
        // —— 以下为 WP1 附加读数（非 §5 要求，供 WP1 自身验收用）——
        revision: window.THREE ? window.THREE.REVISION : '?',
        pebbles: ps.total,
        fieldSize: SW.ripple && SW.ripple.probe ? rp.fieldSize : SW.P.fieldSize,
        reticle: SW.scene.camera.position.toArray().map(function (n) { return +n.toFixed(3); }),
        dbgDt: dtLock,
        dbgHold: held
      };
    },

    // ------------------------------------------------------------- 钉时间
    seek: function (h) {
      if (SW.time && SW.time.setMode) { SW.time.setMode('fixed'); }
      if (SW.time && SW.time.setHour) { SW.time.setHour(h); }
      SW.P.fixedHour = h;
      SW.P.timeMode = 'fixed';
      return h;
    },

    // clock(t)：锁定每帧 dt（涟漪/涌动相位可复现）。传 null 解除。
    clock: function (t) {
      dtLock = (t === null || t === undefined) ? null : +t;
      return dtLock;
    },

    // hold(true)：冻结过渡（每帧 dt = 0）。传 null 解除。
    hold: function (b) {
      held = !!b;
      if (!held) { dtLock = null; }
      return held;
    },

    // 供 99-main.js 消费
    dtFor: function (dt) {
      if (!enabled) { return dt; }
      if (held) { return 0; }
      return dtLock === null ? dt : dtLock;
    }
  };

  SW.debug = dbg;
})(window.SW = window.SW || {}, window, document);
