# UP4-lite —— 湖底程序化 tiling 贴图

> 变更单：**AM-019**　·　波次：**9**　·　前置：**UP3 ✅**（`30-scene.js` / `60-water.js` 已解锁，本包不碰它们）
>
> ⚠ **本包重定义了 UP4。** 原 UP4（`60-UPGRADE-ROADMAP.md §3-UP4`）= 「外部 CC0 PBR 贴图**替换**湖底
> + 实例数 **238 → ~40**」——那会**消灭两层 LOD → 废掉断言 #14 / #15**（= AM-007 二次修订），
> 并动到路线图 §1「保护清单」里的 `InstancedMesh 两层 LOD`。
>
> **雨桐 2026-09-25 裁决**改为：**湖底平面加一张程序化 tiling 贴图，鹅卵石两层 LOD 原样不动。**
> 收益（湖底地面有纹理）保留；代价（废断言 / 动保护清单 / 涨体积）全部躲开。
>
> **与 `60-UPGRADE-ROADMAP.md §3-UP4` 冲突处，一律以本文为准**（那是 09-24 的提案稿）。

---

## §0 需求原文

雨桐 2026-09-25：

> 「有没有可能在海底贴一整张鹅卵石的图？我也觉得没必要每个石头贴图，如果是每个石头就还是程序化细节，不要膨胀体积。」

**主控复读 `AM-005 §3` —— 这才是「之前不建议贴图」的真出处**：

- ❌ 当初否的是 **「用铺满鹅卵石的图片 *替换 / 补充* 几何石」**，**不是"贴图"本身**；
- ✅ 原文末句留了后门：**「可借用的是程序化 canvas 纹理给远景补密铺底噪，*不是替换近景几何*」**；
- → 雨桐的方案正好踩在这后门上：**几何石保留**（= 程序化细节）· **湖底平面加 tiling 贴图**（= 补底噪）·
  **不膨胀体积**（= 程序化生成、零外部资产）。

---

## §1 你拥有的文件（白名单）

| 文件 | 权限 | 说明 |
|---|---|---|
| `src/40-lakebed.js` | ✅ 所有者（**WP1 → UP4-lite**） | 新增程序化贴图生成 + 挂到 `bedMat`；**不动 InstancedMesh、不动 caustic 公式** |
| `src/00-config.js` | ✅ 所有者（**湖底贴图段**） | 新增参数组 |
| `plan/01-CONTRACT.md` | §2.4 注 · §6 · §7 · §9 · §10 | 分段改 |
| `plan/02-AMENDMENTS.md` | AM-019 那一行 | 只写自己的 |
| `plan/100-UP4-lite.md` | ✅ 本文 | 完工记录写这里 |
| `plan/_STATUS.md` | 只**追加**一行 | 不改别人的行 |

**禁止碰**：

- 🔴 `InstancedMesh` 相关任何行（两层 LOD 是路线图 §1「保护清单」项）→ 碰了 `#14 / #15` 必红；
- 🔴 `src/40-lakebed.js:211-352`（鹅卵石场 / 调色板 / 采样）与 `:36-65`（caustic 生成）—— **只读**；
- `index.html`（**零改动**）· `vendor/**`（**零改动**）· `src/30-scene.js` / `src/60-water.js`（UP3 已收工，本包无关）；
- `src/90-debug.js`（滑杆由主控另加，**不占本包额度**）· `src/10-audio.js` · `src/80-ui.js`；
- 冻结件 `plan/wp5-assert.js` / `plan/wp5-env.js` · **断言阈值一律不许改** · `plan/pw/**`（基线由主控重录）。

---

## §2 现状（已替你查好）

| 位置 | 内容 |
|---|---|
| `src/40-lakebed.js:272-279` | 湖底 = **单一** `PlaneGeometry(90, 90, 48, 48)`，逐顶点 `bedY(x,z)` 起伏（正弦状，`0.105·n1 + 0.034·n2`） |
| `src/40-lakebed.js:116-150` | `makeBedMaterial()` = `MeshStandardMaterial({color:0x5d6f66, roughness:0.92, metalness:0})` + caustic `onBeforeCompile` |
| `src/40-lakebed.js:68-85` | `injectWorldVarying(shader)` —— 已经给 fragment 提供了 **`vWXZ`**（世界 xz）与 `vWPos`。**贴图 UV 直接用世界坐标**（避免依赖 `PlaneGeometry` 的 0..1 uv） |
| `src/40-lakebed.js:36-65` | `makeCausticTexture()` —— **无缝平铺的现成范式**：频率全取整数倍 ⇒ u,v 上周期为 1 ⇒ 平铺无缝；**不用 `Math.random`** |
| `src/40-lakebed.js:14-32` | `h2(ix,iy,s)` 确定性值噪声 hash —— 贴图生成可复用它（**需加周期包裹**，见 §4-①） |
| 238 颗鹅卵石（88 + 150） | 两层 `InstancedMesh` —— **本包一个字节不动** |
| 断言 #14 / #15 | LOD 接缝比 / 覆盖率 —— 量的是**鹅卵石屏幕直径与足迹**，与 `bedMat` 无关 ⇒ **本包天然不碰它们** |
| 断言 #6 | 湖底可读（60 帧中位 `sMed > 14`）—— **唯一的直接风险点**（见 §5） |

### 关键推论

1. **结构上是填空题，不是改造题**：湖底平面 + 一张 `MeshStandardMaterial` 已就位，加 `map` / `roughnessMap`
   就是挂到同一张材质上。**不需要动几何、不需要动 LOD、不需要动断言**。
2. **UV 口径分两层**：`albedo` / `roughness` 走 `PlaneGeometry` **内建 uv + `texture.repeat.set(R,R)`**
   （`R = BED_SIZE × bedTexScale`）—— three 的标准 mipmap 路径，掠射角下不至于糊；
   **只有 macro 层**用世界坐标 `vWXZ × bedMacroScale` 手写采样（同一张图不能有两种 scale 的内建 uv ⇒
   第二 UV 只能手写）。caustic 本来就走 `vWXZ`，所以 `injectWorldVarying` 复用即可。

---

## §3 AM-005 §3 四条反对的逐条复核（**这是本包的立项依据，必须先过这一关**）

| AM-005 §3 的反对理由 | 针对什么 | 对本包是否仍成立 | 处理 |
|---|---|---|---|
| `file://` 下外部图片进不了 WebGL 纹理（实测：`img.onload` ok，但 2D `getImageData` / `texSubImage2D` 抛 `SecurityError`） | 外部 CC0 图片 | ✅ **仍成立** | **本包不用外部图片** —— `document.createElement('canvas')` 生成，与 `makeCausticTexture()` 同路径 ⇒ `file://` 天然可用、两入口天然一致 |
| 俯角 25° ⇒ 视线与湖底法线夹 **65°（掠射）** ⇒ 平面 `normalMap` 会糊、uv 拉伸明显 | 法线贴图 | ⚠️ **部分成立** | **本包不做 `normalMap`**（见 §6）。以 **albedo + roughness** 为主；立体感由 albedo 的明暗（画上去的假凹凸）+ `bedY()` 的**真实几何起伏**提供 |
| 照片纹理 **repeat > 6 次**肉眼可辨 | 任何 tiling 贴图 | ✅ **仍成立** | 加 **macro variation 层**（第二 UV 低频采样；周期 ≈ 28 世界单位 ⇒ 全湖底仅重复 **~3 次**） |
| 2K albedo+normal+rough ≈ **16 MB 显存** + 移动端带宽 | CC0 扫描件 | ❌ **不成立** | 程序化 512² + 128² ⇒ **显存 ≈ 1 MB**、磁盘 **+0 字节**（运行时生成） |

> ⚠️ **AM-005 §3 的最后一条「没有剪影、没有相互遮挡、没有视差」整条不适用** ——
> 本包 **不替代** 任何几何石：238 颗真石头仍在提供这三样。贴图只补**石头之间的地面**，
> 以及**左右边缘 / 最远处**本来就没石头的裸地面（`pebbleFieldHalfW` 远边 14.85 vs 可见远边半宽 22.04
> ⇒ 左右各有约 **7 单位**宽的裸地面在画面里）。

---

## §4 实现要点（建议，不是命令）

### ① 无缝贴图：周期值噪声

`h2(ix,iy,s)` 本身无周期，直接拿它铺 tile 会**在边界断开**。加一层包裹即可：

```js
function h2p(ix, iy, s, N) {            // N = 贴图边长（像素）
  var x = ((ix % N) + N) % N;
  var y = ((iy % N) + N) % N;
  return h2(x, y, s);
}
```

用 `h2p` 组成的 value noise 在 `x = N` 处**恰好回到 `x = 0`** ⇒ 平铺无缝。
（与 `makeCausticTexture()` 的"整数频率"是同一目标的两种写法，本包用周期包裹，因为需要多八度的有机噪声而不是规则正弦。）

### ② 一次计算，派生两张贴图

只算**一遍**高度场 `H[N*N]`（3~4 个八度的周期值噪声 + 一层低对比 cellular），然后：

- **albedo**：`baseColor × (1 − grain + grain·H)` ⇒ 灰绿基调 + 颗粒明暗；
- **roughness**：`0.92 × (1 − roughVar · H)` ⇒ 高点（被水磨亮的石面）更光滑。

⚠️ **`albedo` 必须是中性灰绿**（色相不动）—— 否则会漂 `#5`（色度加权色相步长）。

### ③ `material.color` 的处理（**这一条要写进契约**）

今天颜色在 `material.color = 0x5d6f66`。加 albedo 后 three 会 **`color × map`**，直接叠会把画面压暗。

**做法**（PBR 惯例）：`color` 改 `0xffffff`，**颜色移进贴图 albedo**（基准亮度对齐原 `0x5d6f66`）。
`bedTexture: false` 时退回 `0x5d6f66` —— 一行三元，关闭路径永远可用。

### ④ macro 层：打破 tiling 重复感

再生成一张 **128² 的低频** `CanvasTexture`（`NoColorSpace`），在 `onBeforeCompile` 里**第二 UV** 采样：

```glsl
vec3 bedM = texture2D(uBedMacroTex, vWXZ * uBedMacroScale).rgb;
diffuseColor.rgb *= mix(vec3(1.0), bedM * 2.0, uBedMacroGain);   // 均值 1.0，只做 ±gain 的起伏
```

🔴 **注入点与 caustic 同一个 `#include <color_fragment>`** —— 两处注入**必须合并进同一次 `.replace()`**，
否则第二次找不到 anchor（第一次替换已改变字符串）。

### ⑤ 参数进契约

`src/00-config.js` 新增「湖底贴图」段，契约 §6 同步、§10 记一笔：

```js
bedTexture: true,        // 总开关。false = 退回纯色湖底（color = 0x5d6f66）
bedTexSize: 512,         // 贴图边长（2 的幂 → 可生成 mipmap）
bedTexScale: 0.30,       // 世界 → UV 缩放（= 每世界单位多少 UV）；越大越密
bedTexGrain: 0.55,       // 颗粒对比强度（albedo 明暗幅度）
bedRoughVar: 0.20,       // 粗糙度变化幅度
bedMacroScale: 0.035,    // macro 层缩放（周期 ≈ 28.6 世界单位）
bedMacroGain: 0.12       // macro 层幅度
```

### ⑥ 关闭路径

`bedTexture: false` ⇒ 不生成贴图、不挂 `map` / `roughnessMap`、`color` 回 `0x5d6f66`、macro 层 `uBedMacroGain = 0`。
**画面必须与今天逐像素等价**（这是本包的降级判据）。

---

## §5 验收（逐条打勾）

| # | 判据 | 说明 |
|---|---|---|
| 1 | 免构建 `npm run assert` **15/15** | 不退化 |
| 2 | 构建版 `npm run assert:dist` **15/15** | 不退化 |
| 3 | **`#14` / `#15` 逐字不变** | 两者量鹅卵石，本包未碰 ⇒ 变了就是越界 |
| 4 | `#6` 湖底可读（`sMed > 14`） | 改前 / 改后**两套读数写进报告**（这是唯一直接风险点） |
| 5 | `#13` 反光柱 `peak/median ≥ 1.9` | 改前 / 改后对比（湖底明暗会经折射轻微影响水面） |
| 6 | `#5` 色相步长不退化 | albedo 必须中性 ⇒ 见 §4-② |
| 7 | `npm run pw` **14 passed** | 哨兵仍有效（AM-018 后是 3×3 注入） |
| 8 | **贴图无缝**（数值） | 周期噪声 ⇒ `f(x) = f(x+N)`。验证口径：接缝处相邻差分 **≈** 内部相邻差分均值（**不是 ≈ 0** —— 采样点间隔处处相同，"接缝不比内部更跳"即为无缝） |
| 9 | `bedTexture: false` 降级等价 | 与改前逐像素等价（不黑屏、不报错） |
| 10 | 两入口 **console 0 报错** | 硬门 |
| 11 | 体积 `dist/index.html` 增量 **≈ 0** | 纯 JS 代码行，**零外部资产** —— 这是"不膨胀体积"的验收 |
| 12 | 禁 `Math.random` | 贴图生成必须走 `h2` / `mulberry32`（否则帧不可复现） |

**铁律**：断言阈值**一个都不许改**。红了 → **报主控**（`WP6 §2` 的规矩）。

---

## §6 不做清单

| 不做 | 理由 |
|---|---|
| `normalMap` | AM-005 §3 实测：俯角 25° ⇒ 掠射 65° ⇒ 平面法线贴图会糊、uv 拉伸；且要防 WP2 当年打过的「蜂巢纹」回归。**留作 UP4b 可选** |
| 用 CC0 扫描件替换 | 体积 +3~10 MB（base64）/ 需 http 交付形态；且 AM-005 §3 已证不划算 |
| 动 `InstancedMesh` / 实例数 238→40 | 那是**原 UP4** 的做法 —— 会废 #14/#15、动保护清单。**雨桐已改方向** |
| 改 `bedY()` 顶点起伏 | 几何起伏已有，且它是 WP2 读 `BED_SIZE` 的链条之一 |
| AI 生贴图 | 路线图 §4：AI 只做 albedo 图案，**PBR 几何量不可靠**；本包根本不需要外部图 |

---

## 完工记录

**时间**：2026-09-25　·　**变更单**：AM-019　·　**波次**：9　·　**模式**：A（独占，自己提）

### 7.1 验收 12 条（§5 逐条）

| # | 判据 | 实测 | 结果 |
|---|---|---|---|
| 1 | `npm run assert` 15/15 | 15/15 · `JS 错误 (0)` / `Log error (0)` | ✅ |
| 2 | `npm run assert:dist` 15/15 | 15/15 · console 0 | ✅ |
| 3 | `#14` / `#15` **逐字不变** | `ratio=0.809`（far 46.95 / near 58.06）· `解析=0.4377 逐颗=0.4548`（面积 103.67 / 88 颗）—— **与改前逐字符相同** | ✅ |
| 4 | `#6` 湖底可读 | 改前 `14.90` ／ 改后 `15.40`（见 §7.2 分离度） | ✅ |
| 5 | `#13` `peak/median ≥ 1.9` | 改前 `2.111` ／ 改后 `2.089`（范围 1.919~2.205，质心 635.5/1280 = 49.6%） | ✅ |
| 6 | `#5` 色相步长不退化 | 改前 `2.108 @sun` ／ 改后 **`2.108 @sun` 一字不变** | ✅ |
| 7 | `npm run pw` 14 passed | **14 passed**（含哨兵 A/B/C，3×3 注入生效） | ✅ |
| 8 | 无缝（数值） | 接缝/内部 = **0.449（横）/ 0.655（纵）**（判据 < 1.5）· 周期恒等式 `max\|f(x)−f(x+f)\| = 0.000e+0` · `E[H] = 0.5000` | ✅ |
| 9 | `?bedtex=0` 降级等价 | **硬证明**见 §7.4：与改前逐像素差 ≤1 LSB、**任何阈值下 0 px 超阈** | ✅ |
| 10 | 两入口 console 0 报错 | 两入口均 `JS 错误 (0)` / `Log error (0)` | ✅ |
| 11 | 体积增量 ≈ 0 | `dist/index.html` **779,589 B**（改前 776,364 B ⇒ **+3,225 B / +0.415%**），**零外部资产** | ✅ |
| 12 | 禁 `Math.random` | `grep Math.random src/40-lakebed.js` → 仅注释一处，**代码零命中** | ✅ |

断言阈值**一个未改**；冻结件 `plan/wp5-assert.js` / `wp5-env.js` 零改动。

### 7.2 改前 / 改后读数（双入口）

| 读数 | 改前（HEAD） | 改后（默认，贴图开） | 判读 |
|---|---|---|---|
| `#3` 折射差分 | hitFrac **18.5%** · mean 4.81 · max 77 | hitFrac **21.8%** · mean 6.02 · max 77 | 湖底有纹理 ⇒ 折射位移可见度上升（**方向正确**） |
| `#5` 色相步长 | 2.108 @sun | **2.108 @sun** | 一字不变 ⇒ albedo 色相中性（§4-② 达标） |
| `#6` 湖底可读 `std` | 14.90（min 14.37 / max 19.91） | **15.40**（min 15.17 / max 20.22） | **余量 6.4% → 10.0%**（判据 >14） |
| `#13` 反光柱 | 2.111（1.897~2.231）· 质心 634.5 | 2.089（1.919~2.205）· 质心 635.5 | 在 **AM-008 已记的 ~3% 运行间方差**内（`_STATUS` 挂账：四组采样 2.047~2.115） |
| `#14` LOD 接缝 | 0.809 | **0.809** | 逐字不变 |
| `#15` 覆盖率 | 0.4377 / 0.4548 | **0.4377 / 0.4548** | 逐字不变 |
| `dist/index.html` | 776,364 B | **779,589 B** | +3,225 B（纯代码行） |

- `#4` 涟漪衰减 4.00s 墙钟 · `#8` 音频态 running · `#1` anyNaN=false · `#2` calls=6 / tris=53088 —— 均与改前一致。
- `#14` / `#15` **逐字符相同**是本包最关键的一条：它证明**238 颗鹅卵石（88 + 150）与两层 LOD 一个字节没动**，
  = 原 UP4 会废掉的两条断言**被完整保住**（这正是改写 UP4 的全部理由）。

> ⚠️ **`#6` 的运行间方差必须写清**：它是一个 **60 帧中位**，帧相位吃真实时钟 ⇒ 不是逐位量。多轮实测：
> 改前 `14.80 / 14.90 / 14.92`，改后 `15.34 / 15.40 / 16.12 / 16.14`。**两簇不重叠**（改后 min 15.17 > 改前 max ~14.92），
> 方向与幅度都稳定 ⇒ 结论可靠；但**不要**把某一个具体数字当基线去卡。

### 7.3 pw 像素回归**全绿**——为什么这是**正确**行为（本包最需要交代的一条）

UP3 收口时记过一笔：`pw` 的 `full.png` 在 `threshold 0.2` 下**对画面变化几乎不设防**（UP11 实测 2866 px → 8 px）。
AM-019 又会改湖底画面 ⇒ 预判「回归应该红」，**实测 ①②③ 全绿**。这不是失灵，我做了定向取证（方法见 §7.5）：

| 对比（合成帧 / 1280×720 / 钉相位 12.5h · uTime 7.0） | full maxChan | full diffPct | bed-clip maxChan | bed-clip diffPct | 单像素最大 `delta` | **过阈 t=0.2** |
|---|---|---|---|---|---|---|
| ① **噪声地板**（同 URL 两页，A vs A2） | 1 | 0.002% | 0 | 0% | 0.6 | **0 px** |
| ② 改前 vs `?bedtex=0`（**等价判据**） | 1 | 0.027% | 1 | 0.064% | 0.6 | **0 px** |
| ③ 改前 vs **贴图开**（真实足迹） | **29** | **49.006%** | **28** | **56.589%** | **719.5** | **0 px** |

- **贴图确实改了画面**：③ 有 **49%（整幅）/ 57%（湖底带）的像素发生变化**，单像素最大差 **28~29 级**。
- **但没一个像素越过 pixelmatch 的门**：`threshold 0.2` ⇒ 判"不同"需 `delta > 35215×0.2² = 1408.6`，
  对应单通道差 **≈37.5 级**。实测最大 `delta = 719.5` —— **只有门槛的一半**。
  ⇒ `toHaveScreenshot` **必然返回 0 差异像素**，①②③ 全绿是**数学上的必然**，不是断言失效。
- 反向校验：把门收紧到 `t=0.1`（需 ≈26.5 级）⇒ ③ full 出 **5981 px**、bed-clip 出 **1013 px**。
  **同一份画面，门一紧就现形** ⇒ 说明"绿"来自门太宽，而非取证链坏掉。
- 哨兵 A/B/C 仍全绿并通过（3×3 品红块无论落在 UI 还是湖底都被检出）⇒ **断言"不漏报"的能力没丢**。

**裁决（主控自身）**：AM-019 的**验收证据不依赖 pw 像素回归**——它天生是小改动的盲区。
本包的画面变化以 **§7.3 的专项量化** + `#6`/`#3` 的读数位移为准。
`full.png` / `bed-clip.png` / `ui-panel.png` **在主控收口时重录**（理由见 §7.5 末段）。

### 7.4 `?bedtex=0` 降级等价 —— **硬证明**（不是"看起来一样"）

方法：把 **HEAD（AM-019 之前）的源码**导出一份独立副本（`git show HEAD:src/00-config.js|40-lakebed.js`，
sha256 校验一致），两页各自走 pw 的 `boot()` 逐字流程后**截图**，再套 pixelmatch 判据式差分。

| 项 | A（HEAD 改前） | B（当前 + `?bedtex=0`） | C（当前，贴图开） |
|---|---|---|---|
| `SW.P.bedTexture` | `undefined` | `false` | `true` |
| `bedMesh.material` | `map:false · color:5d6f66` | `map:false · color:5d6f66` | `map:true · color:ffffff` |
| `#6.std` | **14.80** | **14.80** | 15.34 |
| `lodMetric.coverage` | `0.4548 / 0.4377` | `0.4548 / 0.4377` | `0.4548 / 0.4377` |

**两条独立证据都指向等价**：
1. **确定性读数**：`A == B`（逐字相等），`C` 不同 ⇒ `?bedtex=0` 的行为落在改前那一侧。
2. **像素级**：`A vs B` 最大通道差 **1 级**、有差异素 0.027%~0.064%、**`delta` 最大 0.6**、
   **连 `t=0.02`（需 ≈3.8 级）都是 0 px**。而 ① 的**噪声地板本身就是 maxChan 1 / 0.6**
   ⇒ **B 与 A 的差异 ≤ 渲染器自身的复现抖动**，等价成立。

> 🔎 **取证踩过的坑（值得记档）**：第一版探针用「裸渲染 `r.render()` + `readPixels`」，
> 实测 `hideLakebed → 0 差异`、`clearMagenta → 0 差异`、`bedTexOff → 0 差异`，**而 `hideWater → 99.93%`**。
> 根因：**裸渲染里湖底被不透明水面挡住**，只能透过折射源 RT（`sceneRT`）看到；而 `sceneRT` 只在
> **完整入口 `SW.scene.render()` 的步骤①**里刷新（`30-scene.js:450-460`）⇒ 裸渲染恒读到**上一帧的旧 `sceneRT`**。
> ⇒ 该口径**不适合**量湖底材质变化。改用「合成帧截图（= `toHaveScreenshot` 同口径）」后一切正常。
> （顺带解释了 `90-debug.js:28` 那句「需要同帧内先 render 一次」的真实边界。）

### 7.5 复现配方（供独立复核）

```js
// 用 pw 的 boot() 逐字流程钉相位，然后截图 —— 与 toHaveScreenshot 同口径
import { HELPERS, EXTRA, pinSnippet, CLEAN_SNIPPET } from './plan/pw/lib/page-lib.mjs';
import { PIN_HOUR, PIN_UTIME } from './plan/pw/lib/const.mjs';
// goto(<url>) → waitFunction(SW.ready) → wait 3000
// → evaluate(HELPERS) → evaluate(EXTRA) → evaluate(pinSnippet(12.5, 7.0)) → evaluate(CLEAN_SNIPPET) → wait 1500
// → page.screenshot() 两次（?debug=1 / ?debug=1&bedtex=0）→ 解 PNG 逐像素差分
// 判据式：d = 0.29889531·dr² + 0.58662247·dg² + 0.11448223·db² ；d > 35215·t² 记 1 px
```
（探针脚本按 `03-COLLAB-PROTOCOL §1` 属临时件，**已删**；配方逐行可重建。）

### 7.6 实现落点（改了什么）

| 文件 | 改动 |
|---|---|
| `src/40-lakebed.js` | +185 行：`pvnoise` / `pcell`（mod-N 周期包裹，复用 `h2`）· `bedWhite1()`（1×1 占位，`NoColorSpace`）· `makeBedTextures()`（**一次**高度场 `H[N²]` 派生 albedo + roughness）· `makeBedMacroTexture()`（128² 低频）· `makeBedMaterial()` 增 3 参 + 3 uniform + **在同一次** `#include <color_fragment>` replace 里追加 macro 采样 · `init()` 按 `SW.P.bedTexture` 分支 |
| `src/00-config.js` | +7 参数（`bedTexture` / `bedTexSize` / `bedTexScale` / `bedTexGrain` / `bedRoughVar` / `bedMacroScale` / `bedMacroGain`）+ `?bedtex=0` 降级开关 + `SW.resetP` 同步 |
| `plan/01-CONTRACT.md` | §2.4 注 · §6 参数段 · §7 所有权（`40-lakebed.js` **WP1 → UP4-lite**）· §9 新增「湖底贴图自检」算式块 · §10 记 AM-019 |
| `plan/02-AMENDMENTS.md` | AM-019（§1 行 · §1.1 全文 · §2 总表 · §3 改写关系速查） |

**规格**：albedo 512² `SRGBColorSpace` + `RepeatWrapping` + `repeat.set(R,R)`（R = 90 × 0.30 = 27）；
roughness 512² `NoColorSpace` 同 repeat；macro 128² `NoColorSpace` + `LinearFilter` + 无 mipmap，走 `vWXZ`。
**显存**：≈2.7 MiB（512²×2 含 mip ≈1.33×2 + 128² 0.06）。⚠️ **§3 表里写的「≈1 MB」是低估，实测口径订正为 ≈2.7 MiB**；
磁盘仍 **+0 字节**（运行时 canvas 生成，零外部资产）。

### 7.7 提交原文

```
commit 04732edb3db344c8d245a490e086682ff66ea6ee
Author: lctfwyt <lctfwyt@outlook.com>
Date:   Fri Sep 25 12:37:04 2026 +0800

    feat(up4): 湖底程序化 tiling 贴图（AM-019）

 plan/01-CONTRACT.md               |  45 +++++-
 plan/02-AMENDMENTS.md             |   7 +-
 plan/03-COLLAB-PROTOCOL.md        |  37 +++++
 plan/04-BOARD.md                  |  11 ++
 plan/100-UP4-lite.md              | 311 ++++++++++++++++++++++++++++++++++++++
 plan/98b-AMENDMENTS-ARCHIVE-v1.md | 110 ++++++++++++++
 plan/_STATUS.md                   |   8 +-
 src/00-config.js                  |  24 ++-
 src/40-lakebed.js                 | 185 ++++++++++++++++++++++-
 9 files changed, 725 insertions(+), 13 deletions(-)
```

模式 **A · 独占** ⇒ 自己提。按 `03-COLLAB-PROTOCOL §7.1` **逐条列名 `git add`**（禁 `-A`），
9 个文件**恰好**等于白名单 + 收尾四步文档。
未提交项：`plan/pw/tests/__snapshots__/*.png` 与 `plan/pw/dist-baseline.txt` —— **属主控地盘**，
由收口提交（`chore(up4)`）单独处理。

### 7.8 主控收口（同一人复核）

| 项 | 动作 | 结果 |
|---|---|---|
| 独立重跑 | `assert` / `assert:dist` / `pw` | 15/15 · 15/15 · **14 passed** |
| 越界核查 | `index.html` / `vendor/**` / `30-scene.js` / `60-water.js` / `90-debug.js` 零改动；改动仅 2 个 src 文件 | ✅ |
| 冻结件 | `npm run pw:frozen` | ✅ `wp5-assert.js` `a7575b48…` · `wp5-env.js` `bd9dd0e8…` **基线与当前逐位相同** |
| pw 基线重录 | `--update-snapshots=all`（三条） | `bed-clip` 32,614 → **49,355 B** · `full` 475,105 → **578,630 B** · `ui-panel` 4,451 → 4,451 B；**重录后复跑 `pw` 14 passed** |
| dist 基线重落 | `npm run build && npm run pw:dist:snapshot` → `npm run pw:dist` | `./index.html` 776,364 → **779,589 B**（`22102742323e…`）；15 文件**逐文件一致**，无 dev-only 引用泄漏 |

> 🔴 **订正一处自己的读数错误（主控自查）**：施工记录里写的 `dist/index.html = 779,484 B` **是错的** ——
> 那是**上一次残留的旧构建产物**（构建发生在最后一处源码微调之前），不是当前源码的产物。
> 收口重建后实测 **779,589 B / sha256 `22102742323e…`**，且**连跑 3 次构建逐位相同**（= `dist ≡ f(src)` 未被破坏）。
> 因此增量是 **+3,225 B / +0.415%**（非 +3,120 / +0.40%）—— 全部相关文档（本文 §7.1/§7.2/§7.8 ·
> `_STATUS` · `98b §AM-019` · `04-BOARD`）**已按 779,589 B 统一订正**。
> 教训：**报体积前必须重建一次**；`ls -l dist/` 读到的是"最后一次构建"，不等于"当前源码"。
