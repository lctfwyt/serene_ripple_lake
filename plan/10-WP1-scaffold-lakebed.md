# WP1 · 脚手架 + 湖底鹅卵石

> 🛑 **未应用变更单：AM-001 · AM-002 · AM-004 · AM-005 · **AM-007 A****
> **本包已交付，代码在五张变更单里被修改**：
> - `src/30-scene.js` 机位 · `src/90-debug.js` probe 字段 → 由 **WP1b** 执行（✅ 已完成）
> - `src/00-config.js` 追加 `glitterDetail` / `glitterRough` / `glitterJitter` → 由 **WP1c** 执行（✅ 已完成）
> - `src/00-config.js` + `src/40-lakebed.js` + `src/90-debug.js` 的**鹅卵石段整段重写** → 由 **WP1d** 执行（✅ 已完成，判据 7/7）
> - `causticDayMod` / `causticNightFloor` 昼夜调制 → 由 **WP1d** 执行（✅ 已完成，机制待命 —— `caustics` 仍为 `false`）
> - **`src/00-config.js` 的 `pebbleScaleFar` / `pebbleScaleNear` 改值（LOD 尺度统一）** → 由 **WP1e** 执行
>   （第一轮 ✅ 已改 `Far`；**第二轮 ⬜ 待补 `Near`**，见 `plan/02-AMENDMENTS.md` **AM-007 §2（2026-09-24 修订）§6.1**）
>
> **不要重做本包。** 另：本文件 §4.4 的机位表与「地平线 0.42–0.50」判据**已被 AM-001 作废**，以 `01-CONTRACT.md §9 共享常量` 为准。
> **AM-004 已作废的旧口径**：本包正文里的 `pebbleCount: 100` / `pebbleArea: 26` 圆盘采样**全部作废** —— 实测只有 31/100 颗落在画面内，有效密度 0.033 颗/单位²。
> **AM-007 A 的留痕（2026-09-24 修订）**：`pebbleScaleFar` 初版 `[0.35, 0.80]`（中位 0.575 = near 0.28 的 **2.054×**）
> → 分界带屏幕直径比 **1.125**，远侧反而更大。**契约 §6 已定：两层必须同为 `[0.20, 0.58]`。**
> ⚠️ `pebbleScaleNear/Far` 只允许**成对**改 —— 只改一层必然造出倒挂。

> 所有者文件：`index.html` `vendor/three.min.js` `src/00-config.js` `src/30-scene.js`
> `src/40-lakebed.js` `src/90-debug.js` `src/99-main.js` + **12 个 src 文件的空壳 stub**
> 前置：**无**（本项目第一个工作包）
> 预计：0.5 天脚手架 + 1 天湖底

---

## 1. 一句话目标

**双击 `index.html` 能打开，湖底铺着鹅卵石，静止画面已经能读出"这是个湖"。**

---

## 2. 开工前必读

1. `plan/00-INDEX.md` §5 全局技术决策（**不要在聊天框里重新讨论**）
2. `plan/01-CONTRACT.md` 全文（尤其 §2 签名、§6 参数表、§7 文件所有权）

---

## 3. 本包的交付清单

### 3.1 目录结构

```
D:\projects\still_water\
├── index.html
├── vendor\
│   └── three.min.js              # r160 UMD，669884 bytes
├── src\
│   ├── 00-config.js              ← 本包
│   ├── 10-audio.js               ← stub
│   ├── 20-time.js                ← stub
│   ├── 30-scene.js               ← 本包
│   ├── 40-lakebed.js             ← 本包
│   ├── 50-ripple.js              ← stub
│   ├── 60-water.js               ← stub
│   ├── 70-input.js               ← stub
│   ├── 80-ui.js                  ← stub
│   ├── 85-fallback.js            ← stub（空）
│   ├── 90-debug.js               ← 本包
│   └── 99-main.js                ← 本包
└── plan\
```

### 3.2 下载 Three.js —— ✅ **已预下载，跳过此步**

`vendor/three.min.js` **已经就位并校验通过**，本包不需要再下载。直接校验即可：

```bash
cd "D:/projects/still_water"
stat -c %s vendor/three.min.js          # 期望 669884
sha256sum vendor/three.min.js           # 期望 170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa
```

**两个校验值必须同时对上**：

| 项 | 值 |
|---|---|
| 字节数 | **669884** |
| sha256 | **170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa** |

> 若日后需要重新下载（版本必须锁 r160，**不可升级**）：
> ```bash
> curl -L -o vendor/three.min.js https://unpkg.com/three@0.160.0/build/three.min.js
> ```
> r161 及以后 `build/three.min.js` 返回 404（UMD 构建被移除，只剩 ESM）。
> 注意 r160 的该文件开头有一行 `console.warn(...deprecated...)` —— **这是正常的**，不是错误。
> 若拿到约 44 bytes 的文件，说明拿到的是 404 页面。

---

## 4. 关键实现

### 4.1 `index.html`（本包写死，**其它 WP 不得改**）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>静水 · still water</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b1418;
    font-family:"PingFang SC","Microsoft YaHei","Source Han Sans SC",system-ui,sans-serif;}
  #c{display:block;width:100%;height:100%;}
  #ui{position:fixed;inset:0;pointer-events:none;}
  #ui > *{pointer-events:auto;}
  #hint{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);
    color:rgba(255,255,255,.72);font-size:13px;letter-spacing:.14em;
    opacity:0;transition:opacity .8s ease;}
  #hint.on{opacity:1;}
  /* WebGL 不可用时的静态兜底 —— 先写，别等出事再补 */
  #fallback{position:fixed;inset:0;display:none;
    background:linear-gradient(180deg,#8fb8c9 0%,#4a7d92 46%,#1d3b47 100%);}
  #fallback.on{display:block;}
</style>
</head>
<body>
<div id="fallback"></div>
<canvas id="c"></canvas>
<div id="ui"></div>
<div id="hint">轻触水面</div>

<script src="vendor/three.min.js"></script>
<script src="src/00-config.js"></script>
<script src="src/10-audio.js"></script>
<script src="src/20-time.js"></script>
<script src="src/30-scene.js"></script>
<script src="src/40-lakebed.js"></script>
<script src="src/50-ripple.js"></script>
<script src="src/60-water.js"></script>
<script src="src/70-input.js"></script>
<script src="src/80-ui.js"></script>
<script src="src/85-fallback.js"></script>
<script src="src/90-debug.js"></script>
<script src="src/99-main.js"></script>
<script>
  // 启动：try/catch 兜底，失败就显示 #fallback，不要白屏
  try { SW.boot(); }
  catch (e) {
    console.error('[still_water] boot failed', e);
    document.getElementById('fallback').classList.add('on');
    document.getElementById('c').style.display = 'none';
  }
</script>
</body>
</html>
```

> 字体说明：中文走**系统字体栈**。`@font-face` 从 `file://` 加载本地字体在 Chrome 有 CORS 风险，中文 web font 又动辄 3–8MB，不划算。

### 4.2 stub 文件模板（**本包最重要的产出**）

每个不属于本包的文件，都建一个只含**冻结签名 + 空实现**的 stub，例如：

```js
// src/50-ripple.js  —— 所有者：WP2
(function (SW) {
  SW.ripple = {
    heightTexture: null,
    active: 0,
    init(renderer) {},
    emit(x, z, amp) {},
    step(dt) {},
    probe() { return { active: 0, fieldSize: SW.P.fieldSize, lastEmitAt: 0 }; }
  };
})(window.SW = window.SW || {});
```

**签名必须逐字对齐 `01-CONTRACT.md` §2。** 有了这套 stub：
- `99-main.js` 的渲染循环可以立刻跑通（全部是空操作）
- WP2/3/4 在各自聊天框里只需**整个替换自己的文件**，不需要改任何其它文件

### 4.3 事件总线（写在 `00-config.js` 里）

```js
SW.bus = {
  m: {},
  on(k, f) { (this.m[k] = this.m[k] || []).push(f); },
  off(k, f) { const a = this.m[k]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } },
  emit(k, p) { const a = this.m[k]; if (a) for (const f of a.slice()) f(p); }
};
```

### 4.4 机位与构图（⭐ 决定"读不读得出湖"）

| 项 | 值 | 说明 |
|---|---|---|
| 相机 | `PerspectiveCamera(fov=42, near=0.1, far=400)` | **fov 42**。广角会让近处水面拉伸失真，像"斜面"不像"湖面" |
| 高度 | `camera.position.set(0, 1.15, 3.4)` | 人眼俯视湖面的姿态 |
| 俯角 | 向下约 12–18° | |
| 地平线 | 落在画面 **0.42–0.50** 高度处 | 太高像俯拍地图，太低看不到水面纵深 |
| 湖底 | 平面 y = 0，向下延伸 | |
| 水面 | y ≈ 1.55 | 水位 |

**验收**：截一张静止画面，遮住标题，问自己"这是湖吗？" —— 如果读成"金属板"或"地板"，改机位，不要改材质。

### 4.5 鹅卵石（⭐ 别做成一盆复制蛋）

> ⛔ **本节已被 AM-004 取代**（圆盘采样 → 可见梯形场 + 双层 LOD + 5 档调色板）。
> 下面几条原则**仍然有效**（几何形变方式、半埋、`seed` 复现），但**字段名与实例化方式以 AM-004 §5.1 为准**。
> `P.pebbleCount` → `P.pebbleCountNear` / `P.pebbleCountFar`；单个 `InstancedMesh` → `pebbles` + `pebblesFar` 两层。

- 几何：`IcosahedronGeometry(1, 2)` → **实测 180 面 / 540 顶点**（近景层）；`IcosahedronGeometry(1, 1)` = 80 面（远景层）
- 实例：`InstancedMesh(geo, mat, P.pebbleCountNear)` 与 `InstancedMesh(geoLow, matLow, P.pebbleCountFar)`
- 每实例随机：非均匀缩放（y 压扁到 `P.pebbleFlatten`）+ 随机旋转 + **调色板颜色（`P.pebblePalette`）** + roughness ∈ `P.pebbleRough`
- **关键**：形变用**世界位置键控的静态噪声**，而不是每颗各自随机形变 —— 否则 100 颗长得一模一样
- 鹅卵石**半埋入**湖底面（y 偏移到只露出 60–70%）
- 随机源只用 `mulberry32(P.seed)`，**不用 `Math.random()`**（否则无法复现断言）
- ⚠️ **`aTint` 必须是线性空间的颜色**（AM-004 §2.3）—— 直接塞 sRGB 值会让深浅对比整个被吃掉

```js
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

### 4.6 `applyTimeState(state)`（**本包实现，WP3 只提供数据**）

按 `TimeState` 字段逐个赋值。这是把「光照」从并行冲突里拆出去的关键设计：

```js
applyTimeState(s) {
  sun.position.setFromSphericalCoords(50, Math.PI / 2 - s.sunElev, s.sunAz);
  sun.color.setRGB(...s.sunColor);
  sun.intensity = s.sunIntensity;
  hemi.color.setRGB(...s.hemiSky);
  hemi.groundColor.setRGB(...s.hemiGround);
  hemi.intensity = s.hemiIntensity;
  fog.color.setRGB(...s.fogColor);
  fog.density = s.fogDensity;
  renderer.toneMappingExposure = s.exposure;
  SW.bus.emit('timechange', s);
}
```

### 4.7 `?debug=1` 面板（**第一天就写**）

没有它，WP5 的断言不可信。默认（无参数）**不创建任何 DOM**。
读数表见 `01-CONTRACT.md` §5。

---

## 5. 验证判据

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | `file://` 双击打开无白屏 | 直接双击 |
| 2 | console 无报错 | DevTools Console |
| 3 | `THREE.REVISION === '160'` | Console 输入 |
| 4 | 静止画面能读出"湖" | 自己看一眼（**这是主判据**） |
| 5 | `renderer.info.render.triangles < 60000` | `?debug=1` 看 `tris` |
| 6 | 鹅卵石不是一盆复制蛋 | 自己看一眼 |
| 7 | 12 个 stub 文件签名与契约逐字一致 | 对照 `01-CONTRACT.md` §2 逐个核 |

**不要截图自证。** 第 4、6 条你自己看，然后把问题告诉我。

---

## 6. 常见坑

| 坑 | 症状 | 解法 |
|---|---|---|
| Three 版本错 | `three.min.js` 只有几十 bytes | 必须 r160，r161+ 该文件不存在 |
| 黑屏 | 相机在物体内部 / 光照为 0 | 先加 `AmbientLight(0xffffff, 0.6)` 确认能看见东西 |
| 色彩异常 | 颜色发灰或过曝 | r160 用 `outputColorSpace`（`SRGBColorSpace`），**不是** `outputEncoding` |
| `file://` 报 CORS | module 加载失败 | 确认**没有**用 `type="module"` |
| stub 签名写错 | 后续 WP 报 `undefined is not a function` | 逐个对照契约 |

---

## 7. 完成后

1. 在 `plan/_STATUS.md` 追加一行
2. 临时的 `_*.js` / `_*.py` 删掉
3. 通知我：**WP1 完成，可以开波次 1 了**
4. 下一波：WP2 / WP3 / WP4 各开一个聊天框（或 WP1+WP2 同一个聊天框连续做）
