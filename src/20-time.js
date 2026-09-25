// src/20-time.js —— 所有者：WP3
// 签名逐字对齐 01-CONTRACT.md §2.2；TimeState 字段表见 §2.2（含 AM-002 追加的 glitterGain / glitterColor）
//
// 已应用的变更单：
//   AM-001 §4.3 —— 天空已移出画面：四态差异全部落在「水面 + 雾色 + 光照」上；
//                  skyTop / skyBottom 由 fogColor 派生（不单独调参）；starAlpha 保留字段但刻意不取 ≥0.995
//                  （WP1 的 30-scene.js 里 starAlpha ≥ 0.995 会把天空网格隐藏，远景会失去背景兜底）。
//   AM-002 §7.3 —— TimeState 加 glitterGain / glitterColor，四个必有时段键一个不缺。
//   AM-003 §6.1 —— 反光柱可行域（本文件承载该变更的全部动作）：
//                  ① sunElev 改成 keyframe 直给，废掉 WP3 §4.4 的正弦公式（它会给出负值 → 柱为 0）
//                  ② 仰角表：晨雾 24° / 正午 64° / 黄昏 22° / 星夜 28°，中间点单调、恒正
//                  ③ 方位设计值：晨雾 −8° / 正午 0° / 黄昏 +8° / 星夜 0°
//                  ④ hHalf 夹取放进 getState() 内部（不是 applyTimeState 阶段），resize 时重算
//                  ⑤ 夜间不归零：sunIntensity ≥ 0.6 + 冷色月光
//   AM-007 §3-B —— 晨雾补暖调：**只动 h=5.50 一个 keyframe 的 fog 色**
//                  （[0.66,0.024,238] → [0.66,0.0065,95]）。全图 R−B 实测 −23.8 → +2.80，
//                  亮度 129.9 → 129.5（不变）。相邻 keyframe 一个未动 → 环形插值其余部分零影响。
//                  ⚠ fog 色相步长 38° → 159°，与 WP5 断言 #5（< 60°）冲突，见该 keyframe 处的注记。
//   AM-022 §2-A~C —— **雾密度整条曲线下调**（UP12 主杠杆）+ 两处时段配色（雨桐拍板）：
//                  ① fogD：13 个 keyframe 全部下调，正午 0.042→**0.026**（F1 档）、9 点 0.055→**0.048**
//                     （保薄雾）、晨雾 0.078→**0.045**，其余 10 键一律 **×0.62**。
//                     依据：`FogExp2` 权重 f = 1−exp(−(k·d)²)，原参数下可见远半段泡在 30%~80% 雾里
//                     （正午顶边 81%、晨雾顶 12% 已 95.7%）⇒「最清澈的正午也蒙一层」是数字事实。
//                     真关雾分离实验（`scene.fog = null`）：正午 σ 13.8→25.7（+86%）、远端 179→128。
//                  ② **撤销 AM-007 §3-B**：5.50 的 fog 由暖黄 [0.66,0.0065,95] 改回冷青灰
//                     [0.62,0.014,214]。🔴 这是本包头号风险 —— R−B 判据会回到负值，必须复测。
//                  ③ 20.50：fog/sky 色相 →190°（治水偏绿）· gli →[0.92,0.030,350]（治月光偏红）。
//                  ⚠ 改 fog 色即改天空色与 env 反射色（AM-001 §4.3：skyTop/skyBottom 由 fogColor 派生）
//                     ⇒ env 会重烘，属预期行为。
//   AM-023 §2 —— **夜段一致 + 白天去月光**（UP13 §11 第二阶段第一轮，雨桐规格 09-25 18:1x）：
//                 ① **N1**：夜段核心 6 键 **20.50 / 21.35 / 22.00 / 22.50 / 2.00 / 4.00** 全部取
//                    **2.00 子夜那一套**（雨桐：「夜晚很长一段时间配色都一致」「月亮在正中不要变位置」）。
//                    统一值：`az 0` · `elev 30.0` · `sunI 0.70` · `hemiI 0.42` · `fogD 0.037` ·
//                    `wRough 0.09` · `expo 0.92` · `star 0.60` · `gGain 0.55` ·
//                    六色 = sun[.88,.016,198] sky[.58,.038,262] gnd[.30,.030,227]
//                          fog[.48,.030,258] wat[.285,.042,252] gli[.92,.018,198]。
//                    `elev` 固定 30° ⇒ 镜面点 `4.35/tan30° = 7.5 m` 不动 ⇒ **月光柱位置整夜不变**；
//                    `az` 全 0 ⇒ **月亮恒在正中**。原 §11「N2 顺平」（21.35 / 22.00 的 gGain 腰斩）
//                    **自动达成**，无需单独动。
//                 ② **D1 白天去月光**：9.00 / 12.50 / 15.50 / 17.50 四键 `gGain` → **0**。
//                    （雨桐「白天也能看到月光」的根因是 env 亮瓣白天幅度 3.36 = 夜间 1.12 的 3 倍；
//                     本条只切水面侧，**env 瓣的弥散 D2a 归第二轮**，见 §11.8。）
//                 🔴 5.50（晨雾）**不纳入 N1** —— `R−B(5.5)` 判据带余量仅 0.9%（§11.5-2）。
//                 🔴 19.75（暮色）**不纳入** —— 保留暖调与 `az=+6`，是「月亮自侧边升起」的过程。
//   AM-023 §1 —— **夜间月光克制**（UP13 §2-C 落地，雨桐拍板 0.55 档）：
//                 22.50（星夜）gGain 1.20 → **0.55** · 2.00（子夜）gGain 1.15 → **0.55**。
//                 只动这两个 keyframe 的 gGain 一个字段，其余字段与相邻键**一字未动**。
//                 ⚠ 已知冲突：断言 #11 要求 glitterGain(22.5) ≥ 0.8（本档 0.55 → 挂），
//                    见本文件 22.50 键处注记与 102-UP13-glare.md 完工记录。
//   AM-024 §2.2（第二轮，施工清单 = `102-UP13-glare.md §2.2`）：三条本文件动作 ——
//                 ① **N3 夜段配色**：统一源「2.00 子夜」→「**22.50 星夜**」（雨桐 18:2x 改口径）。
//                    22.00 / 22.50 / 2.00 三键照 N3 表（`elev 30→28` + 六色换族）。
//                    ⇒ 镜面点 `4.35/tan28° = 8.18 m`（原 7.5 m），仍**整夜不动**（位置变化是全局的一次性平移）。
//                 ② **N3 · 4.00 例外**：`4.00`（破晓前）**不照抄 N3 的 sun/gli** —— 它紧邻 5.50 晨雾的
//                    **95° 琥珀色**，若并用 250° 族则 `#5` 色度加权步长 = 155° × 0.034 = **5.27**（阈值 2.5）。
//                    ⇒ 只换色相、压彩度：`sun [0.88,0.012,250]` · `gli [0.92,0.012,250]` ⇒ **1.86**（余量 26%）。
//                    代价（已由雨桐 19:2x 确认）：破晓前月色变淡。其余四色照 N3。
//                 ③ **N4 `az` 全时段归 0**：日光与月光一律钉在画面正中（雨桐 19:2x 追加）。
//                    改 8 键：`5.50(−8)` `9.00(−5)` `15.50(4)` `17.50(7)` `18.50(8)` `19.75(6)`
//                    `20.50(4)` `21.35(1)` ⇒ 全 **0**。代价：黄昏「侧逆光」消失（雨桐已确认）。
//                    `elev` **不可全钉**（`#10` 要求正午 ≥33°，本轮只把夜段四键钉到 28.0）。
//
//   ⚠ AM-024 与 AM-003 §6.1 的关系：AM-003 的「方位设计值 −8/0/+8/0」与 hHalf 夹取机制**保留不动**
//     （夹取仍每帧生效，`az=0` 只是设计值归零）。真正的「离轴」现在全靠 **D2a 的 env 亮瓣弥散**表达。
//
//   AM-025 §3（第三轮，雨桐 09-25 20:2x 实测反馈）—— 本文件承担四条：
//                 ① **白天去灰**（「白天完全看不到太阳光」）：9.00/12.50/15.50/17.50 的 `gGain` **0 → 0.12**
//                    （回调 AM-023 的 D1；仍 < 0.2 ⇒ `#7` 满足）。配套 `30-scene.js` 的
//                    `D2A_DISC_DROP` 1.7 → **0.9**（白天 disc 2.5→1.6，别再砍 −68%）。
//                 ② **夜光转白**（「红蓝绿染色似的，改成白的，照在海上自动有点海的颜色」）：
//                    夜段 **7 键**（19.75 / 20.50 / 21.35 / 22.00 / 22.50 / 2.00 / 4.00）的 `gli` 彩度
//                    → **0.006**（**保色相**，只是去彩度）⇒ 白光照海、由水色（`wat` 青）自染。
//                 ③ **夜段四键彻底一致**：`sun` 彩度 **0.034 → 0.012**（四键同值）⇒ AM-024 给 `4.00`
//                    开的「压彩度例外」**收编** —— `#5` 由 2.108 → **1.86**（余量 26%）。
//                    🔴 **这是对 §3 硬约束 1 的一处主动偏离**：约束要求 `sun` 恢复 **0.034**，
//                       但那样 `4.00→5.50` 的 `#5` = 155° × 0.034 = **5.27 > 2.5**（会挂）。
//                       取 0.012 同时满足「四键一致」与 `#5`，代价是夜光更近白（与 ② 同向，见 `## 7`）。
//                 ④ **日光色温单调化**（「白天带橙色，正午偏白，黄昏更橙，要自然」）：
//                    `sun` 色相 80/100/**130**/112/78 → **85 / 88 / 72 / 58 / 45**（19.75 再给 **30**）。
//                    原 15.50 的 **130° 是黄绿** —— 下午比上午更绿，色温非单调，这是本条的病根。
//                 ⑤ **黄昏降曝光**（「黄昏 18 点半又曝光太厉害」）：18.50 `gGain 0.35 → 0.20` · `expo 0.98 → 0.95`。
//                    根因：本键 `elev 22°` ⇒ 镜面点 10.8 m > `D2B_FULL 7.2` ⇒ **D2b 管不到那一段**。
//
// ⚠ 与 AM-001 §4.3 第 5 条的冲突：那条要求「夜间 sunElev<0 时 sunIntensity=0」。
//   AM-003 §2 已裁决**以 AM-003 为准** —— 夜间要的是一颗挂在地平线之上 22~30° 的月亮，
//   归零会让整条反光柱消失。新的假光防线是「**sunElev 永不为负**」（本文件所有键恒正）。
//
// ⚠ glitterGain 取值：AM-002 §2.3 给的是 0.35/0.15/0.85/1.00，AM-003 §6.1 改成 0.30/0.15/0.35/1.20。
//   以 AM-003 为准 —— 理由是低仰角的镜面项天然极强（22° 的 shape 7.63 vs 28° 的 2.50），
//   若黄昏也按 0.85 给，昏/夜亮度比会到 3.7 倍，不是「昏 ≈ 夜」。
(function (SW, window) {
  'use strict';

  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function norm24(h) { return ((h % 24) + 24) % 24; }
  // 角度差归一到 (−180, 180] —— 色相最短弧插值的前提
  function wrap180(d) { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; }

  // ══════════════════════════════════════════════ §9 共享常量（只读，不得自行改）
  // 相机在 (0, CAM_Y=5.9, CAM_Z=3.4)、lookAt (0, WATER_Y=1.55, CAM_Z − CAM_LOOKAHEAD)
  // → 水平朝向恒为 −Z。three 的 Spherical(x = sinθ, z = cosθ) 下，−Z 对应 θ = π。改机位走变更单。
  var CAM_FORWARD_AZ = Math.PI;
  var CAM_FOV_FALLBACK = 34;           // 只在 SW.scene.CAM 还没建好时用（正常读 §9 的共享常量）
  var AZ_HALF_MAX = 22;                // AM-003 §3：16:9 下的封顶偏角
  var AZ_HALF_MIN = 7;                 // AM-003 §3：竖屏保底下限
  var AZ_HALF_MARGIN = 6;              // AM-003 §3：距画面边留 6°

  // ── AM-003 §3 / §6.1-4：方位扇区随宽高比夹取 ──────────────────────────────
  // hHalf = atan( tan(fov/2) × aspect )。柱的方位安全区就等于 hHalf，它不是常数：
  //   16:9 桌面 28.03° → k 22°   ·  16:10 笔记本 25.66° → k 19.7°
  //   方形 16.40° → k 10.4°      ·  竖屏 12.73° → k 7°
  // 夹取必须在 getState() 内部做（否则 probe().sunAz 与实际光源位置不一致，WP5 会读到没夹过的值）。
  var azHalfDeg = null;
  function recomputeAzHalf() {
    var fov = (SW.scene && SW.scene.CAM && SW.scene.CAM.fov) || CAM_FOV_FALLBACK;
    var cam = SW.scene && SW.scene.camera;
    var aspect = (cam && cam.aspect > 0 && isFinite(cam.aspect)) ? cam.aspect : 16 / 9;
    var hHalf = Math.atan(Math.tan(fov * 0.5 * D2R) * aspect) / D2R;
    azHalfDeg = Math.min(AZ_HALF_MAX, Math.max(AZ_HALF_MIN, hHalf - AZ_HALF_MARGIN));
    return azHalfDeg;
  }
  function azHalf() { return (azHalfDeg === null) ? recomputeAzHalf() : azHalfDeg; }

  // 光源方位角 = 相机朝向 + clamp(设计偏角, ±k)
  function sunAzAt(azDeg) {
    var k = azHalf();
    return CAM_FORWARD_AZ + clamp(azDeg, -k, k) * D2R;
  }

  // ══════════════════════════════════════════════ OKLCH → 线性 sRGB
  // 为什么用 OKLCH：感知均匀，色相走最短弧插值时不会「中间发灰 / 发绿」。
  // 输出是**线性** sRGB —— 与 30-scene.js 的 setRGB / 天空 shader 的工作空间一致。
  function oklch(L, C, H) {
    var a = C * Math.cos(H * D2R), b = C * Math.sin(H * D2R);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    ];
  }
  // LCH 三元组插值：L / C 线性，H 走最短弧
  function mixLCH(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), a[2] + wrap180(b[2] - a[2]) * t];
  }
  function rgbOf(lch) { return oklch(lch[0], lch[1], lch[2]); }

  // ══════════════════════════════════════════════ keyframe 表（环，按小时升序）
  // 四个必有时段：5.5 晨雾 · 12.5 正午 · 18.5 黄昏 · 22.5 星夜。其余是过渡点。
  //
  // 色相路径（决定「过渡会不会脏」）：
  //   水面 / 雾 / 半球光 走同一条基准色相：252 → 232 → 208 → 190 → 165 → 128 → 92 → 130 → 162 → 196 → 222 → 240
  //   （冷蓝夜 → 青绿昼 → 金黄黄昏 → 经青绿回冷蓝），相邻步 ≤ 38°。
  //   sun / glitter 走另一条（光色：晨昏暖、正午白、夜冷白偏蓝），相邻步 ≤ 52°。
  //   夜里 22.5 → 2.0 → 4.0 是光色由冷转暖的翻转段，彩度刻意压到 0.008~0.030，
  //   让它读成「冷白月光 → 白 → 暖白晨光」而不是明显绕色。
  //
  // 字段：
  //   h 小时 · n 名 · az 方位设计偏角(度，相对相机朝向；+ = 右) · elev 光源高度角(度，**恒正**)
  //   sunI 主光强度（夜间 = 月光，≥0.6）· hemiI · fogD · wRough · expo
  //   star（AM-001 后无画面贡献）· gGain 反光强度
  //   sun/sky/gnd/fog/wat/gli = [L, C, H](OKLCH)
  //   spr **AM-024 D2a 新增**：env 亮瓣弥散度 0~1（0 = 夜紧致 / 1 = 白天弥散）。**AM-025 起兼作**
  //        波表方向的逐时权重（`swDirSpread` 在 `P.swDirSpread`（夜 15）与 `P.swDirSpreadDay`（昼 45）
  //        之间按本值插值 —— 见 `60-water.js` 的 `rawHalf()`）。
  //        只驱动 `30-scene.js` 的亮瓣形状（`disc = 2.5 − 0.9·s` / `glow = 0.20 + 0.35·s`）
  //        与水面法线的方向宽度；与水面**镜面强度**解耦（那由 `gGain` 管）。
  //        逐键表：夜段四键 **0** · 白天四键（9.00/12.50/15.50/17.50）**1** ·
  //        5.50 / 18.50（晨昏）**0.5** · 19.75 / 20.50 / 21.35（入夜台阶）**0.25 / 0.10 / 0.05**。
  //        ⚠ 台阶三键刻意**不**一律取 0.5：21:21（蓝调）时月亮已是主光，半弥散亮瓣会留下一圈光晕
  //          （与 AM-023 §2.1「6 键全并会爆 #5」同族处理 —— 过渡必须分摊，不能齐平）。
  var KEYS = [
    // ── AM-024 §2.2-N3：**夜段统一值的源键**（本键 / 4.00 / 22.00 / 22.50 四键同值，`az` 本就全 0）──
    //    源 = 22.50 星夜**原值**（雨桐「改成之前的 23 点配色」；23:00 落在 22.50→2.00 之间、t≈0.055
    //    ⇒ 实测即星夜原值）。`elev 30 → 28`：镜面点 7.5 m → **8.18 m**，整夜不动。
    //    **AM-025 起**：`sun` 彩度 0.034 → **0.012**（四键一致 + 保 `#5`）· `gli` 彩度 0.048 → **0.006**（转白）。
    { h: 2.00, n: '子夜', az: 0, elev: 28.0, sunI: 0.70, hemiI: 0.42, fogD: 0.037, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 0.55, spr: 0,
      sun: [0.88, 0.012, 250], sky: [0.58, 0.038, 250], gnd: [0.30, 0.030, 215],
      fog: [0.47, 0.030, 246], wat: [0.288, 0.042, 240], gli: [0.92, 0.006, 250] },

    // N1 并轨（AM-023）+ **N3 例外**（AM-024）→ **AM-025 收编**：
    //   AM-024 时本键的 `sun`/`gli` 彩度被单独压到 0.012，因为并到 N3 的 `sun 0.034` 会让
    //   `4.00→5.50` 的 `#5` = 155° × 0.034 = **5.27**（阈值 2.5）。
    //   AM-025 把**夜段四键的 `sun` 彩度一起收到 0.012**、`gli` 彩度收到 0.006（光线转白）⇒
    //   ① `#5` 回到 **1.86**（余量 26%）② **四键重新逐字一致**（例外不再需要，雨桐「好几档渐变」的要求）。
    { h: 4.00, n: '破晓前', az: 0, elev: 28.0, sunI: 0.70, hemiI: 0.42, fogD: 0.037, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 0.55, spr: 0,
      sun: [0.88, 0.012, 250], sky: [0.58, 0.038, 250], gnd: [0.30, 0.030, 215],
      fog: [0.47, 0.030, 246], wat: [0.288, 0.042, 240], gli: [0.92, 0.006, 250] },

    // AM-024 §2.2-N4：`az −8 → 0`（日光钉在正中）。elev/sunI 等一字未动。
    //   5.50 晨雾是**黄昏侧逆光的对偶** —— 日光侧逆光整体取消，弥散改由 D2a 表达（`spr 0.5`）。
    { h: 5.50, n: '晨雾', az: 0, elev: 24.0, sunI: 0.90, hemiI: 0.75, fogD: 0.045, wRough: 0.18, expo: 1.00, star: 0.05, gGain: 0.30, spr: 0.5,
      sun: [0.88, 0.058, 95], sky: [0.70, 0.030, 242], gnd: [0.36, 0.024, 207],
      // AM-007 §3-B（**已由 AM-022 撤销，保留原文备查**）：曾把雾色由冷青蓝 [0.66,0.024,238]
      //   改为与本键 sun/gli 同色相的暖黄 [0.66,0.0065,95]，目的是救全图 R−B（−23.8 → +2.80）。
      //   色度不是 §3 建议的 0.030，因为该旋钮实测比预设灵敏约 50×（C=0.030/H=70 → R−B +24.9）会超上限 +4。
      //   ⚠ 它留下的副作用：fog 色相步长 38° → 159°，越过 WP5 断言 #5 的 <60°（加权后 0.91→1.03）。
      //
      // AM-022 §2-B（2026-09-25 雨桐拍板「清晨③」）：**这个暖黄雾被本人否掉了** —— 理由是观感
      //   「6 点的颜色 + 雾霾感不好看」。现改回冷青灰 [0.62, 0.014, 214]（同时 fogD 0.078→0.045）。
      //   ✅ 副作用**顺带修好**：fog 色相步长 159° → 40°（254°→214°），加权 1.03 → **0.56**，回到 #5 判据带内。
      //   🔴 代价：**R−B 判据会回到负值**（AM-007 就是为它才加暖调）⇒ 这是本包**头号复测项**，越界需主控裁决。
      fog: [0.62, 0.014, 214], wat: [0.355, 0.030, 232], gli: [0.94, 0.034, 95] },

    // D1（AM-023）白天去月光：gGain → 0。**AM-025 回调为 0.12** —— 雨桐「白天完全看不到太阳光」：
    //   D1 把水面镜面路径整个关掉后，白天横向亮光只剩 env 亮瓣，亮点几乎没了。
    //   0.12 仍 < 0.2 ⇒ `#7` 的 `gSpec(12.5) < 0.2` 不受影响（硬约束 2）。
    //   ⚠ 同时 `D2A_DISC_DROP` 1.7 → 0.9（白天 disc 2.5→1.6，别再把亮瓣砍到 −68%）。
    { h: 9.00, n: '上午', az: 0, elev: 46.0, sunI: 1.70, hemiI: 0.90, fogD: 0.048, wRough: 0.13, expo: 1.03, star: 0.00, gGain: 0.12, spr: 1,
      sun: [0.91, 0.040, 85], sky: [0.78, 0.042, 218], gnd: [0.42, 0.034, 183],
      fog: [0.74, 0.034, 214], wat: [0.425, 0.046, 208], gli: [0.95, 0.028, 80] },

    // D1 → **0.12**（AM-025 同上）。`sun` 色相 100 → **88**（正午偏白，AM-025 单调序列的一环）。
    //   ⚠ `elev` **不可钉**（AM-024 硬约束 4）：#10 要求正午 ≥33°，本键 64.0 是全表最大值。
    { h: 12.50, n: '正午', az: 0, elev: 64.0, sunI: 2.10, hemiI: 0.95, fogD: 0.026, wRough: 0.10, expo: 1.05, star: 0.00, gGain: 0.12, spr: 1,
      sun: [0.92, 0.012, 88], sky: [0.84, 0.048, 200], gnd: [0.48, 0.040, 165],
      fog: [0.80, 0.042, 196], wat: [0.520, 0.058, 190], gli: [0.97, 0.008, 100] },

    // D1 → **0.12**。`sun` 色相 130 → **72** —— AM-025 的头号修正：原 130° 是**黄绿**，
    //   而 9.00 是 80、17.50 是 112 ⇒ 下午的太阳比上午更绿（色温**非单调**）。现整条改单调：85/88/72/58/45/30。
    { h: 15.50, n: '午后', az: 0, elev: 47.0, sunI: 1.85, hemiI: 0.90, fogD: 0.030, wRough: 0.11, expo: 1.02, star: 0.00, gGain: 0.12, spr: 1,
      sun: [0.91, 0.030, 72], sky: [0.80, 0.046, 175], gnd: [0.45, 0.038, 140],
      fog: [0.77, 0.040, 171], wat: [0.470, 0.055, 165], gli: [0.96, 0.018, 130] },

    // D1 → **0.12**。`sun` 色相 112 → **58**。⚠ 本键之后 18.50 黄昏是 0.20 ⇒ 17.5→18.5 有一次抬升。
    //   AM-024 N4：`az 7 → 0`（**黄昏侧逆光整体取消**，雨桐 19:2x 确认）。
    { h: 17.50, n: '斜阳', az: 0, elev: 33.0, sunI: 1.55, hemiI: 0.82, fogD: 0.034, wRough: 0.12, expo: 1.00, star: 0.00, gGain: 0.12, spr: 1,
      sun: [0.90, 0.062, 58], sky: [0.74, 0.050, 138], gnd: [0.42, 0.038, 103],
      fog: [0.72, 0.042, 134], wat: [0.430, 0.052, 128], gli: [0.95, 0.050, 112] },

    // AM-024 N4：`az 8 → 0`。AM-024 §2.2：`spr 0.5`（晨昏过渡键取中间）。
    //   **AM-025（雨桐「黄昏 18 点半又曝光太厉害」）**：`gGain 0.35 → 0.20` · `expo 0.98 → 0.95`。
    //   根因：本键 `elev 22°` ⇒ 镜面点 `4.35/tan22° = 10.8 m`，落在 `D2B_FULL = 7.2` **之外**
    //   ⇒ D2b 的纵向截止**完全管不到那一段**，只能靠降增益与降曝光。
    //   `sun` 色相 78 → **45**（更橙，色温序列末端）。
    { h: 18.50, n: '黄昏', az: 0, elev: 22.0, sunI: 1.30, hemiI: 0.78, fogD: 0.038, wRough: 0.13, expo: 0.95, star: 0.05, gGain: 0.20, spr: 0.5,
      sun: [0.88, 0.078, 45], sky: [0.68, 0.058, 102], gnd: [0.40, 0.040, 67],
      fog: [0.66, 0.048, 98], wat: [0.400, 0.050, 92], gli: [0.94, 0.090, 78] },

    // AM-024 N4：`az 6 → 0`。`spr 0.25`（入夜台阶第一级）。
    //   **AM-025**：`gli` 彩度 0.075 → **0.006**（夜段光线转白，保色相）· `sun` 色相 50 → **30**。
    { h: 19.75, n: '暮色', az: 0, elev: 23.5, sunI: 0.80, hemiI: 0.62, fogD: 0.042, wRough: 0.12, expo: 0.96, star: 0.35, gGain: 0.55, spr: 0.25,
      sun: [0.86, 0.048, 30], sky: [0.58, 0.038, 140], gnd: [0.35, 0.026, 105],
      fog: [0.56, 0.030, 136], wat: [0.360, 0.030, 130], gli: [0.93, 0.006, 50] },

    // 🔴 **本键不并轨**（N1 由 6 键收窄为 4 键，见下方说明）—— 只把 `gGain` 0.75 → **0.55**。
    //   原因：19.75 暮色（暖，sky 140 / fog 136 / wat 130）到夜段冷蓝（262 / 258 / 252）跨 **122°**，
    //   中间**必须**留 20.50(190) 与 21.35(206) 两个台阶，否则 `#5` 色度加权色相步长直接爆表 ——
    //   6 键全并实测 **sky 4.636 / fog 3.66 / wat 3.66 / gnd 3.172 / gli 2.664 / sun 2.368**（阈值 2.5）。
    //   收窄为 4 键（22.00 / 22.50 / 2.00 / 4.00 并轨）后实测 **MAX 2.058**（余量 18%）。
    //   ⇒ 20:30~22:00 仍是「入夜渐变」，22:00~4:00 完全一致。**是否要 20:00 起就一致，待雨桐裁**
    //     （那需要把 19.75 暮色的彩度压到 ≤0.016 ⇒ 暮色变灰白，或新增过渡键 ⇒ 违反「13 键零新增」）。
    //   本键色值沿用 AM-022 §2-C（雨桐拍板「20点③」）：治「水偏绿 + 月光偏红」两件事。
    //   AM-024 N4：`az 4 → 0`。`spr 0.10`（台阶第二级）。
    //   **AM-025**：`gli` 彩度 0.030 → **0.006**（转白）。
    { h: 20.50, n: '晚霞', az: 0, elev: 25.0, sunI: 0.74, hemiI: 0.56, fogD: 0.043, wRough: 0.11, expo: 0.95, star: 0.55, gGain: 0.55, spr: 0.10,
      sun: [0.86, 0.030, 20], sky: [0.54, 0.034, 190], gnd: [0.32, 0.026, 137],
      fog: [0.52, 0.030, 190], wat: [0.330, 0.034, 162], gli: [0.92, 0.006, 350] },

    // 🔴 同上：不并轨，只把 `gGain` 1.00 → **0.55** ⇒ **整夜（19.75~4.00）gGain 恒 0.55**，
    //   雨桐「亮度一整晚都在变」这一条**完全解决**；色相/位置在 20:30~22:00 仍渐变（见上）。
    //   ⚠ 原「N2 顺平」的 21.35→0.68 / 22.00→0.60 因此不再需要 —— 直接平到 0.55 即可。
    //   AM-024 N4：`az 1 → 0`。`spr 0.05`（台阶第三级 —— 月亮到此已接管主光）。
    //   **AM-025**：`gli` 彩度 0.014 → **0.006**（转白）。
    { h: 21.35, n: '蓝调', az: 0, elev: 26.5, sunI: 0.72, hemiI: 0.50, fogD: 0.042, wRough: 0.10, expo: 0.94, star: 0.60, gGain: 0.55, spr: 0.05,
      sun: [0.88, 0.014, 345], sky: [0.52, 0.034, 206], gnd: [0.30, 0.028, 171],
      fog: [0.49, 0.030, 202], wat: [0.305, 0.038, 196], gli: [0.92, 0.006, 345] },

    // N3 并轨（AM-024）：本键照 2.00 源键。**AM-025**：`sun` 彩度 0.034 → **0.012**、`gli` → **0.006**
    //   ⇒ 夜段四键重新逐字一致（详见 2.00 键与 `## 7` 的说明）。
    { h: 22.00, n: '入夜', az: 0, elev: 28.0, sunI: 0.70, hemiI: 0.42, fogD: 0.037, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 0.55, spr: 0,
      sun: [0.88, 0.012, 250], sky: [0.58, 0.038, 250], gnd: [0.30, 0.030, 215],
      fog: [0.47, 0.030, 246], wat: [0.288, 0.042, 240], gli: [0.92, 0.006, 250] },

    // AM-023 §1（2026-09-25 雨桐在 pv-ggain-v3.png 上拍板「0.55 不错」）：
    //   星夜 gGain 1.20 → **0.55**（−54%），子夜 2.00 同步 1.15 → **0.55**。
    //   依据：夜间镜面项是水体自身的 2.35 倍（102-UP13 §1.1 实测），月光喧宾夺主。
    //   ⚠ 硬下限：断言 #7 要求 glitterSpec(22.5) > 0.5 ⇒ gGain 不得 ≤ 0.50（余量仅 10%）。
    //   🔴 与断言 #11 冲突：#11 要求 glitterGain(22.5) ≥ 0.8 ⇒ 本档会挂，见完工记录。
    // AM-024 N3：本键**就是统一源**（雨桐「改成之前的 23 点配色」= 本键原值）—— 只把 `elev 28` 保留
    //   （N1 曾把它抬到 30 去凑「镜面点固定 7.5 m」，现四键统一 28 ⇒ 仍固定，只是固定在 8.18 m）。
    { h: 22.50, n: '星夜', az: 0, elev: 28.0, sunI: 0.70, hemiI: 0.42, fogD: 0.037, wRough: 0.09, expo: 0.92, star: 0.60, gGain: 0.55, spr: 0,
      sun: [0.88, 0.012, 250], sky: [0.58, 0.038, 250], gnd: [0.30, 0.030, 215],
      fog: [0.47, 0.030, 246], wat: [0.288, 0.042, 240], gli: [0.92, 0.006, 250] }
  ];

  // ------------------------------------------------------------ 组装 TimeState
  function buildState(hour) {
    var h = norm24(hour);
    var n = KEYS.length, i = n - 1, k;
    for (k = 0; k < n; k++) { if (KEYS[k].h <= h) { i = k; } else { break; } }
    var a = KEYS[i], b = KEYS[(i + 1) % n];

    var h0 = a.h, h1 = b.h; if (h1 <= h0) { h1 += 24; }
    var hh = h; if (hh < h0) { hh += 24; }
    var t = smoothstep((hh - h0) / (h1 - h0));

    var fog = mixLCH(a.fog, b.fog, t);
    return {
      // 方位：设计偏角经 hHalf 夹取（AM-003 §3）。夹取在这里做，probe().sunAz 才和实际光源一致。
      sunAz: sunAzAt(lerp(a.az, b.az, t)),
      // 仰角：keyframe 直给，rad。所有键恒正 —— 这是 AM-003 §2 的假光防线。
      sunElev: lerp(a.elev, b.elev, t) * D2R,
      sunColor: rgbOf(mixLCH(a.sun, b.sun, t)),
      sunIntensity: lerp(a.sunI, b.sunI, t),
      hemiSky: rgbOf(mixLCH(a.sky, b.sky, t)),
      hemiGround: rgbOf(mixLCH(a.gnd, b.gnd, t)),
      hemiIntensity: lerp(a.hemiI, b.hemiI, t),
      fogColor: rgbOf(fog),
      fogDensity: lerp(a.fogD, b.fogD, t),
      waterColor: rgbOf(mixLCH(a.wat, b.wat, t)),
      waterRough: lerp(a.wRough, b.wRough, t),
      waterMetal: 0.0,
      // AM-001 §4.3：天空已移出画面 → 由雾色派生，不为它单独调参。
      // 真露出一点也不会和远景打架。**不要为这两个字段加班。**
      skyTop: oklch(fog[0] * 0.80, fog[1] * 0.90, fog[2] + 4),
      skyBottom: oklch(Math.min(1, fog[0] * 1.04), fog[1], fog[2] - 4),
      exposure: lerp(a.expo, b.expo, t),
      starAlpha: lerp(a.star, b.star, t),
      // AM-002 §7.3 / AM-003 §6.1：反光路径强度与色温（夜最强、正午最弱）
      glitterGain: lerp(a.gGain, b.gGain, t),
      glitterColor: rgbOf(mixLCH(a.gli, b.gli, t)),
      // AM-024 D2a：env 亮瓣弥散度（0 = 夜紧致 / 1 = 白天弥散）。
      //   只被 30-scene.js 的太阳瓣形状消费；**必须进 envDist() 签名**，否则改 s 时 env 不重烘。
      //   ⚠ 本字段是 `01-CONTRACT §2.2` 的**冻结签名**新增项（AM-024 硬约束 1）。
      envSunSpread: clamp01(lerp(a.spr, b.spr, t))
    };
  }

  // ------------------------------------------------------------ 运行时状态
  var cur = null;
  var lastHour = NaN;
  var hourNow = 0;
  var cbs = [];

  function mode() { return (SW.P && SW.P.timeMode === 'fixed') ? 'fixed' : 'auto'; }
  function realHour() {
    var d = new Date();
    return norm24(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + ((SW.P && SW.P.hoursOffset) || 0));
  }
  function targetHour() { return mode() === 'fixed' ? norm24((SW.P && SW.P.fixedHour) || 0) : realHour(); }

  // 只有小时真的推进了才重建状态对象 —— 否则 WP1 的 applyTimeState 会 60 次/秒刷 'timechange'
  var EPS_H = 0.001;   // ≈ 3.6 秒；这段时间里太阳位移 < 0.001 rad，肉眼不可见
  function refresh(force) {
    var h = targetHour();
    if (!force && cur && Math.abs(h - lastHour) < EPS_H) { hourNow = h; return false; }
    hourNow = h; lastHour = h;
    cur = buildState(h);
    return true;
  }
  function fire() {
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](cur); } catch (e) { console.error('[SW.time] onChange handler error', e); }
    }
    // 契约 §3：timechange 由 WP3 emit。WP1 的 applyTimeState 也会 emit 一次（同源、幂等），
    // 监听器请按幂等实现。
    SW.bus.emit('timechange', cur);
  }

  // URL ?hour=18.5 → 直接进 fixed
  (function applyUrl() {
    var m = /[?&]hour=(-?\d+(?:\.\d+)?)/.exec(window.location.search);
    if (!m) { return; }
    var v = parseFloat(m[1]);
    if (!isFinite(v)) { return; }
    SW.P.timeMode = 'fixed';
    SW.P.fixedHour = norm24(v);
  })();

  // 视口变化时重算方位夹取区（AM-003 §6.1-4）
  if (SW.bus && SW.bus.on) { SW.bus.on('resize', recomputeAzHalf); }

  SW.time = {
    // —— 冻结签名（§2.2）——
    getState: function (hour) { return buildState(hour); },
    current: function () { if (!cur) { refresh(true); } return cur; },
    setMode: function (m) {
      m = (m === 'fixed') ? 'fixed' : 'auto';
      if (SW.P.timeMode === m) { return m; }
      SW.P.timeMode = m;
      refresh(true); fire();
      return m;
    },
    getMode: function () { return mode(); },
    setHour: function (h) {
      h = norm24(parseFloat(h));
      if (!isFinite(h)) { return hourNow; }
      SW.P.fixedHour = h;
      SW.P.timeMode = 'fixed';       // 隐含切到 fixed
      refresh(true); fire();
      return h;
    },
    update: function (dt) { if (refresh(false)) { fire(); } },
    onChange: function (cb) { if (typeof cb === 'function') { cbs.push(cb); } return cb; },

    // —— 附加（非冻结接口，供 WP5 断言 / 90-debug 用）——
    getHour: function () { if (!cur) { refresh(true); } return hourNow; },   // 90-debug.js 的 hours() 优先读它
    KEYS: KEYS,
    // §4.3 色相步长自检：每个颜色字段在相邻 keyframe 之间的最大色相步长（度）
    maxHueStep: function () {
      var fld = ['sun', 'sky', 'gnd', 'fog', 'wat', 'gli'], out = {};
      for (var f = 0; f < fld.length; f++) {
        var m = 0, k = fld[f];
        for (var i = 0; i < KEYS.length; i++) {
          var a = KEYS[i][k], b = KEYS[(i + 1) % KEYS.length][k];
          var d = Math.abs(wrap180(b[2] - a[2]));
          if (d > m) { m = d; }
        }
        out[k] = +m.toFixed(2);
      }
      return out;
    },
    // 当前方位夹取区（度）。AM-003 §5.3 第 8 条要用它算判据。
    azHalfDeg: function () { return azHalf(); },
    hHalfDeg: function () {
      var fov = (SW.scene && SW.scene.CAM && SW.scene.CAM.fov) || CAM_FOV_FALLBACK;
      var cam = SW.scene && SW.scene.camera;
      var aspect = (cam && cam.aspect > 0 && isFinite(cam.aspect)) ? cam.aspect : 16 / 9;
      return Math.atan(Math.tan(fov * 0.5 * D2R) * aspect) / D2R;
    },
    // sunAz 相对相机朝向的实际偏离（度，已夹取）。断言 #8 读它。
    azOffsetDeg: function (h) {
      var s = (h === undefined) ? (cur || (cur = buildState(hourNow))) : buildState(h);
      return wrap180((s.sunAz - CAM_FORWARD_AZ) / D2R);
    },
    // 镜面点到相机的水平距离 4.35/tan(elev)。落在 [4.83, 30.95] 内 → 柱在画面里（16:9 口径）。
    mirrorDist: function (h) {
      var s = (h === undefined) ? (cur || (cur = buildState(hourNow))) : buildState(h);
      return 4.35 / Math.tan(s.sunElev);
    },
    // 当前所处的时段名（四态）
    nameOf: function (h) {
      h = norm24(h === undefined ? hourNow : h);
      if (h >= 4 && h < 10) { return '晨雾'; }
      if (h >= 10 && h < 16) { return '正午'; }
      if (h >= 16 && h < 20.5) { return '黄昏'; }
      return '星夜';
    }
  };
})(window.SW = window.SW || {}, window);
