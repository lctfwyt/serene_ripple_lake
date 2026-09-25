// src/00-config.js —— 所有者：WP1
// 内容：全局参数表 SW.P（契约 §6，字段冻结，其它 WP 只读）/ 事件总线 SW.bus（§3）/ 工具函数
// 其它 WP：只读。不要在此新增字段，需要新字段走 01-CONTRACT.md 「变更记录」。
(function (SW, window) {
  'use strict';

  // ---------------------------------------------------------------- §6 参数表
  // ⚠ 字段名与顺序与 01-CONTRACT.md §6 完全一致，不得增删。
  var P = {
    // 时间
    timeMode: 'auto', hoursOffset: 0, fixedHour: 12.5,

    // 波纹
    fieldSize: 512, rippleSpeed: 3.2, rippleLifetime: 4.5,
    rippleWaveK: 9.0, rippleAmp: 0.09, rippleDecay: 0.996,
    normalGain: 2.4, clickAmp: 1.8,
    dragStep: 0.35, dragMinInterval: 0.033, cursorDamp: 14,

    // 鹅卵石 —— AM-004 整段重写（删 pebbleCount / pebbleArea / pebbleScale）
    pebbleCountNear: 88, pebbleCountFar: 150, pebbleLodZ: -11,
    pebbleFieldZ: [-3.0, -24.0], pebbleFieldHalfW: [4.51, 14.85],
    // AM-007 A（两轮）：**两层必须取同一个区间** —— 同区间 = 同尺寸分布，
    //   LOD 分界（z=−11）两侧才在世界尺度上连续，屏幕上由透视自然收小。
    //   第一轮（04:20）只改了 far → midRatio 1.393、只完成一半；
    //   第二轮（04:25）near 一并补到同区间 → midRatio 1.000。
    //   ⚠ 以后要调必须**成对调**，只动一层会立刻造出「远层比近层大」的倒挂。
    pebbleScaleNear: [0.20, 0.58], pebbleScaleFar: [0.20, 0.58],
    pebbleFlatten: 0.55, pebbleRough: [0.22, 0.80],
    pebbleNoiseFreq: 1.7, pebbleNoiseAmp: 0.22,
    pebblePalette: [
      ['#4f5b57', 0.16], ['#78857f', 0.30], ['#9a9f95', 0.27],
      ['#b8a992', 0.17], ['#d8d7cc', 0.10]
    ],
    seed: 20260923,

    // 水下 —— 雨桐 2026-09-24 直裁：关掉 caustic（湖底那层"水波黑影"）
    // causticDayMod（AM-005）：causticStrength 改为「峰值」，运行时按昼夜因子缩放 ——
    //   水下光斑的强弱由水面接收的太阳辐照度决定，正午最强、晨昏中、夜里几乎为零。
    //   实测（4 时段只留湖底平面的亮度 std）：固定强度 晨25.4/午28.5/昏30.7/夜33.1（夜间反而最强，反了）；
    //   调制后 晨16.9/午28.4/昏17.4/夜10.2（正午最强、夜间最弱，与物理一致）。
    caustics: false, causticScale: 0.12, causticSpeed: 0.05, causticStrength: 0.5,
    causticDayMod: true, causticNightFloor: 0.08,

    // 光照 / 后期
    toneMapped: 'ACES', exposure: 1.0,

    // 后期处理 —— AM-009 新增（UP2 落地；WP1 无活跃窗口，主控已预批参数组）
    // bloom 阈值 0.85 抬高到线性 HDR 高光域 → 只吃反光柱/镜面高光，中低亮度不受影响；
    // vignette 很轻（?nopost=1 可运行时整链关闭）。
    // grain 默认 0（主控复核裁决 2026-09-24）：逐帧平移的噪点纹理在深色治愈系画面上
    //   呈「电视机雪花」观感（截图验证不出，真机时间维度噪声），与治愈目标相悖；
    //   管线保留，想要胶片感自行设 0.005~0.02。
    bloom: true, bloomStrength: 0.55, bloomRadius: 0.40, bloomThreshold: 0.85,
    vignetteAmp: 0.16, grainAmp: 0,

    // 环境光照（程序化 equirect + PMREM）—— AM-017 新增（UP3 落地）
    //   来源刻意**不是**外部 HDRI：r160 没有 environmentRotation（13 个 keyframe 的太阳方位
    //   随小时走，固定朝向的 HDRI 只对得上其中一个），且 4 张 1K .hdr ≈ 9 MB 会把单文件交付
    //   撑爆；更关键的是**两条断言入口都在 file:// 下跑** → 运行时生成的 DataTexture 才能通吃。
    //   依据与实测见 plan/99-UP3-hdri.md §3-①。
    //   envEnabled    总开关。false = 完全退回旧光照（hemi/ambient 原值 + 水面二色渐变反射）
    //   envIntensity  湖底 IBL 强度 → 逐帧写 material.envMapIntensity（r160 无 scene.environmentIntensity）
    //   envResolution equirect 宽度（高度 = 宽度/2，必须 2 的幂才能生成 mip）
    //   envWaterGain  水面反射的 env 强度。**与湖底分开**：底是漫反射 IBL、水是镜面反射，
    //                 两者对 #13（反光柱 peak/median）的作用方向相反，分开才能各自调。
    //   envHemiScale / envAmbScale  加 env 后环境光会**重复计**，把 hemi / ambient 按此比例扣回
    //                 （hemi × 0.50、ambient × 0.40 → 净环境光量基本持平，但方向性与色相更物理）
  envEnabled: true, envIntensity: 0.9, envResolution: 128,
  envWaterGain: 0.75, envHemiScale: 0.50, envAmbScale: 0.40,

  // 湖底贴图（程序化 tiling）—— AM-019 新增（UP4-lite）
  //   来源**不是**外部扫描件：① file:// 下外部图片进不了 WebGL 纹理（AM-005 §3 实测 SecurityError）；
  //   ② CC0 2K 组 base64 内联 +3~10 MB，与"不膨胀体积"冲突；③ AM-005 §3 已证「照片贴图替换几何石」不划算。
  //   → 用 canvas 运行时生成（与 makeCausticTexture() 同路径）：周期值噪声 + 低对比 cellular 出高度场，
  //     派生 albedo（颜色，sRGB）与 roughness（湿润变化）。
  //   bedTexture   总开关。false = 退回纯色湖底（material.color 回 0x5d6f66、不挂 map/roughnessMap）
  //   bedTexSize   贴图边长（2 的幂 → 才能 generateMipmaps）
  //   bedTexScale  世界 → UV 缩放（每世界单位多少 UV）；越小 tile 越大、重复越少
  //                0.60 ⇒ tile 1.67 世界单位；0.30 ⇒ 3.33。**调细 tile 是 AM-020 散掉"斑块感"的主手段**
  //   bedTexGrain  albedo 明暗幅度（颗粒对比）。AM-020：0.55→0.25；**AM-021：0.25→0.08**。
  //                这是"降低底部纹路存在感"的**唯一正面杠杆**，且**保持对称**（不压暗部，见 bedTexDark）。
  //                ⚠ 别用 bedRoughVar 去"帮忙"——实测那是反效果，见下一行。
  //   bedRoughVar  粗糙度变化幅度（湿润感：高处更光滑）。
  //                🔴 **AM-021 实测警告（本项是陷阱）**：降它会让 #6 **上升**（看起来"白赚"），
  //                   但地面**平均亮度**随之下降（rough↑ ⇒ 镜面反射↓ ⇒ 变暗）⇒ 与鹅卵石的反差
  //                   **变大** ⇒ 画面上**反而更不平**（整幅 std 17.01→17.31 / IQR 27.9→29.6）。
  //                   ⇒ 要"画面更平"就**只降 grain，别动这一项**。AM-020 曾把它当补偿杠杆，已作废。
  //   bedMacroScale / bedMacroGain  macro 层（第二 UV 低频）—— 打破 tiling 重复感
  //                 （AM-005 §3：照片类纹理 repeat > 6 次肉眼可辨；macro 周期 ≈ 28.6 世界单位
  //                  ⇒ 全湖底 90 单位仅重复 ~3 次）
  //   ⚠ AM-020 实测：macro 层**换不来 #6** —— 周期 28.6 世界单位 ≫ #6 采样区（几米），
  //     区内近似常数。macroGain 0.12→0.34 时 #6 只动 0.04。
  bedTexture: true, bedTexSize: 512, bedTexScale: 0.60, bedTexGrain: 0.08,
  bedRoughVar: 0.20, bedMacroScale: 0.035, bedMacroGain: 0.10,
  // 观感整形 —— AM-020 新增。默认值 = AM-020 的**调定结果**（不是中性值）。
  //   bedTexDark  **暗部压缩**：0 = 原对称式（暗部同样按 ×(1−grain) 压，密集黑点就是"脏"的来源）；
  //               1 = 只亮不暗。
  //               ⚠ **本包最终取 0，即保持对称。** 曾一度定稿 1.0（配 grain 0.90）把纹理能量整体
  //                 翻到亮侧（贴图 min 72→97、#6 回到 15.55），但雨桐看了对照板否决 ——
  //                 **"亮斑不好看"**（暗斑被压平 ⇒ 变成亮斑 ⇒ 观感发云）。故本参数留在 `0`，
  //                 只作为**调试滑杆上的一根备选杠杆**，不是当前观感。
  //   bedTexSpeck 高频衰减：1 = 原样；越小则细密噪点越少（细点密度是"脏"的第二来源）。
  //   bedCellAmt  cellular 权重（原值 0.14）：cell 边界成暗缝 ⇒ "石子缝"网格观感，调到基本消失。
  //   bedTexWarp  域扭曲：0 = 关。**不是**修"格子底纹"用的（那个判断已被证伪，见 AM-020 §4），
  //               实际作用是**在不加细噪点的前提下补回有机结构**（内部相邻差分 0.016→0.075）。
  //               取整数频率 ⇒ 平铺无缝性不受影响（契约 §9 自检仍成立）。
  //   ⚠ bedTexBase 保持 1：拿它"把地面整体调亮"会顶穿 #6（实测 1.25 ⇒ #6 = 12.92 < 14，
  //     因为地面变亮 ⇒ 与鹅卵石的反差缩小 ⇒ 区内 std 掉）。要更亮请走
  //     「压 bedTexSpeck」的方向，别动基准色。
  //   🔴 **核心机理：观感与 #6 在本项目里是【负相关】的（AM-021 用两根正交杠杆证明）**
  //     · **降 `bedTexGrain`（贴图明暗）** ⇒ 画面**真的**变平（整幅 std / 亮度跨度 / 低频斑驳
  //       三项同时下降），但 `#6` **跟着降**。（AM-021 定稿：14.94 → **14.43**）
  //     · **降 `bedRoughVar`** ⇒ `#6` **上升**（白赚的表象），但画面**反而更不平**（见上）。
  //     ⇒ **没有"两全"的解。** 要画面更平，就得接受 `#6` 余量收窄。这不是调不出来，
  //       是判据的几何含义（**地面 vs 鹅卵石**的区内标准差）决定的 —— 详见 AM-021 §3。
  //     ⚠ 另一条 AM-021 实测：贴图在屏幕上被**缩小 2~5 倍**显示（tile 1.67 世界单位 ≈ 250~330
  //       屏幕像素，而贴图侧约 306 px/世界单位）⇒ 高频颗粒已被 mipmap 平均掉 ⇒
  //       **贴图自身的对比在最终画面里占比很小**（贴图 std 7.55→0，整幅画面 std 只动 0.6%）。
  //       ⇒ "底部亮暗对比"若在屏幕上仍然显眼，主因大概率**不在贴图**上（见 AM-021 §4）。
  //   ⛔ **再往下压必须先谈**：`#6` 余量到 AM-021 只剩 ~3%，继续压就是拿冻结判据换审美
  //      （`03-COLLAB-PROTOCOL §7.2` 的禁令）；要么改判据口径（走变更单），要么转攻别处。
  bedTexDark: 0, bedTexSpeck: 0.45, bedCellAmt: 0.02, bedTexBase: 1, bedTexWarp: 0.22,

    // 交互
    splash: true, cameraSway: false, swayAmp: 0.002,

    // 音频
    audioMode: 'auto', bgmVolume: 0.60, handVolume: 0.80, ambVolume: 0.50,
    duckAmount: 0.45, duckDown: 0.05, duckUp: 0.70,
    handBand: [400, 1400, 0.8], handDecay: 0.62,
    // UP11 / AM-015：BGM 由单曲改为**曲目列表** —— 进页面从列表里随机一首、右上前端可选。
    //   本字段只给「有哪些曲、按什么顺序」，**不含任何母带数值**：
    //   每首的 `trim`（响度配平）与 `trueDur`（真实内容时长）都按资产实测，
    //   一律留在 `10-audio.js` 的 `BGM_TRACKS` 表里 —— 那里才是唯一真值源，
    //   也是 `npm run audio:baseline` 漂移报警要盯的地方（换了资产必须重算，见下表注释）。
    //   ⚠ 表里没有的文件名也能放进来：`10-audio.js` 会按「未知资产」降级
    //     （trim 退回原曲值、不做真实时长封顶），不会静音、只是母带目标与循环出点不保证。
    //   文件名的取名与顺序由雨桐定（2026-09-25）：**bgm-mingjing.mp3**（明镜）· **bgm-weifeng.mp3**（微风）。
    bgmFiles: ['assets/audio/bgm-mingjing.mp3', 'assets/audio/bgm-weifeng.mp3'],
    // UP9 / AM-010（海鸟 + 咔嗒）：
    //   birds     海鸟环境层总开关（false = 一声不出，连排放定时器都空转）
    //   uiVolume  UI 音效总线音量（时间刻度尺的咔嗒）；**第四条**总线，与 bgm/hand/amb 并列进 limiter
    // ⚠ 「母带 / 配平」那一类常数（BGM_TRIM · SLAP_TRIM · BIRD_TRIM · TICK_TRIM）刻意**不放进 P**：
    //   它们是针对**当前资产实测**出来的，换资产必须重算。留在 `10-audio.js` 里，
    //   `npm run audio:baseline` 的漂移报警才能把它们一网打尽。
    //   birdGapMin/Max  两次鸣叫的间隔区间（秒）。不是给日常调的旋钮，但**查验需要** ——
    //                   验收 #1 要在合理时间内等到一声（默认 25~70s 太慢），改了之后
    //                   下一次排期立即生效，这正是 §4 #1「临时把间隔调短」的落点。
    birds: true, birdGapMin: 25, birdGapMax: 70, uiVolume: 0.30,

    // 反光路径（glitter path）—— AM-002 新增
    // AM-006（2026-09-24）：收窄夜间白光范围。
    //   glitterDetail 0.35 → 0.16：细节法线 RMS 斜率 19° → 约 9°，
    //     仍大于 GGX 瓣宽但只 1.6 倍 → 远离镜面线的「误中」概率大幅下降，
    //     碎白光从「撒满整片水面」收束到镜面柱附近。再小会退回「光滑塑料带」。
    //   glitterRough 0.045 → 0.065：单颗高光从针尖变成小圆斑，
    //     收窄后柱不至于断成断续的点，读起来是「一条连续的月光带」。
    glitterDetail: 0.16, glitterRough: 0.065, glitterJitter: 0.15,
    // glitterDetail: 0.10, glitterRough: 0.3, glitterJitter: 0.15,

    // 细节波表方向（AM-022 §2-D · 雨桐拍板「A2/A3 取中间 = ±15」）—— 本包的主改动
    //   swDirSpread  **双向半角（度）**：16 个波压到 90°±s 与 270°±s 两组，组内连续随机。
    //     0 = 各向同性（旧行为，碎网）；15 = 定稿（横纹 + 之字形）；44 = 碎网感回升。
    //     实测（午夜全画面）：s=0 柱宽 43.8% / 横纹比 1.53 → s=15 收窄 + 横纹比约 3.5。
    //   swZigAmp    之字形相位幅度：给每个波叠一条沿 x 的低频正弦 ⇒ 波峰线左右摆动。
    //     0 = 关（横纹会"死板"成百叶窗）；0.85 = 定稿。
    //   swZigFreq   之字形空间频率（沿世界 x）。
    // ⚠ 这三项**不在每帧路径上**：改完必须调 `SW.water.rebuildWaves()` 重编着色器才生效
    //   （debug 面板那组滑杆已内置防抖 + 自动调用）。
    swDirSpread: 15, swZigAmp: 0.85, swZigFreq: 0.75,

    // 调试
    debug: false
  };

  // ?debug=1 → 打开 debug 面板。参数表本身保持字面量不变，这里只改运行时值。
  P.debug = /[?&]debug=1(?:&|$)/.test(window.location.search);
  // ?bedtex=0 → 关闭湖底 tiling 贴图（AM-019 的降级路径，做法同 ?nopost=1）。
  //   贴图在 SW.lakebed.init() 里按此值决定是否生成 ⇒ 必须在 init 之前解析。
  P.bedTexture = !/[?&]bedtex=0(?:&|$)/.test(window.location.search);

  SW.P = P;

  // 只读默认快照。UI 的「重置」按钮调 SW.resetP()：
  // 它是原地改 SW.P 的**同一个对象**，所以各处持有的 SW.P 引用不会失效。
  SW.P0 = JSON.parse(JSON.stringify(P));
  SW.resetP = function () {
    var d = JSON.parse(JSON.stringify(SW.P0));
    for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) { SW.P[k] = d[k]; } }
    SW.P.debug = P.debug; // 启动参数（?debug=1）不参与重置
    SW.P.bedTexture = P.bedTexture; // 同上（?bedtex=0）
    return SW.P;
  };

  // ------------------------------------------------------- §3 事件总线（冻结）
  SW.bus = {
    m: {},
    on: function (k, f) { (this.m[k] = this.m[k] || []).push(f); return f; },
    off: function (k, f) {
      var a = this.m[k]; if (!a) { return; }
      var i = a.indexOf(f); if (i >= 0) { a.splice(i, 1); }
    },
    emit: function (k, p) {
      var a = this.m[k]; if (!a) { return; }
      var s = a.slice();
      for (var i = 0; i < s.length; i++) {
        try { s[i](p); } catch (e) { console.error('[SW.bus] handler error on "' + k + '"', e); }
      }
    }
  };

  // ----------------------------------------------------------------- 工具函数
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  // 唯一随机源。渲染路径上禁止 Math.random()（否则断言不可复现）。
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  SW.util = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    mix3: mix3,
    mulberry32: mulberry32,
    // 固定 seed → 独立可复现的随机流（互不干扰，便于各自加流）
    newRng: function (seed) { return mulberry32(((seed >>> 0) ^ 0x9E3779B9) >>> 0); },
    // 在 [a,b) 区间取数
    range: function (rng, a, b) { return a + (b - a) * rng(); },
    // 判断关键数值里有没有 NaN（SW.debug 的 anyNaN 用）
    anyNaN: function (vals) {
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (v === null || v === undefined) { continue; }
        if (typeof v === 'number' && !isFinite(v)) { return true; }
        if (v.isVector3 || (typeof v.x === 'number' && typeof v.y === 'number')) {
          if (!isFinite(v.x) || !isFinite(v.y) || (v.z !== undefined && !isFinite(v.z))) { return true; }
        }
        if (v.isColor) { if (!isFinite(v.r) || !isFinite(v.g) || !isFinite(v.b)) { return true; } }
      }
      return false;
    }
  };

})(window.SW = window.SW || {}, window);
