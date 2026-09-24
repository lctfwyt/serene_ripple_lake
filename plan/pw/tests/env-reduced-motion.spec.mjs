// plan/pw/tests/env-reduced-motion.spec.mjs —— UP6 · 环境判据 #3（对应 plan/wp5-env.js 判据 #3）
//
// 启动条件换档靠 config 的 `env-reduced-motion` project：`use: { reducedMotion: 'reduce' }`。
//
// ⚠ 原脚本（wp5-env.js）为此做了三步：起页 → `Emulation.setEmulatedMedia` → **再 navigate 一次**
//   （因为它自己注释了"媒体模拟必须在页面加载前生效 → 设置后重新导航一次"）。
//   这里 `reducedMotion` 是 **context 级选项**，从第一帧就生效 → 那次多余导航直接省掉。
//
// 判据（与 wp5-env.js 同义，`85-fallback.js` 的三条"自动涌动"逐项覆盖）：
//   ① 命中媒体查询            ② 不自动走时（hour 锁 fixed）
//   ③ 相机呼吸 / 细节抖动关闭  ④ 水面自走相位钉住（`__rmFrozen` + uTime 前后相等）
//   ⑤ 点击仍出涟漪（"只响应显式点击"是**保留**项，不能被冻 dt 连带冻掉）
//   ⑥ 画面非空（静帧）        ⑦ console 无 JS 报错

import { test, expect } from '@playwright/test';
import { ENTRY } from '../lib/const.mjs';

// 采样用的区间平均亮度（照抄 wp5-env.js）
const MEAN_LUM = `(function(){
  var r = SW.scene.renderer, gl = r.getContext();
  var w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
  r.render(SW.scene.scene, SW.scene.camera);
  var b=new Uint8Array(w*h*4);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);
  var s=0,n=0;
  for(var y=Math.floor(h*0.2);y<Math.floor(h*0.6);y+=3){
    for(var x=0;x<w;x+=3){ var i=(y*w+x)*4; s+=0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2]; n++; }
  }
  return +(s/n).toFixed(2);
})()`;

test('env #3 · prefers-reduced-motion: reduce ⇒ 静帧 + 只响应显式点击', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('exception: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console.error: ' + m.text()); } });

  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3000);

  const t0 = await page.evaluate('({ h: SW.time.getHour(), mode: SW.time.getMode(), rm: matchMedia("(prefers-reduced-motion: reduce)").matches, fb: SW.fallback })');
  const s0 = await page.evaluate(MEAN_LUM);
  await page.waitForTimeout(4000);
  const t1 = await page.evaluate('SW.time.getHour()');
  const s1 = await page.evaluate(MEAN_LUM);
  const rm = await page.evaluate('({ rm: SW.fallback.reducedMotion, cam: SW.P.cameraSway, jit: SW.P.glitterJitter, applied: SW.fallback.applied })');

  const u0 = await page.evaluate('SW.water.uniforms.uTime.value');
  await page.waitForTimeout(1200);
  const u1 = await page.evaluate('SW.water.uniforms.uTime.value');
  const frozen = await page.evaluate('!!SW.water.__rmFrozen');

  // 「只响应显式点击」：模拟一次真实点击，涟漪源必须被创建
  await page.mouse.move(640, 430);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const clickAct = await page.evaluate('SW.ripple.probe().active');

  console.log('  ' + JSON.stringify({ t0, s0, t1, s1, rm, u0, u1, frozen, clickAct }));

  expect(t0.rm, 'matchMedia(reduce) 命中').toBe(true);
  expect(rm.rm, 'SW.fallback.reducedMotion').toBe(true);
  expect(t0.mode, '时间模式锁 fixed').toBe('fixed');
  expect(t1, '4s 后 hour 完全不变').toBe(t0.h);
  console.log(`  ℹ hour ${t0.h.toFixed(4)} → ${t1.toFixed(4)}（4s 后，差 ${Math.abs(t1 - t0.h).toExponential(2)}）`);

  expect(rm.cam, '相机呼吸关闭').toBe(false);
  expect(rm.jit, '细节抖动关闭').toBe(0);
  console.log(`  ℹ 降级项 [${rm.applied.join(' | ')}]`);

  expect(frozen, 'SW.water.__rmFrozen').toBe(true);
  expect(u0, 'uTime 被钉住（1.2s 前后必须相等）').toBe(u1);
  console.log(`  ℹ uTime ${u0} → ${u1}`);

  expect(clickAct, '点击仍出涟漪（"只响应显式点击"是保留项）').toBeGreaterThan(0);
  expect(s0, '区间均亮（静帧非空）').toBeGreaterThan(10);
  expect(s1, '区间均亮（4s 后仍非空）').toBeGreaterThan(10);
  console.log(`  ℹ 画面亮度 ${s0} → ${s1}`);

  expect(errors, 'console 无 JS 报错').toEqual([]);
});
