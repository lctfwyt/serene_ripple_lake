# UP3 —— 环境光照（程序化环境贴图 + IBL）

> 变更单：**AM-017**　·　波次：**8**　·　前置：**UP1a ✅ · UP2 ✅**（UP2 与 UP3 同碰 `30-scene.js` → 串行，现已解锁）
> ⚠ 本单原定 `AM-010`，该号在 09-25 被 **UP9 海鸟环境音**占用 → 主控 2026-09-25 顺延为 **AM-017**。
> 裁决与根因见 `02-AMENDMENTS.md §2.1` 与 `90-WAVE4.md §7` 订正块。**别再用 AM-010。**
> 施工口径以本文为准；与 `60-UPGRADE-ROADMAP.md §3-UP3` 冲突处，**以本文为准**（那是 09-24 的提案稿）。

---

## §0 需求原文（路线图 §3-UP3）

> 现状：`30-scene.js:165-175` = 1 DirectionalLight + 1 HemisphereLight（**两个颜色是手猜的**）+ 1 AmbientLight。**无 env map、无 PMREM**
> 方案：HDRI → `RGBELoader` + `PMREMGenerator` → `scene.environment`
> 收益：环境光物理一致 · 水面有**真实环境反射**（现在只有一个 `uSkyTop`/`uSkyBottom` 二色渐变在假装天空）
> 🔴 风险：**会和 13 个 keyframe 的美术方向打架**

**主控裁决（2026-09-25）：环境贴图来源改为「程序化」，不用外部 HDRI 素材。** 理由见 §3-①。

---

## §1 你拥有的文件（白名单）

| 文件 | 权限 | 说明 |
|---|---|---|
| `src/30-scene.js` | ✅ 所有者（**波次 8 起从 UP2 移交**） | 环境贴图构建 + `applyTimeState` 挂载 + 灯光配比 |
| `src/60-water.js` | ✅ 所有者（**从已收工的 UP8 移交**） | 🔴 只动**水面反射那一行** + 一个 uniform（见 §4），别碰其余 |
| `src/00-config.js` | ✅ 所有者（**env 段**） | 新增 env 参数组 |
| `plan/01-CONTRACT.md` | §2.6 `SW.scene` + §6 渲染参数 | 分段改 |
| `plan/02-AMENDMENTS.md` | AM-017 那一行 | 只写自己的 |
| `README.md` | ✅ 「环境光照」一小节 | 建议补；不是硬要求 |
| `plan/99-UP3-hdri.md` | ✅ 本文 | 完工记录写这里 |
| `plan/_STATUS.md` | 只**追加**一行 | 不改别人的行 |

**禁止碰**：`index.html`（🔴 **本包 `index.html` 零改动** —— 见 §3-④）· `vendor/**`（零改动）·
`src/90-debug.js`（env 强度滑杆由主控另加，**不占本包额度**）· `src/10-audio.js` ·
冻结件 `wp5-assert.js` / `wp5-env.js` · **断言阈值一律不许改** · `plan/pw/**`（基线由主控重录）

---

## §2 现状（已替你查好）

| 位置 | 内容 |
|---|---|
| `src/30-scene.js:165-175` | 三盏手调灯：`DirectionalLight(0xffffff, 2.1)` · `HemisphereLight(0x9fcee0, 0x33473f, 0.9)` · `AmbientLight(0xffffff, 0.12)`。**无 env map、无 PMREM** |
| `src/30-scene.js:213` | `applyTimeState(s)` —— keyframe 应用点（`s.skyTop` / `s.skyBottom` / `s.sunI` / `s.fog` …） |
| `src/30-scene.js:225-226` | 天空球用 `sky.material.uniforms.uTop/uBottom` ← **与水面同源的那对颜色**。环境贴图就该从这一对派生 |
| `src/60-water.js:243` | `refl = mix(uSkyBottom, uSkyTop, st);` ← **「假天空」就是这一行**，本包要把它换成采样环境贴图 |
| `src/60-water.js:337-338` | 每帧从 keyframe 喂 `uSkyTop` / `uSkyBottom` |
| `src/60-water.js:393-394` | 两个 uniform 的初值 |
| `src/40-lakebed.js:117` / `:172` | 两层鹅卵石都是 `MeshStandardMaterial`，**`metalness: 0`** → env 贡献**以漫反射 IBL 为主**，镜面增益很弱（预期湖底会"亮起来"，而不是"反起来"） |
| `vendor/three.min.js` | ✅ **核心 API 全部命中**：`PMREMGenerator` · `fromEquirectangular` · `compileEquirectangularShader` · `fromScene` · `DataTexture` · `EquirectangularReflectionMapping` · `envMapIntensity`（15 处）<br>❌ **三个缺失**：`environmentRotation` · `envMapRotation` · `environmentIntensity`（**都是 r163+ 才加**） |

### 关键推论（这两条决定了整包的做法）

1. **`vendor/` 零改动、`index.html` 零改动** —— `PMREMGenerator` 在 three 核心里，不需要像 UP2 那样新建 vendor bundle，也不需要新 `<script>` 标签。**本包不碰加载顺序。**
2. 🔴 **r160 转不了环境贴图，也调不了 `scene.environmentIntensity`** → 环境强度只能在**材质侧**用 `material.envMapIntensity` 调（13 个 keyframe 要强度变化就逐帧写材质属性）；朝向则**只能靠"生成时就画对"**——这是程序化方案的天然优势（见 §3-①）。

---

## §3 四个必须知道的坑

### ① 为什么用程序化环境，不用 Poly Haven 真 HDRI（**主控已调研，别推翻**）

| 调研事实 | 对"真 HDRI"的影响 |
|---|---|
| Poly Haven 1K `.hdr` 实测 **1.6~1.7 MB/张**（`lilienstein-1K` 1.7 MB · `pool-1K` 1.6 MB） | 4 张 = 6.4 MB → base64 内联 ≈ **8.5 MB** → 单 HTML **771 KB → ~9 MB（12×）**，与"双击即开的单文件"交付形态冲突 |
| 🔴 r160 **没有 `environmentRotation`** | 13 个 keyframe 的**太阳方位随小时走**（AM-003 夹取），固定朝向的 HDRI **只对得上其中一个** → 正中 §0 那条"会和 13 个 keyframe 打架"。缓解只能每 keyframe 重烘 PMREM 或手转 equirect 源 |
| **真月光 HDRI 稀缺**（路线图自己承认） | 4 张里至少 1 张还得程序化补 → 本来就是混合方案 |

**程序化方案的做法**：从 `s.skyTop` / `s.skyBottom` 派生一张小尺寸 equirect `DataTexture`
（建议 **128×64**，可加太阳瓣 + 地平线带 + 极轻噪声云），`PMREMGenerator.fromEquirectangular()` 烘成 env。
→ 成本 **64 KB 显存、磁盘 0 字节**；13 个 keyframe 想要哪个方位的日光瓣就画哪个，**"打架"这条风险直接消失**；夜间合成冷色低强度，**不存在"月光素材稀缺"**。

> ⚠ **代价要认**：镜像反射里**不会有真实的云 / 地平线结构细节**。而 `60-water.js:243` 现在本来就是二色渐变，
> 所以本包的增益是**「粗糙度感知模糊 + 菲涅尔 + 地面半球 + 物理一致的漫反射 IBL」**，不是"水里有云"。
> 「水里有云」= 真 HDRI + 上面那三笔代价 —— **已记为可选升级路径，见 §6-B，本包不做。**

### ② 两个 API 缺失 → 强度与朝向都得"绕着来"

- **强度**：无 `scene.environmentIntensity` → 用 `material.envMapIntensity`。13 个 keyframe 若要强度起伏（如夜间压低），就在 `applyTimeState` 里逐帧写。**别去 `vendor/` 里补 API。**
- **朝向**：无 rotation API → 靠生成时决定（程序化的优势）。若你发现某个时段反射方位别扭，**改生成参数，别试着转贴图**。

### ③ 断言会被影响哪几条（**先跑一遍基线，再动手**）

| 断言 | 为什么受影响 | 预期 |
|---|---|---|
| **#13** 反光柱 `peak/median ≥ 1.9` | 环境反射给整幅加了基线 → **median 抬高，比值被拉低** | 🔴 **最危险**，很可能要重标 |
| **#6** 湖底可读（60 帧中位 `sMed > 14`） | IBL 漫反射把湖底照亮 | 方向是**变亮**（远离地板），但仍要重测 |
| **#5** 色相步长（色度加权 `max < 2.5`） | env 带色（天空偏蓝）→ 色相梯度可能变 | 要重测 |
| #3 折射差分 | 水面反射分量换了来源 | 要重测 |
| **AM-007 §1 四态 R−B** | env 是**偏蓝**的 → R−B 会漂 | 要重标 |
| #1 / #2 / #4 / #7 / #8 / #9~#12 / #14 / #15 | 与光照/环境无关（几何、keyframe 日月、LOD、音频） | **不应变** —— 变了就是回归 |

**铁律**：
1. 🔴 **断言阈值一个都不许改。** 红了就**报主控重标**（照 WP6 §2 的规矩）。
2. 动手**前**先跑一次 `npm run assert` 存下"改前读数"，改完再跑，**把前后两套读数写进报告**。
3. `#14 / #15` 是 LOD 判据，本包**不该碰** —— 它们红了说明你动到了 `40-lakebed.js`，那是越界。

### ④ 两条入口**都是 `file://`** —— 所以"零 IO"是硬要求

```
npm run assert       → node plan/wp5-assert.js                      （免构建 index.html，file://）
npm run assert:dist  → node plan/wp5-assert.js file:///…/dist/index.html?debug=1
```

**两条入口都在 `file://` 下跑**。所以：环境贴图**必须是运行时生成的 `DataTexture`**，
**不许** fetch / XHR / `<img>` 拉任何 `.hdr` 文件 —— 那会在**两条线同时**拿不到，不是"降级"。

好消息：程序化方案天然满足这条，`DataTexture` 不打网络，**两入口读数天然一致**。

---

## §4 实现要点（建议，不是命令）

1. **构建函数**（`30-scene.js` 内，建议命名 `_buildEnvEquirect(s)`）：
   按 `s.skyTop` / `s.skyBottom` 填一张 **128×64** `DataTexture`，`mapping = THREE.EquirectangularReflectionMapping`。
   建议结构：上半球 skyTop→skyBottom 竖向渐变 + **太阳瓣**（方位取 `s.sunAz` / 仰角取 `s.sunElev`，颜色取 `s.sunColor`，强度取 `s.sunI`，归一化后当 HDR 值）+ 下半球压暗的"地面/水体半球"。
2. **烘 PMREM**：`PMREMGenerator` 在 `init()` 里建一次，`compileEquirectangularShader()` 预热；
   按 keyframe 变化**惰性重建**（dirty 标记 + 阈值，别每帧烘），旧 `RenderTarget` 记得 `dispose()`。
3. **挂载**：`scene.environment = rt.texture`；强度走 `envMapIntensity`（`40-lakebed.js` 的两层材质**不在白名单** → 强度通过 `traverse` 设，或让主控决定是否移交）。
4. **水面**：把 `60-water.js:243` 的 `mix(uSkyBottom, uSkyTop, st)` 换成**采样 env**。
   ⚠ 采样要在**世界空间反射向量**上做；`uSkyTop/uSkyBottom` **先别删**（它是 UP2 之前的既定路径，删了会连带影响 `applyState` 与调试），**保留并作为 fallback**：env 未就绪时仍走旧路径 → 这样即使 PMREM 失败画面也不黑。
5. **灯光配比**：加了 env 之后 `HemisphereLight`（0.9）与 `AmbientLight`（0.12）**会重复计环境光** → 按路线图 §3 的建议**下调 hemi 强度当补差**，`DirectionalLight`（太阳/月亮）**保留不动**（它是 keyframe 的主光）。
6. **参数进契约**：`00-config.js` 新增 env 段（建议：`envEnabled` / `envIntensity` / `envResolution`），
   契约 §6 同步 + §10 记一笔。**契约 §2.6 `SW.scene` 若新增方法，签名一并冻结。**

---

## §5 验收（逐条打勾）

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | **`vendor/` 与 `index.html` 逐字节未改** | `git diff` 必须为空（一票否决级） |
| 2 | **零网络加载** | 全程无 fetch / XHR / `.hdr`；`DataTexture` 运行时生成 |
| 3 | **环境光确实生效** | `scene.environment` 非空；湖底亮度实测**高于**改前（#6 `sMed` 上升） |
| 4 | **水面反射换了来源** | 关掉 env（`envEnabled=false`）→ 画面回到旧二色渐变；开 → 反射随粗糙度/视角变化 |
| 5 | **15/15 断言两入口全过** | `npm run assert` + `npm run assert:dist`；**报告前后两套读数** |
| 6 | 不受影响的断言**确实没动** | 重点核 #7 / #9~#12 / #14 / #15 |
| 7 | **AM-007 §1 四态 R−B 重测标定** | 四态（晨/午/昏/夜）R−B 读数 + 与改前的差 |
| 8 | `#13` 读数与余量 | 若逼近 `1.9`（余量 < 10%）→ 照常提交，但**留言板挂主控箱** |
| 9 | console 0 报错（两入口） | 都要 |
| 10 | **两种降级都不黑** | ① `envEnabled=false` ② PMREM 建失败（模拟：临时抛错）→ 画面走旧路径 |
| 11 | 窄屏 / 移动端不回归 | `npm run pw`；`ui-panel` / `bed-clip` 快照**不应变**（本包不动 UI） |
| 12 | dist 与基线 | `npm run build` → `npm run pw:dist:snapshot` → `npm run pw:dist`（体积应只小幅变化） |

> ⚠ `pw` 的 `full.png` **预期会变**（画面亮度/反射变了）—— 那是真变更，**报主控重录，别自己重录**。
> ⚠ `pw` 的 safe-delete 守卫坑**已从源头消除**（2026-09-25 主控：`trace.screenshots=false`，
> 单跑残留 1378→**14** 条目 / 75 MB→**125 KB**）→ **直接 `npm run pw` 即可，不需要 `--output` 绕法**。
> 原理与历史见 `03-COLLAB-PROTOCOL.md §8.1`。

---

## §6 收尾与「不做」

### A. 收尾（四步 + 提交）

1. 完工记录写进本文 **§7**
2. `plan/_STATUS.md` 只**追加**自己一行
3. **AM-017 关单**：`02-AMENDMENTS.md` §2.1 移到 §2 总表 → 全文移 `98b` 归档 → 契约 §2.6 / §6 / §10 同步
4. `04-BOARD.md` 主控箱留言清零
5. **提交**：本包本轮**独占工作区 → 模式 A，你自己提**（`feat(up3): …（AM-017）`）
   —— 细则见 `03-COLLAB-PROTOCOL.md §7.1`：**只 `git add` 白名单里的文件，禁 `-A`**；不许 amend / 动 tag；`plan/pw/**` 不自己重录。
   ⚠ **别和 WP6（AM-016）同时开** —— 它也要 `00-config.js`；真并行就只能转**模式 B（不提交）**。

### B. 明确**不做**（留档，别顺手做）

| 不做 | 理由 |
|---|---|
| 引入 Poly Haven 真 HDRI | §3-① 三条代价（9 MB / r160 无旋转 / 月光稀缺）。**若雨桐后续要"水里有云"，另开一包** |
| 每 keyframe 重烘 PMREM | 只要惰性重建（§4-2） |
| 改 `vendor/` 补 `environmentIntensity` | 别碰第三方运行时；用 `envMapIntensity` 绕 |
| 改断言阈值 | 铁律。红了报主控 |
| 给 `90-debug.js` 加滑杆 | 不占本包额度；雨桐要调 env 强度，主控另开 |
| 动 `40-lakebed.js` 的材质 | 会让 `#14 / #15` 失去对象（那是 UP4 的地盘） |

---

## §7 完工记录（过程流水）

> **状态：✅ 已完工 2026-09-25 11:2x**　·　变更单 **AM-017** 已关单（全文移 `98b-AMENDMENTS-ARCHIVE-v1.md`）
> 提交：模式 A（本轮独占工作区，UP3 自己提）——`git log -1 --stat` 原文见 §7.8

### §7.1 复述四件事（开工前）

| # | 内容 |
|---|---|
| ① 拥有的文件 | `src/30-scene.js`（波次 8 起从 UP2 移交）· `src/60-water.js`（从 UP8 移交，**只动反射那一行 + 3 个 uniform**）· `src/00-config.js`（**仅 env 段**）· 契约 §2.3/§2.6/§6/§7/§9/§10（分段）· `02-AMENDMENTS.md`（AM-017 行）· 本文 · `_STATUS.md`（追加一行）· `README.md`（环境光照小节，可选） |
| ② 不许碰 | `index.html`（🔴 零改动）· `vendor/**`（🔴 零改动）· `src/40-lakebed.js` **材质**（UP4 地盘，动了 #14/#15 失去对象）· `src/90-debug.js` · `src/20-time.js` · `src/80-ui.js` · `src/10-audio.js` · 冻结件 `plan/wp5-assert.js` / `plan/wp5-env.js` · **断言阈值** · `plan/pw/**`（基线主控地盘） |
| ③ 要应用的变更单 | **本包就是 AM-017**；开工时未决区**无其他条目**（AM-001~AM-015 全关）。板上 `UP3` 箱 1 条、`全体` 箱 1 条，均为拆包通知（已处理） |
| ④ 影响的断言 + 验法 | #13（最危险，env 抬高 median → 比值被压）· #6（IBL 提亮湖底，口径是**正午 std**）· #5（env 带色）· #3（反射换源）· AM-007 §1 四态 R−B；#1/#2/#4/#7/#9~#12/#14/#15 不该变 → 前后两套读数逐条比对 |

### §7.2 改前读数（第一件事，两入口各跑一次）

| 读数 | 免构建 | dist |
|---|---|---|
| 断言通过 | 15/15 | 15/15 |
| #13 peak/median(24相位中位) | 2.136（1.965~2.265）· 质心 635.0 | 2.130（1.977~2.238）· 质心 636.8 |
| #6 湖底 std（正午 60 帧中位） | 15.05（min 14.67 / max 23.38） | 15.02（14.70 / 23.45） |
| #5 chromaStep max | 2.108 @sun | 2.108 @sun |
| #3 折射差分 | hit 18.8% · mean 4.67 · max 91 | hit 19.0% · mean 4.65 · max 81 |
| #2 calls / tris | 6 / 53088 | 6 / 53088 |
| 四态 R−B（24 相位中位） | 4.26 / −32.11 / 40.73 / −32.91 | — |
| 四态全幅亮度 | 137.46 / 157.36 / 131.17 / 83.03 | — |

### §7.3 过程中踩到的两个坑（都改了实现，不是调阈值）

**坑 1 · equirect 的 `v` 是**非线性**的。** three 的 `equirectUv()` 是
`u = atan2(d.z,d.x)/(2π)+0.5`、`v = asin(clamp(d.y,-1,1))/π+0.5` —— **不是** `d.y*0.5+0.5`。
生成侧与采样侧**两端都必须用这一条**，否则环境贴图整体错位（水里的天空带跑到脚下），比不换还糟。
已把它提升为契约 §9 的 `ENV_EQUIRECT_UV` 口径。

**坑 2 · 太阳瓣被 mip 模糊吃掉了。** 第一版 `pow(d,1400)×4.0`（半宽 ≈1.8°）在 128×64 的
`mip1`（一个纹素 ≈5.6°）上被抹成 0 → **峰值没起来、中位反而被抬升** → #13 比值被压到
**1.842**（判据 ≥1.9，直接挂）。改为 `pow(d,300)×2.5`（半宽 ≈3.9°，活得住 mip0~1）
+ 绕日晕 `pow(d,20)×0.20`，并把水面 mip 偏置由 `waterRough×12` 收到 `×8`。
**根因**：`#13` 量的是"列剖面 peak/median"，而水面反射的 mip 模糊会把窄高光摊平 ——
太阳的**物理**镜面高光本来就该由 `60-water.js` 的 GGX 路径（两层法线）承担，
env 只负责补环境色。这条已写进契约 §9「环境贴图自检」的「太阳瓣角宽」一栏。

### §7.4 参数标定（一次性扫参数得结论，不是拍脑袋）

`#6` 的真实口径是**正午**（断言在 `seek(12.5)` 之后测），且实测 `std ≈ 0.096 × 区域均值`
—— 即 std **随亮度正比变化**，所以"把湖底调暗"反而让 #6 更差。9 组组合（含 `envEnabled=false`
真基线，同一轮内测）结论：

| 配置（env / waterGain / hemiScale / ambScale） | #13 ratioMed | #6 std / 均值 | 判定 |
|---|---|---|---|
| **ENV-OFF（基线，同轮）** | 2.081 | 14.92 / 138.87 | 参照 |
| 1.0 / 1.0 / 0.55 / 0.45 | 2.081 | 14.78 / 155.25 | #6 退 |
| 1.0 / 1.0 / 0.50 / 0.40 | **1.918** | 14.74 / 154.93 | ❌ #13 挂 |
| 1.0 / 0.85 / 0.55 / 0.45 | **1.915** | 14.92 / 155.47 | ❌ #13 挂 |
| 1.2 / 1.0 / 0.60 / 0.50 | 2.023 | 14.81 / 159.53 | 余量 6.5% |
| **0.9 / 0.75 / 0.50 / 0.40** | **2.125** | **14.88 / 152.11** | ✅ **采用** |

采用值落进 config：`envEnabled:true, envIntensity:0.9, envResolution:128,
envWaterGain:0.75, envHemiScale:0.50, envAmbScale:0.40`。
`envWaterGain` 取 0.75 而非 1.0 的理由（写进契约 §6 注释）：实测 1.0 会把水面中位亮度抬上去、
#13 被压到 1.92（余量 1%）。

### §7.5 验收（§5 十二条逐条）

| # | 判据 | 结果 |
|---|---|---|
| 1 | `vendor/` 与 `index.html` 逐字节未改 | ✅ `git diff -- index.html vendor/` **空** |
| 2 | 零网络加载 | ✅ `src/**` 无 fetch / XHR / `<img>` / `TextureLoader`（grep 命中仅在注释）；pw `10-assert` `requestfailed (0)：无`；`pw:dist`「引用泄漏检查: 无」 |
| 3 | 环境光确实生效 | ✅ `scene.environment` 非空 · `_envMatCount=3`（湖底 + 两层鹅卵石）· 湖底正午区域均值 **138.87 → 152.11（+9.5%）**，std 14.92 → 14.88（**亮度上去、对比没塌**） |
| 4 | 水面反射换了来源 + 随粗糙度变化 | ✅ `uProbe=5` 直读 `refl`（h=22.5，x∈[0.30,0.70]×y∈[0.35,0.95]）：<br>env 关 `mean/std = 19.89 / 5.23` → env 开 **51.72 / 51.12**（**来源换了**，均值 2.6×、离散 9.8×）<br>`waterRough` 0.02 → 0.60：std **54.92 → 25.45**（**mip 偏置生效 = 粗糙度感知模糊**） |
| 5 | 15/15 两入口全过 | ✅ `npm run assert` **15/15** · `npm run assert:dist` **15/15** · console 0 报错 |
| 6 | 不受影响的断言确实没动 | ✅ #1 `anyNaN=false` · #2 `calls=6 / tris=53088` · #4 自然衰减 4.00s · #7 `1.000 / 0.1500` · #8 `bgmGain 0.6000000238418579` · #9~#12 六时段表**逐字相同** · #14 `0.809` · #15 `0.4377/0.4548` — 全部与改前一致 |
| 7 | AM-007 §1 四态 R−B 重测标定 | ✅ 见 §7.6（四态区分度保持） |
| 8 | `#13` 读数与余量 | ⚠ **免构建 2.106（余量 10.5%）· dist 2.096（余量 10.3%）** —— 在 10% 达标线**之上**；按包文档要求**已在留言板挂主控箱** |
| 9 | console 0 报错（两入口） | ✅ 0 / 0 |
| 10 | 两种降级都不黑 | ✅ ① `envEnabled=false`：`sceneEnv=false`、`waterEnvReady=false`、hemi 回 **0.42** / amb 回 **0.12**（原值），画面亮度 **82.72**（非黑）<br>② 强制 `PMREMGenerator.prototype.fromEquirectangular` 抛错（CDP 侧注入，**prod 代码零改动**）：`err="SIMULATED PMREM FAILURE"`、`ready=false`、画面 **82.83**（非黑）、**无 console 报错**<br>③ 撤销注入 → env 恢复正常（可逆） |
| 11 | 窄屏 / 移动端不回归 | ✅ `npm run pw` **14 passed**；`ui-panel.png` / `bed-clip.png` **未红**（本包不动 UI）；`env-narrow` 零重叠、`env-reduced-motion` / `env-no-webgl` 全过 |
| 12 | dist 与基线 | ✅ `npm run build` → `dist/index.html` **776,364 B**（改前 766,289 B，**+10,075 B / +1.3%**）；13 个音频资产 `pw:dist` 逐字节 `=`；`./index.html` 一项 `!` 待主控重落 |

**惰性重建实测**（验收要点，不是"每帧重烘"）：自动时钟下 4 s 内 `SW.scene.env.rebuilds` **5 → 5**
（**0 次**重建，帧率 ~56 fps）；只有改参数强制清 `_envLast` 时才 +1。

### §7.6 前后两套读数（口径 `1306,876 → 1280×720`）

| 读数 | 改前（免构建 / dist） | 改后（免构建 / dist） | 变化 |
|---|---|---|---|
| **#13** peak/median(24相位中位) | 2.136 / 2.130 | **2.106 / 2.096** | −0.03（余量 10.5% / 10.3%） |
| #13 亮带质心 | 635.0 / 636.8 | 633.6 / 637.8（49.5% / 49.8%） | 中心 ±6% 内，噪声级 |
| **#6** 湖底 std（正午 60 帧中位） | 15.05 / 15.02 | **14.93 / 14.88** | −0.12（地板 14，余量 +6.6%） |
| **#5** chromaStep max | 2.108 @sun | **2.108 @sun** | 逐字不变（per 表全同） |
| **#3** 折射差分 | 18.8%/4.67/91 · 19.0%/4.65/81 | **17.8%/4.76/78 · 17.8%/4.75/72** | 高于判据（>10% / >30） |
| #2 calls / tris | 6 / 53088 | 6 / 53088 | 未变 |
| #14 / #15 | 0.809 · 0.4377/0.4548 | 0.809 · 0.4377/0.4548 | 未变 |
| **四态 R−B**（晨 5.5 / 午 12.5 / 昏 18.5 / 夜 22.5） | 4.26 · **−32.11** · 40.73 · −32.91 | **4.81 · −32.96 · 41.40 · −33.45** | 每态偏移 ≤0.9；暖冷跨度 73.8 → **74.9**（区分度未破） |
| 四态全幅亮度 | 137.46 · 157.36 · 131.17 · 83.03 | 139.26 · **162.62** · 134.52 · 84.61 | 午 +3.3%（最大），夜 +1.9% |

**两入口一致性**：15 条 detail **逐字相同**；四态 R−B / 亮度差 **≤0.05**；噪纹状态量（#3 hitFrac、
#13 质心）差 ≤0.9。

### §7.7 pw 像素基线：**未红，无需重录**（与 §5 的预期相反，附实测原因）

`npm run pw` **14 passed** —— `full.png` / `ui-panel.png` / `bed-clip.png` **全部未红**。
不是"没改"：在 pw 的**钉相位**（h=12.5 / uTime=7）下，env 开/关两帧实测

| 量 | 值 |
|---|---|
| 帧指纹 | env_ON `4136680232` vs env_OFF `1606781963`（**不是同一帧**） |
| **max 通道差** | **50 / 255 = 0.196** ← 恰好在 Playwright `threshold: 0.2` **之下** |
| RMS / PSNR | 9.90 / **28.2 dB**（对照：不钉相位的波纹相位噪声是 20.1~32 dB） |
| 有差异素比例 | **99.0%** |

→ **UP3 改变了 99% 的像素，但没有任何一个像素越过感知阈值** → 基线保持绿。
代价是这条基线**对本包不设防**（与 `03-COLLAB-PROTOCOL.md §8.2` 记录的盲区同源；
UP11 是"2866 raw px → 8 px 超阈"，本包更极端："99% raw px → 0 px 超阈"）。
是否为新画面重录 `full.png` 由**主控裁**（重录 = 基线反映 UP3 后画面；不重录 = 保留"升级前画面"的原始比对能力）。
本包**不自作主张**（`03 §7.1-③`）。

> 顺带确认：`env_ON` 的帧指纹 `4136680232` 与 `20-determinism` 用例 C 的 4 次采样指纹**逐位相同**
> —— 即 UP3 之后，pw 的确定性链（hour + uTime + dt 三钉）**没有被打断**，加法天然可复现。

### §7.8 提交

（`git log -1 --stat` 原文粘贴于此处 —— 见提交后补录）

