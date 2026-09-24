// plan/pw/tests/env-no-webgl.spec.mjs —— UP6 · 环境判据 #4（对应 plan/wp5-env.js 判据 #4）
//
// 启动条件换档靠 config 的 `env-no-webgl` project：`--disable-3d-apis --disable-webgl`。
//
// 判据（与 wp5-env.js 同义）：
//   · `#fallback` 亮起、`#c` 隐藏（不白屏）
//   · **未进入任何模块 init**（`SW.ready === false`、`SW.fallback.webgl === false`）
//   · 兜底文案含 "WebGL"
//   · console **零 JS 报错**（走的是 `85-fallback.js` 的 boot 拦截器，不是 index.html 的 try/catch ——
//     后者会打一条 console.error；这条判据正是用来区分两条兜底路径的）

import { test, expect } from '@playwright/test';
import { ENTRY } from '../lib/const.mjs';

test('env #4 · 强制关 WebGL ⇒ 渐变兜底，不白屏、console 干净', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('exception: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console.error: ' + m.text()); } });

  await page.goto(ENTRY);
  // 这里**不能**等 `SW.ready`（WebGL 不可用时它永远不会变 true）—— 等兜底 DOM 就位即可
  await page.waitForFunction(`!!document.getElementById('fallback')`, null, { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(`(function(){
    var f = document.getElementById('fallback'), cv = document.getElementById('c');
    return { fb: SW.fallback, hasFallback: !!f, fbOn: f ? f.classList.contains('on') : null,
             fbText: f ? (f.textContent || '').trim() : '',
             canvasDisplay: cv ? getComputedStyle(cv).display : null,
             uiDisplay: (function(){ var u = document.getElementById('ui'); return u ? getComputedStyle(u).display : null; })(),
             webglCtx: (function(){ try { var t = document.createElement('canvas'); return !!(t.getContext('webgl2') || t.getContext('webgl')); } catch(e){ return 'throw'; } })(),
             swReady: !!SW.ready, probeExposed: typeof window.__probe };
  })()`);
  console.log('  ' + JSON.stringify(r));

  expect(r.webglCtx, 'flag 真的关掉了 WebGL（否则本用例无意义）').toBe(false);
  expect(r.fbOn, '#fallback 亮起').toBe(true);
  expect(r.canvasDisplay, '#c 已隐藏（不白屏）').toBe('none');
  expect(r.swReady, '未进入任何模块 init').toBe(false);
  expect(r.fb.webgl, 'SW.fallback.webgl').toBe(false);
  expect(r.fb.bootWrapped, 'boot 拦截器已装').toBe(true);
  expect(r.fbText, '兜底文案').toContain('WebGL');
  console.log(`  ℹ reason="${r.fb.reason}" · #ui display=${r.uiDisplay} · __probe=${r.probeExposed}`);

  expect(errors, 'console 无 JS 报错（说明走的是 boot 拦截器，不是 try/catch 兜底）').toEqual([]);
});
