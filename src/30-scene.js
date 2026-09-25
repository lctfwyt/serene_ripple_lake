// src/30-scene.js —— 所有者：WP1 → UP3（AM-017 起环境光照段归 UP3）
// 签名逐字对齐 01-CONTRACT.md §2.3。其它 WP：只读。
//
// WP2 会用到的钩子（契约 §2.3 之外的**附加**便利属性，不影响冻结签名）：
//   SW.scene.rtCamera  —— 赋一个镜像相机，WP1 的 render() 就会自动把场景渲进 SW.scene.sceneRT
//                          （渲染期间自动隐藏 SW.water.mesh，避免水面被画进自己的折射 RT）。
//   SW.scene.sceneRT    —— 已分配好，**不要重建**。颜色附件是 linear（未做 tonemap / 未编码），
//                          DepthTexture 用 NearestFilter（用 LINEAR 会变全白）。
//   SW.scene.env        —— **UP3 / AM-017 新增**（只读消费）：程序化环境贴图的运行时状态。
//                          { ready, equirect, rt, rebuilds, res, err }
//                          `60-water.js` 只读 `ready` 与 `equirect` 两个字段，**不得重建**。
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

  // ═══ UP3 / AM-017：程序化环境贴图（equirect DataTexture → PMREMGenerator）══════
  // 为什么是程序化而不是外部 HDRI：见 plan/99-UP3-hdri.md §3-①（体积 9 MB / r160 无 rotation /
  //   真月光素材稀缺）。硬约束：`npm run assert` 与 `assert:dist` **都在 file:// 下跑** →
  //   环境贴图必须是**运行时生成的 DataTexture**，不许 fetch / XHR / <img> 拉 .hdr
  //   （那会在两条线上同时拿不到，不是"降级"）。
  // r160 缺 `scene.environmentIntensity` 与 `environmentRotation` →
  //   强度只能走 `material.envMapIntensity`，朝向只能靠"生成时就画对"
  //   （这恰是程序化方案的天然优势）。**不要去 vendor/ 里补 API。**
  var ENV_EPS = 0.02;          // 惰性重建阈值（签名距离）。防每帧重烘 PMREM
  var AMB_BASE = 0.12;         // AmbientLight 基准强度；env 生效时按 P.envAmbScale 压减
  var ENV_SUN_DISC = 2.5;      // 太阳瓣紧致分量峰值
  // 太阳瓣的**角宽**必须够大：水面反射按粗糙度取 mip（128×64 的 mip1 一个纹素 ≈ 5.6°），
  // 半宽 ≲2° 的针尖瓣在 mip1 上会被抹成 0 —— 实测「峰值没起来、中位反而升」→ 反光柱判据反而变差。
  // 取 pow(d,300)（半宽 ≈ 3.9°）：在 mip0~1 上活得住，又不至于宽到像"假光斑"。
  // 太阳的**物理**镜面高光仍由 60-water.js 的 GGX 路径（两层法线）承担，env 只补环境色。
  var ENV_SUN_DEXP = 300;      // 紧致分量指数
  var ENV_SUN_GLOW = 0.20;     // 太阳瓣宽泛分量峰值（绕日暖晕 → 给漫反射 IBL 方向性）
  var ENV_SUN_GEXP = 20;       // 宽泛分量指数
  var ENV_SUN_AMP = 1.6;       // 太阳瓣总幅度 = amp × max(sunIntensity, 0.25)
  var ENV_GROUND_MIN = 0.16;   // 下半球（"地面/水体半球"）最暗处的相对亮度
  var ENV_REBUILD_MAX = 40;    // 单次会话重建上限（护栏，防阈值失效时空转）

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function sstep(e0, e1, x) { var t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
  function numOr(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // TimeState → 环境签名距离：只统计**会改变环境外观**的字段。
  //   sunAz / sunElev 是 rad，系数 0.25 → 约 0.08 rad(≈4.6°) 的位移就够触发重建。
  //   ⚠ 同类字段间**不互相抵消**（取绝对值累加）—— 否则"天空变亮 + 太阳变暗"会被误判成没变。
  function envDist(a, b) {
    if (!a || !b) { return Infinity; }
    var d = 0, i;
    for (i = 0; i < 3; i++) {
      d += Math.abs(numOr(a.skyTop[i], 0) - numOr(b.skyTop[i], 0));
      d += Math.abs(numOr(a.skyBottom[i], 0) - numOr(b.skyBottom[i], 0));
      d += 0.6 * Math.abs(numOr(a.sunColor[i], 0) - numOr(b.sunColor[i], 0));
    }
    d += 0.6 * Math.abs(numOr(a.sunIntensity, 0) - numOr(b.sunIntensity, 0));
    d += 0.25 * (Math.abs(numOr(a.sunAz, 0) - numOr(b.sunAz, 0)) +
                 Math.abs(numOr(a.sunElev, 0) - numOr(b.sunElev, 0)));
    return d;
  }

  // 128×64（POT，可生成 mip）equirect：
  //   上半球 skyBottom → skyTop 竖向渐变（**与天空球 shader 同一算式**：smoothstep(-0.06,0.62,y)^0.85）
  //   + 太阳瓣（方位取 sunAz、仰角取 sunElev、色取 sunColor、幅度取 sunIntensity）
  //   + 下半球压暗的"地面/水体半球"。色值一律**线性**，与 setRGB / 天空 uniform 同工作空间。
  //
  // ⚠ 采样约定必须与 three 的 equirectUv() **逐字一致**（否则环境贴图整个错位、水面反射全乱）：
  //     u = atan2(dir.z, dir.x)/(2π) + 0.5      v = asin(dir.y)/π + 0.5      ← v 是**非线性**的！
  //     DataTexture.flipY = false → 第 0 行对应 v = 0 → dir.y = −1（正下方）。
  function buildEnvEquirect(s, W, H) {
    var DU = THREE.DataUtils;
    var toHalf = (DU && DU.toHalfFloat) ? DU.toHalfFloat : function (v) { return v; };
    var ce = Math.cos(s.sunElev), se = Math.sin(s.sunElev);
    var lx = ce * Math.sin(s.sunAz), ly = se, lz = ce * Math.cos(s.sunAz);
    var T = s.skyTop, B = s.skyBottom, C = s.sunColor;
    var amp = Math.max(0.25, numOr(s.sunIntensity, 0.7)) * ENV_SUN_AMP;
    var data = new Uint16Array(W * H * 4);
    var k = 0, ix, iy, i;
    for (iy = 0; iy < H; iy++) {
      var v = (iy + 0.5) / H;
      var y = Math.sin((v - 0.5) * Math.PI);
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var up = y >= 0;
      var t = Math.pow(sstep(-0.06, 0.62, y), 0.85);                    // 同天空球
      var gm = ENV_GROUND_MIN + (1 - ENV_GROUND_MIN) * sstep(-0.75, 0.02, y);
      for (ix = 0; ix < W; ix++) {
        var phi = ((ix + 0.5) / W - 0.5) * Math.PI * 2;
        var dx = r * Math.cos(phi), dz = r * Math.sin(phi);
        var cr, cg, cb;
        if (up) {
          cr = B[0] + (T[0] - B[0]) * t;
          cg = B[1] + (T[1] - B[1]) * t;
          cb = B[2] + (T[2] - B[2]) * t;
        } else {
          cr = B[0] * gm; cg = B[1] * gm; cb = B[2] * gm;
        }
        var dp = dx * lx + y * ly + dz * lz;
        if (dp > 0) {
          var lobe = Math.pow(dp, ENV_SUN_DEXP) * ENV_SUN_DISC + Math.pow(dp, ENV_SUN_GEXP) * ENV_SUN_GLOW;
          if (lobe > 1e-5) { var sc = lobe * amp; cr += C[0] * sc; cg += C[1] * sc; cb += C[2] * sc; }
        }
        data[k++] = toHalf(cr); data[k++] = toHalf(cg); data[k++] = toHalf(cb); data[k++] = toHalf(1);
      }
    }
    var tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;
    // HalfFloat + LinearMipmapLinear：水面按粗糙度取 mip → **粗糙度感知模糊**。
    // （WebGL2 核心里 R16G16B16A16F 是 texture-filterable 的，不需要额外扩展。）
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.RepeatWrapping;          // 经度方向循环
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    tex.name = 'envEquirect';
    return tex;
  }

  // ------------------------------------------------------ TimeState 变更判定
  function arrEq(a, b) {    if (a === b) { return true; }
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
    // UP3 / AM-017（附加属性，非冻结签名）：程序化环境贴图的运行时状态
    env: { ready: false, equirect: null, rt: null, rebuilds: 0, res: '', err: '' },
    _envPmrem: null, _envRT: null, _envEq: null, _envOldRT: null, _envOldEq: null,
    _envLast: null, _envEnabledLast: null, _envMatPending: true, _envMatCount: 0,

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
      // hemi.intensity / amb.intensity 不在这里直接赋 —— 见下方 env 段：
      // env 生效时环境光会**重复计**，两者要按 P.envHemiScale / P.envAmbScale 一起扣回。
      fog.color.setRGB(s.fogColor[0], s.fogColor[1], s.fogColor[2]);
      fog.density = s.fogDensity;
      this.renderer.toneMappingExposure = s.exposure;
      this.sky.material.uniforms.uTop.value.setRGB(s.skyTop[0], s.skyTop[1], s.skyTop[2]);
      this.sky.material.uniforms.uBottom.value.setRGB(s.skyBottom[0], s.skyBottom[1], s.skyBottom[2]);
      this.stars.material.opacity = SW.util.clamp(s.starAlpha, 0, 1);
      this.sky.visible = s.starAlpha < 0.995;

      // ── UP3 / AM-017：环境贴图（惰性重建）+ 环境光扣回 ─────────────────────
      // 惰性判据 = envDist(新建状态, 上次烘图用的状态) > ENV_EPS。
      //   `refresh()` 只在小时推进 ≥0.001 时才换状态对象 → 同一状态反复调用时 dist = 0，
      //   不会每帧重烘；开着自动时钟时重建频率约「每几分钟一次」量级。
      var envOn = !!SW.P.envEnabled;
      if (envOn !== this._envEnabledLast) {          // 运行时开关翻转 → 强制重判
        this._envEnabledLast = envOn;
        this._envLast = null;
      }
      var envLive = false;
      if (envOn) {
        if (envDist(s, this._envLast) > ENV_EPS || !this.env.ready) {
          this._envLast = s;
          envLive = this.buildEnv(s);
        } else {
          envLive = this.env.ready;
        }
      } else if (this.env.ready) {
        this.dropEnv();
      }
      // 建失败（env.err 非空）→ 视作没生效，光照按旧值，画面走水面二色渐变
      if (this.env.err) { envLive = false; }
      hemi.intensity = s.hemiIntensity * (envLive ? numOr(SW.P.envHemiScale, 1) : 1);
      this.amb.intensity = AMB_BASE * (envLive ? numOr(SW.P.envAmbScale, 1) : 1);

      this.appliedState = s;
      // 只在状态真正变化时广播（否则会 60 次/秒地刷 WP2/WP3 的监听器）
      if (!sameState(prevState, s)) { prevState = s; SW.bus.emit('timechange', s); }
    },

    // ─────────────────────────────── UP3 / AM-017：环境贴图构建 / 降级 ───────
    // 返回 boolean（是否已生效）。任何异常一律吞掉并降级 ——
    // 环境光失败**绝不能**连累画面（验收 #10-②：模拟 PMREM 建失败时画面必须走旧路径、不许黑）。
    buildEnv: function (s) {
      var P = SW.P;
      var W = Math.max(8, numOr(P.envResolution, 128) | 0);
      var H = Math.max(4, W >> 1);
      if (this.env.rebuilds >= ENV_REBUILD_MAX) { return this.env.ready; }
      try {
        if (!this._envPmrem) {
          this._envPmrem = new THREE.PMREMGenerator(this.renderer);
          this._envPmrem.compileEquirectangularShader();
        }
        var eq = buildEnvEquirect(s, W, H);
        var rt = this._envPmrem.fromEquirectangular(eq);
        // 双缓冲释放：只回收「上上张」，避免水面当帧还指着刚被 dispose 的贴图
        if (this._envOldRT) { this._envOldRT.dispose(); this._envOldRT = null; }
        if (this._envOldEq) { this._envOldEq.dispose(); this._envOldEq = null; }
        this._envOldRT = this._envRT; this._envOldEq = this._envEq;
        this._envRT = rt; this._envEq = eq;
        this.scene.environment = rt.texture;     // 只作用于 MeshStandardMaterial（= 两层鹅卵石湖底）
        this.env.equirect = eq;
        this.env.rt = rt;
        this.env.ready = true;
        this.env.res = W + 'x' + H;
        this.env.err = '';
        this.env.rebuilds++;
        this._envMatPending = true;              // 材质 envMapIntensity / USE_ENVMAP 需要刷一次
        return true;
      } catch (e) {
        this.env.err = String((e && e.message) || e);
        this.dropEnv();
        return false;
      }
    },

    // envEnabled=false 或构建失败 → 退回旧光照。**不销毁** PMREM/RT（还能再开回来）。
    dropEnv: function () {
      if (this.scene) { this.scene.environment = null; }
      this.env.ready = false;
      this._envMatPending = true;
      return false;
    },

    // 把 P.envIntensity 写到所有 MeshStandardMaterial 上。
    //   r160 没有 scene.environmentIntensity → 强度只能逐材质写（见 99-UP3-hdri.md §3-②）。
    //   `40-lakebed.js` 不在本包白名单 → 用 traverse 设，**不碰那个文件的一个字节**。
    //   forceUpdate=true 时顺手 needsUpdate 一次，让 three 把 USE_ENVMAP 编进程序。
    //   ⚠ 只在待刷标记置位时调用（needsUpdate 会触发重编程序，不能每帧做）。
    _applyEnvIntensity: function (forceUpdate) {
      var k = numOr(SW.P.envIntensity, 1);
      var n = 0;
      if (!this.scene) { return 0; }
      this.scene.traverse(function (o) {
        var m = o.material;
        if (!m || !m.isMeshStandardMaterial) { return; }
        if (m.envMapIntensity !== k) { m.envMapIntensity = k; }
        if (forceUpdate) { m.needsUpdate = true; }
        n++;
      });
      this._envMatCount = n;
      return n;
    },

    render: function (dt) {
      var r = this.renderer;
      // ⓪'' UP3：材质 envMapIntensity 待刷（首帧湖底可能还没建出来 → 保持待刷直到落上）
      if (this._envMatPending && this._applyEnvIntensity(true) > 0) { this._envMatPending = false; }
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
