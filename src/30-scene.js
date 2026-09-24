// src/30-scene.js —— 所有者：WP1
// 签名逐字对齐 01-CONTRACT.md §2.3。其它 WP：只读。
//
// WP2 会用到的钩子（契约 §2.3 之外的**附加**便利属性，不影响冻结签名）：
//   SW.scene.rtCamera  —— 赋一个镜像相机，WP1 的 render() 就会自动把场景渲进 SW.scene.sceneRT
//                          （渲染期间自动隐藏 SW.water.mesh，避免水面被画进自己的折射 RT）。
//   SW.scene.sceneRT    —— 已分配好，**不要重建**。颜色附件是 linear（未做 tonemap / 未编码），
//                          DepthTexture 用 NearestFilter（用 LINEAR 会变全白）。
(function (SW, window, document) {
  'use strict';
  var THREE = window.THREE;

  var W = 1, H = 1;
  var prevState = null;

  // ═══ 机位共享常量（01-CONTRACT.md §9）═════════════════════════════════════
  // ⚠ 这几个数字是跨 WP 约定（WP2 的 RT 相机必须同步 fov 与机位、WP3 的雾要按远景调）。
  //   要改 → 必须走 plan/02-AMENDMENTS.md 开变更单。**不要在正文里写裸数字。**
  //   AM-001：雨桐要求「更俯视、网页全是湖水、看不到地平线以上」。
  var CAM_FOV = 34;             // 42 太宽：高俯视时画面纵向跨 4→50 单位，上半屏全是雾
  var CAM_Y = 5.9;              // 水面之上 4.35（WATER_Y = 1.55）
  var CAM_Z = 3.4;
  var WATER_Y = 1.55;
  var CAM_LOOKAHEAD = 9.33;     // lookAt 的水平前视距离
  // 由上面几项推出，不要写死：
  //   俯角 = atan((CAM_Y − WATER_Y) / CAM_LOOKAHEAD) = atan(4.35/9.33) = 25.00°
  //   顶边射线俯角 = 俯角 − CAM_FOV/2 = 25 − 17 = 8°（向下）→ 全程俯视水面，无天空
  //   地平线行位 = 0.5 − 俯角/CAM_FOV = 0.5 − 25/34 = −0.235 → 在画面顶边之外

  // ------------------------------------------------------------- 天空 / 星星
  function makeSky() {
    var geo = new THREE.SphereGeometry(300, 48, 24);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0.24, 0.45, 0.72) },
        uBottom: { value: new THREE.Color(0.62, 0.76, 0.78) }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop;',
        'uniform vec3 uBottom;',
        'varying vec3 vDir;',
        'void main() {',
        '  float t = smoothstep(-0.06, 0.62, normalize(vDir).y);',
        '  t = pow(t, 0.85);',
        '  gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n')
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'sky';
    return mesh;
  }

  function makeStars() {
    var N = 620, pos = new Float32Array(N * 3);
    var rng = SW.util.newRng(SW.P.seed ^ 0x5EED);
    for (var i = 0; i < N; i++) {
      // 只铺上半球，避免星星落到湖底高度以下
      var u = rng(), v = rng();
      var theta = SW.util.TAU * u;
      var y = 0.06 + 0.94 * v;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var R = 288;
      pos[i * 3] = Math.cos(theta) * r * R;
      pos[i * 3 + 1] = y * R;
      pos[i * 3 + 2] = Math.sin(theta) * r * R;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.7, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.name = 'stars';
    return pts;
  }

  // ---------------------------------------------------------------- RT 分配
  function makeSceneRT(w, h) {
    var dw = Math.max(2, Math.floor(w)), dh = Math.max(2, Math.floor(h));
    var depth = new THREE.DepthTexture(dw, dh, THREE.UnsignedIntType);
    depth.minFilter = THREE.NearestFilter;  // ⚠ 不能 LINEAR
    depth.magFilter = THREE.NearestFilter;
    var rt = new THREE.WebGLRenderTarget(dw, dh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      depthTexture: depth
    });
    rt.texture.name = 'sceneRT.color';
    rt.texture.generateMipmaps = false;
    return rt;
  }

  // ------------------------------------------------------ TimeState 变更判定
  function arrEq(a, b) {
    if (a === b) { return true; }
    if (!a || !b || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }
  function sameState(a, b) {
    if (!a || !b) { return false; }
    for (var k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { continue; }
      var va = a[k], vb = b[k];
      if (Array.isArray(va) || Array.isArray(vb)) { if (!arrEq(va, vb)) { return false; } }
      else if (va !== vb) { return false; }
    }
    return true;
  }

  var scene = {
    renderer: null, scene: null, camera: null, clock: null,
    sun: null, hemi: null, amb: null, fog: null,
    sky: null, stars: null,
    sceneRT: null, rtCamera: null,
    lastState: null, appliedState: null,

    init: function (canvas) {
      var w = canvas.clientWidth || window.innerWidth;
      var h = canvas.clientHeight || window.innerHeight;

      var renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, alpha: false,
        powerPreference: 'high-performance', stencil: false
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      // r160 用 outputColorSpace（不是 outputEncoding）
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = SW.P.exposure;

      this.renderer = renderer;

      var sc = new THREE.Scene();
      sc.fog = new THREE.FogExp2(0x6b999f, 0.052);
      this.scene = sc;
      this.fog = sc.fog;

      // AM-001：fov 34 + 俯角 25°。俯角必须 > fov/2 = 17°，否则地平线回到画面里。
      var cam = new THREE.PerspectiveCamera(CAM_FOV, w / h, 0.1, 400);
      cam.position.set(0, CAM_Y, CAM_Z);
      cam.lookAt(0, WATER_Y, CAM_Z - CAM_LOOKAHEAD);   // → (0, 1.55, −5.93)
      this.camera = cam;

      // 光照：sun 负责方向感，hemi 负责水面反射与水下环境反弹，amb 只是防黑底
      var sun = new THREE.DirectionalLight(0xffffff, 2.1);
      sun.position.set(30, 40, 20);
      sc.add(sun);
      sc.add(sun.target);
      this.sun = sun;

      var hemi = new THREE.HemisphereLight(0x9fcee0, 0x33473f, 0.9);
      sc.add(hemi);
      this.hemi = hemi;

      var amb = new THREE.AmbientLight(0xffffff, 0.12);
      sc.add(amb);
      this.amb = amb;

      this.sky = makeSky(); sc.add(this.sky);
      this.stars = makeStars(); sc.add(this.stars);

      this.sceneRT = makeSceneRT(
        Math.floor(w * renderer.getPixelRatio()),
        Math.floor(h * renderer.getPixelRatio())
      );

      this.clock = new THREE.Clock();
      W = w; H = h;

      window.addEventListener('resize', this._onResize, false);
      window.addEventListener('orientationchange', this._onResize, false);
      return this;
    },

    _onResize: function () {
      if (!scene.renderer) { return; }
      var canvas = scene.renderer.domElement;
      var w = canvas.clientWidth || window.innerWidth;
      var h = canvas.clientHeight || window.innerHeight;
      if (!w || !h) { return; }
      scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      scene.renderer.setSize(w, h, false);
      scene.camera.aspect = w / h;
      scene.camera.updateProjectionMatrix();
      var pr = scene.renderer.getPixelRatio();
      scene.sceneRT.setSize(Math.floor(w * pr), Math.floor(h * pr));
      W = w; H = h;
      SW.bus.emit('resize', { w: w, h: h, dpr: pr });
    },

    // 按 TimeState 字段逐个赋值。WP3 只提供数据，不需要碰本文件。
    // 注意：setRGB 的入参按**线性**工作空间解释（r160 默认行为），对得上天空 shader 的线性输出。
    applyTimeState: function (s) {
      if (!s) { return; }
      var sun = this.sun, hemi = this.hemi, fog = this.fog;
      sun.position.setFromSphericalCoords(50, Math.PI / 2 - s.sunElev, s.sunAz);
      sun.color.setRGB(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
      sun.intensity = s.sunIntensity;
      hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
      hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
      hemi.intensity = s.hemiIntensity;
      fog.color.setRGB(s.fogColor[0], s.fogColor[1], s.fogColor[2]);
      fog.density = s.fogDensity;
      this.renderer.toneMappingExposure = s.exposure;
      this.sky.material.uniforms.uTop.value.setRGB(s.skyTop[0], s.skyTop[1], s.skyTop[2]);
      this.sky.material.uniforms.uBottom.value.setRGB(s.skyBottom[0], s.skyBottom[1], s.skyBottom[2]);
      this.stars.material.opacity = SW.util.clamp(s.starAlpha, 0, 1);
      this.sky.visible = s.starAlpha < 0.995;

      this.appliedState = s;
      // 只在状态真正变化时广播（否则会 60 次/秒地刷 WP2/WP3 的监听器）
      if (!sameState(prevState, s)) { prevState = s; SW.bus.emit('timechange', s); }
    },

    render: function (dt) {
      var r = this.renderer;
      // ⓪ 推进 WP1 自己的动画相位（水下光斑）。放在这里是为了不动契约 §2.10 那条冻结的渲染循环。
      if (SW.lakebed && SW.lakebed.tick) { SW.lakebed.tick(dt); }
      // ⓪' 可选的呼吸位移（P.cameraSway，默认 false）。只平移不改朝向 → 读起来像"船在轻轻晃"。
      // ⚠ AM-001 §4.1 第 4 条：基准值必须跟着机位走（原先硬编码 1.15，一开就把相机拽回水下）。
      if (SW.P.cameraSway) {
        this._swayT = (this._swayT || 0) + dt;
        var a = SW.P.swayAmp * 4;
        var s = this._swayT;
        this.camera.position.set(
          Math.sin(s * 0.37) * a,
          CAM_Y + Math.sin(s * 0.53) * a * 0.5,
          CAM_Z + Math.sin(s * 0.29) * a
        );
      }
      // ① 湖底离屏（供 WP2 做屏幕空间折射）。rtCamera 未设置时跳过。
      if (this.rtCamera) {
        var wm = SW.water && SW.water.mesh;
        var vis = wm ? wm.visible : null;
        if (wm) { wm.visible = false; }
        r.setRenderTarget(this.sceneRT);
        r.clear();
        r.render(this.scene, this.rtCamera);
        r.setRenderTarget(null);
        if (wm) { wm.visible = vis; }
      }
      // ② 主画面。AM-009：后期链激活时走 SW.post.render()（composer：bloom + vignette/grain +
      //    OutputPass 收尾 ACES+sRGB）；否则按 v1 直渲。两条分支共享步骤① 的 sceneRT ——
      //    composer 的缓冲区由 EffectComposer 自建，与折射源 RT 互不触碰（90-WAVE4 §5-①）。
      if (SW.post && SW.post.active) {
        SW.post.render(dt);
      } else {
        r.render(this.scene, this.camera);
      }
    }
  };

  // 附加（非冻结接口）：机位共享常量的只读副本。
  // WP2 建镜像折射相机时请读这里，**不要自己抄数字** —— 抄了就迟早对不上。
  scene.CAM = { fov: CAM_FOV, y: CAM_Y, z: CAM_Z, waterY: WATER_Y, lookahead: CAM_LOOKAHEAD };

  SW.scene = scene;
})(window.SW = window.SW || {}, window, document);
