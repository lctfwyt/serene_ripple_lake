# vendor/ —— 第三方运行时依赖

本项目**无构建步骤**时的唯一外部依赖。它以 UMD 形式被 `index.html` 用经典 `<script>` 引入，
不走 npm、不走打包器 —— 这是「双击即开」这条交付形态的前提。

---

## three.js r160（UMD 构建）

| 项 | 值 |
|---|---|
| 文件 | `three.min.js` |
| 版本 | **r160** |
| 字节数 | **669,884** |
| SHA-256 | `170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa` |
| 许可证 | **MIT** —— Copyright © 2010-2023 Three.js Authors |

### 为什么锁死 r160，不能升

`build/three.min.js`（UMD）自 **r150 起被标记弃用**、**r161 起从发行包中移除**。
即 r160 是**最后一个提供 UMD 构建的版本**。升到 r161+ 只能改用 ES Module，
而 ESM 在 `file://` 下会被 CORS 挡掉 —— 直接破坏「双击打开」。

> 这也正是 `plan/60-UPGRADE-ROADMAP.md` 里 **UP1（Vite 构建链）** 要解决的根问题：
> 解开 UMD 约束后，才能用上 `three/examples/jsm` 全生态。

### 校验方法

```bash
sha256sum vendor/three.min.js
# 期望：170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa
wc -c < vendor/three.min.js
# 期望：669884
```

### 为什么它是纯 LF 且必须声明为二进制

文件当前是**纯 LF 换行**、字节数恰好 669,884。本机 `core.autocrlf=true`，
若 git 把它当作文本处理，某次 checkout 就会把 LF 换成 CRLF，字节数漂成 ~677 KB，
上述「字节锁」记录随之失效。

因此 `.gitattributes` 里有一条：

```gitattributes
vendor/*.min.js  binary
```

`binary` 等价于 `-text -diff` —— git 原样存取，不做任何换行转换，也不在 diff 里
展开这几百 KB 的噪声。

---

## three.js r160 · 后处理子集（`three-post.min.js`，**本项目构建物**）

> ⚠ 与上面的 `three.min.js` 性质不同：它**不是 upstream 原件**，而是由本仓构建脚本
> 从 `node_modules/three@0.160.0/examples/jsm` 打出的 bundle。存在理由：r160 UMD
> 不含 postprocessing，免构建入口（`file://`）接 bloom（UP2）需要它。

| 项 | 值 |
|---|---|
| 文件 | `three-post.min.js` |
| 字节数 | **25,676** |
| SHA-256 | `dcc9544789042013748e0cdeb9be9148ffccdbc995e8651f7d063a324de8ed86` |
| 来源 | three@**0.160.0**（与 `three.min.js` 锁同版本）`examples/jsm`：EffectComposer / Pass / MaskPass / RenderPass / ShaderPass / UnrealBloomPass / OutputPass + CopyShader / LuminosityHighPassShader |
| 格式 | IIFE，加载时副作用挂 **`window.THREEPOST`**（EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, CopyShader, LuminosityHighPassShader） |
| 三本体 | **不含** —— `import … from 'three'` 被映射到 `window.THREE`（stub）。composer 与场景共享同一个 three 实例，规避跨实例风险 |
| 许可证 | MIT —— 压缩剥除了内嵌许可头 → **必须保留 `LICENSE.three.txt`** |

### 重建 / 校验

```bash
node plan/build-vendor-post.mjs      # 重建并打印 sha256（应与上表一致）
sha256sum vendor/three-post.min.js
```

### 冒烟验证（2026-09-24，系统 Chrome headless · file:// · swiftshader）

加载 `vendor/three.min.js` + `three-post.min.js` 后：`EffectComposer → RenderPass →
UnrealBloomPass → OutputPass → render()` 全链无异常，追加 `ShaderPass(CopyShader)`
再渲染一帧亦通过，console/page error **0**。即 bundle 内部类与 UMD `window.THREE`
的跨实例互操作已被真实 WebGL 验证。

### 一致性约束（升 three 必读）

- 本 bundle 与 `three.min.js` **必须同版本**：两者都出自 three r160。将来若换 three
  版本（注意：r161+ 无 UMD），**两者必须一起换**，且重跑本构建脚本 + 冒烟。
- `plan/build-vendor-post.mjs` 依赖 `rolldown`（vite 8 的传递依赖），无新增直接依赖。

---

## 许可证合规

MIT 许可证要求分发时保留版权声明与许可声明。`three.min.js` 文件**头部内嵌**了完整的
`@license` 块（SPDX 标识亦在其中），因此**单独分发该文件即已满足要求**，无需附带额外文件。

若将来移除了内嵌注释（例如经打包器压缩），**必须**在此目录补一份
`LICENSE.three.txt`，写明 MIT 全文与出处。
