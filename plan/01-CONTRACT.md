# 接口契约（冻结）

> **所有工作包必读。** 任何聊天框都**不得**修改本文件里已冻结的签名、事件名、DOM id、文件所有权。
> 需要新增接口 → 在本文件末尾「变更记录」追加一行，并同步告知其它 WP。
>
> 本文件存在的唯一理由：WP2/3/4 是**三个并行聊天框**，它们之间只能通过本文件通信。

---

## 1. 脚本加载方式与顺序（冻结）

`index.html` 用**经典 `<script>` 标签**，顺序即依赖顺序，**不得调整**：

```html
<script src="vendor/three.min.js"></script>  <!-- 全局 THREE -->
<script src="vendor/three-post.min.js"></script>  <!-- AM-009：后处理类全局 THREEPOST（主控构建；dist 入口不用它） -->
<script src="src/00-config.js"></script>     <!-- SW.P -->
<script src="src/10-audio.js"></script>      <!-- SW.audio   -->
<script src="src/20-time.js"></script>       <!-- SW.time    -->
<script src="src/30-scene.js"></script>      <!-- SW.scene   -->
<script src="src/40-lakebed.js"></script>    <!-- SW.lakebed -->
<script src="src/50-ripple.js"></script>     <!-- SW.ripple  -->
<script src="src/60-water.js"></script>      <!-- SW.water   -->
<script src="src/65-post.js"></script>       <!-- SW.post（AM-009） -->
<script src="src/70-input.js"></script>      <!-- SW.input   -->
<script src="src/80-ui.js"></script>         <!-- SW.ui      -->
<script src="src/85-fallback.js"></script>   <!-- 降级兜底    -->
<script src="src/90-debug.js"></script>      <!-- SW.debug   -->
<script src="src/99-main.js"></script>       <!-- SW.boot()  -->
```

**为什么不是 ES module**：`type="module"` + importmap 在 `file://` 下被 CORS 挡死，双击打不开。
经典脚本没有模块作用域 → 所以所有模块挂到 `window.SW` 命名空间下。

---

## 2. 命名空间总表（冻结签名）

```js
window.SW = {};
```

### 2.1 `10-audio.js` → `SW.audio`（所有者：WP4）

```js
SW.audio = {
  ready: false,
  init(),                 // 首次用户手势后调用，创建 AudioContext
  setEnabled(bool),
  playHand(speed01),      // speed01 ∈ [0,1]，控制划水/点击声强度
  duck(),                 // 压低 BGM（划水时调用）
  suspend(),
  resume(),
  probe()                 // → { state, bgmGain, handGain, ambGain, lastHandPeak }
};
```

### 2.2 `20-time.js` → `SW.time`（所有者：WP3）

```js
SW.time = {
  getState(hour),         // 纯函数，无副作用：hour(0~24) → TimeState
  current(),              // 当前应生效的 TimeState
  setMode('auto'|'fixed'),
  getMode(),              // → 'auto' | 'fixed'
  setHour(h),             // 隐含切到 fixed
  update(dt),
  onChange(cb)            // 时段状态变化时回调，cb(TimeState)
};
```

**`TimeState` 字段表（冻结，加字段必须走「变更记录」）**：

| 字段 | 类型 | 含义 |
|---|---|---|
| `sunAz` | number | 太阳方位角，弧度 |
| `sunElev` | number | 太阳高度角，弧度 |
| `sunColor` | [r,g,b] | 0~1 |
| `sunIntensity` | number | |
| `hemiSky` | [r,g,b] | 半球光天空色 |
| `hemiGround` | [r,g,b] | 半球光地面色 |
| `hemiIntensity` | number | |
| `fogColor` | [r,g,b] | |
| `fogDensity` | number | `FogExp2` 密度 |
| `waterColor` | [r,g,b] | 水面基色 |
| `waterRough` | number | 0~1 |
| `waterMetal` | number | 0~1 |
| `skyTop` | [r,g,b] | 天空渐变顶部 |
| `skyBottom` | [r,g,b] | 天空渐变地平线 |
| `exposure` | number | `toneMappingExposure` |
| `starAlpha` | number | 0~1，星星可见度（**AM-001 后无画面贡献**，保留字段） |
| `glitterGain` | number | **AM-002 新增**。反光路径强度，0~1.2。夜晚最强、正午最弱 |
| `glitterColor` | [r,g,b] | **AM-002 新增**。反光路径色（线性）。月光=冷白、黄昏=琥珀金 |

### 2.3 `30-scene.js` → `SW.scene`（所有者：WP1）

```js
SW.scene = {
  init(canvas),
  renderer, scene, camera, clock,
  sun, hemi, fog,
  sceneRT,                // 湖底离屏渲染目标（WP2 只读，不得重建）
  applyTimeState(state),  // 把 TimeState 灌进 lights / fog / exposure
  render(dt)
};
```

### 2.4 `40-lakebed.js` → `SW.lakebed`（所有者：WP1）

```js
SW.lakebed = { init(scene), group, causticTexture };
```

### 2.5 `50-ripple.js` → `SW.ripple`（所有者：WP2）

```js
SW.ripple = {
  init(renderer),
  emit(x, z, amp),        // 世界坐标 (x,z) 注入涟漪，amp 为振幅倍率
  step(dt),               // 推进波动方程（ping-pong）
  heightTexture,          // 给水面 shader 采样的高度场 RT
  active,                 // 存活源计数（供断言）
  probe()                 // → { active, fieldSize, lastEmitAt }
};
```

**关键**：`heightTexture` 必须在 `SW.ripple.init()` 后即可用（哪怕内容全零），
否则 `60-water.js` 无法建 shader。

### 2.6 `60-water.js` → `SW.water`（所有者：WP2）

```js
SW.water = {
  init(scene, camera),
  mesh, material, uniforms,
  update(dt),
  setRefract(bool),       // 供断言用：关掉折射做像素差分
  probe()                 // → { refract, normalGain, tris }
};
```

### 2.6b `65-post.js` → `SW.post`（所有者：UP2 · **AM-009 新增**）

```js
SW.post = {
  init(),                 // bus 'ready' 后自调（THREEPOST 检测 + composer 构建）；?nopost=1 / 缺类 → 跳过直渲
  render(dt),             // 由 SW.scene.render() 步骤②调用（active 时替代直渲）；OutputPass 末位施加 ACES+sRGB
  active,                 // 后期链是否在跑（false → 30-scene 直渲）
  composer, bloomPass, gradePass,
  setEnabled(bool),       // 运行时开关
  probe()                 // → { post, bloom, strength, threshold, radius, grain, vignette }
};
```

**约束**：后处理类供给 = `window.THREEPOST`（免构建：vendor/three-post.min.js，主控所有；构建：app/post-global.js 原生 import 挂同名全局）。折射源 `sceneRT` 与 composer 缓冲**必须独立**；OutputPass 必须是末位 pass（r160 对 RT 不做 tonemap）。

### 2.7 `70-input.js` → `SW.input`（所有者：WP2）

```js
SW.input = { init(dom), probe() /* → { worldX, worldZ, speed01, dragging } */ };
```

### 2.8 `80-ui.js` → `SW.ui`（所有者：WP3）

```js
SW.ui = { init(), update(dt) };   // 内部自建 DOM，不改 index.html
```

### 2.9 `90-debug.js` → `SW.debug`（所有者：WP1）

```js
SW.debug = {
  init(),
  update(dt),
  probe(),                // → 见 §5 读数表
  seek(h),                // 钉时间：切 fixed 并设 hour
  clock(t),               // 钉动画时钟（涟漪/涌动相位）
  hold(bool)             // 冻结过渡
};
```
**仅在 `?debug=1` 时挂载**，默认不创建任何 DOM。

### 2.10 `99-main.js` → 启动（所有者：WP1）

```js
SW.boot = function () { /* 渲染循环，见下 */ };
```

**渲染循环（冻结，WP1 写死，其它 WP 不得改）**：

```js
function frame(t) {
  const dt = Math.min(SW.scene.clock.getDelta(), 0.05);
  SW.time.update(dt);
  SW.scene.applyTimeState(SW.time.current());
  SW.ripple.step(dt);
  SW.water.update(dt);
  SW.scene.render(dt);
  SW.ui.update(dt);
  SW.debug.update(dt);
  requestAnimationFrame(frame);
}
```

---

## 3. 事件总线（WP1 实现，所有 WP 可用）

```js
SW.bus = { on(key, fn), off(key, fn), emit(key, payload) };
```

**事件名与 payload（冻结）**：

| 事件 | payload | 谁 emit | 谁 on |
|---|---|---|---|
| `ready` | — | WP1 | WP4（首次手势提示） |
| `splash` | `{ x, z, speed01 }` | WP2 (`70-input.js`) | **WP4**（播划水声）、WP2（涟漪已自行处理） |
| `timechange` | `TimeState` | WP3 | WP1（scene）、WP2（水色） |
| `resize` | `{ w, h, dpr }` | WP1 | WP2 |

**跨 WP 的唯一通信方式就是这张表。** 想在别的 WP 里直接调对方内部函数 → 不允许。

---

## 4. DOM id（冻结）

| id | 元素 | 所有者 |
|---|---|---|
| `#c` | canvas | WP1 |
| `#ui` | UI 容器（默认空） | WP1 建容器，WP3 往里加 |
| `#hint` | 首次手势提示 | WP1 |
| `#snd` | 声音开关 | WP3 |
| `#hour` | 时段滑块 | WP3 |
| `#dbg` | debug 面板 | WP1（仅 `?debug=1`） |

**所有 UI 用 JS 创建并 append 到 `#ui`**，不改 `index.html` 结构 → 避免并行冲突。

---

## 5. `SW.debug.probe()` 读数表（冻结，断言依赖）

| 键 | 类型 | 来源 |
|---|---|---|
| `fps` | number | 滚动 60 帧 |
| `frameMs` | number | 同上 |
| `calls` | number | `renderer.info.render.calls` |
| `tris` | number | `renderer.info.render.triangles` |
| `hours` | number | `SW.time` 当前小时（4 位小数） |
| `timeMode` | string | `'auto' ∣ 'fixed'` |
| `rippleActive` | number | `SW.ripple.active` |
| `ptrWorld` | `{x,z}` | `SW.input.probe().worldX/worldZ` |
| `ptrSpeed` | number | `SW.input.probe().speed01` |
| `sunAz` / `sunElev` | number | | 
| `audioCtx` | string | `'running' ∣ 'suspended' ∣ 'none'` |
| `bgmGain` | number | |
| `reduceMotion` | boolean | `matchMedia('(prefers-reduced-motion: reduce)')` |
| `webgl` | boolean | |
| `anyNaN` | boolean | 关键 uniform 是否出现 NaN |
| `refract` | boolean | `SW.water.probe().refract` |
| `glitterGain` | number | 当前 `TimeState.glitterGain`（**AM-002**） |
| `glitterSpec` | number | `SW.water.probe().glitterSpec` —— 水面对准光源方向采样点的镜面高光值 0~1（**AM-002**，断言依赖） |
| `pebbles` | number | **AM-004 改写**：两层鹅卵石实例数**总和**（原为单层 `.count`） |
| `pebbleCountNear` / `pebbleCountFar` | number | **AM-004**：近景层（180 面）/ 中远景层（80 面）各自实例数 |
| `pebbleInView` | number | **AM-004**：落点位于**可见梯形**内的颗数（用与建场同一套 NDC 四角射线求交） |
| `pebbleDensity` | number | **AM-004**：`pebbleInView / 可见梯形面积`，单位「颗/单位²」。**断言依赖** |
| `pebbleTintSpread` | number | **AM-004**：全部实例 `aTint` 的 sRGB 亮度极差。**断言依赖** |
| `pebbleFieldZ` | `[number, number]` | **AM-004**：`[NEAR_Z, FAR_Z]`，与 §9 `PEBBLE_FIELD_Z` 同源 |

**默认（无 `?debug=1`）不得创建 debug DOM，也不得暴露 `__probe`。**

---

## 6. 参数表 `SW.P`（`00-config.js`，所有者：WP1）

WP1 建立**完整字段**；各 WP 只读自己的字段，**不得新增**。
`var P = {...}` 与「重置」按钮的赋值必须同步。

```js
var P = {
  // 时间
  timeMode: 'auto', hoursOffset: 0, fixedHour: 12.5,

  // 波纹
  fieldSize: 512, rippleSpeed: 3.2, rippleLifetime: 4.5,
  rippleWaveK: 9.0, rippleAmp: 0.09, rippleDecay: 0.996,
  normalGain: 2.4, clickAmp: 1.8,
  dragStep: 0.35, dragMinInterval: 0.033, cursorDamp: 14,

  // 鹅卵石 —— AM-004 整段重写（删 pebbleCount / pebbleArea）
  pebbleCountNear: 88, pebbleCountFar: 150, pebbleLodZ: -11,
  pebbleFieldZ: [-3.0, -24.0], pebbleFieldHalfW: [4.51, 14.85],
  // AM-007 A（2026-09-24 修订）：**两层必须取同一个区间** —— 同一尺寸分布，
  //   LOD 分界（z=−11）两侧才在世界尺度上连续，屏幕上由透视自然收小。
  //   只改一层会造出「远层比近层大」的倒挂（WP1d-fix 实测：中位 0.28 vs 0.575 = 2.054×
  //   → 分界带屏幕直径比 1.125，远侧反而更大）。算式与判据见 §9「鹅卵石场自检」。
  //   ⚠ 单颗大小**本来就不该**近大远小 —— 判据是**分布口径**，不是单颗顺序。
  pebbleScaleNear: [0.20, 0.58], pebbleScaleFar: [0.20, 0.58],
  pebbleFlatten: 0.55, pebbleRough: [0.22, 0.80],
  pebbleNoiseFreq: 1.7, pebbleNoiseAmp: 0.22,
  pebblePalette: [
    ['#4f5b57', 0.16], ['#78857f', 0.30], ['#9a9f95', 0.27],
    ['#b8a992', 0.17], ['#d8d7cc', 0.10]
  ],
  seed: 20260923,

  // 水下 —— causticDayMod / causticNightFloor 由 AM-005 追加（WP1 落地）
  // causticStrength 语义变更：由「固定强度」改为「**峰值**」，运行时乘昼夜因子（见 AM-005）
  caustics: false, causticScale: 0.12, causticSpeed: 0.05, causticStrength: 0.5,
  causticDayMod: true, causticNightFloor: 0.08,

  // 光照 / 后期
  toneMapped: 'ACES', exposure: 1.0,

  // 后期处理 —— AM-009 新增（UP2 落地）；?nopost=1 运行时整链关闭（同 debug 处理，字面量不变）
  //   grainAmp 0.05→0.02：主控复核指示（返工轮，grain 换定种噪点纹理 + 振幅降档，93-UP2-bloom.md §6a）
  bloom: true, bloomStrength: 0.55, bloomRadius: 0.40, bloomThreshold: 0.85,
  vignetteAmp: 0.16, grainAmp: 0.02,

  // 交互
  splash: true, cameraSway: false, swayAmp: 0.002,

  // 音频
  audioMode: 'auto', bgmVolume: 0.60, handVolume: 0.80, ambVolume: 0.50,
  duckAmount: 0.45, duckDown: 0.05, duckUp: 0.70,
  handBand: [400, 1400, 0.8], handDecay: 0.62,
  bgmFile: 'assets/audio/bgm-stillwater.mp3',

  // 反光路径（glitter path）—— AM-002 新增；AM-006 收窄白光范围
  glitterDetail: 0.16, glitterRough: 0.065, glitterJitter: 0.15,

  // 调试
  debug: false
};
```

---

## 7. 文件所有权（冻结，**一票否决级**）

一个文件只能有一个所有者。**不拥有就不许改。**

| 文件 | 所有者 | 其它 WP 的权限 |
|---|---|---|
| `index.html` | **WP1** | 只读 |
| `vendor/three.min.js` | **WP1** | 只读 |
| `src/00-config.js` | **WP1** | 只读 |
| `src/30-scene.js` | **WP1** | 只读（`applyTimeState` 已在 WP1 内实现，WP3 只提供 `TimeState`） |
| `src/40-lakebed.js` | **WP1** | 只读 |
| `src/90-debug.js` | **WP1** | 只读（读数已按 §5 暴露，WP2/3/4 只需保证自己的 probe 返回对应字段） |
| `src/99-main.js` | **WP1** | 只读 |
| `src/50-ripple.js` | **WP2** | 只读 |
| `src/60-water.js` | **WP2** | 只读 |
| `src/70-input.js` | **WP2** | 只读 |
| `src/20-time.js` | **WP3** | 只读 |
| `src/80-ui.js` | **WP3** | 只读 |
| `src/10-audio.js` | **WP4** | 只读 |
| `assets/audio/*` | **WP4** | 只读 |
| `src/85-fallback.js` | **WP5** | 只读 |
| `README.md` | **WP5** | 只读 |
| `plan/*.md` | 记录用 | 只在 `_STATUS.md` 追加 |

> **WP1 的 `applyTimeState` 已经实现**：它按 `TimeState` 字段逐个赋给 `sun` / `hemi` / `fog` / `renderer.toneMappingExposure`。
> 所以 **WP3 不需要碰 `30-scene.js`** —— 这正是把光照从并行冲突里拆出去的关键。

---

## 8. 每个 WP 完成的定义（Definition of Done）

1. 自己拥有的文件全部写完，无 `TODO` 占位。
2. 自己暴露的 `probe()` 字段全部返回真实值（不是 `undefined`）。
3. `file://` 双击打开，**console 无报错**（Warning 允许）。
4. 本 WP 的验收判据全部通过。
5. 在 `plan/_STATUS.md` 追加一行状态。
6. 临时脚本（`_*.js` / `_*.py`）已删除。

---

## 9. 共享常量（Shared Constants）★ 跨 WP 的数值约定

> **为什么有这一节**：§2 冻结的是**函数签名**，但真正会让多个 WP 互相打架的是**数值**——
> 相机俯角、水位、湖底尺寸。这些原先散落在各 WP 的正文里，WP1 交付后就没人再看，
> 于是 WP2/WP3 各按自己的理解取值，合并时才发现对不上。
> **凡 ≥2 个 WP 依赖的数值，一律登记在这里。不允许只写在某个 WP 的正文里。**
>
> 修改本节 → 必须走 `02-AMENDMENTS.md` 开一张变更单，并同步 §10 变更记录。

| 常量 | 值 | 所有者 | 谁依赖 | 说明 |
|---|---|---|---|---|
| `CAM_FOV` | **34** | WP1 | WP2（RT 相机必须同步） | ~~42~~ 见 AM-001。42 太宽，高俯视时上半屏全是雾 |
| `CAM_PITCH_DEG` | **25** | WP1 | WP3 / WP5 | **必须 > 17°（= fov/2）**，否则地平线回到画面里 |
| `CAM_POS` | **`(0, 5.9, 3.4)`** | WP1 | WP2 | 水面之上 **4.35** |
| `CAM_LOOKAHEAD` | **9.33** | WP1 | — | `lookAt` 的水平前视距离 |
| `CAM_LOOKAT` | **`(0, 1.55, -5.93)`** | WP1 | — | 由上面两项算出，不要直接写死 |
| `WATER_Y` | **1.55** | WP2 | WP1b 断言 / WP2 | 水位 |
| `BED_Y` | **0** | WP1 | WP2 | 湖底平面高度 |
| `BED_SIZE` | **90** | WP1 | WP2 | 湖底边长。**水面尺寸必须 ≥ 它**，否则边缘穿帮 |
| `WATER_SIZE_MIN` | **90** | WP2 | — | 水面边长下限（= `BED_SIZE`） |
| `HORIZON_VISIBLE` | **`false`** | WP1 | WP3 / WP5 | **硬约束**：地平线必须在画面之外。WP3 的四态设计不能依赖天空 |
| `SKY_ROLE` | `'防露黑背景'` | WP1 | WP3 | 天空网格**保留但不可见**。`skyTop/skyBottom/starAlpha` 字段保留、对画面无贡献 |
| `FOG_ROLE` | `'远景淡出'` | WP3 | WP2 | 雾的作用从「遮地平线」变为「让远处水面淡出」。**不因看不到地平线而调稀** |
| `TIME_STATE_FIELDS` | 见 §2.2 | WP3 | WP1 | 字段不因 AM-001 增删；AM-002 追加 `glitterGain` / `glitterColor` |
| `SUN_AZ_SECTOR` | **`min(22°, hHalf − 6°)`，下限保底 `7°`** | WP3 | WP2 · WP5 | ~~相机朝向 ± 75°（AM-002）~~ **AM-003 改写**：扇区**随宽高比变化**。`hHalf = atan(tan(CAM_FOV/2) × aspect)`。±25° 只在 16:9 成立，竖屏安全区仅 **12.73°**（实测）。**夹取必须在 `getState()` 内部做**，否则 probe 与实际光源位置不一致 |
| `SUN_AZ_DESIGN` | **±8°**（`sunAz = π + offset`） | WP3 | WP5 | **AM-003**：四个 keyframe 的设计偏移量（晨 −8° / 午 0° / 昏 +8° / 夜 0°）。落在夹取区以内，夹取只在窄窗口兜底 |
| `GLITTER_ELEV_BAND` | **[22°, 30°]** | WP3 | WP5 | **AM-003**：晨雾 / 黄昏 / 星夜三个低光时段的 `sunElev` 必须落在此区间（实测 shape 5.2~7.6，柱最强） |
| `GLITTER_ELEV_MAX` | **32°** | WP3 | WP5 | **AM-003**：硬上限。实测 34° → shape 1.01、38° → 0.63，`glitterSpec(22.5) > 0.5` 的悬崖在 ~40°，取 32° 留 **8° 余量** |
| `SUN_ELEV_MIN` | **`> 0`（永不为负）** | WP3 | WP5 | **AM-003 硬约束**：光源仰角恒为正。`glitterSpec()` 第一道门就是 `Ly <= 0.02 → 0`；夜间靠**月亮**（正仰角）而非 hemi 接管。**取代 AM-001 §4.3 第 5 条** |
| `MOON_INTENSITY_MIN` | **0.6** | WP3 | WP5 | **AM-003**：夜间 `sunIntensity` 下限。`60-water.js` 的 `SUN_I_FLOOR = 0.30` 只是安全网（它让 `glitterSpec` 读到 1.0 但画面柱只有 0.30 亮度 → **假通过**），不能当设计依赖 |
| `NOON_ELEV_MIN` | **33°** | WP3 | WP5 | **AM-003**：正午 `sunElev` 下限，保证 `shape × 0.15 < 0.2`。WP3 建议取 **64°**（shape 0.012） |
| `GLITTER_LAYERS` | **2**（大波纹 FBO + 高频细节法线） | WP2 | — | **AM-002**：只用单层法线做不出破碎柱，高光会连成光滑带 → 像塑料 |
| `GLITTER_PEAK_HOUR` | **22.5** | WP3 | WP2 | **AM-002**：反光路径最强出现在星夜；正午最弱（柱几乎消失）。**AM-003 补注**：柱的**实际亮度** = `glitterColor × glitterGain × sunColor × max(sunIntensity, 0.30) × BRDF` —— 黄昏的几何天然占优，可接受顺序为「昏 ≈ 夜 > 晨 ≫ 午」 |
| `HALF_H_FOV` | **`atan(tan(CAM_FOV/2) × aspect)`** | WP1 | WP3 · WP5 | **AM-003**：水平半视角。实测：16:9（**1280×720**）→ **28.53°**、16:10 → 25.66°、方形 → 16.40°、竖屏 → **12.73°**。**这是反光柱方位安全区的真实边界。** ⚠ 旧文档把 16:9 写作 28.03°（那是 **1254×720** 的值，2026-09-24 订正，见 `02-AMENDMENTS.md §1.1`） |
| `PEBBLE_FIELD_Z` | **`[-3.0, -24.0]`** | WP1 | WP1d · WP5 | **AM-004**：鹅卵石场 z 范围。近边放在画面近边（−3.15）**之外** 0.15，避免底边出现「石头戛然而止」；远边取 −24（雾穿透率 < 15%） |
| `PEBBLE_FIELD_HALFW` | **`[4.51, 14.85]`** | WP1 | WP1d · WP5 | **AM-004**：场在 NEAR_Z / FAR_Z 处的**半宽**。来自 NDC 四角射线与 `y=0` 求交的实测（4.58 / 22.04），按 16:9 参考宽高比 + 10% 余量收窄 |
| `PEBBLE_LOD_Z` | **`-11`** | WP1 | WP1d · WP5 | **AM-004**：LOD 分界。近侧用高模、远侧用低模 |
| `PEBBLE_LOD_FACES` | **`[180, 80]`** | WP1 | WP1d · WP5 | **AM-004**：`Icosahedron(1,2)` 实测 **180 面 / 540 顶点**（⚠️ AM-002 §6 写的 320 是错的，`PolyhedronGeometry` 细分是 `20 × (detail+1)²`）；`Icosahedron(1,1)` = 80 面 |
| `PEBBLE_TINT_SPREAD_MIN` | **0.45** | WP1 | WP5 | **AM-004**：`aTint` 的 sRGB 亮度极差下限。改前实测 **0.153**（等于没做深浅） |
| `PEBBLE_DARK_MIN` | **0.34**（sRGB 亮度） | WP1 | WP5 | **AM-004**：暗端下限。湖底基色 `#5d6f66` 亮度 **0.42**，更暗的石在水下吸收后会与湖底阴影糊在一起 |
| `PEBBLE_DENSITY_MIN` | **0.55 颗/单位²** | WP1 | WP5 | **AM-004**：清晰带（z ∈ [−3, −14]）内有效密度下限。改前实测 **0.033**，目标 0.5~1.0 |
| `PEBBLE_COVERAGE_MIN` | **0.40** | WP1 | WP5 | **AM-007**：近带（z ∈ [−3, −11]）**足迹覆盖率**下限。实测：`[0.14,0.42]` → **0.235**（稀，露底多）· `[0.25,0.90]` → ≈**1.0**（过饱和＝凝胶团块）· `[0.20,0.58]` → **0.454** ✅。**这条是唯一能量到「稀」的判据**（密度量颗数，不随尺寸变） |
| `PEBBLE_LOD_SEAM_RATIO_MAX` | **1.00**（必须 <） | WP1 | WP5 | **AM-007**：LOD 接缝的**屏幕口径**判据 —— 分界带里远层屏幕直径中位 **不得大于** 近层。实测：旧参数 **1.125**（倒挂）· 统一尺寸后预测 **0.80**。⚠ 这是**分布口径**，单颗大小不可比（见 §9 注） |
| `PEBBLE_SCALE_COMMON` | **`[0.20, 0.58]`（两层同值）** | WP1 | WP1e · WP5 | **AM-007 A 修订**：`pebbleScaleNear` 与 `pebbleScaleFar` **必须取同一区间**。改动只允许成对改 |
| `MAX_CHROMA_STEP` | **2.5**（必须 <） | WP3 | WP5 | **AM-007 §5.2c**：**色度加权**色相步长上限。`chromaStep = ‖ΔH‖ × min(C_a, C_b)`，逐字段取 13 个相邻 keyframe 对的**最大**值。**色相只有在两端都有彩度时才可感知**，权重取 `min` 是保守取法（不会因一端很饱和就把另一端近灰的旋转算成一大步）。全表实测最大 **2.11**（`sun` 斜阳→黄昏）。⚠ **不要用 1.5** —— 按任何一般约定实现都会打挂 `sun`(2.11) / `gli`(2.10) / `wat`(1.92) / `sky`(1.80) |

**几何自检**（改机位后必须重算，`plan/02-AMENDMENTS.md AM-001 §2.2` 有完整算式）：

```
CAM_PITCH_DEG = atan((CAM_POS.y − WATER_Y) / CAM_LOOKAHEAD)   // atan(4.35/9.33) = 25.00°
horizonRow    = 0.5 − CAM_PITCH_DEG / CAM_FOV                  // 0.5 − 25/34 = −0.235  ← 必须 < 0
顶边射线俯角   = CAM_PITCH_DEG − CAM_FOV/2                      // 25 − 17 = 8° 向下    ← 必须 > 0
远边落点       = CAM_POS.z − (CAM_POS.y − WATER_Y)/tan(顶边射线)  // 3.4 − 30.9 = −27.5  ← 必须 > −45（BED_SIZE/2）
```

**反光柱自检**（AM-003 新增，改动比例后必须重算）：

```
hHalf      = atan(tan(CAM_FOV/2) × aspect)          // 1280×720（16:9）→ 28.53°   竖屏 → 12.73°
kDeg       = min(22, max(7, hHalf − 6))             // sunAz 允许的最大偏角
|sunAz − π| ≤ kDeg                                   // 否则柱整条滑出画面
sunElev ∈ [22°, 30°]   （晨 / 昏 / 夜）  ≤ 32° 硬上限
sunElev > 0             （任何时段）
```

**鹅卵石场自检**（AM-004 新增，改机位 / 改 `fov` 后必须重算）：

```
可见梯形 = NDC 四角射线 ∩ 平面 y = BED_Y     // 实测 16:9：近边 z=−3.15 半宽 4.58 → 远边 z=−38.6 半宽 22.04
hw(z)    = HALF_W_NEAR + (HALF_W_FAR − HALF_W_NEAR) × (NEAR_Z − z) / (NEAR_Z − FAR_Z)
PEBBLE_FIELD_Z[0] 要比可见近边再往外放 ~0.15   // −3.0 vs −3.15：避免底边出现「石头戛然而止」
PEBBLE_FIELD_HALFW[0] ≈ hw(PEBBLE_FIELD_Z[0])
PEBBLE_FIELD_HALFW[1] ≈ hw(PEBBLE_FIELD_Z[1]) × 1.10    // 10% 余量：窄窗口也要盖满
清晰带密度 = pebbleCount(近) / 梯形面积(z ∈ [−3, −14])   ≥ PEBBLE_DENSITY_MIN   // 0.85 ≥ 0.55
覆盖率     = π · E[s²] · pebbleCount(近) / 梯形面积(z ∈ [−3, −11])   ≥ PEBBLE_COVERAGE_MIN
             E[s²] = (a² + ab + b²) / 3   ，[a,b] = pebbleScaleNear   // 均匀分布的二阶矩
LOD 尺度比 = mid(pebbleScaleFar) / mid(pebbleScaleNear)      = 1.00 ± 0.05       // AM-007 A：远层不得大于近层
LOD 接缝比 = med(屏幕直径 | far 层, z∈[−12.5,−11]) / med(屏幕直径 | near 层, z∈[−11,−9.5])   < 1.00
```

> ⚠️ **上面的判据全是「分布口径」，不是「单颗口径」。**
> 每颗石子的尺寸都是随机的，**远层一颗大石本来就该比近层一颗小石显得大** —— 那是自然多样性，
> 不是缺陷。会出问题的只有一件事：**把两层的屏幕尺寸分别统计，远层的分布中心不该高于近层**。
> 上面的 `LOD 接缝比` 就是量这件事（实测基线见 `02-AMENDMENTS.md AM-007 §2.3`）。

> **`PEBBLE_COVERAGE_MIN` 为什么必须单列**：`PEBBLE_DENSITY_MIN` 量的是**颗数**/面积，
> 改尺寸时它一个数都不动 —— 所以 WP1d-fix 把近景缩小后「石头变稀、露底多」时，
> 密度判据照样通过。覆盖率才量得到「稀」。三个口径各自的分工见 AM-007 §2.2。

**色相路径自检**（AM-007 §5.2c 新增，改任何 keyframe 色值后必须重算）：

```
chromaStep(k) = max over 13 adjacent pairs of |ΔH| × min(C_a, C_b)   // k ∈ sun/sky/gnd/fog/wat/gli
max over k    <  MAX_CHROMA_STEP (2.5)                              // 全表实测最大 2.11 (sun 斜阳→黄昏)
数据源：SW.time.KEYS（[L, C, H] 三元组，H 以度计）—— WP5 直接算，**不改 20-time.js**
```

> ⚠ 这条取代原来的「原始色相步长 < 60°」。**为什么**：色相在低色度处**没有感知意义** ——
> 只旋转色相、同时把色度压到近灰（`C ≈ 0.0065`）时通道偏移仅 **±4/255**，肉眼不可见，
> 但原始色相步长会读到 **159°**（AM-007 B 的晨雾补暖就是这种情况）。原始色相步长保留为**诊断读数**，
> `SW.time.maxHueStep()` 仍可调用，但**不再作判据**。

**验证窗口自检**（AM-007 新增，跑无头断言前必须核对 —— 写错会让 az 类断言假宽松）：

```
viewport = (--window-size 的 W − 26, H − 156)        // 实测，不是 (W−26, H−100)
要 16:9 画布 → --window-size=1306,876 → 1280×720     // aspect 1.7778 · hHalf 28.53°  ✅
错值示例    → --window-size=1306,820 → 1280×664      // aspect 1.9277 · hHalf 30.51°  ❌ 差 2.5°
```
> ⚠ **所有像素类判据（`R−B` 色温 / 列亮度剖面 / 湖底 std / 折射差分）必须在 `1306,876 → 1280×720` 这一个口径下取**，
> **不得混用 1280×664 的读数**（`R−B(5.5)` 两口径差 0.26，而判据带只有 12 宽）。见 AM-007 §6.3 动作 #8。

---

## 10. 变更记录

> 任何对 §1–§9 的修改都追加到这里，格式：`时间 | 改了什么 | 影响哪些 WP`
> **跨 WP 的追溯修改**（已交付的包要改）开条变更单落在 `02-AMENDMENTS.md`，此处只记一行指针。

| 时间 | 变更 | 影响 |
|---|---|---|
| 2026-09-23 | 初版冻结 | — |
| 2026-09-23 | 新增 **§9 共享常量**；`fov` 42→34、俯角 15°→25°、相机抬到水面之上、地平线移出画面。详见 `02-AMENDMENTS.md` **AM-001** | WP1b · WP2 · WP3 · WP5 |
| 2026-09-23 | §5 `probe()` 表追加 `camY` / `camPitchDeg` / `horizonRow` / `topRowL` / `fogL`（AM-001 §5.1） | WP1b · WP5 |
| 2026-09-23 | **AM-002 采纳 A+B**：§2.2 `TimeState` 追加 `glitterGain` / `glitterColor`；§6 参数表追加 `glitterDetail` / `glitterRough` / `glitterJitter`；§9 追加 `SUN_AZ_SECTOR` / `GLITTER_LAYERS` / `GLITTER_PEAK_HOUR`；§5 追加 `glitterGain` / `glitterSpec` | WP1c · WP2 · WP3 · WP5 |
| 2026-09-24 | **AM-003 裁决**：§9 `SUN_AZ_SECTOR` 由固定 `±75°` 改为 **`min(22°, hHalf−6°)`（随宽高比）**；新增 `SUN_AZ_DESIGN` / `GLITTER_ELEV_BAND` / `GLITTER_ELEV_MAX` / `SUN_ELEV_MIN` / `MOON_INTENSITY_MIN` / `NOON_ELEV_MIN` / `HALF_H_FOV`；§9 新增「反光柱自检」算式块。**改写了 AM-001 §4.3 第 5 条**（夜间 `sunElev < 0` → `sunIntensity = 0` 作废） | **WP3**（全部动作）· WP5 |
| 2026-09-24 | **AM-004 裁决**：§6 鹅卵石段整段重写（删 `pebbleCount` / `pebbleArea`；加 `pebbleCountNear` / `pebbleCountFar` / `pebbleLodZ` / `pebbleFieldZ` / `pebbleFieldHalfW` / `pebbleScaleNear` / `pebbleScaleFar` / `pebblePalette`）；§5 追加 `pebbleCountNear` / `pebbleCountFar` / `pebbleInView` / `pebbleDensity` / `pebbleTintSpread` / `pebbleFieldZ`，`pebbles` 语义改为两层总和；§9 追加 `PEBBLE_FIELD_Z` / `PEBBLE_FIELD_HALFW` / `PEBBLE_LOD_Z` / `PEBBLE_LOD_FACES` / `PEBBLE_TINT_SPREAD_MIN` / `PEBBLE_DARK_MIN` / `PEBBLE_DENSITY_MIN`。**AM-002 §6 的三层表作废** | **WP1d**（新包）· WP5 |
| 2026-09-24 | **AM-005**：§6 追加 `causticDayMod` / `causticNightFloor`（`causticStrength` 语义改为**峰值**）。**AM-002 §6 已作废的前提下，本节只增量** | WP1d（已落）· WP5 |
| 2026-09-24 | **AM-006**：§6 `glitterDetail` `0.35→0.16` · `glitterRough` `0.045→0.065`（收窄夜间白光到镜面柱附近） | WP2（已落）· WP5 |
| 2026-09-24 | **AM-007**：① §6 `pebbleScaleFar` `[0.35,0.80]→[0.20,0.58]`（LOD 尺度统一）② §9 新增「**验证窗口自检**」算式块（`viewport = (W−26, H−156)`，`1306,876 → 1280×720`）③ §9 鹅卵石自检追加 `LOD 尺度比 = 1.00 ± 0.05` ④ 晨雾暖调（仅 keyframe 值，不入契约）；WP5 断言 +1（#13 反光柱像素口径） | **WP1e** · **WP3b** · **WP5** |
| 2026-09-24 | **AM-007 A 修订（主控直裁 + 实测）**：§6 `pebbleScaleNear` `[0.14,0.42] → [0.20,0.58]`（**两层必须同区间**，§6.1 动作清单原漏写 near 那条）；§9 追加 `PEBBLE_COVERAGE_MIN` / `PEBBLE_LOD_SEAM_RATIO_MAX` / `PEBBLE_SCALE_COMMON`；§9 鹅卵石自检追加**覆盖率**与**接缝屏幕比**两个算式，并加「判据是分布口径、单颗不可比」的注 | **WP1e（补一行）** · **WP5**（断言 +2 → 15 条） |
| 2026-09-24 | **AM-007 §5.2c（主控直裁 + 实测）**：① 断言 #5 由「原始色相步长 < 60°」改为**色度加权** `‖ΔH‖ × min(C_a,C_b) < 2.5`；§9 追加 `MAX_CHROMA_STEP` + 「**色相路径自检**」算式块。**理由**：`fog` 补暖后原始色相步长 38° → **159°**，但色度压到近灰（偏移 ±4/255）→ 无「过渡发灰」。阈值经**全表 13 key × 6 字段**重新标定（最大 2.11 = `sun` 斜阳→黄昏），**不是下游建议的 1.5**（1.5 会打挂 `sun`/`gli`/`wat`/`sky`）。② §9 `HALF_H_FOV` / 反光柱自检 / 验证窗口自检的 `hHalf` 由笔误 **28.03° → 28.53°**（正确值；28.03° 是 1254×720 的值）；③ §9 验证窗口自检追加「**像素类判据一律固定 1306,876 → 1280×720**」的口径约束 | **WP5**（#5 换口径 + 画布口径固化）· WP3（作者侧的自检规则） |
| 2026-09-24 | **AM-009（UP2 后期处理管线，已关单）**：§1 加载顺序插入 `vendor/three-post.min.js`（THREEPOST 全局，主控构建，仅免构建入口）与 `src/65-post.js`；§2 新增 **§2.6b `SW.post`**；§6 追加 post 参数段（`bloom/bloomStrength/bloomRadius/bloomThreshold/vignetteAmp/grainAmp`，`?nopost=1` 运行时关闭）。**断言阈值一律未动**——#2 语义变为 composer 末位 pass 计数（1/1）、#13/#6 读数微移，重标由主控做。全文见 `98b-AMENDMENTS-ARCHIVE-v1.md` §AM-009，过程见 `plan/93-UP2-bloom.md` | **UP2** · 契约 §1/§2/§6 · WP5（断言重标待做） |
