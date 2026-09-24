// app/post-global.js —— UP2（AM-009）：构建入口的后处理类供给件
//
// 免构建入口由 vendor/three-post.min.js 提供 window.THREEPOST（主控构建）；
// 构建入口在这里用 three/addons **原生 import** 挂同一个全局 —— 65-post.js 两条入口零分叉。
//
// ⚠ 依赖顺序：必须晚于 three-global.js（同类需求：src/ 都从 window.THREE 取全局），
//   且早于 src/65-post.js 首次使用（实际 65-post 在 bus 'ready' 时才 init，这里是顺序对齐）。
// ⚠ 不要把 addons 赋到 `import * as THREE` 的命名空间对象上 —— ESM namespace 不可扩展，
//   严格模式下赋值直接 TypeError。只挂 window.THREEPOST。
//   addons 内部 `import ... from 'three'` 与 three-global.js 是同一模块实例（Rollup 合并），
//   不存在第二份 THREE。
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

window.THREEPOST = { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass };
