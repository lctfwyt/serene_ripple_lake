// build-vendor-post.mjs —— 生成 vendor/three-post.min.js（主控所有）
//
// 目的：免构建入口（file:// 双击）接 UP2 后期处理。r160 UMD 里没有 postprocessing，
// 而升级 three 会破坏 UMD（r161 起移除），故把 three@0.160.0 的 examples/jsm
// 后处理子集打成 IIFE，挂 window.THREEPOST。
//
// 关键设计：bundle **不含** three 本体 —— 用 stub 把 `import ... from 'three'`
// 映射到 window.THREE（vendor/three.min.js 的 UMD 实例）。这是刻意的：
// ① 省掉 670KB 重复；② composer 内部对象与场景里的对象同源，规避跨实例
// instanceof 风险；③ 版本一致性由 node_modules/three 与 vendor 锁同版本保证。
//
// 用法：node plan/build-vendor-post.mjs
// 产出：vendor/three-post.min.js（打印 字节数 + sha256，登记进 vendor/README.md）

import { rolldown } from 'rolldown';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-post-'));
const OUT = path.join(ROOT, 'vendor', 'three-post.min.js');

// —— 1. stub：把 'three' 的全部导出映射到 window.THREE ——
const threeNames = Object.keys(THREE);
const stub = path.join(TMP, 'three-stub.mjs');
fs.writeFileSync(
  stub,
  'const T = window.THREE;\n' +
  'export default T;\n' +
  threeNames.map((n) => `export const ${n} = T[${JSON.stringify(n)}];`).join('\n') +
  '\n'
);

// —— 2. 入口：暴露 UP2 需要的后处理类（ShaderPass 留给 vignette/grain 自定义着色器）——
const entry = path.join(TMP, 'entry.mjs');
fs.writeFileSync(
  entry,
  `import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js';
window.THREEPOST = { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, CopyShader, LuminosityHighPassShader };
`
);

// —— 3. 打包（IIFE，压缩；加载时副作用挂 window.THREEPOST）——
const bundle = await rolldown({
  input: entry,
  resolve: {
    alias: {
      three: stub,
      // rolldown 不认 three 的 package.json exports 子路径，显式映射
      'three/addons': path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm'),
    },
  },
});
const { output } = await bundle.generate({ format: 'iife', minify: true });
const code = output[0].code;
fs.writeFileSync(OUT, code);

const sha = createHash('sha256').update(code).digest('hex');
console.log(`vendor/three-post.min.js`);
console.log(`  bytes : ${Buffer.byteLength(code)}`);
console.log(`  sha256: ${sha}`);
console.log(`  three 导出映射: ${threeNames.length} 个 → window.THREE`);
console.log(`  暴露: window.THREEPOST.{EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, CopyShader, LuminosityHighPassShader}`);
fs.rmSync(TMP, { recursive: true, force: true });
