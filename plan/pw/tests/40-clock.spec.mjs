// plan/pw/tests/40-clock.spec.mjs —— UP6 · page.clock 驱动模拟时间
//
// 目的：把 `plan/wp5-assert.js` 的 **#4（涟漪衰减）** 从"等墙钟 4 秒"换成"推假时钟"，
//   顺带绕开 `50-ripple.js` 的 `MAX_SUB = 4` 那个坑（90-WAVE4 §4 方案要点原文）。
//
// 为什么原脚本要绕（wp5-assert.js #4 的注释）：
//   `50-ripple.js` 用固定子步 `SUB_DT = 1/60` 推进，且一帧最多 4 个子步；
//   `step()` 内部还把 dt 钳到 0.25。所以**锁一个大 dt 推不动模拟时间**——
//   每帧最多推进 4×(1/60) = 0.0667s，跟不锁一样。原脚本只好"自然衰减 + 20s 超时兜底"。
//
// 本文件做两件事：
//   ① 用 `SW.ripple.step(4.6)` 单次调用**量化**上面那句话（delta 只有 0.0667 而不是 4.6）
//   ② 用 `page.clock` 把 6 秒模拟时间**一次推完**，并断言源按 simTime 正常老化
//
// ⚠ 老实说清楚它换来了什么（UP6 实测，别替它吹）：
//   两轮实测墙钟 **2268ms / 4978ms**（同样推 6000ms 假时间），而原脚本的"自然衰减"实测 3750ms。
//   → **它不一定更快，甚至可能更慢**。因为墙钟大头是 375 帧 rAF 的 GL 渲染，一帧都省不掉；
//     原脚本的"自然衰减"其实是在等**同一个** 4.5s 模拟时间走完，两边的帧数是同一个数量级。
//   真正的收益是**确定性**：一次调用推进精确的模拟时间，
//   不再"轮询 20s 等它自己老化、超时了再拿 step() 兜底"。判据从"赛跑"变成"算术"。
//   ⚠ 所以下面**不设"更快"的硬阈值** —— 那种阈值会随机器抖动，而且它本来就不是本用例的主张。
//
// ⚠ `page.clock` 必须在 `goto` **之前** install。它替换页面的 Date / setTimeout /
//   requestAnimationFrame / performance —— 而 `THREE.Clock` 走的是 `performance.now()`，
//   所以整条 dt 链（99-main → ripple.step → simTime）都被接管了。

import { test, expect } from '@playwright/test';
import { ENTRY } from '../lib/const.mjs';

test('page.clock 驱动 #4：量化 MAX_SUB=4 的限流 + 把"轮询等 4 秒"换成一次推完', async ({ page }) => {
  test.setTimeout(120_000);

  await page.clock.install({ time: new Date('2026-09-24T12:00:00') });
  await page.goto(ENTRY);
  await page.clock.runFor(4000);                 // 推 4s 假时间：boot + rAF 循环跑起来

  const ready = await page.evaluate('!!(window.SW && window.SW.ready === true)');
  expect(ready, 'SW.ready（假时钟下 boot 仍完成）').toBe(true);

  await page.evaluate('window.__seek(12.5)');
  await page.clock.runFor(1200);

  // ---------------------------------------------------------- ① 量化 MAX_SUB 限流
  const lim = await page.evaluate(`(function(){
    var t0 = SW.ripple.probe().simTime;
    SW.ripple.step(4.6);                       // 一个巨大的 dt
    var t1 = SW.ripple.probe().simTime;
    return { before: +t0.toFixed(4), after: +t1.toFixed(4), delta: +(t1 - t0).toFixed(4) };
  })()`);
  console.log(`  ℹ 单次 step(4.6) → simTime 只推进 ${lim.delta}s（= MAX_SUB × 1/60 = ${(4 / 60).toFixed(4)}），远小于 4.6`);
  expect(lim.delta, '大 dt 被 MAX_SUB 限流').toBeLessThan(0.1);

  // ---------------------------------------------------------- ② page.clock 推进老化
  const t0 = await page.evaluate('SW.ripple.probe().simTime');
  const emitted = await page.evaluate('SW.ripple.emit(0, -6, 2.0)');
  const a0 = await page.evaluate('SW.ripple.probe().active');
  expect(emitted, 'emit 成功').toBe(true);
  expect(a0, 'emit 后 active').toBeGreaterThan(0);

  const wallStart = Date.now();
  await page.clock.runFor(6000);                 // 推 6s 假时间（≈ 375 帧 rAF）
  const wallMs = Date.now() - wallStart;

  const r = await page.evaluate(`(function(){
    var q = SW.ripple.probe();
    return { simTime: +q.simTime.toFixed(3), active: q.active, lifetime: SW.P.rippleLifetime };
  })()`);
  const dSim = +(r.simTime - t0).toFixed(3);
  console.log(`  ℹ runFor(6000ms 假时间) → simTime +${dSim}s · active=${r.active} · 墙钟耗时 ${wallMs}ms`);
  console.log(`  ↳ 对照：wp5-assert.js 走"自然衰减"实测 3.25~3.75s 墙钟（本轮 10-assert.spec.mjs 实测值）`);
  console.log(`     收益不在速度（375 帧 rAF 的 GL 渲染一帧都省不掉，实测 2268~4978ms，可能比自然衰减还慢），`);
  console.log(`     而在**确定性**：从"轮询 20s 等它自己老化 + 超时拿 step() 兜底"变成"一次调用推完精确的模拟时间"。`);

  expect(dSim, '假时钟真的推进了模拟时间').toBeGreaterThan(4.5);
  expect(r.active, '源按 simTime 老化，已全部退出活跃计数').toBe(0);
  // 只当"没卡死"的护栏，不当性能主张 —— 见文件头那段
  expect(wallMs, '推假时钟不该卡住').toBeLessThan(20_000);
});
