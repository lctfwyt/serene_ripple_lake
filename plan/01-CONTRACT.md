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
  sfxTick(step),          // UP9/AM-010：刻度尺咔嗒。step ∈ [0,1]，返回 boolean（真出声才 true）
                          //   自带 ≤25 ms 节流、受 #snd 管辖、未就绪/静音一律 false 且不抛错
                          //   签名由 90-WAVE5 §5 冻结 —— 改签名要先改契约
  bgmInfo(),              // UP11/AM-015：→ { count, idx, label, file, tracks:[{file,label}],
                          //   mode, switching, pinned }。**音频未启动时也可调**（曲目表来自 SW.P，
                          //   此时 idx = -1）—— `#sw-bgm` 在 boot 期（首次手势前）就要把胶囊画出来
  setBgmTrack(i),         // UP11/AM-015：0 起下标，切歌。返回 boolean。
                          //   音频启动**之前**调 = 只记下意图（startBgm 用它取代随机首播）；
                          //   合成兜底模式（文件资产已判死）= false，不抛错
  suspend(),
  resume(),
  probe()                 // → { state, bgmGain, handGain, ambGain, lastHandPeak }（另有诸多附加读数）
};
```

**AM-010（2026-09-25，UP9）**：新增 `sfxTick(step)`（`80-ui.js` 的时间刻度尺消费）与海鸟环境层。
海鸟走 `<audio>` 元素池（同 slapPool），建池**错峰**在 slap 之后（tick 5.2 s / bird 6.5 s）——
`SLAP_DELAY` 的存在就是在证明「启动瞬间多元素并发会把 BGM 挤死」。`P.birds` 总开关。

**AM-015（2026-09-25，UP11）**：BGM 由**单曲**变**曲目列表** —— `P.bgmFile` → `P.bgmFiles`，
进页面随机一首（`80-ui.js` 的 `#sw-bgm` 可选）。每首的母带 `trim` 与真实内容时长 `trueDur`
按资产实测、存在 `10-audio.js` 的 `BGM_TRACKS` 表（**唯一真值源**）—— 换曲必须两个一起换，
否则循环接缝会塌尾静音。切歌复用**同一个** `<audio>` 元素、只换 `.src`
（`createMediaElementSource` 按元素建，换元素 = 重建 SourceNode = "接两次图"）。
`?bgm=<n>` 可钉死首播曲目（验收/断言用；随机首播本身故意不可复现）。

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
| `envSunSpread` | number | **AM-024 新增**。env 太阳亮瓣**弥散度** 0~1（0 = 夜紧致 / 1 = 白天弥散）。只被 `30-scene.js` 的亮瓣形状消费（`disc = 2.5 − 1.7·s` / `glow = 0.20 + 0.35·s`，角宽指数不动）。**必须在 `envDist()` 签名里**，否则改 s 时 env 不重烘、改动静默失效。逐键：夜段四键 0 · 白天四键 1 · 晨昏 0.5 · 入夜台阶 0.25/0.10/0.05 |

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

**AM-017（2026-09-25，UP3）**：`SW.scene` **冻结签名一字未动**，只追加**附加便利属性 / 方法**
（与 `sceneRT` / `rtCamera` 同级，不属于 §2.3 冻结面）：

```js
SW.scene.env            // 只读消费：{ ready, equirect, equirectBase, rt, rebuilds, res, err, spread, gate, deferred }
                        //   `60-water.js` 只读 ready / equirect / equirectBase，**不得重建**
                        //   `spread` 为 AM-024 D2a 追加：当前生效的 s_eff（0=夜紧致 / 1=白天弥散）
                        //   `gate` 为 AM-029 追加：当前昼夜门控 g = smoothstep(0.52,0.70,spr)
                        //     （0 = 圆斑/月亮档 · 1 = 等仰角光环/光带档）
                        //   `deferred` 为 AM-030 追加：因静默期（停稳 6 帧才烘）被推迟的累计次数（诊断读数）
                        //   🔴 **AM-031 追加 `equirectBase`** = **无光带**版（= PMREM 的 disc 源）。
                        //     自 AM-031 起 `60-water.js` **每帧按 `bandGate()` 选图** —— `g = 0`（夜段）
                        //     采 `equirectBase` ⇒ 光带**结构性为 0**，不再依赖"夜里重烘过一张"。
                        //   🔴 **AM-032 · 两张改为「满档常驻」+ 消费端混权重 （改写 AM-029/031 的选图机制）** ——
                        //     生产端不再按 `g` 烘"混好的成品"，改**恒烘两张**（内容与当帧 `g` 无关）：
                        //       `equirectBase` = **纯圆斑满档**（= `opt` 不传 / `g = 0` 那张）
                        //       `equirect`     = **纯光环满档**（= `buildEnvEquirect(s, W, H, { g: 1, band })` 那张）
                        //     ⇒ `equirect !== equirectBase` **恒成立**（原"夜段两张同一对象"的特例**作废**）。
                        //     消费端由"二选一"升级为 **`mix(base, band, uEnvMix)`**、`uEnvMix = bandGate()`
                        //     ⇒ 光带**当帧**出/消，与月亮柱 `uSunRadiance ×(1−g)` 同频（`105-UP13-fix3-band-mix.md`）。
                        //     稳态（`g ∈ {0,1}`）**逐位不变**；过渡段（`0<g<1`）允许 ≤1 ULP 差异（half 量化）。
                        //   🔴 **AM-029 L5 · 同一张 env 有两个消费者（刻意不同源）** ——
                        //     `equirect` = **水面专用**（满档光环版 → `60-water.js` 的 `uEnvEq`）；
                        //     `rt.texture` → `scene.environment` = **石头/湖底漫反射 IBL**（走 PMREM，
                        //     源是 **disc 版**、逐位等于 AM-029 之前）。
SW.scene.buildEnv(s)    // 用 TimeState 重建 equirect + PMREM；返回 boolean（是否生效）
SW.scene.dropEnv()      // 退回旧光照（envEnabled=false / 建失败）——不销毁 PMREM
```

**约束**：
① 环境贴图**必须是运行时生成的 `DataTexture`** —— `vendor/**` 与 `index.html` 逐字节零改动，
   **两条入口（免构建 / dist）都在 `file://` 下跑**，fetch / XHR / `<img>` 拉 `.hdr` 会在两条线上
   同时拿不到，不是"降级"。
② r160 **无** `scene.environmentIntensity` / `environmentRotation` → 强度走 `material.envMapIntensity`
   （在 `30-scene.js` 里用 `traverse` 设，**不碰 `40-lakebed.js`**），朝向靠"生成时就画对"。
③ 环境光**只作用于 `MeshStandardMaterial`**（= 两层鹅卵石湖底）。水面是自定义 `ShaderMaterial`，
   **不采样 PMREM 的 CubeUV RT**（r160 的 `CUBEUV_*` 定义是给内建材质注入的，自定义材质拿不到），
   改为在 `60-water.js` 里直接采样**同一张 equirect + mip 偏置**（uv 口径见 §9 `ENV_EQUIRECT_UV`）。
   视觉等价、零编译风险。`uSkyTop` / `uSkyBottom` **保留为 fallback**，env 未就绪时走旧二色渐变。


### 2.4 `40-lakebed.js` → `SW.lakebed`（所有者：WP1）

```js
SW.lakebed = { init(scene), group, causticTexture };
```

> **AM-019（UP4-lite）**：`SW.lakebed` **冻结签名一字未动** —— 湖底 tiling 贴图（程序化 albedo / roughness / macro）
> 是 `init()` 的**内部实现**，**不新增导出**。可观测的变化只有材质侧：`bedMesh.material` 多了 `map` / `roughnessMap`，
> 且 `material.color` 由 `0x5d6f66` 改 `0xffffff`（颜色移入 albedo 贴图，`P.bedTexture=false` 时回退）。
> **238 颗鹅卵石（两层 `InstancedMesh`）与 `pebble*` 参数一个字节未动** ⇒ `#14 / #15` 不受影响。
>
> **AM-020（同包修复轮）**：**冻结签名仍一字未动**。新增的 `refreshBedTexture()` 挂在 `SW.lakebed` 上，
> 属 **WP1 内部附加面**（dev 调参用、非每帧路径、`?debug=1` 面板消费）。可观测面追加：`bedMesh.material` 的
> `map`/`roughnessMap` 会被**运行时替换**，`SW.lakebed._bedTex` 记录当前贴图引用（供 `dispose` 用）。
> 鹅卵石与 LOD 仍一字未动。`refreshBedTexture()` 的读数**不等于**冷启动读数（会话内漂移 ~0.6，见 §9 口径边界）。

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
  setGlitterNear(v),      // AM-024 D2b：反光项距离权重的运行时混合 v∈[0,1]（1=生效/0=关闭）
                          //   **交付态恒 1**，只给对比出图 / 降级用；与 setRefract 同族的差分手法
  probe()                 // → { refract, normalGain, tris, envReady, envGain,
                          //     glitterNear, glitterNearMin, glitterWBottom, glitterWJ13Edge,
                          //     envTex, envMix }
};
```

**AM-017（2026-09-25，UP3）**：`probe()` 追加 `envReady`（环境反射是否在跑，降级判据 #10 读它）
与 `envGain`（`P.envWaterGain`）；`uniforms` 追加 `uEnvEq` / `uEnvReady` / `uEnvGain`
（`uEnvEq` 每帧从 `SW.scene.env.equirect` 重指 —— 重建会换贴图，同 `uHeight` 的道理）。
`setRefract` / 其余方法签名未动。

**AM-031（2026-09-29，UP13-fix2）**：`probe()` 追加只读读数 **`envTex`** ∈ `'base'` / `'band'` / `'none'`
—— 当帧水面**实际采样**的是「无光带版」还是「带光带版」（消费层门控 `bandGate()` 的选择结果），
`'none'` = env 未生效走降级。与 `SW.scene.env.equirectBase`（§2.3，AM-031 追加）配对：
`bandGate() = 0`（夜段）⇒ `'base'` **且不依赖是否重烘**（判据靠它读，见 `104 §5`）。

**AM-032（2026-09-29，UP13-fix3 · ⬜ 待施工）**：**本包改的是"怎么用两张"**。
- `uniforms` 追加 **`uEnvEqBase`**（→ `SW.scene.env.equirectBase`，无光带版）与 **`uEnvMix`**（每帧 `bandGate()`）；
  **`uEnvEq` 保留**，语义变为「**满档光环版**」（→ `SW.scene.env.equirect`，**不再二选一**）。
- FRAG 的 env 反射由"采一张"改为 **`mix(texture2D(uEnvEqBase, …), texture2D(uEnvEq, …), uEnvMix)`**。
- `probe()` 追加只读读数 **`envMix`**（0~1，带 4 位小数）；`envTex` 由二态扩为**三态**：
  `'base'`（`envMix ≤ 0`）/ `'mix'`（`0 < envMix < 1`）/ `'band'`（`envMix ≥ 1`）/ `'none'`（env 未生效）。


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

### 2.8 `80-ui.js` → `SW.ui`（所有者：WP3 → **UP10**，AM-011）

```js
SW.ui = { init(), update(dt) };   // 内部自建 DOM，不改 index.html
```

**AM-011（2026-09-25，UP10）**：`#hour` 由 `input[type=range]` 改为 `div[role=slider][tabindex=0]`
—— 24h 环上的滑动窗口刻度尺：hour 恒 `mod 24`、拖动走**位移增量**（无限拖动 / 首尾相接不需要端点特例）；
键盘方向键 / PageUp/Down / Home 与双击回 auto 全保留。刻度尺常量在 `80-ui.js` 顶部模块区
（90-WAVE5 §4 耦合 ①：**不进 `00-config.js`**）；咔嗒声经 `SW.audio.sfxTick(step)`（§2.1，判空降级）。
**`#ui` 的第一个子节点保持为左上时段面板** —— pw 的 `ui-panel` 快照盯的就是它。

**AM-015（2026-09-25，UP11）**：新增选曲控件 `#sw-bgm`（右上、`#snd` 正下方，一行「**BGM：** + 每曲一枚
并排 chip」，曲名由 `10-audio.js` 的 `BGM_TRACKS[].label` 提供）。形态**刻意是纯 `<button>`**：
曾实现为原生 `<select>`，2026-09-25 由雨桐裁决**整体回滚**（原因：原生弹层是另一个绘制层，不吃
`backdrop-filter`、不吃父元素透明底，「和 chip 一样的透明」在那条链路上做不到）。
`sw-` 前缀的辅助 id 与 `#sw-ruler-track` / `#sw-ruler-head` 同级，**不进 §4 冻结表**。
`SW.ui` 签名与 `#hour` 行为均未动；`#ui` 的第一个 div **仍是时段面板**（新控件只追加在后面）。

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
| `#hour` | 时段刻度尺（AM-011 起为 `div[role=slider]`，不再是 `input[type=range]`；DOM id 未变） | WP3 → UP10 |
| `#sw-bgm` | BGM 选曲行（「BGM：」标签 + 每曲一枚 chip，AM-015 新增） | WP3 → UP10 → UP11 |
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
  //   单颗大小**本来就不该**近大远小 —— 判据是**分布口径**，不是单颗顺序。
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
  //   grain 轨迹：0.05 → 0.02（返工轮，93 §6a）→ **0（主控终裁 2026-09-24 22:40）**——
  //   逐帧平移噪点在深色治愈系画面上呈「电视机雪花」观感（真机时间维度噪声，截图验证不出），
  //   与治愈目标相悖。管线保留，想要胶片感自行设 0.005~0.02。
  bloom: true, bloomStrength: 0.55, bloomRadius: 0.40, bloomThreshold: 0.85,
  vignetteAmp: 0.16, grainAmp: 0,

  // 环境光照（程序化 equirect + PMREM）—— AM-017 新增（UP3 落地）
  //   来源刻意**不是**外部 HDRI：r160 无 environmentRotation（13 个 keyframe 的太阳方位随小时走，
  //   固定朝向的 HDRI 只对得上其中一个）· 4 张 1K .hdr ≈ 9 MB 会撑爆单文件交付 ·
  //   **两条断言入口都在 file:// 下跑** → 只有运行时生成的 DataTexture 能通吃。见 `99-UP3-hdri.md §3-①`。
  //   envEnabled    总开关。false = 完全退回旧光照（hemi/ambient 原值 + 水面二色渐变反射）
  //   envIntensity  湖底 IBL 强度 → 逐帧写 material.envMapIntensity（r160 无 scene.environmentIntensity）
  //   envResolution equirect 宽度（高度 = 宽度/2，必须 2 的幂才能生成 mip）
  //   envWaterGain  水面反射的 env 强度。**与湖底分开**：底是漫反射 IBL、水是镜面反射，
  //                 两者对 #13（反光柱 peak/median）的作用方向相反，分开才能各自调。
  //                 取 0.75 而非 1.0：实测 1.0 会把中位亮度抬上去、#13 比值被压到 1.92（余量 1%）。
  //   envHemiScale / envAmbScale  加 env 后环境光**重复计**，把 hemi / ambient 按此比例扣回
  envEnabled: true, envIntensity: 0.9, envResolution: 128,
  envWaterGain: 0.75, envHemiScale: 0.50, envAmbScale: 0.40,
  // AM-028 新增：**白天档**水面 env 反射强度（远端反光主杠杆）。
  //   逐时 = lerp(envWaterGain, envWaterGainDay, TimeState.envSunSpread)；夜段 s=0 ⇒ 保持 0.75（护 #13）。
  envWaterGainDay: 1.35,
  // AM-024 D2a 新增：日光亮瓣弥散度的全局倍率。s_eff = clamp01(TimeState.envSunSpread × 本值)。
  //   0 = 关掉 D2a（全时段紧致亮瓣）· 1 = 设计值 · >1 = 放大弥散。
  //   ⚠ 它**不在 envDist() 签名里**（同倍率两端相乘会约掉）⇒ 30-scene 单独监听、一变强制重烘。
  envSunSpreadGain: 1,
  // AM-029 新增（L1）：**横向光带**（等仰角光环）四数打包成单字段 —— 非夜晚 env 亮瓣的形状参数。
  //   背景：非夜晚的亮瓣原是一颗「点光源圆斑」（= 假月亮），反射到水面收成一根**竖柱**；雨桐要求
  //   非夜晚要一条**横向光带**（无竖条、无圆斑）。物理入口不是把圆斑拉长，而是**换一个形状**：
  //     等仰角光环 —— 亮度只与**仰角**有关、与经度无关 ⇒ 反射向量 R 的仰角 ≈ 相机到该水点的仰角、
  //     与屏幕横坐标无关 ⇒ 反射到水面天然成**横带**（`30-scene.js: buildEnvEquirect` 的 L3）。
  //   amp    光环幅度倍率（叠在 `max(0.25, sunIntensity) × ENV_SUN_AMP` 上）
  //   elev   光环仰角（度）· sigma 光环角宽（度，高斯 σ）· detail 水面 env 采样法线里高频波的占比（L7）
  //   🔴 **常量**：只在 `buildEnv` 烘图时被读。`envDist()` 已纳入 `sunSpread01` ⇒ 逐时门控天然触发
  //      重烘；但用 debug 滑杆改这四数**要手动重烘**（`SW.scene.buildEnv`）或重启才可见。
  //   🔴 光环由昼夜门控 `g = smoothstep(0.52, 0.70, spr)` 与圆斑**互斥混合**（L4）；
  //      `g = 0`（夜段）⇒ 逐位回到圆斑版（`ampDisc === amp`），是 L5「disc 版逐位一致」的依据。
  envBand: { amp: 0.5, elev: 8.0, sigma: 1.0, detail: 0.3 },

  // 湖底贴图（程序化 tiling）—— AM-019 新增（UP4-lite）
  //   来源**不是**外部扫描件：① `file://` 下外部图片进不了 WebGL 纹理（AM-005 §3 实测 SecurityError）；
  //   ② CC0 2K 组 base64 内联 +3~10 MB，与"不膨胀体积"冲突；③ AM-005 §3 已证「照片贴图替换几何石」不划算。
  //   → 用 `document.createElement('canvas')` 运行时生成（与 `makeCausticTexture()` 同路径）：
  //     一次周期性多八度值噪声 + 低对比 cellular 出高度场，派生 albedo(sRGB) 与 roughness。
  //   以下数值块与 `src/00-config.js` **逐字对应**，改配置必须同步改这里（唯一真值源是 `src/00-config.js`）。
  //   bedTexture   总开关。false = 退回纯色湖底（material.color 回 0x5d6f66，不挂 map/roughnessMap）
  //   bedTexSize   贴图边长（**2 的幂** → 才能 generateMipmaps）；albedo 与 roughness 同尺寸
  //   bedTexScale  世界 → UV 缩放（= 每世界单位多少 UV）；**越小 tile 越大、重复越少**
  //   bedTexGrain  albedo 明暗幅度（颗粒对比）
  //   bedRoughVar  粗糙度变化幅度（湿润感：高点更光滑）
  //   bedMacroScale / bedMacroGain  macro 层（第二 UV 低频采样）—— **打破 tiling 重复感**
  //     （AM-005 §3：照片类纹理 repeat > 6 次肉眼可辨；macro 周期 ≈ 1/0.035 ≈ 28.6 世界单位
  //      ⇒ 全湖底 90 单位仅重复 ~3 次）
  //   —— 以下 5 个为 **AM-020 新增**（观感整形）——
  //   bedTexDark   暗部压缩：0 = 对称（默认，保持）；1 = 只亮不暗（曾定稿、被用户否决 ⇒ 仅作调试杠杆）
  //   bedTexSpeck  高频衰减（细点密度）：1 = 原样；越小细密噪点越少
  //   bedCellAmt   cellular 权重（cell 边界 = 暗缝网格；原值 0.14）
  //   bedTexWarp   域扭曲（整数频率 ⇒ 平铺无缝性不受影响）；**理由不是修"格子底纹"**（已证伪，见 AM-020 §4）
  //   bedTexBase   基准色明度倍率。**保持 1** —— 调亮地面会顶穿 #6（1.25 ⇒ 12.92 < 14）
  bedTexture: true, bedTexSize: 512, bedTexScale: 0.60, bedTexGrain: 0.08,
  bedRoughVar: 0.20, bedMacroScale: 0.035, bedMacroGain: 0.10,
  bedTexDark: 0, bedTexSpeck: 0.45, bedCellAmt: 0.02, bedTexBase: 1, bedTexWarp: 0.22,

  // 交互
  splash: true, cameraSway: false, swayAmp: 0.002,

  // 音频
  audioMode: 'auto', bgmVolume: 0.60, handVolume: 0.80, ambVolume: 0.50,
  duckAmount: 0.45, duckDown: 0.05, duckUp: 0.70,
  handBand: [400, 1400, 0.8], handDecay: 0.62,
  bgmFiles: ['assets/audio/bgm-mingjing.mp3', 'assets/audio/bgm-weifeng.mp3'],
  // AM-015（UP11）：BGM 单曲 → 曲目列表（进页面随机一首、前端可选）。
  //   曲名：**明镜**（bgm-mingjing.mp3）· **微风**（bgm-weifeng.mp3）—— 文件名与曲名同源
  //   （2026-09-25 由 `bgm-stillwater.mp3` / `bgm-cand1.mp3` 改名，那两名是生成期临时名）。
  //   **全库唯一的「旧名 → 新名」索引就是本行**（主控 09-25 裁决）：
  //     旧名**只**保留在历史记录类文档里（`70-REPO-BASELINE` / `40-WP4` / `50-WP5` /
  //     `80-UP1` / `91-UP5` / `92-UP6` / `98*` / `98b*`）—— 那些行记的是「当时实测到什么」，
  //     回改成新名会让文档与当时的 git 史实互相矛盾（证据降级成传闻）。**不要去"修"它们。**
  //     反之「活文档」（本契约 · `02-AMENDMENTS` · `README` · `src/**` ·
  //     `plan/audio-baseline.py` · `vite.config.mjs` · `plan/pw/dist-baseline.txt`）必须用新名。
  //   这里**只有文件名**；每首的母带 `trim` 与真实内容时长 `trueDur` 在
  //     `src/10-audio.js` 的 `BGM_TRACKS` 表里（按资产实测，`npm run audio:baseline` 复核）。
  //     换曲必须两个一起换，否则循环出点会落到错误位置 → 每圈接缝塌尾静音。
  // AM-010（UP9）：海鸟层总开关 + 鸣叫间隔区间（查验时可临时调短）+ UI 音效总线音量（第四条总线）
  birds: true, birdGapMin: 25, birdGapMax: 70, uiVolume: 0.30,

  // 反光路径（glitter path）—— AM-002 新增；AM-006 收窄白光范围
  glitterDetail: 0.16, glitterRough: 0.065, glitterJitter: 0.15,
  // AM-028 新增：**白天档**镜面粗糙度（GGX alpha）。语义：`glitterRough` 收窄为「夜段档」。
  //   抬它 = 把高光瓣摊宽 = 亮带「横向铺开」不再是细条（实测 18:30：0.065→0.20 让横向
  //   peak/median 由 1.50 → 1.33）。逐时 = lerp(glitterRough, glitterRoughDay, envSunSpread)；
  //   夜段 s=0 ⇒ **逐位 0.065** ⇒ 月柱锐度与 #13 结构上不受影响。
  glitterRoughDay: 0.20,

  // 细节波表方向 —— AM-022 新增（§2-D）。改完必须 `SW.water.rebuildWaves()` 重编着色器才生效
  //   （不在每帧路径上；debug 面板「水面波纹」组已内置防抖 + 自动调用）。
  //   swDirSpread = 双向半角（度）：0 = 各向同性（与 AM-022 之前的形态**逐位等价**）· 15 = AM-022 定稿。
  //   🔴 **AM-029（L2）：本值回到「全天常量」= 36** —— 删 `swDirSpreadDay`、不再按 `envSunSpread` 插值
  //      （`60-water.js: rawHalf()` 直返本值）。AM-025 的逐时化（夜 15 / 昼 45）作废；
  //      `quantHalf()` / `applyWaveHalf()` / 跨档重编机制**保留**（档位恒定 ⇒ 实际不再重编）。
  //      ✅ 夜段也取 36：实测 22:30 柱中−侧 82.5 → 82.4（不动），月柱位置由 `elev` 决定、与波表方向无关。
  swDirSpread: 36, swZigAmp: 0.85, swZigFreq: 0.75,

  // 调试
  debug: false
};
```

---

## 7. 文件所有权（冻结，**一票否决级**）

一个文件只能有一个所有者。**不拥有就不许改。**

| 文件 | 所有者 | 其它 WP 的权限 |
|---|---|---|
| `index.html` | **WP1** | 只读（**UP14/AM-033 授权**：改 `<title>` + 加 `#brand` DOM/CSS，`5c35c6b`） |
| `vendor/three.min.js` | **WP1** | 只读 |
| `app/index.html` | **UP1a**（构建入口镜像） | 只读（**UP14/AM-033**：`<title>`+`#brand`，`5c35c6b`；**UP17/AM-036**：加 PWA `<head>` 元信息，未开工） |
| `app/main.js` | **UP1a** | 只读（**UP17/AM-036**：末尾追加 SW 注册块，**不得新增 `import`** —— R3 顺序约束） |
| `app/public/**` | —（**UP17/AM-036** 新建） | 新建（Vite `publicDir` ⇒ 原样拷进 `dist/` 根） |
| `src/00-config.js` | **WP1** | 只读（UP11/AM-015 经主控授权改过音频段：`bgmFile` → `bgmFiles`；**UP3/AM-017 改 env 段**；**UP4-lite/AM-019 改湖底贴图段**） |
| `src/30-scene.js` | **WP1 → UP2 → UP3**（AM-017，波次 8 起移交） | 只读（`applyTimeState` 在 WP1 内实现，WP3 只提供 `TimeState`；**环境光照段属 UP3**） |
| `src/40-lakebed.js` | **WP1 → UP4-lite**（AM-019，波次 9 起移交） | 只读（UP3/AM-017 连材质都没碰，只从 `30-scene.js` 用 `traverse` 设 `envMapIntensity`；**UP4-lite/AM-019 加湖底 tiling 贴图 —— 但 `InstancedMesh` 两层 LOD 与 `pebble*` 参数一个字节未动**；**AM-020 同包修复轮：贴图观感整容 + 新增 `refreshBedTexture()` 运行时重建面 —— 鹅卵石与 LOD 仍一字未动**） |
| `src/90-debug.js` | **WP1** | 只读（读数已按 §5 暴露，WP2/3/4 只需保证自己的 probe 返回对应字段）。AM-020 在 `?debug=1` 面板新增「湖底贴图」滑杆组（10 项，140 ms 防抖重建；`bedMacroScale`/`bedMacroGain` 两项走 uniform 真·实时）；纯 dev-only，不进交付物、不改 `SW.debug` 冻结签名 |
| `src/99-main.js` | **WP1** | 只读 |
| `src/50-ripple.js` | **WP2** | 只读 |
| `src/60-water.js` | **WP2 → UP8 → UP3**（AM-017，波次 8 起移交） | 只读（UP3 只动**反射那一行 + 3 个 uniform**） |
| `src/70-input.js` | **WP2** | 只读 |
| `src/20-time.js` | **WP3** | 只读 |
| `src/80-ui.js` | **WP3 → UP10**（AM-011）**→ UP11**（AM-015） | 只读 |
| `src/10-audio.js` | **WP4 → UP9**（AM-010）**→ UP11**（AM-015） | 只读（**UP15/AM-034 授权**：划水声改造，未开工） |
| `assets/audio/*` | **WP4**（UP11 改名两首 BGM：`bgm-stillwater.mp3` → `bgm-mingjing.mp3`、`bgm-cand1.mp3` → `bgm-weifeng.mp3`） | 只读（**UP15/AM-034 授权**：仅在选「新增采样」时新增文件，未开工） |
| `src/85-fallback.js` | **WP5** | 只读（**UP14/AM-033 授权**：品牌串，`5c35c6b`） |
| `README.md` | **WP5** | 只读（**UP14/AM-033** 标题 · **UP16/AM-035** 部署节 · **UP17/AM-036** PWA 小节） |
| `netlify.toml` · `.nvmrc` | —（**UP16/AM-035** 新建） | 新建（部署配置） |
| `plan/*.md` | 记录用 | 只在 `_STATUS.md` 追加 |

### 7.1 跨包写权限授权登记（**一票否决的唯一解除方式**）

> 本表**不替代所有权**：所有权仍在原包。本表只登记「**某包在某 AM 下被临时授权写它不属于的文件**」。
> **未登记的写入 = 越权** —— `03-COLLAB-PROTOCOL §7.4` 的「本包改动文件」**不含**越权项。

| AM | 包 | 被授权写的「他包文件」 | 契约所有者 | 动作 | 状态 |
|---|---|---|---|---|---|
| AM-033 | UP14 | `index.html` · `app/index.html` | WP1 · UP1a | 改 `<title>` + 加 `#brand` DOM/CSS | ✅ 已应用（`5c35c6b`） |
| AM-033 | UP14 | `src/85-fallback.js` · `README.md` | WP5 | 品牌串 / 标题 | ✅ 已应用（`5c35c6b`） |
| AM-033 | UP14 | `package.json` | 共享 | 描述串 | ✅ 已应用（`5c35c6b`） |
| AM-034 | UP15 | `src/10-audio.js` · `assets/audio/slap1~4.wav` | WP4→UP11 · WP4 | slap 拍击采样换源 / 复核 | ⬜ 未开工（`108`） |
| AM-035 | UP16 | `package.json` · `README.md` | 共享 · WP5 | `deploy` script / 部署节 | ⬜ 未开工（`109`） |
| AM-036 | UP17 | `app/index.html` · `app/main.js` · `README.md` | UP1a · UP1a · WP5 | PWA `<head>` / SW 注册块 / PWA 小节 | ⬜ 未开工（`110`） |

### 7.2 契约偏离登记（由主控裁决后登记；**不是**「先做后报」的免罪符）

| # | 偏离 | 原条款 | 实际做法 | 裁决理由 |
|---|---|---|---|---|
| 1 | `#brand` 写进 `index.html` 而**非** JS 追加到 `#ui` | §2「所有 UI 由 JS 创建并 append 到 `#ui`，不改 `index.html` 结构」 | `#brand` 是 `index.html` 的 DOM（与 `#hint` 并列） | 它是**首屏引导文案**而非 UI 面板（与 `#hint` 同类）；换来一条 CSS 相邻兄弟选择器的**零 JS 同步**。该条款的立法意图是「防并行包抢 `#ui`」，UP14 独占 ⇒ 意图不冲突（`106 §2`） |
| 2 | `#brand` **不在** `#ui` 子树 | §2「`#ui > *` 接管指针事件」 | 自加 `pointer-events:none` | 见上；`#ui > *` 管不到它，必须自己写（否则会吃掉水面手势） |

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

## 9. 共享常量（Shared Constants）跨 WP 的数值约定

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
| `SUN_AZ_DESIGN` | **0°**（`sunAz = π`） | WP3 | WP5 | ~~±8°（晨 −8 / 午 0 / 昏 +8 / 夜 0）~~ **AM-024 N4 归零**：日光与月光一律钉在画面正中（雨桐 19:2x「日光现在会移动，你得让它不移动，就像夜晚时段在正中间一样」）。8 键的 `az` 全改 0 ⇒ 白天横向亮光**完全由 D2a 的 env 亮瓣弥散**表达，不再靠离轴方位。代价：黄昏「侧逆光」消失（已确认）。夹取机制（`SUN_AZ_SECTOR`）保留 —— `az=0` 只是设计值归零，夹取仍每帧生效 |
| `GLITTER_ELEV_BAND` | **[22°, 30°]** | WP3 | WP5 | **AM-003**：晨雾 / 黄昏 / 星夜三个低光时段的 `sunElev` 必须落在此区间（实测 shape 5.2~7.6，柱最强） |
| `GLITTER_ELEV_MAX` | **32°** | WP3 | WP5 | **AM-003**：硬上限。实测 34° → shape 1.01、38° → 0.63，`glitterSpec(22.5) > 0.5` 的悬崖在 ~40°，取 32° 留 **8° 余量** |
| `SUN_ELEV_MIN` | **`> 0`（永不为负）** | WP3 | WP5 | **AM-003 硬约束**：光源仰角恒为正。`glitterSpec()` 第一道门就是 `Ly <= 0.02 → 0`；夜间靠**月亮**（正仰角）而非 hemi 接管。**取代 AM-001 §4.3 第 5 条** |
| `MOON_INTENSITY_MIN` | **0.6** | WP3 | WP5 | **AM-003**：夜间 `sunIntensity` 下限。`60-water.js` 的 `SUN_I_FLOOR = 0.30` 只是安全网（它让 `glitterSpec` 读到 1.0 但画面柱只有 0.30 亮度 → **假通过**），不能当设计依赖 |
| `NOON_ELEV_MIN` | **33°** | WP3 | WP5 | **AM-003**：正午 `sunElev` 下限，保证 `shape × 0.15 < 0.2`。WP3 建议取 **64°**（shape 0.012） |
| `GLITTER_LAYERS` | **2**（大波纹 FBO + 高频细节法线） | WP2 | — | **AM-002**：只用单层法线做不出破碎柱，高光会连成光滑带 → 像塑料 |
| `GLITTER_PEAK_HOUR` | **22.5** | WP3 | WP2 | **AM-002**：反光路径最强出现在星夜；正午最弱（柱几乎消失）。**AM-003 补注**：柱的**实际亮度** = `glitterColor × glitterGain × sunColor × max(sunIntensity, 0.30) × BRDF` —— 黄昏的几何天然占优，可接受顺序为「昏 ≈ 夜 > 晨 ≫ 午」 |
| `HALF_H_FOV` | **`atan(tan(CAM_FOV/2) × aspect)`** | WP1 | WP3 · WP5 | **AM-003**：水平半视角。实测：16:9（**1280×720**）→ **28.53°**、16:10 → 25.66°、方形 → 16.40°、竖屏 → **12.73°**。**这是反光柱方位安全区的真实边界。** 旧文档把 16:9 写作 28.03°（那是 **1254×720** 的值，2026-09-24 订正，见 `02-AMENDMENTS.md §1.1`） |
| `PEBBLE_FIELD_Z` | **`[-3.0, -24.0]`** | WP1 | WP1d · WP5 | **AM-004**：鹅卵石场 z 范围。近边放在画面近边（−3.15）**之外** 0.15，避免底边出现「石头戛然而止」；远边取 −24（雾穿透率 < 15%） |
| `PEBBLE_FIELD_HALFW` | **`[4.51, 14.85]`** | WP1 | WP1d · WP5 | **AM-004**：场在 NEAR_Z / FAR_Z 处的**半宽**。来自 NDC 四角射线与 `y=0` 求交的实测（4.58 / 22.04），按 16:9 参考宽高比 + 10% 余量收窄 |
| `PEBBLE_LOD_Z` | **`-11`** | WP1 | WP1d · WP5 | **AM-004**：LOD 分界。近侧用高模、远侧用低模 |
| `PEBBLE_LOD_FACES` | **`[180, 80]`** | WP1 | WP1d · WP5 | **AM-004**：`Icosahedron(1,2)` 实测 **180 面 / 540 顶点**（AM-002 §6 写的 320 是错的，`PolyhedronGeometry` 细分是 `20 × (detail+1)²`）；`Icosahedron(1,1)` = 80 面 |
| `PEBBLE_TINT_SPREAD_MIN` | **0.45** | WP1 | WP5 | **AM-004**：`aTint` 的 sRGB 亮度极差下限。改前实测 **0.153**（等于没做深浅） |
| `PEBBLE_DARK_MIN` | **0.34**（sRGB 亮度） | WP1 | WP5 | **AM-004**：暗端下限。湖底基色 `#5d6f66` 亮度 **0.42**，更暗的石在水下吸收后会与湖底阴影糊在一起 |
| `PEBBLE_DENSITY_MIN` | **0.55 颗/单位²** | WP1 | WP5 | **AM-004**：清晰带（z ∈ [−3, −14]）内有效密度下限。改前实测 **0.033**，目标 0.5~1.0 |
| `PEBBLE_COVERAGE_MIN` | **0.40** | WP1 | WP5 | **AM-007**：近带（z ∈ [−3, −11]）**足迹覆盖率**下限。实测：`[0.14,0.42]` → **0.235**（稀，露底多）· `[0.25,0.90]` → ≈**1.0**（过饱和＝凝胶团块）· `[0.20,0.58]` → **0.454** ✅。**这条是唯一能量到「稀」的判据**（密度量颗数，不随尺寸变） |
| `PEBBLE_LOD_SEAM_RATIO_MAX` | **1.00**（必须 <） | WP1 | WP5 | **AM-007**：LOD 接缝的**屏幕口径**判据 —— 分界带里远层屏幕直径中位 **不得大于** 近层。实测：旧参数 **1.125**（倒挂）· 统一尺寸后预测 **0.80**。这是**分布口径**，单颗大小不可比（见 §9 注） |
| `PEBBLE_SCALE_COMMON` | **`[0.20, 0.58]`（两层同值）** | WP1 | WP1e · WP5 | **AM-007 A 修订**：`pebbleScaleNear` 与 `pebbleScaleFar` **必须取同一区间**。改动只允许成对改 |
| `MAX_CHROMA_STEP` | **2.5**（必须 <） | WP3 | WP5 | **AM-007 §5.2c**：**色度加权**色相步长上限。`chromaStep = ‖ΔH‖ × min(C_a, C_b)`，逐字段取 13 个相邻 keyframe 对的**最大**值。**色相只有在两端都有彩度时才可感知**，权重取 `min` 是保守取法（不会因一端很饱和就把另一端近灰的旋转算成一大步）。全表实测最大 **2.11**（`sun` 斜阳→黄昏）。**不要用 1.5** —— 按任何一般约定实现都会打挂 `sun`(2.11) / `gli`(2.10) / `wat`(1.92) / `sky`(1.80) |

**环境贴图自检**（AM-017 新增，改 equirect 尺寸 / 采样口径时必须重算）：

```
ENV_EQUIRECT_UV     = ( u = atan2(dir.z, dir.x)/(2π) + 0.5 ,  v = asin(dir.y)/π + 0.5 )
                       v 是**非线性**的（three 的 equirectUv() 就是这条）——
                       写成 v = dir.y*0.5+0.5 会让整张环境贴图错位、水面反射全乱。
                       DataTexture.flipY = false → 第 0 行对应 v = 0 → dir.y = −1（正下方）。
ENV_EQUIRECT_SIZE   = (envResolution, envResolution/2) = 128×64   // 必须 2 的幂 → 才能 generateMipmaps
ENV_MIP_BIAS        = clamp(uWaterRough × 8.0, 0, 4)              // 粗糙度 → mip 偏置（水面侧）
太阳瓣角宽          ≈ sqrt(2·ln2 / ENV_SUN_DEXP) = sqrt(2·ln2/300) ≈ 3.9°（半宽）
                       必须 ≳ mip1 的一个纹素（≈5.6°）量级，否则针尖瓣在 mip1 上被抹成 0
                       → 实测「峰值没起来、中位反而升」→ 反光柱判据 #13 反而变差
惰性重建阈值        ENV_EPS = 0.02（envDist 签名距离）；实测自动时钟 4s 内重建 **0** 次
```

**湖底贴图自检**（AM-019 新增 / **AM-020、AM-021 两次修订**，改贴图尺寸 / 缩放 / 噪声口径时必须重算）：

```
贴图尺寸            = (bedTexSize, bedTexSize) = 512×512     // 必须 2 的幂 → 才能 generateMipmaps
无缝条件            周期值噪声：格点索引做 mod(N) 包裹 ⇒ f(x) = f(x + N)
                     ⇒ 平铺接缝处的相邻像素差分与内部同分布
                     （验证口径：|f[N−1] − f[0]| 应 ≈ mean_i |f[i+1] − f[i]|，**不是 ≈ 0**
                       —— 采样点间隔处处相同，接缝不比内部更"跳"即为无缝）
                     **AM-020 量化地板**：判据「跨缝/内部 < 1.5」只在**内部相邻差分 > ~1 亮度级**时有效。
                     实测 grain 0.30 / speck 0.50 时内部步长只有 0.016（< 1 LSB @8bit）
                     ⇒ 绝大多数相邻对量化后相等、比值失去意义（该组实测 Y=1.962 是假报警）。
                     本包定稿的步长在 0.075 量级，判据有效（实测比值 0.873~1.133）。
                     要覆盖"极平滑"参数区，须改在**高度场 float** 上算，不能算在 8 位贴图上。
ALBEDO 均值归一      sm[k] = 1 + grain·2·(dv ≥ 0 ? dv : dv·(1−bedTexDark))，dv = h[k] − 0.5
                     sScale = (N·N) / Σ sm          // ← **AM-020：亮度守恒改为代码显式保证**
                     albedo = sm[k] · sScale        // ⇒ 与 grain / bedTexDark 取值**无关**地恒成立
                     对比 AM-019：当时靠"对称 ⇒ 均值天然为 1"的巧合；现在是**加强**守门条件。
warp 域扭曲          h += a · pvnoise(i·f/N + w1·f, j·f/N + w2·f, f, s)，w1/w2 = (pvnoise(...) − 0.5)·bedTexWarp
                     频率取**整数**（FWN = 3）⇒ 周期仍是 N ⇒ 平铺无缝性不变（已实测）。
albedo/roughness UV 用 PlaneGeometry **内建 uv** + texture.repeat.set(R, R)，R = BED_SIZE × bedTexScale
                     （走 three 标准 mipmap / aniso 路径；与 BED_SIZE / BED_SEG 天然耦合，改它需重算）
macro UV            uv = vWXZ × bedMacroScale                // **世界坐标**（第二 UV，与 map 解耦 ——
                     同一张图不能有两种 scale 的内建 uv，这是唯一必须手写采样的那一层）
tile 尺寸           = BED_SIZE / R = 1 / bedTexScale 世界单位/次
                     AM-019: 0.30 → 3.33 单位/次 ⇒ 90 单位重复 27 次
                     AM-020: 0.60 → 1.67 单位/次 ⇒ 90 单位重复 54 次（**调细以散掉斑块感**）
macro 周期          = 1 / bedMacroScale ≈ 28.6 世界单位       // 90 / 28.6 ≈ 3.1 次  ⇒ 打破规则重复
                     AM-020 实测：macro 层**换不来 #6** —— 周期 ≫ #6 采样区（几米），区内近似常数。
                       macroGain 0.12→0.34 时 #6 只动 0.04。别指望 macro 补判据余量。
亮度守恒            albedo 的 **linear 均值** = 原 material.color(0x5d6f66) 的 linear 值（由 sScale 保证）
                     **AM-021 澄清**：此式只管"albedo 的均值"，**不含** `roughnessMap` 对地面亮度的影响。
屏幕采样率          **AM-021 新增边界**：贴图在屏幕上被**缩小 2~5 倍**显示 ——
                    tile 1.67 世界单位 ≈ 250~330 屏幕像素，而贴图侧约 306 px/世界单位。
                    ⇒ 高频颗粒已被 **mipmap 平均掉** ⇒ 贴图本体的对比在最终画面里占比很小
                      （实测贴图 std 7.55→0，整幅画面 std 只动 **0.6%**）。
                    ⇒ **凡讨论"贴图改动在屏幕上是否看得见"，必须用带后期的真实画面量**，
                      不能只看贴图本体，也不能只读 `#6`。
观感与 #6 负相关  `#6` 量的是**地面 vs 鹅卵石**的区内反差 —— 实测**两根正交杠杆方向相反**：
                    ① **降 `bedTexGrain`（贴图明暗）** ⇒ 整幅 std / 亮度跨度 / 低频斑驳**三项同降**
                       （画面**真的**变平），但 `#6` **跟着降**。`grain` 曲线（60 帧中位，各档冷启动）：
                       0.25→14.95 · 0.18→14.69 · 0.12→14.51 · **0.08→14.42（AM-021 定稿）** ·
                       0.04→14.36 · 0.00→14.32
                    ② **降 `bedRoughVar`（反射斑驳）** ⇒ `#6` **升 0.40~0.47**（看似白赚），
                       但地面**平均亮度下降**（rough↑ ⇒ 镜面反射↓）⇒ 与鹅卵石反差**变大** ⇒
                       **整幅 std 反升 1.8%（17.01→17.31）、IQR 27.9→29.6** ⇒ **画面更不平**。
                    ⇒ **没有两全解**：要画面更平只有"降 grain"，并接受 `#6` 余量收窄。
                      **AM-021 后余量只剩 3.4%**（中位 14.48 对阈值 14；AM-020 时是 7.1%）
                      ⇒ 再往下压**必须先谈判据**（走变更单），不许硬吃。
                    **更正 AM-020 的一句错话**：AM-020 在此写过「`#6` 的天然位置 = 无贴图地板
                      14.85 ⇒ 这条路已到头」。**AM-021 实测证伪** —— 贴图 albedo **全均匀**（`grain 0`）时
                      `#6` = **14.32**，**比地板还低 0.52**（`roughnessMap` 一旦挂上，地面平均粗糙度就
                      偏离材质常量 0.92 ⇒ 地面亮度改变 ⇒ 与石头的反差跟着变）。
                      ⇒ **"无贴图"与"贴图全均匀"不是同一个端点；地板不是下限。**
```

**判据读数的口径边界（AM-020 §4-⑤，收口复核新增 —— 与 §9 其他算式同等强制）**：

```
跨候选比较          **必须走冷启动**（独立起页 / `plan/wp5-assert.js`）。
                    会话内切换 `SW.P` + `refreshBedTexture()` 后，`#6` 会随"已跑时长 + 已渲染帧数"
                    漂移，实测同一份配置先后读出 **15.38 / 14.74 / 14.36**（漂移 ~0.6，相对阈值 14 不可忽略）。
                    已排除的原因：不是 refreshBedTexture 失真（参数不变时 14.99 = 冷启动 14.95，
                    albedo 逐位相同 hash 1906563278）、也不是 resetP 没恢复。
                    ⇒ 调试滑杆只用于看**方向**；定稿读数一律取自冷启动断言。
```

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

> **上面的判据全是「分布口径」，不是「单颗口径」。**
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

> 这条取代原来的「原始色相步长 < 60°」。**为什么**：色相在低色度处**没有感知意义** ——
> 只旋转色相、同时把色度压到近灰（`C ≈ 0.0065`）时通道偏移仅 **±4/255**，肉眼不可见，
> 但原始色相步长会读到 **159°**（AM-007 B 的晨雾补暖就是这种情况）。原始色相步长保留为**诊断读数**，
> `SW.time.maxHueStep()` 仍可调用，但**不再作判据**。

**验证窗口自检**（AM-007 新增，跑无头断言前必须核对 —— 写错会让 az 类断言假宽松）：

```
viewport = (--window-size 的 W − 26, H − 156)        // 实测，不是 (W−26, H−100)
要 16:9 画布 → --window-size=1306,876 → 1280×720     // aspect 1.7778 · hHalf 28.53°  ✅
错值示例    → --window-size=1306,820 → 1280×664      // aspect 1.9277 · hHalf 30.51°  ❌ 差 2.5°
```
> **所有像素类判据（`R−B` 色温 / 列亮度剖面 / 湖底 std / 折射差分）必须在 `1306,876 → 1280×720` 这一个口径下取**，
> **不得混用 1280×664 的读数**（`R−B(5.5)` 两口径差 0.26，而判据带只有 12 宽）。见 AM-007 §6.3 动作 #8。

---

## 10. 变更记录

> 对 §1–§9 的任何修改在此记一行；逐项动作 / 理由 / 读数见对应变更单全文（`98b-AMENDMENTS-ARCHIVE-v1.md`、`98c-SLIM-ARCHIVE-20260925.md`）与包文档完工记录。

| 时间 | 变更 | 影响 |
|---|---|---|
| 09-23 | 初版冻结 | — |
| 09-23 | AM-001：新增 §9 共享常量；机位改高俯视（fov 34 / 俯角 25° / 地平线出画）；§5 probe 加机位字段 | WP1b/2/3/5 |
| 09-23 | AM-002：TimeState + §6 + §9 + §5 加 glitter 系列（反光路径） | WP1c/2/3/5 |
| 09-24 | AM-003：光源方位随宽高比夹取 + 6 个光源常量 + 反光柱自检 | WP3/5 |
| 09-24 | AM-004：鹅卵石段整段重写（梯形场 + 双层 LOD）+ probe 5 字段 + 7 常量 | WP1d/5 |
| 09-24 | AM-005：caustic 昼夜调制（causticStrength 语义改峰值） | WP1d/5 |
| 09-24 | AM-006：glitter 白光收窄取值 | WP2/5 |
| 09-24 | AM-007：LOD 同区间 + 验证窗口自检（H−156）+ 色相路径自检（MAX_CHROMA_STEP 2.5）+ 断言 #13 | WP1e/3b/5 |
| 09-24 | AM-009：后期管线（three-post.min.js + 65-post.js + §2.6b SW.post + post 参数段）；收口 grainAmp=0 · #2 直渲口径 · #7 改名 · #13→1.9 | UP2/主控 |
| 09-25 | AM-011：`#hour` 改 24h 环形刻度尺（签名/id 不变）；AM-014：惯性 + 中线突出层 + 命中区 padding | UP10 |
| 09-25 | AM-010：`sfxTick()` + birds/tick 资产 + 第四总线 uiGain | UP9/UP10 |
| 09-25 | AM-017：程序化 env（§2.3 附加面 env/buildEnv/dropEnv + §6 env 参数段 + 环境贴图自检）；30-scene/60-water 所有权 → UP3 | UP3 |
| 09-25 | AM-015：BGM 曲目列表（bgmFiles + setBgmTrack + `#sw-bgm` chip）；两首改名明镜/微风；BGM_TRACKS 唯一真值源 | UP11 |
| 09-25 | AM-020：湖底贴图参数 7→12 + refreshBedTexture()；湖底贴图自检大改 | 主控 |
| 09-25 | AM-021：bedTexGrain→0.08；§9 新增「观感与 #6 负相关」「屏幕采样率」边界 | 主控 |
| 09-25 | AM-022：swDirSpread/swZigAmp/swZigFreq + rebuildWaves()；13 键 fogD 全降；5.50 冷青灰；20.50 配色 | 主控 |
| 09-25 | AM-023：`20-time.js` 的 `gGain` 22.50/2.00→0.55 + 夜段四键并轨 + 白天四键归零；断言 #11 下限 0.8→0.5（判据面，非契约面） | UP13 |
| 09-25 | AM-024：`TimeState` 加 `envSunSpread`（§2.2）· §6 加 `envSunSpreadGain` · §9 `SUN_AZ_DESIGN` ±8°→**0°**（N4 az 全归 0）；`#5` 复跑 2.108（4.00 压彩度保判据） | UP13 二轮 |
| 09-25 | AM-025：§6 加 `swDirSpreadDay`（波表方向逐时化，`swDirSpread` 语义收窄为夜段档）；`20-time.js` 白天 `gGain` 0→0.12 + 夜段 `sun` 彩度 0.034→0.012、`gli`→0.006 + 日光色温单调化 + 18.50 降曝光；`30-scene.js` `D2A_DISC_DROP` 1.7→0.9 | UP13 三轮 |
| 09-25 | AM-026~028：§6 加 `envWaterGainDay` / `glitterRoughDay`（两者都逐时化，夜段逐位不变）；`20-time.js` 黄昏 `spr`→1.0 + `sun` 橙→白直通 + 5.50 `sun`/`gli` 压彩度（去绿/转白）+ 白天 `gli` 单调 + 白天/黄昏 `gGain`→0.28；**5.50 色调整族**（为救 `R−B(5.5)`） | UP13 四轮 |
| 09-29 | AM-029：§6 加 `envBand {amp,elev,sigma,detail}`（横向光带四数合一）· **删 `swDirSpreadDay`**（`swDirSpread` 回到全天常量 **36**）· §2.3 加只读面 `env.gate`；`30-scene.js` 等仰角光环 + 昼夜门控 `smoothstep(0.52,0.70,spr)` + **石头 IBL 隔离**（`env.equirect` 带光带 / `scene.environment` 走 disc 版）；`60-water.js` 镜面**非夜晚精确归零**（`uSunRadiance ×(1−g)`）+ env 采样法线解耦（`uEnvDetailW`）；`20-time.js` 昼段 `gGain` 归 0（死数清理） | UP13 五轮 |
| 09-29 | AM-030：`30-scene.js` 删 env「终身 40 次重建配额」→ 改「停稳 `ENV_SETTLE_FRAMES = 6` 帧才烘 + **成功才提交** `_envLast`」；§2.3 只读面加 `env.deferred`（`env.rebuilds` 降为诊断计数） | UP13-fix1 |
| 09-29 | AM-031：§2.3 加 `env.equirectBase`（无光带版）· §2.6 加 `probe().envTex`（二态）；`60-water.js` 每帧按 `bandGate()` 选图 ⇒ 夜段光带**结构性为 0**、不依赖重烘 | UP13-fix2 |
| 09-29 | AM-032：§2.3 两张改为「**满档常驻**」（`equirect` = 纯光环 `g=1` / `equirectBase` = 纯圆斑，与当帧 `g` 无关）· §2.6 加 `uEnvEqBase` / `uEnvMix` / `probe().envMix`，`envTex` 扩为**三态**；消费端 `mix(base, band, bandGate())` ⇒ 光带与月亮柱**同频** | UP13-fix3 |
| 09-29 | AM-033：产品名 → `静湖微澜 · Serene Ripple Lake`（**非契约面**：`<title>` / README / package.json 描述 / 兜底页串）；**新增 §7.1 跨包写权限授权登记 + §7.2 契约偏离登记**（登记 UP14 的 2 处偏离） | UP14 |
| 09-29 | AM-034：登记 §7.1 —— UP15 获权写 `src/10-audio.js` / `assets/audio/slap1~4.wav`（**slap 换源规格待雨桐**，未开工） | UP15 |
| 09-29 | AM-035：登记 §7.1 —— UP16 获权写 `package.json` / `README.md`（Netlify 部署配置，**新增 `netlify.toml` / `.nvmrc`**，未开工） | UP16 |
| 09-29 | AM-036：登记 §7.1 —— UP17 获权写 `app/index.html` / `app/main.js` / `README.md`；**新增 `app/public/**`**（PWA manifest + SW + 图标）。**范围裁定：只改构建入口 `app/index.html`，不动免构建入口根 `index.html`**（PWA 在 `file://` 不生效；根入口引用 manifest 会产生 `requestfailed` 污染 `netErrors`） | UP17 |
