// src/65-post.js —— 所有者：UP2（AM-009 · 开工口径 90-WAVE4 §5；复核返工轮见 §6a）
// 后期处理管线：EffectComposer + RenderPass + UnrealBloomPass（阈值抬高，只吃高光/反光柱）
//   + GradePass（轻 vignette / film grain，线性光域）+ OutputPass（收尾：renderer 同款 ACES + sRGB）。
//
// 类供给（window.THREEPOST，两入口同名同形 → 本文件零分叉）：
//   · 免构建入口：vendor/three-post.min.js（主控构建入库，UP2 只消费不构建）；
//   · 构建入口：app/post-global.js 原生 import three/addons 后挂同一全局。
//
// RT 独立（90-WAVE4 §5-①）：折射源 sceneRT 由 30-scene 步骤①独占（水面渲染前）；
//   composer 的 read/write buffer 由 EffectComposer 内部自建（水面渲染后），两套互不触碰。
//
// r160 事实（node_modules/three.module.js:20716 实证）：渲进 RT 时材质不做 tonemap / 输出
//   色彩空间转换 → 中间帧是线性 HDR；OutputPass 作**末位**渲到画布时施加 renderer.toneMapping
//   （ACES）+ outputColorSpace（sRGB）。故 OutputPass 必须是最后一个 pass，否则最终帧变亮/变灰。
//
// 降级：?nopost=1 · THREEPOST 缺失 · 首帧渲染异常 → 整链跳过，30-scene 回落直渲（只 warn，不黑屏）。
(function (SW, window, document) {
  'use strict';

  var T = window.THREEPOST;   // 加载期检测（script 顺序：three-post 在本文件之前）
  var NOP = /[?&]nopost=1(?:&|$)/.test(window.location.search);

  // —— grain 噪点纹理（AM-009 复核返工：替换 sin-hash）——
  // mulberry32 固定种子 → 256×256 单通道 R8 纹理。完全确定性：同种子必同图样 →
  //   帧指纹可复现不依赖运行时状态。NearestFilter（整纹素取值，无插值模糊）+ Repeat
  //  （逐帧整纹素平移回卷）。shader 内零 sin、零大参数哈希。
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildNoiseTexture(THREE) {
    var S = 256, data = new Uint8Array(S * S), rnd = mulberry32(0x57111);
    for (var i = 0; i < data.length; i++) { data[i] = (rnd() * 256) | 0; }
    var tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // Grade pass：vignette + film grain。跑在**线性光域**（OutputPass 的 ACES 之前）——
  //   这正是胶片颗粒的物理形态（线性光噪声）；振幅随亮度缩放（暗部有下限、亮部不过曝）。
  // 时基：uOffPx 由 render(dt) 按 _t（dtFor 钉控累加）导出的**整数帧号**驱动 ——
  //   同相位必同帧号必同偏移 → 像素断言 / 帧指纹逐位可复现。
  var GradeShader = {
    name: 'SWGradeShader',
    uniforms: {
      tDiffuse: { value: null },
      tNoise: { value: null },      // init 时挂 buildNoiseTexture() 产物
      uOffPx: { value: null },      // init 时挂 THREE.Vector2（本帧整纹素偏移，像素单位）
      uVignette: { value: 0.16 },
      uGrain: { value: 0.02 },
      uAspect: { value: 1.7778 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform sampler2D tNoise;',
      'uniform vec2 uOffPx;',
      'uniform float uVignette, uGrain, uAspect;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec4 c = texture2D(tDiffuse, vUv);',
      '  // vignette：距中心的椭圆距离（按宽高比校正），只压角落，中心不动',
      '  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);',
      '  c.rgb *= 1.0 - uVignette * smoothstep(0.45, 0.98, length(d));',
      '  // grain：320x180 基准网格（每颗粒 4x4 px 团簇 —— 35mm 胶片扫描粒径的真实形态，',
      '  //   也让 PNG 压缩可利用块内相关性）+ 256x256 定种噪点纹理 Repeat 回卷。',
      '  //   floor(vUv*grid)+整数偏移后 /256 采样 —— 每帧图样整纹素平移，无亚纹素漂移、无 sin。',
      '  float n = texture2D(tNoise, (floor(vUv * vec2(320.0, 180.0)) + uOffPx) * 0.00390625).r - 0.5;',
      '  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));',
      '  c.rgb += n * 2.0 * uGrain * (0.15 + lum);',
      '  gl_FragColor = c;',
      '}'
    ].join('\n')
  };

  var post = {
    active: false,        // 后期链是否真的在跑（false → 30-scene 直渲）
    composer: null,
    bloomPass: null,
    gradePass: null,
    _t: 0,
    _failed: false,

    probe: function () {
      var P = SW.P;
      return {
        post: this.active,
        bloom: !!(this.active && P.bloom && this.bloomPass && this.bloomPass.enabled),
        strength: P.bloomStrength,
        threshold: P.bloomThreshold,
        radius: P.bloomRadius,
        grain: P.grainAmp,
        vignette: P.vignetteAmp
      };
    },

    init: function () {
      if (NOP) { console.warn('[still_water] post: ?nopost=1 → 后期链关闭（直渲）'); return; }
      if (!T || !T.EffectComposer || !T.RenderPass || !T.UnrealBloomPass || !T.OutputPass || !T.ShaderPass) {
        console.warn('[still_water] post: THREEPOST 不可用 → 后期链跳过（直渲）');
        return;
      }
      var r = SW.scene.renderer, sc = SW.scene.scene, cam = SW.scene.camera;
      if (!r || !sc || !cam) { return; }

      var THREE = window.THREE;
      var w = r.domElement.clientWidth || window.innerWidth;
      var h = r.domElement.clientHeight || window.innerHeight;

      // EffectComposer 默认 HalfFloatType RT（r160）→ 中间帧线性 HDR，bloom 与 grade 都在高动态域做
      var composer = new T.EffectComposer(r);
      composer.addPass(new T.RenderPass(sc, cam));

      var bloom = new T.UnrealBloomPass(
        new THREE.Vector2(w, h),
        SW.P.bloomStrength, SW.P.bloomRadius, SW.P.bloomThreshold
      );
      composer.addPass(bloom);

      var grade = new T.ShaderPass(GradeShader);
      grade.uniforms.uAspect.value = w / h;
      grade.uniforms.tNoise.value = buildNoiseTexture(THREE);   // 定种噪点（确定性）
      grade.uniforms.uOffPx.value = new THREE.Vector2(0, 0);    // 逐帧整纹素偏移（render 里更新）
      composer.addPass(grade);

      // OutputPass 必须最后：r160 对 RT 不做 tonemap/色彩空间 → 只有末位渲到画布时它才施加 ACES+sRGB
      composer.addPass(new T.OutputPass());

      this.composer = composer;
      this.bloomPass = bloom;
      this.gradePass = grade;
      this.active = true;
    },

    // 由 30-scene.render() 步骤②调用（替代直渲）。dt 已经过 SW.debug.dtFor 钉控 → 可复现。
    render: function (dt) {
      if (!this.composer) { return; }
      if (this._failed) { SW.scene.renderer.render(SW.scene.scene, SW.scene.camera); return; }
      this._t += dt;
      var P = SW.P;
      this.bloomPass.enabled = !!P.bloom;
      var u = this.gradePass.uniforms;
      u.uVignette.value = P.vignetteAmp;
      u.uGrain.value = P.grainAmp;
      // 帧号 = _t·60 整量化（_t 由 dtFor 钉控累加 → 同相位必同帧号）；互质步长 17/43
      //   平移整纹素（Repeat 回卷），偏移序列周期 256 帧。uOffPx 为 null 时是 probe 场景，跳过。
      if (u.uOffPx.value) {
        var f = Math.floor(this._t * 60 + 0.5);
        u.uOffPx.value.set((f * 17) % 256, (f * 43) % 256);
      }
      try {
        this.composer.render(dt);
      } catch (e) {
        // 首帧即崩（驱动/扩展缺失等）→ 永久回落直渲，别每帧刷异常
        this._failed = true;
        this.active = false;
        console.warn('[still_water] post: composer 渲染失败 → 回落直渲', e);
        SW.scene.renderer.render(SW.scene.scene, SW.scene.camera);
      }
    },

    setEnabled: function (b) {   // 运行时开关（调试/降级用）；false = 当帧起回落直渲
      this.active = !!b && !!this.composer;
      return this.active;
    }
  };

  SW.post = post;

  // init 挂在 ready：SW.boot 各模块 init 完成后发出（99-main §⑥），renderer/scene/camera 均已就绪
  SW.bus.on('ready', function () {
    try { post.init(); }
    catch (e) { console.warn('[still_water] post init failed（非致命，直渲）', e); }
  });

  // resize：bus 事件来自 30-scene._onResize（CSS 尺寸 + dpr）；composer.setSize 内部乘 pixelRatio
  SW.bus.on('resize', function (ev) {
    if (!post.composer || !ev) { return; }
    post.composer.setSize(ev.w, ev.h);
    if (post.gradePass) { post.gradePass.uniforms.uAspect.value = ev.w / ev.h; }
  });

})(window.SW = window.SW || {}, window, document);
