// app/main.js —— UP1a 构建入口的唯一入口模块
//
// 🔴 本文件的 import 顺序**必须与根 index.html 第 29–41 行的 <script> 顺序逐条一致**（R3）。
//    下面每条 import 后面标了它在 index.html 里对应的行，核对时按行号对。
//
//    第 1 条是 three 的全局挂载（替代 index.html:29 的 <script src="vendor/three.min.js">）：
//    它必须在最前，因为 src/ 全部用 `var THREE = window.THREE` 取全局。
//    ESM 的 import 声明会被提升，但**求值顺序 = 书写顺序**（深度优先后序），所以这样写是可靠的。
//
// 为什么 src/ 保持 IIFE + 经典脚本写法、不做 ESM 化：
//    它们要**同时**被两条入口加载。ESM 化会打断 `window.SW` 这个模块间契约（契约 §1），
//    也会让免构建入口（纯经典 <script>）直接失效。详见 80-UP1-build-chain.md §2。
import './three-global.js';        // ← index.html:29  vendor/three.min.js（改为 ESM 挂全局）
import '../src/00-config.js';      // ← index.html:30
import '../src/10-audio.js';       // ← index.html:31
import '../src/20-time.js';        // ← index.html:32
import '../src/30-scene.js';       // ← index.html:33
import '../src/40-lakebed.js';     // ← index.html:34
import '../src/50-ripple.js';      // ← index.html:35
import '../src/60-water.js';       // ← index.html:36
import '../src/70-input.js';       // ← index.html:37
import '../src/80-ui.js';          // ← index.html:38
import '../src/85-fallback.js';    // ← index.html:39
import '../src/90-debug.js';       // ← index.html:40
import '../src/99-main.js';        // ← index.html:41

// 启动：try/catch 兜底，失败就显示 #fallback，不要白屏
// （与 index.html:42-50 的内联 boot 逐字同义）
try {
  window.SW.boot();
} catch (e) {
  console.error('[still_water] boot failed', e);
  document.getElementById('fallback').classList.add('on');
  document.getElementById('c').style.display = 'none';
}
