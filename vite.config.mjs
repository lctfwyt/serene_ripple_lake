// vite.config.js —— UP1a 构建链配置
//
// ⚠ 本项目的 package.json **故意不写 `"type": "module"`**，原因与构建无关但很关键：
//   plan/wp5-assert.js / plan/wp5-env.js 是 **CommonJS**（用 require()），它们靠「最近的
//   package.json 没有 type:module」才被 Node 当 CJS 解析。一旦加上 "type": "module"，
//   这两个断言脚本会立刻以 `require is not defined` 挂掉。
//   → 想清楚再动 package.json 的 type 字段。Vite 自己不受影响：它会先把本文件打包成临时
//     ESM 再加载，所以这里写 import/export 是合法的。
//
// 目标（80-UP1-build-chain.md §0）：
//   免构建入口 index.html  —— 逐字节不变、行为不变（由 §5-#10 的 git diff 把关）
//   构建入口 app/ → dist/  —— singlefile：JS/CSS 内联；**但它旁边必须有 dist/assets/audio/**
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 插件 1：音频随行（§2.3）
//
// 🔴 为什么打包器管不了音频：`P.bgmFile = 'assets/audio/bgm-stillwater.mp3'` 与
//    10-audio.js 的 SLAP_FILES 都是**运行时字符串**，不是 `import` —— 打包器眼里它们
//    只是普通字符串，不会进 bundle、不会被改写、更不会被复制。
//    而 10-audio.js 用相对路径 `assets/audio/...` 找它们 → dist/index.html 旁边
//    必须真的存在 dist/assets/audio/。
//
// 「dist/ 双击即开」按**目录**判：与今天的 index.html 需要同目录的 assets/ 同理，无退化。
// ============================================================================
function swCopyAudio() {
  return {
    name: 'sw:copy-audio',
    apply: 'build',
    closeBundle() {
      const from = path.join(ROOT, 'assets');
      const to = path.join(ROOT, 'dist', 'assets');
      if (!fs.existsSync(from)) { throw new Error('[sw:copy-audio] assets/ 不存在：' + from); }
      fs.cpSync(from, to, { recursive: true });
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) =>
        n + (e.isDirectory() ? walk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
      console.log(`[sw:copy-audio] assets/ → dist/assets/  ${walk(to)} B`);
    }
  };
}

// ============================================================================
// 插件 2：HMR 自接受垫片（dev-only，只影响被白名单点名的模块）
//
// 为什么需要它：Vite 对「没有 accept 的模块」的默认行为是**逐级上抛 → 整页刷新**。
// 而 §5-#9 要求「改 src/80-ui.js 一行文案，**不整页刷新**即生效」。
// accept 必须写在模块自己或它的导入方里 —— 但 src/** 属于「不许碰」（§1.2），
// 所以只能在 **dev 的 transform 阶段附加**：不落盘、不进构建、git diff 依然为空。
//
// 为什么白名单只有 80-ui.js：
//   本项目 12 个模块全部是「init 一次、之后只通过 SW.x 被渲染循环调用」的形态。
//   对大多数模块来说，「重新执行模块 = 换掉 SW.x 这个对象」会**丢掉 init 建立的内部状态**
//   （例如 30-scene.js 重执行后 SW.scene.renderer/ scene/ camera 全是 undefined → 循环立刻炸）。
//   80-ui.js 是唯一能安全重入的：它只建 DOM，而 DOM 可以整体清掉重建。
//   → 其余模块仍走 Vite 默认（整页刷新），这是**刻意的保守选择**，不是遗漏。
//   ⚠ 每改一次 80-ui.js 会多一个 window keydown 监听（匿名，摘不掉）。dev-only，无害。
// ============================================================================
const HMR_SELF_ACCEPT = ['src/80-ui.js'];
const HMR_SHIM = `
/* ---- dev-only HMR 垫片（vite.config.js 追加，不落盘、不进构建）---- */
if (import.meta.hot) {
  import.meta.hot.accept(function () {
    var ui = document.getElementById('ui');
    if (ui) { ui.innerHTML = ''; }          // 清掉上一版建的 DOM（含 #snd / #hour）
    if (window.SW && SW.ui && SW.ui.init) { SW.ui.init(); }
  });
}
`;
function swHmrShim() {
  return {
    name: 'sw:hmr-shim',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      const norm = id.replace(/\\/g, '/');
      if (!HMR_SELF_ACCEPT.some((f) => norm.endsWith(f))) { return null; }
      return { code: code + HMR_SHIM, map: null };
    }
  };
}

export default defineConfig({
  // 构建入口在 app/，根 index.html 因此**完全不参与构建**
  root: 'app',
  plugins: [viteSingleFile(), swCopyAudio(), swHmrShim()],
  server: {
    // 允许 dev server 读到 app/ 之外的 ../src（默认已是工程根，此处显式写死防未来漂移）
    fs: { allow: [ROOT] }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,          // dist/ 是纯产物，每次干净重建
    // ⚠ 不设 target / output.format：先按默认试。§3-R1 的退路顺序见 80-UP1-build-chain §6，
    //   只有 §5-#3（file:// 双击能开）失败才逐级启用，并在 _STATUS.md 记录实际走向。
  }
});
