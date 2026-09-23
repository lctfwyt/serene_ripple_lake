// src/50-ripple.js —— 所有者：WP2
// 签名逐字对齐 01-CONTRACT.md §2.5：{ init, emit, step, heightTexture, active, probe }
//
// 选型理由（WP2 §4.1）：波动方程 FBO ping-pong，而不是「shader 内 N 个解析涟漪」。
//   后者无法互相干涉、无法自然衰减 —— 而「波纹干涉」正是治愈感的核心。
//
// 附加（非冻结接口，WP2 自己加的只读信息，供水面对齐采样）：
//   SW.ripple.field = { cx, cz, half, texel }
//   60-water.js 必须读这里来算高度场 uv，**不要自己抄数字**。
//
// 状态纹理布局：R = 当前高度 h（世界单位，米），G = 上一帧高度 h_prev。
//   波动方程需要两步历史，所以必须占两个通道。
(function (SW, window) {
  'use strict';
  var THREE = window.THREE;
  var TAU = Math.PI * 2;

  // ── 高度场的世界覆盖 ──────────────────────────────────────────────────
  // P 里没有「场的世界范围」这个字段，而契约 §6 不允许 WP2 新增 P 字段，故落在本文件。
  // 覆盖 ±22、中心 (0,−10) 是照 AM-001 §2.2 的可见水域算的：
  //   可见 z ∈ [−27.5, −1.4]（顶边射线俯角 8° → 落点 z=−27.5）
  //   可见 x ∈ ±16.8（远边水平半角 28.6°）
  // → 44×44 的场把可见水域整个包进去，还留了一圈吸收带。
  var FIELD_HALF = 22;
  var FIELD_CX = 0;
  var FIELD_CZ = -10;

  var MAX_SOURCES = 8;      // §4.5 护栏：同场活跃源 ≤ 8，否则「涟漪乱炖」
  var SUB_DT = 1 / 60;      // 固定子步：帧率波动不该改变传播速度
  var MAX_SUB = 4;          // 一帧最多 4 个子步（dt 被钳到 0.05 时正好 3 个）
  var H_CLAMP = 0.6;        // 高度钳位，防叠加爆炸
  var CFL_MAX = 0.70;       // 显式差分稳定上限（2D 理论值 1/√2 ≈ 0.707）

  var N = 0;
  var renderer = null;
  var rtA = null, rtB = null, cur = null, nxt = null;
  var fsScene = null, fsCam = null, fsQuad = null;
  var stepMat = null, splatMat = null;
  var pending = [];         // 扁平队列 [u,v,amp, u,v,amp, ...]，两次 step 之间可多次注入
  var sources = [];         // { x, z, amp, t } 用于 active 计数与生命周期
  var simTime = 0, acc = 0;
  var lastEmitAt = -1, emitCount = 0;

  // ------------------------------------------------------------ shader：推进
  var STEP_FRAG = [
    'precision highp float;',
    'uniform sampler2D uState;',
    'uniform vec2 uTexel;',
    'uniform float uK2;',      // (c·dt/Δx)²，已在 JS 侧钳到 CFL 以内
    'uniform float uDecay;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 c = texture2D(uState, vUv);',
    '  float h = c.r, hp = c.g;',
    '  float l = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;',
    '  float r = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;',
    '  float d = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;',
    '  float u = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;',
    '  float lap = l + r + d + u - 4.0 * h;',
    '  float hn = (2.0 * h - hp + uK2 * lap) * uDecay;',
    '  // 边界吸收带：外圈 12% 逐帧衰减，否则涟漪会撞场边弹回来 → 鱼缸感',
    '  vec2 e = min(vUv, 1.0 - vUv);',
    '  float edge = smoothstep(0.0, 0.12, min(e.x, e.y));',
    '  hn *= mix(0.90, 1.0, edge);',
    '  hn = clamp(hn, -0.6, 0.6);',
    '  gl_FragColor = vec4(hn, h, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------ shader：注入
  // 注入的是**凹陷**（像手指点水），随后自然回弹成向外传播的环。
  // 同时加到 R/G 两个通道 → 初速度为零的纯位移，比只加 R 更接近真实落水。
  var SPLAT_FRAG = [
    'precision highp float;',
    'uniform sampler2D uState;',
    'uniform vec3 uSplat[8];',   // (u, v, amp)
    'uniform float uSigma2;',    // 2σ²（uv 空间）
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 s = texture2D(uState, vUv);',
    '  float add = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    vec3 sp = uSplat[i];',
    '    vec2 dd = vUv - sp.xy;',
    '    add -= sp.z * exp(-dot(dd, dd) / uSigma2);',
    '  }',
    '  vec2 hh = clamp(vec2(s.r, s.g) + add, -0.6, 0.6);',
    '  gl_FragColor = vec4(hh.x, hh.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var QUAD_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ 内部
  function pickType(r) {
    var gl = r.getContext();
    var isGL2 = !!(r.capabilities && r.capabilities.isWebGL2);
    if (isGL2 && gl.getExtension('EXT_color_buffer_float')) { return THREE.FloatType; }
    if (!isGL2 && gl.getExtension('OES_texture_float') && gl.getExtension('WEBGL_color_buffer_float')) {
      return THREE.FloatType;
    }
    // 半精度：11 位尾数对本场景（h ~ 0.01~0.16）够用，但衰减步长 4e-5 已接近其精度下限，
    // 若发现波纹「台阶状」衰减，说明落到了这一档 —— 见 _STATUS.md 遗留。
    return THREE.HalfFloatType;
  }

  function makeRT(type) {
    var rt = new THREE.WebGLRenderTarget(N, N, {
      minFilter: THREE.LinearFilter,     // 水面采样要平滑；推进 shader 取的是纹素中心，线性=精确
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    rt.texture.name = 'ripple.state';
    return rt;
  }

  function clearRT(rt, r) {
    var cc = new THREE.Color();
    r.getClearColor(cc);
    var ca = r.getClearAlpha();
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(rt);
    r.clear(true, true, false);
    r.setRenderTarget(null);
    r.setClearColor(cc, ca);
  }

  // 渲染一 pass：读 cur → 写 nxt → 交换。交换后必须同步 heightTexture 的指向。
  function pass(mat) {
    fsQuad.material = mat;
    renderer.setRenderTarget(nxt);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);
    var t = cur; cur = nxt; nxt = t;
    api.heightTexture = cur.texture;
    api.stateRT = cur;          // 只读附加：断言要 readRenderTargetPixels 验"场非全零"
  }

  function splatPass(list) {
    var arr = splatMat.uniforms.uSplat.value;
    for (var i = 0; i < 8; i++) {
      var o = i * 3;
      if (o + 2 < list.length) { arr[i].set(list[o], list[o + 1], list[o + 2]); }
      else { arr[i].set(0, 0, 0); }        // amp = 0 → 该项贡献为 0（不用 break，兼容性更好）
    }
    // 源宽度决定环距：σ ∝ 2π/k。rippleWaveK=9 → σ≈0.29u → 环距 ≈0.7u（§4.2 表）
    var sigma = 0.42 * (TAU / Math.max(0.5, SW.P.rippleWaveK));
    var su = sigma / (2 * FIELD_HALF);
    splatMat.uniforms.uSigma2.value = Math.max(1e-7, 2 * su * su);
    splatMat.uniforms.uState.value = cur.texture;
    pass(splatMat);
  }

  function stepPass() {
    var P = SW.P;
    var dx = (2 * FIELD_HALF) / N;
    var k = P.rippleSpeed * SUB_DT / dx;
    if (k > CFL_MAX) { k = CFL_MAX; }
    stepMat.uniforms.uK2.value = k * k;
    stepMat.uniforms.uDecay.value = P.rippleDecay;
    stepMat.uniforms.uState.value = cur.texture;
    pass(stepMat);
  }

  function substep() {
    // ① 注入（拖动时一帧内可能攒了多个） ② 推进
    while (pending.length) { splatPass(pending.splice(0, 8)); }
    stepPass();
    simTime += SUB_DT;
  }

  // ================================================================ 模块主体
  var api = {
    heightTexture: null,
    stateRT: null,
    active: 0,
    field: { cx: FIELD_CX, cz: FIELD_CZ, half: FIELD_HALF, texel: 0 },

    init: function (r) {
      renderer = r;
      N = Math.max(64, Math.min(1024, SW.P.fieldSize | 0));
      this.field.texel = 1 / N;

      var type = pickType(r);
      if (type !== THREE.FloatType) {
        console.warn('[still_water] ripple: 浮点 RT 不可用，退回半精度。波纹衰减可能出现台阶。');
      }
      rtA = makeRT(type); rtB = makeRT(type);

      fsScene = new THREE.Scene();
      fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      stepMat = new THREE.ShaderMaterial({
        uniforms: {
          uState: { value: null },
          uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
          uK2: { value: 0.3 },
          uDecay: { value: SW.P.rippleDecay }
        },
        vertexShader: QUAD_VERT,
        fragmentShader: STEP_FRAG,
        depthTest: false, depthWrite: false,
        // 关键：这两个 pass 里流动的是**物理量不是颜色**，
        // 一旦被 tonemap / 色彩空间转换过，波动方程就不再是线性的 → 会自激。
        toneMapped: false
      });

      var splats = [];
      for (var i = 0; i < 8; i++) { splats.push(new THREE.Vector3()); }
      splatMat = new THREE.ShaderMaterial({
        uniforms: {
          uState: { value: null },
          uSplat: { value: splats },
          uSigma2: { value: 1e-4 }
        },
        vertexShader: QUAD_VERT,
        fragmentShader: SPLAT_FRAG,
        depthTest: false, depthWrite: false,
        toneMapped: false
      });

      fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stepMat);
      fsQuad.frustumCulled = false;
      fsScene.add(fsQuad);

      clearRT(rtA, r); clearRT(rtB, r);
      cur = rtA; nxt = rtB;
      this.heightTexture = cur.texture;   // 即便内容全零也必须可用（60-water 建 shader 要用）

      simTime = 0; acc = 0; pending = []; sources = []; emitCount = 0; lastEmitAt = -1;
      this.active = 0;
      return this;
    },

    emit: function (x, z, amp) {
      if (!renderer || !(amp > 0)) { return false; }
      var u = (x - (FIELD_CX - FIELD_HALF)) / (2 * FIELD_HALF);
      var v = (z - (FIELD_CZ - FIELD_HALF)) / (2 * FIELD_HALF);
      if (u < 0 || u > 1 || v < 0 || v > 1) { return false; }   // 场外不注入
      pending.push(u, v, amp);
      if (sources.length >= MAX_SOURCES) { sources.shift(); }
      sources.push({ x: x, z: z, amp: amp, t: simTime });
      emitCount++;
      lastEmitAt = simTime;
      this.active = sources.length;
      return true;
    },

    step: function (dt) {
      if (!renderer) { return; }

      // ① 源老化（生命周期到了就退出活跃计数；波本身继续在场里传播并自然衰减）
      var lt = SW.P.rippleLifetime;
      if (lt > 0 && sources.length) {
        var keep = [];
        for (var i = 0; i < sources.length; i++) {
          if (simTime - sources[i].t <= lt) { keep.push(sources[i]); }
        }
        sources = keep;
      }
      this.active = sources.length;

      // ② 固定子步推进。dt 被外部钳到 0.05 → 最多 3 步；慢帧只会"波走慢"，不会炸。
      var d = (typeof dt === 'number' && dt > 0) ? dt : 0;
      if (d > 0.25) { d = 0.25; }
      acc += d;
      var n = 0;
      while (acc >= SUB_DT && n < MAX_SUB) { substep(); acc -= SUB_DT; n++; }
      if (acc > SUB_DT * MAX_SUB) { acc = 0; }   // 追不上就丢掉积压，别雪崩
    },

    probe: function () {
      return {
        active: sources.length,
        fieldSize: N,
        lastEmitAt: lastEmitAt,
        // 附加读数（WP5 断言用得着）
        emitCount: emitCount,
        simTime: simTime,
        pending: pending.length,
        half: FIELD_HALF,
        center: [FIELD_CX, FIELD_CZ],
        cfl: (function () {
          var dx = (2 * FIELD_HALF) / N;
          return Math.min(SW.P.rippleSpeed * SUB_DT / dx, CFL_MAX);
        })()
      };
    }
  };

  SW.ripple = api;
})(window.SW = window.SW || {}, window);
