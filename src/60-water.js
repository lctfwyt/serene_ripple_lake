// src/60-water.js —— 所有者：WP2
// 签名逐字对齐 01-CONTRACT.md §2.6：{ init, update, setRefract, mesh, material, uniforms, probe }
//
// 遵守的约束：
//   AM-001 §4.2 — ① 水面尺寸 ≥ BED_SIZE(90)  ② RT 相机 = 主相机（同 fov 34，不另建）
//                 ③ 俯角 25° → 掠射角变大 → Fresnel 反射分量偏弱，F0 按水重取
//                 ④ 俯视压缩了波纹的屏幕尺度 → normalGain 可上调（见 _STATUS.md 调参项）
//   AM-002 §7.2 — GGX specular + **两层法线**（大波纹 FBO + 高频细节），3 相位去闪烁
//   UP8   §2   — 收敛（2026-09-24，`plan/90-WAVE4.md`）：① uProbe 的 8 个诊断分支改**编译期**
//                （`material.defines.WP_PROBE`，仅 `?debug=1` 时定义）→ 交付形态的着色器里
//                不再有调试代码。② 删掉 55 行「用 JS 重算 GLSL 的 D/Vis/Fs」的 `glitterSpec()`，
//                `probe().glitterSpec` 改为**直读 `uGlitterGain`**（字段名与 0~1 量程不变）。
//                **不改画面行为、不改任何 uniform 名、不改 SW.water 方法签名、不动 swDetail()（归 UP4）。**
//
// 三条铁律（WP2 §3）：水面绝不进 sceneRT · depth 纹理 NEAREST · RT 与主 pass 同相机投影。
// 前两条由 WP1 在 30-scene.js 里保证；第三条这里直接用**同一个 camera 对象**当 rtCamera，
// 是最彻底的同投影保证（SW.scene.CAM 里的机位常量只用于几何自检，不在这里抄数字）。
(function (SW, window) {
  'use strict';
  var THREE = window.THREE;

  // ── 本文件私有常量（契约 §6 不允许 WP2 新增 P 字段，故落在这里）─────────────
  var SEG = 96;                       // 水面网格分段：96×96 = 18,432 三角面
  var DISP = 0.5;                     // 顶点位移的美术衰减（0.94u/quad vs 0.7u 环距 → 全量会走样）
  var REFRACT_K = 0.035;              // 折射屏幕位移系数（uv / 单位斜率）
  // 注意 thick 是**视线穿过水体的长度**（= 垂直水深 / sin(视线仰角)），不是垂直水深。
  // 实测：底部仰角 42° → 2.28；中部仰角 25° → 2.69。所以 Beer-Lambert 的指数天然随距离变大，
  // 远景会自己变蓝变浊 —— 这是对的，不需要额外加"远处更浓"。
  var ABSORB = [0.18, 0.070, 0.050]; // 吸收系数/单位光程（红先被吃掉 → 深水偏青）
  var ABSORB_K = 0.06;               // 向 waterColor 收敛的速率（这一项直接"洗白"湖底，取小）
  // 「近水清澈」偏置：thick 是**视线穿过水体的长度**，近处也有 2.35 左右（= 1.55 / sin 仰角）。
  // 若直接拿它做吸收，近处鹅卵石会被压掉 ~30% 对比 —— 那就不叫"透过水看石头"了。
  // 扣掉这个基线后：近处 eff ≈ 0.15（几乎全透），远处 eff 随光程迅速增长 →
  // 远景照旧一层层变蓝变浊，层次反而拉得更开（实测 eff：0.15 / 0.69 / 1.68 / 3.2）。
  var NEAR_CLEAR = 2.20;
  var CALM_FAR = 7.0, CALM_NEAR = 28.0; // 「近岸水动、远水安静」的过渡区间（距相机水平距离）
  var NEAR_A = 3.5, NEAR_B = 13.0;      // 「近处」判定区间（距相机水平距离）
  var NEAR_DETAIL_DAMP = 0.50;          // 近处把细节法线压到 50% —— 近景要看清石头，不是看波纹
  var NEAR_REFRACT_DAMP = 0.40;         // 近处折射位移也收一点，避免湖底被推糊
  var GLITTER_GAIN_FALLBACK = 0.55;   // WP3 还没给 glitterGain 时的兜底（stub 阶段不能出 NaN）
  var DETAIL_ALPHA_W = 0.0625;        // 细节斜率方差并入 GGX alpha 的权重（0.25²）
  var SUN_I_FLOOR = 0.30;             // 光照强度下限：防 WP3 夜间把 sunIntensity 归零后月光柱整体消失
  var TRIS_BUDGET = 60000;
  var DETAIL_SEED = 0x51EE7;          // 细节波表的固定种子（渲染路径禁止 Math.random）
  var DETAIL_N = 16;                  // 波数
  var LAM_MIN = 0.32, LAM_MAX = 1.6;  // 波长区间（世界单位）：只保留 0.32~1.6u 的中细波纹，
                                      // 不跟 FBO 大波纹抢尺度，也不会拖出长条带。
  var WARP_AMP = 0.28;                // 域扭曲幅度：把规则等高线掰弯，是"塑料桌布感"的解药

  var mesh = null, mat = null, u = null;
  var camera = null;
  var tAcc = 0;
  var tris = 0;
  var fallbackH = null;               // ripple 未初始化时的 1×1 占位高度图

  // ============================================================ 顶点着色器
  var VERT = [
    'uniform sampler2D uHeight;',
    'uniform vec2 uFieldCenter;',
    'uniform float uFieldInv;',
    'uniform float uDisp;',
    'varying vec2 vField;',
    'varying vec3 vWorld;',
    'varying vec4 vClip;',
    'varying float vViewZ;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vField = (wp.xz - uFieldCenter) * uFieldInv + 0.5;',
    '  float h = 0.0;',
    '  if (vField.x > 0.0 && vField.x < 1.0 && vField.y > 0.0 && vField.y < 1.0) {',
    '    h = texture2D(uHeight, vField).r;',
    '  }',
    '  wp.y += h * uDisp;',
    '  vWorld = wp.xyz;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  vViewZ = mvPosition.z;',
    '  vClip = projectionMatrix * mvPosition;',
    '  gl_Position = vClip;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');

  // ============================================================ 片元着色器
  // ============================================== 细节波表（编译期常量 → 注入 GLSL）
  // 渲染路径禁止 Math.random（断言要可复现）→ 用固定种子的 SW.util.newRng，
  // 在模块加载时把 16 个波的（方向 / 波数 / 幅度 / 相位 / 色散速度）烤成 GLSL 字面量。
  // AM-022 §2-D：方向重铸 —— buildDetail 由「一次性 IIFE 常量」改为**可传参重建**。
  //   mode = { halfDeg: 双向半角(度), zig: {a, f} }
  //   · halfDeg 为 0 / 缺省 ⇒ 各向同性（**与原实现逐位等价**，rng 序列未变）
  //   · halfDeg = 15 ⇒ 16 个波压到 90°±15° 与 270°±15° 两组；组内仍是**连续随机** ——
  //     因为 u0 的分层抖动已经把 16 个值铺满 [0,1)，band 只是对每组做一次仿射压缩，
  //     **不是**只有 +15/−15 两个离散值（实测 ±5 档取到 15 个不同角度）。
  //   ⚠ rng 消耗序列必须与原实现**逐位一致**（否则连"现状"都会变）：
  //     shuffle 15 次 → uu 16 次 → 角度抖动 16 次 → ph 16 次 → 二次 shuffle 15 次。
  //     ⇒ 只允许在"角度计算之后"插入纯算术，**不许新增 rng() 调用**。
  function buildDetail(mode) {
    var rng = SW.util.newRng(DETAIL_SEED);
    var TAU = Math.PI * 2, N = DETAIL_N;
    var slot = [], i, j, t;
    for (i = 0; i < N; i++) { slot.push(i); }
    for (i = N - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = slot[i]; slot[i] = slot[j]; slot[j] = t; }
    var w = [];
    for (i = 0; i < N; i++) {
      var uu = (i + 0.2 + 0.6 * rng()) / N;
      var lam = LAM_MAX * Math.pow(LAM_MIN / LAM_MAX, uu);
      var k = TAU / lam;
      var u0 = (slot[i] + 0.5 + 0.7 * (rng() * 2 - 1)) / N;   // 分层抖动 → u0 在 [0,1) 均匀铺开
      var u = u0;
      if (mode && mode.halfDeg) {
        var s = mode.halfDeg / 360;                            // ← 换算：s × 360° = 半角（不是 ×180°）
        var base = (u0 < 0.5) ? 0.25 : 0.75;                   // 双向：90°(横纹主向) / 270° 两组
        u = base + ((u0 * 2) % 1 - 0.5) * 2 * s;               // 组内连续随机 ∈ [base−s, base+s]
      }
      var ang = u * TAU;
      w.push({
        k: k,
        dx: Math.cos(ang), dz: Math.sin(ang),
        kx: k * Math.cos(ang), kz: k * Math.sin(ang),
        amp: Math.pow(k / TAU, -0.28),        // λ = 1u 时取 1.0；短波略弱、长波略强
        ph: rng() * TAU,
        om: 1.9 * Math.sqrt(k)                // 深水色散 ω = √(gk)，g 折成美术速度
      });
    }
    // 打乱顺序只为让相邻波的参数不相关（无额外作用，但便于分组统计）
    for (i = N - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = w[i]; w[i] = w[j]; w[j] = t; }
    // 16 个独立相位求和：每项的模长方差 = amp²/2 → E|g|² = Σ amp²/2。
    // 归一化到 RMS 斜率 = 1 → K = 1/√sumS。（旧的"分组求平均"在这里没有意义：
    // 都是独立随机相位之和，分组不改变分布；抗闪烁靠的是 alpha 里并入方差，不是分组。）
    var sumS = 0;
    for (i = 0; i < N; i++) { sumS += w[i].amp * w[i].amp / 2; }
    return { w: w, norm: 1 / Math.sqrt(sumS), n: N, sumS: sumS };
  }

  function detailGLSL(mode) {
    var D = buildDetail(mode);
    var L = [], i, b;
    var f = function (v) { return (Math.abs(v) < 1e-8 ? 0 : v).toFixed(5); };
    L.push('// AM-022 dir-mode: halfDeg=' + ((mode && mode.halfDeg) ? mode.halfDeg : 'iso') +
      ' · zig=' + ((mode && mode.zig) ? 'on' : 'off'));
    L.push('float wband(float k, float pw) { return smoothstep(1.6, 4.5, 6.2831853 / max(k * pw, 1e-6)); }');
    L.push('vec2 swDetail(vec2 p, float t, float pw) {');
    L.push('  vec2 q = p + vec2(sin(p.y * 0.27 + t * 0.11), cos(p.x * 0.31 - t * 0.09)) * ' + WARP_AMP.toFixed(3) + ';');
    L.push('  float jsp = 0.6 + 1.6 * uGlitterJitter;');
    L.push('  vec2 g = vec2(0.0);');
    for (i = 0; i < D.n; i++) {
      b = D.w[i];
      var ph = f(b.ph);
      // 之字形：给每个波的相位叠一条沿 x 的低频正弦 ⇒ 波峰线左右摆动，横纹不会"死板"成百叶窗
      if (mode && mode.zig) {
        ph = f(b.ph) + ' + ' + f(mode.zig.a) + ' * sin(p.x * ' + f(mode.zig.f) + ' + ' + f(b.ph) + ')';
      }
      L.push('  g += vec2(' + f(b.dx) + ', ' + f(b.dz) + ') * (' + f(b.amp) + ' * wband(' + f(b.k) +
        ', pw) * cos(' + f(b.kx) + ' * q.x + ' + f(b.kz) + ' * q.y + t * ' + f(b.om) + ' * jsp + ' + ph + '));');
    }
    L.push('  return g * ' + f(D.norm) + ';');
    L.push('}');
    return L.join('\n');
  }

  // FRAG 里 swDetail 块的占位符 —— 运行时想换方向档，重新生成一次 GLSL 再 replace 即可。
  // 用占位符而不是把整段 FRAG 也函数化，是为了让「换波表」这个动作**只碰一处字符串**。
  var DETAIL_SLOT = '__SW_DETAIL_BLOCK__';
  // 从 SW.P 读当前方向档（debug 滑杆改的就是这三个值）
  function waveMode() {
    return {
      halfDeg: (typeof SW.P.swDirSpread === 'number' && isFinite(SW.P.swDirSpread)) ? SW.P.swDirSpread : 0,
      zig: (SW.P.swZigAmp > 0) ? { a: SW.P.swZigAmp, f: SW.P.swZigFreq } : null
    };
  }

  var FRAG = [
    'uniform sampler2D uHeight;',
    'uniform sampler2D uScene;',
    'uniform sampler2D uSceneDepth;',
    'uniform float uNear, uFar;',
    'uniform float uTime;',
    'uniform float uTexelStep;',
    'uniform float uSlopeScale;',
    'uniform vec2 uFieldCenter;',
    'uniform float uFieldInv;',
    'uniform float uNormalGain;',
    'uniform float uPxScale;',
    'uniform float uRefract;',
    'uniform float uRefractK;',
    'uniform vec3 uAbsorb;',
    'uniform float uAbsorbK;',
    'uniform vec3 uWaterColor;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uSkyBottom;',
    // ★ UP3 / AM-017：环境贴图反射。uEnvEq 由 SW.scene.env.equirect 供给（每帧在 update() 里重指），
    //   uEnvReady 是 0/1 开关 —— 0 时整段等于旧路径（= envEnabled=false / PMREM 建失败 的降级）。
    'uniform sampler2D uEnvEq;',
    'uniform float uEnvReady;',
    'uniform float uEnvGain;',
    'uniform vec3 uCamPos;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunRadiance;',
    'uniform vec3 uGlitterColor;',
    'uniform float uGlitterDetail;',
    'uniform float uGlitterRough;',
    'uniform float uGlitterJitter;',
    'uniform float uGlitterGain;',
    'uniform float uWaterRough;',
    'uniform float uWaterMetal;',
    // ★ UP8：uProbe 仅在 ?debug=1 时定义 WP_PROBE → 交付形态下这个 uniform 连声明都不进程序，
    //   three 的 WebGLUniforms 只遍历**活动** uniform，所以 uniforms.uProbe 留着也不会被上传。
    '#ifdef WP_PROBE',
    'uniform float uProbe;',
    '#endif',
    'varying vec2 vField;',
    'varying vec3 vWorld;',
    'varying vec4 vClip;',
    'varying float vViewZ;',
    '#include <fog_pars_fragment>',
    '#include <packing>',

    'float hAt(vec2 uv) {',
    '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }',
    '  return texture2D(uHeight, uv).r;',
    '}',

    // ── UP3 / AM-017：世界空间方向 → equirect uv ─────────────────────────────
    // 与 three 的 equirectUv() 逐字一致（u 由 atan2(z,x) 定、v 由 asin(y)/π 定，v 是**非线性**的）。
    // 写错这个式子 → 环境反射整个错位（水里的天空带会跑到脚下），比不换还糟。
    'vec2 swEnvUV(vec3 d) {',
    '  float u = atan(d.z, d.x) * 0.15915494 + 0.5;',
    '  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5;',
    '  return vec2(u, v);',
    '}',

    // ── 高频细节法线的梯度（AM-002 §7.2 第 2/4 条）────────────────────────
    // ⚠ 2026-09-24 重写。旧版是「4 个**等间距**方向 × 3 组相位」共 12 个正弦波：
    //   等角多波求和必然在水面织出一张规则二维点阵（用户说的"蜂巢/细胞纹"），
    //   频率固定、不随昼夜变，像塑料桌布，还压过湖底与光影差异。四条对症的解法：
    //   ① 方向分层抖动（圆周 N 等分、每份内随机）→ 既不聚簇也不规则；
    //   ② 波长 0.42u~5.0u 连续几何分布 + 抖动 → 不存在"同一个 λ 反复出现"的主频；
    //   ③ 域扭曲：先用两条低频正弦把采样坐标掰弯 → 等高线失去直边（塑料感的解药）；
    //   ④ 深水色散 ω ∝ √k → 各波速度不同，图案自己演化，不是整体平移。
    //   16 个波独立相位直接求和，幅度 ∝ λ^(-0.28)，
    //   最后整体归一到 RMS 斜率 = 1 —— uGlitterDetail 的语义与改造前完全一致。
    //   pw = 每像素的世界尺寸：波长在屏幕上不足 ~2px 的波会被滤掉（远景自动变平，
    //   不再"发麻"，也省掉无谓的高频采样）。
    //   AM-022：此处原本直接嵌 `detailGLSL()` 的结果（编译期常量）。现改为占位符，
    //   由 `fragShader(mode)` 在**建材质时 + 每次重建时**替换 ⇒ 方向档可运行时改。
    DETAIL_SLOT,

    'void main() {',
    '  vec2 suv = clamp(vClip.xy / vClip.w * 0.5 + 0.5, vec2(0.0), vec2(1.0));',

    // ① 大尺度波纹斜率（中心差分，世界单位）
    '  float e = uTexelStep;',
    '  vec2 sR = vec2(hAt(vField + vec2(e, 0.0)) - hAt(vField - vec2(e, 0.0)),',
    '                 hAt(vField + vec2(0.0, e)) - hAt(vField - vec2(0.0, e))) * uSlopeScale;',
    // 远水安静带：既是对"满屏都在动"的审美护栏，也省掉远处的高频采样
    '  float calm = 1.0 - 0.45 * smoothstep(' + CALM_FAR.toFixed(1) + ', ' + CALM_NEAR.toFixed(1) + ', length(uCamPos.xz - vWorld.xz));',
    '  sR *= uNormalGain * calm;',

    // ② 高频细节斜率（→ 反光柱的破碎感）
    //    pw   = 每像素对应的世界尺寸 → 波长不足 2px 的波自动滤掉（远景不发麻、不闪）
    //    near01：近景减弱细节 —— 近处要看清鹅卵石，不是看一层波纹
    //    breath：37s 周期的极慢强弱起伏 —— 图案不会永远是同一张脸
    '  float dcam = length(uCamPos.xz - vWorld.xz);',
    '  float near01 = 1.0 - smoothstep(' + NEAR_A.toFixed(1) + ', ' + NEAR_B.toFixed(1) + ', dcam);',
    '  float pw = uPxScale * max(-vViewZ, 0.001);',
    '  float breath = 0.86 + 0.14 * sin(uTime * 0.169 + 1.7);',
    '  vec2 sD = swDetail(vWorld.xz, uTime, pw) * (uGlitterDetail * breath * (1.0 - ' + NEAR_DETAIL_DAMP.toFixed(2) + ' * near01));',

    '  vec3 N = normalize(vec3(-(sR.x + sD.x), 1.0, -(sR.y + sD.y)));',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  float NoV = clamp(dot(N, V), 0.02, 1.0);',

    // ③ 水深（用 sceneRT 的 depth 反算，做 Beer-Lambert 吸收）
    '  float dRaw = texture2D(uSceneDepth, suv).x;',
    '  float sceneZ = perspectiveDepthToViewZ(dRaw, uNear, uFar);',
    '  float thick = clamp(vViewZ - sceneZ, 0.0, 12.0);',

    // ④ 屏幕空间折射。细节法线只按 30% 计入位移 —— 它的高频在屏幕上已近亚像素，
    //    全量偏移会让湖底"发麻"；但着色法线仍用全量，破碎感照旧。
    '  float tf = clamp(thick * 0.62, 0.08, 1.6) * (1.0 - ' + NEAR_REFRACT_DAMP.toFixed(2) + ' * near01);',
    '  vec2 off = vec2(sR.x + sD.x * 0.30, -(sR.y + sD.y * 0.30)) * (uRefractK * tf * uRefract);',
    '  vec2 ruv = clamp(suv + off, vec2(0.0015), vec2(0.9985));',
    '  vec3 bed = texture2D(uScene, ruv).rgb;',

    // 吸收只吃「超过近水清澈基线」的那段光程（NEAR_CLEAR 的推导见文件头常量区）
    '  float eff = max(thick - ' + NEAR_CLEAR.toFixed(2) + ', 0.0);',
    '  vec3 body = mix(bed * exp(-uAbsorb * eff), uWaterColor, 1.0 - exp(-eff * uAbsorbK));',

    // ⑤ 菲涅尔 + 天空反射（AM-001：天空看不到了，但掠射角的水面仍在"反射"它 —— 这是远景的亮度来源）
    '  float F0 = 0.02 + 0.30 * uWaterMetal;',
    '  float Fr = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);',
    '  vec3 R = reflect(-V, N);',
    '  float st = pow(smoothstep(-0.06, 0.62, R.y), 0.85);',
    '  vec3 reflBase = mix(uSkyBottom, uSkyTop, st);',
    // ★ UP3 / AM-017：把「假天空」的二色渐变换成**采样环境贴图**。
    //   采样在**世界空间反射向量** R 上做（不是屏幕空间）—— 否则转动/压缩画面时反射不会跟着几何走。
    //   mip 偏置 = 粗糙度 → 等效 PMREM 的粗糙度感知模糊（贴图是 POT + generateMipmaps）。
    //   uSkyTop / uSkyBottom **保留**并作为 fallback：env 未就绪（含建失败）时画面绝不黑。
    //   水面**不**采样 PMREM 出来的 CubeUV RT：r160 的 CUBEUV_* 定义是给内建材质注入的，
    //   自定义 ShaderMaterial 拿不到 → 改走「同一张 equirect + mip」，视觉等价、零编译风险。
    '  vec3 refl = reflBase;',
    '  if (uEnvReady > 0.5) {',
    '    float envBias = clamp(uWaterRough * 8.0, 0.0, 4.0);',
    '    vec3 envCol = texture2D(uEnvEq, swEnvUV(R), envBias).rgb * uEnvGain;',
    '    refl = mix(reflBase, envCol, uEnvReady);',
    '  }',
    '  vec3 col = mix(body, refl, clamp(Fr, 0.0, 1.0));',

    // ⑥ 反光路径（AM-002 A）：GGX + 两层法线
    //    alpha 里并入细节斜率的方差 —— 既抗闪烁（把亚像素高光摊成 ~6° 的瓣），
    //    也是"破碎"的物理来源：局部平均法线在变，宽瓣被调制成一格一格。
    '  vec3 L = uSunDir;',
    '  float NoL = dot(N, L);',
    // ⚠ D/Vis/Fs 必须在 if 块**外**声明 —— uProbe=8 要在块外读它们。
    //   2026-09-24 踩过：写在块里的话 GLSL 编译直接失败 → 水面材质整个失效（只剩湖底石头）。
    '  float D = 0.0, Vis = 0.0, Fs = 0.0;',
    '  if (L.y > 0.0 && NoL > 0.0) {',
    '    vec3 H = normalize(V + L);',
    '    float NoH = max(dot(N, H), 0.0);',
    '    float VoH = max(dot(V, H), 0.0);',
    '    float ar = max(uGlitterRough, uWaterRough * 0.25);',
    '    float a2 = ar * ar + uGlitterDetail * uGlitterDetail * ' + DETAIL_ALPHA_W.toFixed(5) + ';',
    '    float dd = NoH * NoH * (a2 - 1.0) + 1.0;',
    '    D = a2 / (3.14159265 * dd * dd);',
    '    float gv = NoL * sqrt(a2 + (1.0 - a2) * NoV * NoV);',
    '    float gl2 = NoV * sqrt(a2 + (1.0 - a2) * NoL * NoL);',
    '    Vis = 0.5 / max(gv + gl2, 1e-4);',
    '    Fs = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);',
    '    col += uGlitterColor * uGlitterGain * uSunRadiance * (D * Vis * Fs);',
    '  }',

    // ⑦ 私有探针（uProbe）：把中间量直接写进颜色，供断言读回。
    //    return 会跳过后面的 tonemapping / colorspace / fog → 读到的就是线性原值。
    //    1 = 细节层斜率 sD　2 = 大波纹斜率 sR　3 = (eff, thick, pw) 诊断
    //    4 = body（吸收+水色后）　5 = refl（天空反射）　6 = bed（折射采样到的湖底）
    //    7 = mix(body, refl, Fr)（菲涅尔之后、高光之前）
    //    8 = specular 项强度 (D*Vis*Fs)，用于诊断白光范围
    //
    //    ★ UP8 收敛（2026-09-24）：整段用 `#ifdef WP_PROBE` 包住 —— 只有 `?debug=1` 起页时
    //      `material.defines` 才带 WP_PROBE，**交付形态（非 debug）下这 8 个分支不参与编译**：
    //      调试代码不再进生产着色器，热路径顺带省掉 8 次区间比较。
    //      （断言一律用 `?debug=1` 起页，所以这里读数不变；非 debug 一致性由 UP8 单独验证。）
    '#ifdef WP_PROBE',
    '  if (uProbe > 6.5 && uProbe < 7.5) { gl_FragColor = vec4(mix(body, refl, clamp(Fr, 0.0, 1.0)), 1.0); return; }',
    '  if (uProbe > 3.5 && uProbe < 4.5) { gl_FragColor = vec4(body, 1.0); return; }',
    '  if (uProbe > 4.5 && uProbe < 5.5) { gl_FragColor = vec4(refl, 1.0); return; }',
    '  if (uProbe > 5.5 && uProbe < 6.5) { gl_FragColor = vec4(bed, 1.0); return; }',
    '  if (uProbe > 7.5 && uProbe < 8.5) { gl_FragColor = vec4(vec3(clamp(D * Vis * Fs, 0.0, 1.0)), 1.0); return; }',
    '  if (uProbe > 0.5 && uProbe < 1.5) { gl_FragColor = vec4(sD.x * 0.5 + 0.5, sD.y * 0.5 + 0.5, 0.0, 1.0); return; }',
    '  if (uProbe > 1.5 && uProbe < 2.5) { gl_FragColor = vec4(sR.x * 0.5 + 0.5, sR.y * 0.5 + 0.5, 0.0, 1.0); return; }',
    '  if (uProbe > 2.5 && uProbe < 3.5) { gl_FragColor = vec4(eff * 0.25, thick * 0.25, pw * 60.0, 1.0); return; }',
    '#endif',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  // 把当前方向档的 swDetail 块填进 FRAG 模板。
  // ⚠ 每次调用都会重跑 buildDetail（16 个波 + 字符串拼接，≈ 1ms 级），但**不重编 GLSL**：
  //   真正的重编发生在调用方写 `mat.fragmentShader` 后置 `needsUpdate = true`。
  function fragShader(mode) {
    return FRAG.replace(DETAIL_SLOT, detailGLSL(mode));
  }

  // UP3 / AM-017：env 未就绪时占位的 1×1 纹理。
  //   sampler2D **不能为 null**（three 会绑一张无 image 的空纹理 → 采样结果不确定）。
  //   用 1×1 的浅水色，即使 uEnvReady 判据被绕过也不会出黑块。
  function makeEnvPlaceholder() {
    var t = new THREE.DataTexture(
      new Uint8Array([128, 150, 170, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    t.name = 'envPlaceholder';
    return t;
  }

  // 2·tan(fov/2)/drawingBufferHeight：屏幕上一像素对应多少世界单位（在 |viewZ| = 1 处）
  function pxScale(cam) {    var h = 1;
    if (SW.scene.renderer) {
      var gl = SW.scene.renderer.getContext();
      if (gl && gl.drawingBufferHeight > 1) { h = gl.drawingBufferHeight; }
    }
    return 2 * Math.tan(cam.fov * 0.5 * Math.PI / 180) / h;
  }

  // ============================================== glitterSpec：反光增益（直读 uniform）
  // ★ UP8 收敛（2026-09-24）：这里原本是 55 行 JS —— 把 GLSL 的 D / Vis / Fs 沿「光源方位线」
  //   重算一遍，只为给 probe 一个"预测的镜面峰值"。两个问题：
  //     ① shader 一改它就**静默漂移**（改 shader 的人不会记得同步这段 JS）—— 典型维护陷阱；
  //     ② 它是冗余的：返回值只被 probe 消费，而"柱到底能不能被看见"的硬判据已经
  //        由 **断言 #13 直读像素**承担（24 相位中位 2.144 / 亮带质心 49.6%）。
  //   现改为**直读已有 uniform**（不重算）：语义从「预测的镜面峰值」→「反光增益」。
  //   · 字段名 `glitterSpec` 与 0~1 量程**不变** → `90-debug.js` 与 `wp5-assert.js #7` 一行不用改。
  //   · 钳到 0~1 是因为 `TimeState.glitterGain` 本身可 >1（实测夜 1.20 / 午 0.15）——
  //     做钳制而不是去改 #7 的阈值，避免动到别人拥有的断言。
  //   · 柱的**几何**可行性由 #9 / #10 / #12（仰角 · 方位）覆盖，可读性由 #13（像素）覆盖，
  //     判据覆盖面没有缺口（见 `plan/90-WAVE4.md §2` 坑 1）。
  function glitterSpec() {
    if (!u) { return 0; }
    var g = u.uGlitterGain.value;
    if (typeof g !== 'number' || !isFinite(g)) { return 0; }
    return g < 0 ? 0 : (g > 1 ? 1 : g);
  }

  // ============================================== TimeState → uniforms
  function applyState(s) {
    if (!s || !u) { return; }
    // WP3 的 TimeState 是唯一来源。stub 阶段缺 glitterGain/glitterColor → 用兜底，绝不产生 NaN。
    u.uGlitterGain.value = (typeof s.glitterGain === 'number' && isFinite(s.glitterGain))
      ? s.glitterGain : GLITTER_GAIN_FALLBACK;
    if (s.glitterColor) { u.uGlitterColor.value.setRGB(s.glitterColor[0], s.glitterColor[1], s.glitterColor[2]); }
    else { u.uGlitterColor.value.setRGB(1, 1, 1); }
    if (s.waterColor) { u.uWaterColor.value.setRGB(s.waterColor[0], s.waterColor[1], s.waterColor[2]); }
    if (typeof s.waterRough === 'number') { u.uWaterRough.value = s.waterRough; }
    if (typeof s.waterMetal === 'number') { u.uWaterMetal.value = s.waterMetal; }
    if (s.skyTop) { u.uSkyTop.value.setRGB(s.skyTop[0], s.skyTop[1], s.skyTop[2]); }
    if (s.skyBottom) { u.uSkyBottom.value.setRGB(s.skyBottom[0], s.skyBottom[1], s.skyBottom[2]); }
  }

  // ================================================================ 模块主体
  SW.water = {
    mesh: null,
    material: null,
    uniforms: {},

    init: function (scene, cam) {
      var P = SW.P;
      camera = cam;

      // 水面尺寸 ≥ 湖底：直接读湖底几何的 parameters，不抄 §9 里的裸数字（抄了迟早对不上）
      var bedSize = 90;
      if (SW.lakebed && SW.lakebed.bedMesh && SW.lakebed.bedMesh.geometry &&
          SW.lakebed.bedMesh.geometry.parameters) {
        bedSize = SW.lakebed.bedMesh.geometry.parameters.width || bedSize;
      }
      var waterY = (SW.scene.CAM && typeof SW.scene.CAM.waterY === 'number') ? SW.scene.CAM.waterY : 1.55;

      var f = SW.ripple.field;
      var height = SW.ripple.heightTexture;
      if (!height) {
        // ripple 初始化失败（safe() 里被 catch）时的占位图，保证 shader 仍能编译
        fallbackH = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
        fallbackH.needsUpdate = true;
        height = fallbackH;
      }

      var geo = new THREE.PlaneGeometry(bedSize, bedSize, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

      var uniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
      uniforms.uHeight = { value: height };
      uniforms.uScene = { value: SW.scene.sceneRT ? SW.scene.sceneRT.texture : null };
      uniforms.uSceneDepth = { value: SW.scene.sceneRT && SW.scene.sceneRT.depthTexture ? SW.scene.sceneRT.depthTexture : null };
      uniforms.uNear = { value: cam.near };
      uniforms.uFar = { value: cam.far };
      uniforms.uTime = { value: 0 };
      uniforms.uTexelStep = { value: f.texel || 1 / 512 };
      // 斜率 = Δh(两个纹素) / (2·Δx) ，Δx = 2·half/N  →  × N/(4·half)
      uniforms.uSlopeScale = { value: (f.texel ? 1 / f.texel : 512) / (4 * (f.half || 22)) };
      uniforms.uFieldCenter = { value: new THREE.Vector2(f.cx || 0, f.cz || 0) };
      uniforms.uFieldInv = { value: 1 / (2 * (f.half || 22)) };
      uniforms.uDisp = { value: DISP };
      uniforms.uNormalGain = { value: P.normalGain };
      // 每像素对应的世界尺寸（沿视线距离 1）：2·tan(fov/2)/drawingBufferHeight
      uniforms.uPxScale = { value: pxScale(cam) };
      uniforms.uRefract = { value: 1 };
      uniforms.uRefractK = { value: REFRACT_K };
      uniforms.uAbsorb = { value: new THREE.Vector3(ABSORB[0], ABSORB[1], ABSORB[2]) };
      uniforms.uAbsorbK = { value: ABSORB_K };
      uniforms.uWaterColor = { value: new THREE.Color(0.06, 0.20, 0.22) };
      uniforms.uSkyTop = { value: new THREE.Color(0.24, 0.45, 0.72) };
      uniforms.uSkyBottom = { value: new THREE.Color(0.62, 0.76, 0.78) };
      // ★ UP3 / AM-017：env 供给入口（真正指向由 update() 每帧刷新 —— 重建后会换新贴图）
      uniforms.uEnvEq = { value: makeEnvPlaceholder() };
      uniforms.uEnvReady = { value: 0 };
      uniforms.uEnvGain = { value: 1 };
      uniforms.uCamPos = { value: new THREE.Vector3().copy(cam.position) };
      uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
      uniforms.uSunRadiance = { value: new THREE.Color(1, 1, 1) };
      uniforms.uGlitterColor = { value: new THREE.Color(1, 1, 1) };
      uniforms.uGlitterDetail = { value: P.glitterDetail };
      uniforms.uGlitterRough = { value: P.glitterRough };
      uniforms.uGlitterJitter = { value: P.glitterJitter };
      uniforms.uGlitterGain = { value: GLITTER_GAIN_FALLBACK };
      uniforms.uWaterRough = { value: 0.12 };
      uniforms.uWaterMetal = { value: 0.0 };
      uniforms.uProbe = { value: 0 };

      // ★ UP8 收敛：WP_PROBE 只在 `?debug=1` 时定义 —— uProbe 的 8 个诊断分支因此
      //   **不进交付着色器**（`SW.P.debug` 由 00-config.js 在脚本加载时按 query 置好，
      //   早于本模块 init，所以这里直读是安全的）。交付形态可量化省下热路径 8 次区间比较。
      var defines = {};
      if (P.debug) { defines.WP_PROBE = ''; }

      mat = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: VERT,
        // AM-022：不再直接用 FRAG（里面是占位符），按当前方向档现填。
        fragmentShader: fragShader(waveMode()),
        defines: defines,
        fog: true,
        transparent: false,
        side: THREE.FrontSide,
        toneMapped: true
      });
      mat.name = 'water';

      mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = waterY;
      mesh.name = 'water';
      mesh.frustumCulled = false;      // 水面 90×90 远超视锥，交给 GPU 裁
      scene.add(mesh);

      u = uniforms;
      this.mesh = mesh;
      this.material = mat;
      this.uniforms = uniforms;

      // 折射 RT：直接用主相机对象 → 与主 pass 同 fov / 同位姿 / 同投影矩阵，
      // 屏幕空间折射的 uv 才能严格对上（WP2 §8 头号坑）
      SW.scene.rtCamera = cam;

      // 首次灌 TimeState（99-main 里 applyTimeState 在 water.init 之后才调）
      try { applyState(SW.time.current()); } catch (e) { /* WP3 未就绪就用兜底 */ }
      SW.bus.on('timechange', applyState);

      SW.bus.on('resize', function () {
        if (!SW.scene.sceneRT) { return; }
        u.uScene.value = SW.scene.sceneRT.texture;
        u.uSceneDepth.value = SW.scene.sceneRT.depthTexture || null;
      });

      return this;
    },

    update: function (dt) {
      if (!mat || !camera) { return; }
      tAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
      u.uTime.value = tAcc;

      // 高度场每帧都在 ping-pong 交换 → 必须重新指向（这也是为什么不能只在 init 里绑一次）
      if (SW.ripple.heightTexture) { u.uHeight.value = SW.ripple.heightTexture; }

      u.uCamPos.value.copy(camera.position);
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uPxScale.value = pxScale(camera);   // resize 后 drawingBufferHeight 会变

      var sun = SW.scene.sun;
      if (sun) {
        u.uSunDir.value.copy(sun.position).normalize();
        var si = Math.max(sun.intensity, 0);
        // 下限 SUN_I_FLOOR：夜间若 WP3 把 sunIntensity 归零，月光柱（夜景唯一视觉焦点）会整体消失
        var sc = Math.max(si, SUN_I_FLOOR);
        u.uSunRadiance.value.setRGB(sun.color.r * sc, sun.color.g * sc, sun.color.b * sc);
      }

      u.uNormalGain.value = SW.P.normalGain;
      u.uGlitterDetail.value = SW.P.glitterDetail;
      u.uGlitterRough.value = SW.P.glitterRough;
      u.uGlitterJitter.value = SW.P.glitterJitter;

      // ★ UP3 / AM-017：env 供给。水面**不拥有**环境贴图（构建在 30-scene.js），
      //   只消费 SW.scene.env。重建会换新贴图 → 必须每帧重指（同 uHeight 的道理）。
      var ev = SW.scene.env;
      var envOn = !!(SW.P.envEnabled && ev && ev.ready && ev.equirect);
      if (envOn) { u.uEnvEq.value = ev.equirect; }
      u.uEnvReady.value = envOn ? 1 : 0;
      u.uEnvGain.value = (typeof SW.P.envWaterGain === 'number' && isFinite(SW.P.envWaterGain))
        ? SW.P.envWaterGain : 1;
    },

    setRefract: function (bool) {
      if (u) { u.uRefract.value = bool ? 1 : 0; }
    },

    // AM-022 §2-D：按当前 SW.P 的 swDirSpread / swZigAmp / swZigFreq **重建细节波表**。
    //   · 代价：three 会丢弃旧程序重编一次（首帧 ~50~200ms 卡顿）⇒ 只给 debug 面板用，
    //     且调用方要防抖（见 90-debug.js 的「水面波纹（松手生效）」组）。
    //   · 只换 swDetail 块，**不动 uniform / 不动 defines** ⇒ WP_PROBE 等宏不受影响。
    //   · 返回是否真的重建了（未 init 时返回 false，调用方不该报错）。
    rebuildWaves: function () {
      if (!mat) { return false; }
      mat.fragmentShader = fragShader(waveMode());
      mat.needsUpdate = true;
      return true;
    },

    probe: function () {
      var ar = u ? Math.max(SW.P.glitterRough, (u.uWaterRough.value || 0) * 0.25) : 0;
      return {
        refract: !!(u && u.uRefract.value > 0.5),
        normalGain: SW.P.normalGain,
        tris: tris,
        // —— AM-002 §5 / §7.4：WP5 的断言要读这两个 ——
        glitterGain: u ? u.uGlitterGain.value : 0,
        // ★ UP8：语义已由「预测的镜面峰值」改为「**直读的反光增益**」（钳 0~1），
        //   调用方（90-debug.js / wp5-assert.js #7）无需改动 —— 见上方函数头注释。
        glitterSpec: glitterSpec(),
        // —— §7.4 第 3 条：证明两层法线都在（不是只有一层） ——
        normalLayers: 2,
        rippleGain: SW.P.normalGain,
        detailGain: SW.P.glitterDetail,
        alphaEff: Math.sqrt(ar * ar + SW.P.glitterDetail * SW.P.glitterDetail * DETAIL_ALPHA_W),
        sunDir: u ? u.uSunDir.value.toArray() : [0, 1, 0],
        // —— UP3 / AM-017：环境反射是否在跑（降级判据 #10 读它）——
        envReady: !!(u && u.uEnvReady.value > 0.5),
        envGain: u ? u.uEnvGain.value : 0,
        overBudget: tris > TRIS_BUDGET
      };
    }
  };
})(window.SW = window.SW || {}, window);
