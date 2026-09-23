// app/jsm-smoke.js —— UP1a §5-#8：证明 three/examples/jsm 生态已解锁
//
// 这是本包存在的**唯一理由**的验证件（§0）：免构建入口只有 UMD 的 three 主包，
// `examples/jsm` 全是 ESM → 在经典 <script> 下根本不可达。UP1a 引入构建链后它才可达，
// 而 UP2 要的 EffectComposer / UP3 要的 RGBELoader 都卡在这一步。
//
// 🔴 本文件**不接入渲染管线**（那是 UP2 的事）。它只做两件事：
//     ① 真实 import → 证明解析/链接通过（这才是「解锁」的判据）
//     ② 用**真实 WebGLRenderer** 建一个 EffectComposer 实例 → 证明不是只有类型能读
//    跑完把结果挂到 window.__jsmSmoke，并把同一份结果画到页面上。
//
// 只存在于 dev server（http://localhost:5173/jsm-smoke.html）。
// ⚠ 请勿把它加进 app/index.html 或 app/main.js —— 它会进 dist 产物并抬高体积。
import * as THREE from 'three';
// ↓↓ 这三条以前是**不可达**的：免构建入口（经典 <script> + UMD）拿不到 examples/jsm
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const rows = [];
function step(name, fn) {
  try {
    const detail = fn();
    rows.push({ name, ok: true, detail: String(detail) });
  } catch (e) {
    rows.push({ name, ok: false, detail: (e && e.message) || String(e) });
  }
}

step('three 版本', () => 'r' + THREE.REVISION);
step('EffectComposer 是构造函数', () => {
  if (typeof EffectComposer !== 'function') { throw new Error('不是 function：' + typeof EffectComposer); }
  return 'typeof = function';
});
step('RGBELoader 是构造函数（UP3 的前置）', () => {
  if (typeof RGBELoader !== 'function') { throw new Error('不是 function：' + typeof RGBELoader); }
  return 'typeof = function';
});
step('真实 WebGLRenderer', () => {
  const r = new THREE.WebGLRenderer({ antialias: false });
  r.setSize(64, 64, false);
  return r.getContext().getParameter(r.getContext().VERSION);
});
step('★ 用真实 renderer 建 EffectComposer 实例', () => {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(64, 64, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const composer = new EffectComposer(renderer);            // ← §5-#8 的原话：能建实例
  composer.addPass(new RenderPass(scene, camera));
  composer.render();                                        // 真跑一帧，证明 RT 链可用
  return 'renderTarget 尺寸 ' + composer.renderTarget1.width + '×' + composer.renderTarget1.height +
         ' · passes=' + composer.passes.length;
});
step('UnrealBloomPass（UP2 的实际 pass）', () => {
  const p = new UnrealBloomPass(new THREE.Vector2(64, 64), 0.5, 0.4, 0.85);
  return p.constructor.name + ' · strength=' + p.strength;
});

window.__jsmSmoke = { ok: rows.every((r) => r.ok), rows, rev: THREE.REVISION };

const box = document.getElementById('out');
box.innerHTML = rows.map((r) =>
  `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✅' : '❌'} <b>${r.name}</b> — <span>${r.detail}</span></div>`
).join('') + `<div class="sum">${window.__jsmSmoke.ok ? '★ 全部通过：examples/jsm 已解锁' : '⚠ 有失败项，见上'}</div>`;
