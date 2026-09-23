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

## 许可证合规

MIT 许可证要求分发时保留版权声明与许可声明。`three.min.js` 文件**头部内嵌**了完整的
`@license` 块（SPDX 标识亦在其中），因此**单独分发该文件即已满足要求**，无需附带额外文件。

若将来移除了内嵌注释（例如经打包器压缩），**必须**在此目录补一份
`LICENSE.three.txt`，写明 MIT 全文与出处。
