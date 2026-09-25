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
> ⚠ 跑 `pw` 若被 safe-delete 守卫拦，见 `03-COLLAB-PROTOCOL.md §8.1`（用 `--output=test-results/_pwN`）。

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

> **状态：⬜ 未开工**（包文档 2026-09-25 由主控拆出；施工方从下方起追加）
