# WP2 · 水体折射 + 波纹系统 + 划水交互

> ✅ **AM-001 §4.2 + AM-002 §7.2 已应用**（2026-09-24 00:33，WP2 本体交付）。
> 前置的 WP1c（AM-002 §7.1，`00-config.js` 加 3 个 glitter 字段）同批完成。
> 给 WP3 的两条硬约束与留给 WP5 的判据修订，见 `plan/_STATUS.md` 与 `02-AMENDMENTS.md §8`。
>
> 所有者文件：`src/50-ripple.js` `src/60-water.js` `src/70-input.js`
> 前置：**WP1 完成**（需要 `SW.scene` / `SW.lakebed` / `SW.P` / stub 已就位）
> 预计：1.5 天水体 + 1 天波纹 = 2.5 天
> **★ 本项目最关键路径，也是最难的一个包。建议独占一个聊天框。**

---

## 1. 一句话目标

**透过水能看见被波纹扭曲的鹅卵石；点击/拖动产生可传播、可干涉、自然衰减的涟漪。**

---

## 2. 开工前必读

1. `plan/01-CONTRACT.md` §2.5 §2.6 §2.7（你的三个 API 签名）+ §7 文件所有权
2. `plan/00-INDEX.md` §6 风险 #1 #2 #4

**你只拥有 `50-ripple.js` / `60-water.js` / `70-input.js` 三个文件。**
如需改 `30-scene.js`（例如加 RenderTarget）→ **不允许**，`sceneRT` 已由 WP1 在 `SW.scene` 里建好，你只读。

---

## 3. 渲染管线（4 个 pass）

```
[1] sceneRT  ── 湖底 + 鹅卵石 + 焦散 ──→ WebGLRenderTarget(RGBA + DepthTexture, NEAREST)
                                              │
[2] 天空 pass ── 渐变 + 太阳盘 ────────────────┤
                                              │
[3] 水面 pass ── ShaderMaterial ←─────────────┘
       顶点：位移 = 采样波纹高度场
       片元：折射(采样 sceneRT，uv 按法线偏移)
             + 菲涅尔 + 高光 + 天空反射 + 深度吸收
                                              │
[4] 合成 + ACESFilmicToneMapping + 曝光（WP1 已配）
```

### ⚠️ 三条铁律

1. **水面只在主 pass 画，绝不进 sceneRT** —— 否则自反馈噪声。
2. **DepthTexture 过滤必须 `NEAREST`** —— 用 `LINEAR` 会静默全白。
3. **sceneRT 与主 pass 必须共用同一个 camera 的投影** —— 否则鹅卵石错位/游动。

---

## 4. 波纹：波动方程 FBO ping-pong

### 4.1 为什么不用「shader 内 N 个解析涟漪」

| 方案 | 互相干涉 | 自然衰减 | 源数量 | 成本 |
|---|---|---|---|---|
| N 个解析圆形涟漪 | ❌ 不能 | ❌ 只能按时间淡出 | N ≤ 4 | 随 N 线性增长 |
| **波动方程 ping-pong** | ✅ 天然干涉 | ✅ 物理衰减 | 无上限 | **固定 1 次全屏 pass** |

"波纹互相干涉"正是治愈感的核心 —— 所以选波动方程。

### 4.2 离散化

```
h_new = 2·h - h_prev + c²·∇²h
然后 h_new *= 0.996        // 阻尼
```

| 项 | 值 | 参数 |
|---|---|---|
| 高度场尺寸 | 512²（移动 256） | `P.fieldSize` |
| 传播速度 c | 3.2 u/s | `P.rippleSpeed` |
| 阻尼 | 0.996 | `P.rippleDecay` |
| 生命周期 | 4.5 s | `P.rippleLifetime` |
| 环距 | `2π/k ≈ 0.70u` | `P.rippleWaveK = 9.0` |

**稳定性**：显式差分要求 `c·dt/Δx ≤ 1`（CFL 条件）。`fieldSize=512` 覆盖 26 单位 → `Δx ≈ 0.051`；
`c=3.2`、60fps `dt=0.0167` → `c·dt/Δx ≈ 1.05`，**略微超界**。
处理：`dt` 钳到 `0.05` 上限（WP1 的渲染循环已钳），并在 `step()` 里把 `c²` 乘一个 `dtScale` 归一化到 60fps。
若出现高频自激振荡（画面"沸腾"），优先降 `P.rippleSpeed` 到 2.4。

### 4.3 实现要点

```js
// 双 RT 交替，各自带 NEAREST 过滤
rtA = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, ... });
rtB = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, ... });
// 全屏 quad + 一个正交相机（或 THREE.PlaneGeometry(2,2) + 默认相机）
// step(): 读 rtA → 写 rtB，渲染到 RT；然后 swap
```

**注入涟漪**（世界坐标 → 纹素坐标）：

```js
emit(x, z, amp) {
  const u = (x / P.rippleArea + 0.5);   // → 0..1
  const v = (z / P.rippleArea + 0.5);
  // 在 FBO 里画一个高斯凹陷：h -= amp * exp(-d²/2σ²)
  // 或用一个小的 Sprite/Plane 走 additive 混合
}
```

`emit` 必须能**在两次 step 之间被调用多次**（连续拖动），不能每帧只支持一个源。

### 4.4 水面着色器怎么用高度场

- **顶点**：`position.y += texture2D(uHeight, uv).r * amp`
- **法线**：片元里取 `∂H/∂x, ∂H/∂z`（中心差分），乘 `P.normalGain`

### 4.5 参数护栏（⭐ 别做成"金属盆"）

| 参数 | 上限 | 超了会怎样 |
|---|---|---|
| `rippleWaveK` | 9.0（环距 ≥0.70u） | 环太密 → 视觉发神经、像微波炉 |
| 同场活跃源 | ≤ 8 | 满屏同心圆 → "涟漪乱炖" |
| `rippleAmp` | 0.09 | 水下全在游动，像水床 |
| `normalGain` | 2.4 | 法线过强 → 水面变金属 |

**还要留安静带**：近岸水动、远水安静。这是审美项，也是对性能和观感的双重保护。

---

## 5. 水体折射

### 5.1 做法

1. 湖底场景（`SW.lakebed.group`）渲到 `SW.scene.sceneRT`，带 `DepthTexture`
2. 水面片元里：
   - 用波纹法线偏移屏幕 uv → 采样 `sceneRT` → 得到"被扭曲的湖底"
   - 菲涅尔项混合「折射色」与「天空反射色」
   - 用 depth 差做**深度吸收**（水越深越蓝绿、越不透明）

### 5.2 分步调试法（**强烈建议**）

不要一次写完整个 shader。按这个顺序，每步都能看到东西：

| 步骤 | 现象 |
|---|---|
| a. 水面着色器输出 `sceneRT` 原图 | 看到**没有水感的湖底**（说明 RT 通了） |
| b. 加固定 uv 偏移（`uv + vec2(0.01, 0)`） | 湖底整体平移，无扭曲（说明采样对） |
| c. 换成波纹法线偏移 | 湖底被波纹扭曲 ← **关键一步** |
| d. 加菲涅尔 | 掠射角处变亮、正下方透明 |
| e. 加深度吸收 | 深水变蓝绿 |
| f. 加高光 | 太阳方向出现波光 |

每步都要能独立回退。**卡住时把 `P.debugScene` 打开全屏显示 sceneRT**，先确认 RT 本身是对的。

---

## 6. 划水交互（`70-input.js`）

| 事件 | 行为 |
|---|---|
| `click` | raycast → 强涟漪（`amp × P.clickAmp`）+ `SW.bus.emit('splash', {x,z,speed01:1})` |
| `drag` | 沿轨迹**限流**发射小涟漪：位移 ≥ `P.dragStep`(0.35u) 且间隔 ≥ `P.dragMinInterval`(33ms) |
| 指针速度 | 做一阶低通滤波（`P.cursorDamp = 14`）→ 归一化到 `speed01` |
| 触摸 | 走与鼠标同一条路径（用 Pointer Events 一套搞定） |

**速度耦合**：`speed01` 同时影响 ① 涟漪振幅 ② 传给音频的强度。这样"划得快声音大、波纹大"。

```js
// 事件解耦：input 只负责发事件，音频由 WP4 订阅
SW.bus.emit('splash', { x, z, speed01 });
SW.ripple.emit(x, z, P.rippleAmp * speed01);
```

---

## 7. 验证判据

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | 折射确实在扭曲鹅卵石 | `SW.water.setRefract(true/false)` 两帧在水下区域**像素差 > 阈值** |
| 2 | 涟漪可干涉 | 同点连点两次，能看到波纹交叠后继续传播 |
| 3 | 涟漪会衰减 | `emit(); __clock(t + 4.6); SW.ripple.active === 0` |
| 4 | 无 NaN | `SW.debug.probe().anyNaN === false` |
| 5 | 三角面预算 | `tris < 60000` |
| 6 | 划水事件在发 | `SW.bus.on('splash', p => console.log(p))` 看得到 |
| 7 | ✨ 不金属、不沸腾 | **自己看**（主判据） |

**只跑一次断言**，别反复截图对比。

---

## 8. 常见坑

| 坑 | 症状 | 解法 |
|---|---|---|
| RT 相机不一致 | 鹅卵石错位、随波纹"游动" | 确认 sceneRT pass 用同一 camera 的投影矩阵 |
| 水面画进自己 RT | 画面噪点、自反馈 | 渲染 sceneRT 前 `water.visible = false` |
| depth 纹理 LINEAR | 水面全白 | 必须 `NEAREST` |
| 波纹"沸腾" | 高频自激振荡 | 降 `P.rippleSpeed`，检查 CFL |
| 波纹看不见 | 高度场全零 / 采样 uv 错 | 先把高度场直接当颜色输出到屏幕上确认 |
| FloatType 不支持 | 全黑 / 报错 | 退回 `HalfFloatType`；查 `renderer.capabilities` |
| 移动端掉帧 | < 30fps | `fieldSize` 降到 256 |

---

## 9. 完成后

1. `plan/_STATUS.md` 追加一行
2. 删掉临时脚本
3. 通知我：**WP2 完成**
4. 等 WP3 / WP4 汇合后开 WP5
