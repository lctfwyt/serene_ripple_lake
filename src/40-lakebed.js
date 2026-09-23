// src/40-lakebed.js —— 所有者：WP1
// 契约 §2.4：SW.lakebed = { init(scene), group, causticTexture }
// 附加（WP1 内部用，非冻结接口）：SW.lakebed.tick(dt) —— 推进水下光斑相位，
//   由 30-scene.js 的 render(dt) 调用（因此契约里那条冻结的渲染循环不用改）。
(function (SW, window, document) {
  'use strict';
  var THREE = window.THREE;
  var TAU = Math.PI * 2;

  // ⚠ BED_SIZE 不得改：WP2 的 60-water.js:289-292 从 bedMesh.geometry.parameters.width
  //   读它来定水面边长（AM-004 §3 第 1 条「不得破坏的接口」）。
  var BED_SIZE = 90, BED_SEG = 48;

  // ---------------------------------------------------------- 确定性值噪声
  function h2(ix, iy, s) {
    var n = (ix * 374761393 + iy * 668265263 + s * 1013904223) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var u = x - xi, v = y - yi;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    var a = h2(xi, yi, s), b = h2(xi + 1, yi, s);
    var c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function bedY(x, z) {
    var n1 = vnoise(x / 7.0 + 11.3, z / 7.0 - 4.1, 17) * 2 - 1;
    var n2 = vnoise(x / 2.7 - 3.7, z / 2.7 + 8.9, 91) * 2 - 1;
    return 0.105 * n1 + 0.034 * n2;
  }

  // -------------------------------------------------- 程序化水下光斑（caustic）
  // 频率全部取整数倍 → 在 u,v 上周期为 1 → 平铺无缝。不用 Math.random。
  function makeCausticTexture() {
    var N = 256;
    var cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(N, N);
    var d = img.data;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var u = i / N, v = j / N;
        var a = Math.sin(TAU * (2 * u + 3 * v)) + Math.sin(TAU * (3 * u - 2 * v));
        var b = Math.sin(TAU * (5 * u + 1 * v)) + Math.sin(TAU * (1 * u - 4 * v));
        var s = Math.sin(a * 1.30 + b * 0.90);
        var g = Math.pow(Math.abs(s), 2.6);          // 细亮丝
        var o = (j * N + i) * 4;
        d[o] = 255 * g * 0.86;                        // 略偏青绿
        d[o + 1] = 255 * g * 0.97;
        d[o + 2] = 255 * g;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;   // 这是"光强"不是"颜色"，不要做 sRGB 解码
    return tex;
  }

  // ---------------------------------------------- shader 注入：世界坐标 varying
  var WORLD_VARY = [
    'varying vec2 vWXZ;',
    'varying vec3 vWPos;'
  ].join('\n');
  function injectWorldVarying(shader) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>', '#include <common>\n' + WORLD_VARY
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
      '  vec4 swW = modelMatrix * vec4(transformed, 1.0);\n' +
      '  vWPos = swW.xyz;\n' +
      '  vWXZ = swW.xz;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>', '#include <common>\n' + WORLD_VARY
    );
  }

  // ------------------------------------------ AM-005：caustic 强度随昼夜调制
  // 水下光斑的强弱 ∝ 水面接收的太阳辐照度 → 正午最强、晨昏中、夜里几乎为零。
  // 极值**从 WP3 的 keyframe 表动态取**，不写死数字：WP3 以后调 sunI，这里自动跟随。
  // （契约 §2.2 冻结签名，本函数只用 SW.time.current() 读数据，不改 TimeState。）
  var _sunLo = null, _sunHi = null;
  function sunRange() {
    if (_sunLo !== null) { return; }
    var K = (SW.time && SW.time.KEYS) || null;
    if (!K || !K.length) { _sunLo = 0.70; _sunHi = 2.10; return; }  // 兜底 = AM-005 落单时的表值
    var lo = Infinity, hi = -Infinity, i, v;
    for (i = 0; i < K.length; i++) {
      v = K[i].sunI; if (v < lo) { lo = v; } if (v > hi) { hi = v; }
    }
    _sunLo = lo; _sunHi = hi;
  }
  function causticDayFactor() {
    if (!SW.P.causticDayMod) { return 1; }
    var st = (SW.time && SW.time.current) ? SW.time.current() : null;
    if (!st) { return 1; }
    sunRange();
    var span = _sunHi - _sunLo;
    var g = span > 1e-6 ? (st.sunIntensity - _sunLo) / span : 1;
    g = g < 0 ? 0 : (g > 1 ? 1 : g);
    // 0.6 次幂：低光端不要掉得太快，黄昏要留得住光斑
    var f = SW.P.causticNightFloor;
    return f + (1 - f) * Math.pow(g, 0.6);
  }

  // ------------------------------------------------ 湖底材质：叠一层水下光斑
  function makeBedMaterial(causticTex) {
    var mat = new THREE.MeshStandardMaterial({
      color: 0x5d6f66, roughness: 0.92, metalness: 0.0
    });
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uCausticTex = { value: causticTex };
      shader.uniforms.uCausticScale = { value: SW.P.causticScale };
      shader.uniforms.uCausticTime = { value: 0 };
      shader.uniforms.uCausticStrength = { value: SW.P.caustics ? SW.P.causticStrength : 0 };
      injectWorldVarying(shader);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nuniform float uCausticTime;'
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' +
        'uniform sampler2D uCausticTex;\n' +
        'uniform float uCausticScale;\n' +
        'uniform float uCausticTime;\n' +
        'uniform float uCausticStrength;'
      ).replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
        '  vec2 cuv = vWXZ * uCausticScale\n' +
        '           + vec2(uCausticTime * 0.0035, uCausticTime * -0.0026);\n' +
        '  vec3 caus = texture2D(uCausticTex, cuv).rgb;\n' +
        '  caus *= 0.55 + 0.45 * texture2D(uCausticTex, vWXZ * uCausticScale * 0.37\n' +
        '           + vec2(uCausticTime * -0.0021, uCausticTime * 0.0031)).r;\n' +
        '  totalEmissiveRadiance += caus * uCausticStrength;'
      );
      mat.userData.shader = shader;
    };
    return mat;
  }

  // ------------------------------------------------------- 鹅卵石材质（逐实例）
  var NOISE_GLSL = [
    'float sw_h(vec3 p) {',
    '  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'float sw_n(vec3 x) {',
    '  vec3 i = floor(x), f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(sw_h(i + vec3(0,0,0)), sw_h(i + vec3(1,0,0)), f.x),',
    '                 mix(sw_h(i + vec3(0,1,0)), sw_h(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(sw_h(i + vec3(0,0,1)), sw_h(i + vec3(1,0,1)), f.x),',
    '                 mix(sw_h(i + vec3(0,1,1)), sw_h(i + vec3(1,1,1)), f.x), f.y), f.z);',
    '}'
  ].join('\n');

  // AM-004 §2.3：基色改纯白，深浅全部由 aTint 承担（diffuse = white × lin(palette)）。
  // 这样 aTint 恒 ≤ 1，语义干净；若仍用 #b4b9b2 基色，调色板会被整体压暗、对比被吃掉。
  function makePebbleMaterial() {
    var mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.55, metalness: 0.0, flatShading: false
    });
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uNoiseFreq = { value: SW.P.pebbleNoiseFreq };
      shader.uniforms.uNoiseAmp = { value: SW.P.pebbleNoiseAmp };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n' +
        'attribute float aRough;\n' +
        'attribute vec3 aTint;\n' +
        'varying float vRough;\n' +
        'varying vec3 vTint;\n' +
        'uniform float uNoiseFreq;\n' +
        'uniform float uNoiseAmp;\n' + NOISE_GLSL
      ).replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        '  // 关键：种子取实例的世界位置 → 每颗轮廓不同，而不是 100 颗复制蛋\n' +
        '  vec3 iSeed = instanceMatrix[3].xyz * 1.37;\n' +
        '  float nn = sw_n(position * uNoiseFreq + iSeed);\n' +
        '  transformed += normalize(position) * (nn - 0.5) * 2.0 * uNoiseAmp;\n' +
        '  vRough = aRough;\n' +
        '  vTint = aTint;'
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying float vRough;\nvarying vec3 vTint;'
      ).replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = vRough;'
      ).replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= vTint;'
      );
    };
    return mat;
  }

  // --------------------------------- AM-004：鹅卵石场（可见梯形 + 调色板）
  // 场形状：z ∈ [F0, F1] 的**梯形**，半宽随 z 线性张开（近窄远宽）。
  // 原来的圆盘（以 (0,−5) 为心、半径 13）实测只有 31/100 颗落在可见区内（69% 白给）。
  function halfWidthFn(F, W) {
    var span = F[0] - F[1];               // 正数（F[0] = NEAR_Z > F[1] = FAR_Z）
    return function (z) { return W[0] + (W[1] - W[0]) * (F[0] - z) / span; };
  }

  // 拒绝采样 → **面积均匀**。若 x、z 各自独立均匀，远段（半宽是近段的 3.3 倍）
  // 单位面积密度会被摊薄成 1/3，近处过密、远处过稀。
  function sampleField(rand, hwAt, W, z0, z1, n) {
    var out = new Float64Array(n * 2), got = 0, guard = 0;
    while (got < n && guard < n * 200) {
      guard++;
      var z = z0 + rand() * (z1 - z0);
      var x = (rand() * 2 - 1) * W[1];    // 用最大半宽兜上包络
      if (Math.abs(x) <= hwAt(z)) { out[got * 2] = x; out[got * 2 + 1] = z; got++; }
    }
    // 兜底（理论上打不满才走这里）：用包络内均匀点补齐，保证实例数严格等于 n
    while (got < n) {
      out[got * 2] = (rand() * 2 - 1) * W[1] * 0.5;
      out[got * 2 + 1] = z0 + rand() * (z1 - z0);
      got++;
    }
    return out;
  }

  // 调色板：hex(sRGB) → **线性**工作空间。r160 的 ColorManagement 默认开启，
  // diffuseColor.rgb *= vTint 发生在线性空间，直接把 sRGB 数值写进去会让暗石偏亮、整体发灰。
  function buildPalette(list) {
    var cols = [], cum = [], total = 0;
    for (var i = 0; i < list.length; i++) {
      cols.push(new THREE.Color().setHex(parseInt(list[i][0].slice(1), 16), THREE.SRGBColorSpace));
      total += list[i][1];
      cum.push(total);
    }
    return { cols: cols, cum: cum, total: total };
  }
  function pickPalette(rand, pal) {
    var t = rand() * pal.total;
    for (var i = 0; i < pal.cum.length; i++) { if (t < pal.cum[i]) { return pal.cols[i]; } }
    return pal.cols[pal.cols.length - 1];
  }

  // ================================================================ 模块主体
  var lakebed = {
    group: null,
    causticTexture: null,
    bedMesh: null,
    pebbles: null,      // 近景层（180 面）—— 名字保留：90-debug.js 读 .count
    pebblesFar: null,   // 中远景层（80 面）—— AM-004 新增
    _causticTime: 0,
    _bedShader: null,

    init: function (scene) {
      var P = SW.P;
      var group = new THREE.Group();
      group.name = 'lakebed';
      this.group = group;

      // ---- 湖盆 ----
      var geo = new THREE.PlaneGeometry(BED_SIZE, BED_SIZE, BED_SEG, BED_SEG);
      geo.rotateX(-Math.PI / 2);
      var pos = geo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, bedY(x, z));
      }
      geo.computeVertexNormals();

      this.causticTexture = makeCausticTexture();
      var bedMat = makeBedMaterial(this.causticTexture);
      var bed = new THREE.Mesh(geo, bedMat);
      bed.position.set(0, 0, 0);
      bed.name = 'lakebed.bed';
      group.add(bed);
      this.bedMesh = bed;

      // ---- 鹅卵石（AM-004：梯形场 + 双层 LOD + 5 档调色板）----
      var F = P.pebbleFieldZ;          // [-3.0, -24.0]  契约 §9 PEBBLE_FIELD_Z
      var W = P.pebbleFieldHalfW;      // [4.51, 14.85]  契约 §9 PEBBLE_FIELD_HALFW
      var LODZ = P.pebbleLodZ;         // -11            契约 §9 PEBBLE_LOD_Z
      var hwAt = halfWidthFn(F, W);
      var pal = buildPalette(P.pebblePalette);
      var rand = SW.util.mulberry32(P.seed);
      var rg = SW.util.range;

      // 两层共用一份材质（shader 完全相同 → 只编译一次 program）
      var pebMat = makePebbleMaterial();

      // 实测面数：Icosahedron(1,2) = 180 / Icosahedron(1,1) = 80
      // （AM-002 §6 写的 320 是错的：PolyhedronGeometry 细分是 20 × (detail+1)²）
      var layers = [
        { key: 'pebbles', name: 'lakebed.pebbles', geo: new THREE.IcosahedronGeometry(1, 2),
          z0: F[0], z1: LODZ, n: P.pebbleCountNear | 0, scale: P.pebbleScaleNear },
        { key: 'pebblesFar', name: 'lakebed.pebblesFar', geo: new THREE.IcosahedronGeometry(1, 1),
          z0: LODZ, z1: F[1], n: P.pebbleCountFar | 0, scale: P.pebbleScaleFar }
      ];

      for (var li = 0; li < layers.length; li++) {
        var L = layers[li];
        var n = L.n;
        var pts = sampleField(rand, hwAt, W, L.z0, L.z1, n);

        var rough = new Float32Array(n);
        var tint = new Float32Array(n * 3);
        var mtx = new THREE.Matrix4();
        var q = new THREE.Quaternion();
        var eul = new THREE.Euler();
        var v3 = new THREE.Vector3();
        var sc = new THREE.Vector3();

        var inst = new THREE.InstancedMesh(L.geo, pebMat, n);
        inst.name = L.name;
        for (var k = 0; k < n; k++) {
          var px = pts[k * 2], pz = pts[k * 2 + 1];

          var base = rg(rand, L.scale[0], L.scale[1]);
          var sx = base * rg(rand, 0.82, 1.24);
          var sz = base * rg(rand, 0.82, 1.24);
          var sy = base * P.pebbleFlatten * rg(rand, 0.78, 1.18);

          // 半埋：只露约 65%
          v3.set(px, bedY(px, pz) + sy * 0.35, pz);
          eul.set(rg(rand, -0.25, 0.25), rand() * TAU, rg(rand, -0.25, 0.25));
          q.setFromEuler(eul);
          sc.set(sx, sy, sz);
          mtx.compose(v3, q, sc);
          inst.setMatrixAt(k, mtx);

          rough[k] = rg(rand, P.pebbleRough[0], P.pebbleRough[1]);
          // AM-004 §2.4：调色板抽取多出来的这 1 次 rand() 就写在 aTint 这一行
          var c = pickPalette(rand, pal);
          tint[k * 3] = c.r; tint[k * 3 + 1] = c.g; tint[k * 3 + 2] = c.b;
        }
        inst.instanceMatrix.needsUpdate = true;
        L.geo.setAttribute('aRough', new THREE.InstancedBufferAttribute(rough, 1));
        L.geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
        inst.frustumCulled = false;
        group.add(inst);
        this[L.key] = inst;
      }

      scene.add(group);
      return this;
    },

    // 由 30-scene.js 的 render(dt) 调用
    tick: function (dt) {
      this._causticTime += dt;
      var sh = this.bedMesh && this.bedMesh.material.userData.shader;
      if (sh) {
        sh.uniforms.uCausticTime.value = this._causticTime;
        sh.uniforms.uCausticScale.value = SW.P.causticScale;
        // causticStrength 现在读作**峰值**，实际强度 = 峰值 × 昼夜因子（AM-005）
        sh.uniforms.uCausticStrength.value =
          SW.P.caustics ? SW.P.causticStrength * causticDayFactor() : 0;
      }
    }
  };

  SW.lakebed = lakebed;
})(window.SW = window.SW || {}, window, document);
