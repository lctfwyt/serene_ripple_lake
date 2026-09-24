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
    // ★ 主控 2026-09-24 修复「?debug=1 全屏闪」：
    //   上面这次 r.render() 是**裸渲染**——直接画进屏幕 backbuffer，不带 bloom / vignette。
    //   而 SW.debug.update() 位于主渲染**之后**（99-main.js 冻结的渲染循环：scene.render →
    //   ui.update → debug.update），所以这帧裸画面会残留到下一帧才被覆盖；采样节流 300ms →
    //   约 3.3 次/秒的亮度骤降。bloom 上线后裸帧与后期帧差异剧增，才从"几乎看不出"变成"一直闪"。
    //   读完像素立刻用主渲染入口把正确画面画回去。dt=0 ⇒ lakebed.tick(0)（_causticTime += 0）、
    //   post.render(0)（_t += 0）均不推进任何相位 → 读数语义与可复现性零影响，只多一帧 GPU。
    try {
      if (SW.scene && SW.scene.render) { SW.scene.render(0); }
    } catch (e) { /* 恢复失败最多留一帧裸画面，不影响读数 */ }
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
      this._buildSliders();
      document.body.appendChild(panel);

      // 只有 debug 模式才暴露；契约 §5 明确要求默认不得暴露
      window.__probe = function () { return SW.debug.probe(); };
      window.__seek = function (h) { return SW.debug.seek(h); };
      window.__clock = function (t) { return SW.debug.clock(t); };
      window.__hold = function (b) { return SW.debug.hold(b); };
      return this;
    },

    // —— 后期参数滑杆（主控 2026-09-24：雨桐调 taste 用）——
    // 仅 ?debug=1 存在。grain/vignette 走 SW.P（65-post 每帧读，立即生效）；
    // bloom 三参 init 时已烘焙进 pass → 直接写 SW.post.bloomPass 的同名属性并回写 SW.P 保持一致。
    // 不落盘：刷新即回到 00-config.js 默认值；「重置」按钮回 SW.P0。
    // 时序：dbg.init 早于 post 的 ready → 先建 UI 挂「启动中」提示，ready 后再定性（激活/未激活）。
    _buildSliders: function () {
      var box = document.createElement('div');
      box.id = 'dbg-sliders';
      box.style.cssText = [
        'pointer-events:auto', 'margin-top:6px', 'padding-top:6px',
        'border-top:1px solid rgba(216,230,234,.25)'
      ].join(';');

      var defs = [
        // [SW.P 字段, bloomPass 属性, 标签, min, max, step, 小数位]
        //  · bloom 三参：init 时烘焙进 pass → 直写 SW.post.bloomPass 同名属性
        //  · glitter 三参：60-water 每帧读 SW.P（478 行附近）→ 改 P 即实时生效
        //  · ⚠ #13/#5 断言按当前默认（detail 0.16 / rough 0.065）标定，大幅调整后固化前跑 npm run assert
        ['bloomStrength',  'strength',  'bloom 强度 ', 0,    1.5,  0.01,  2],
        ['bloomThreshold', 'threshold', 'bloom 阈值 ', 0,    1,    0.01,  2],
        ['bloomRadius',    'radius',    'bloom 半径 ', 0,    1,    0.01,  2],
        ['vignetteAmp',    null,        'vignette   ', 0,    0.4,  0.005, 3],
        ['grainAmp',       null,        'grain      ', 0,    0.05, 0.001, 3],
        ['glitterDetail',  null,        'glit 细节  ', 0,    0.35, 0.005, 3],
        ['glitterRough',   null,        'glit 粗糙  ', 0.005,0.3,  0.005, 3],
        ['glitterJitter',  null,        'glit 抖动  ', 0,    0.5,  0.005, 3]
      ];

      defs.forEach(function (d) {
        var field = d[0], passProp = d[1], label = d[2], min = d[3], max = d[4], step = d[5], dec = d[6];
        var row = document.createElement('div');
        row.style.cssText = 'white-space:nowrap;margin:2px 0';
        var lab = document.createElement('span');
        lab.textContent = label;
        var input = document.createElement('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step;
        input.value = SW.P[field];
        input.style.cssText = 'width:110px;vertical-align:middle;accent-color:#7fb8c9;height:14px';
        var val = document.createElement('span');
        val.textContent = Number(SW.P[field]).toFixed(dec);
        val.style.cssText = 'display:inline-block;width:48px;text-align:right';
        input.addEventListener('input', function () {
          var v = parseFloat(input.value);
          SW.P[field] = v;
          if (passProp && SW.post && SW.post.bloomPass) { SW.post.bloomPass[passProp] = v; }
          val.textContent = v.toFixed(dec);
        });
        row.appendChild(lab); row.appendChild(input); row.appendChild(val);
        box.appendChild(row);
      });

      var reset = document.createElement('button');
      reset.textContent = '重置默认';
      reset.style.cssText = 'pointer-events:auto;margin-top:4px;font:inherit;color:inherit;' +
        'background:rgba(216,230,234,.12);border:1px solid rgba(216,230,234,.3);border-radius:4px;padding:1px 8px;cursor:pointer';
      reset.addEventListener('click', function () {
        var P0 = SW.P0;
        defs.forEach(function (d) {
          SW.P[d[0]] = P0[d[0]];
          if (d[1] && SW.post && SW.post.bloomPass) { SW.post.bloomPass[d[1]] = P0[d[0]]; }
        });
        var rows = box.querySelectorAll('input');
        defs.forEach(function (d, i) {
          rows[i].value = P0[d[0]];
          rows[i].nextSibling.textContent = Number(P0[d[0]]).toFixed(d[6]);
        });
      });
      box.appendChild(reset);

      var hint = document.createElement('div');
      hint.style.cssText = 'opacity:.75';
      hint.textContent = '（后期链启动中…）';
      box.appendChild(hint);

      // ready 之后定性：激活 → 撤提示；未激活（?nopost=1 / THREEPOST 缺失）→ 收起滑杆只留说明
      SW.bus.on('ready', function () {
        if (SW.post && SW.post.active) {
          hint.style.display = 'none';
        } else {
          hint.textContent = '（后期链未激活：?nopost=1 或 THREEPOST 缺失 → 参数无效）';
          box.querySelectorAll('div,input,button').forEach(function (el) {
            if (el !== hint) { el.style.display = 'none'; }
          });
        }
      });

      panel.appendChild(box);
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
