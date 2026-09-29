// plan/pw/tests/60-env-refresh.spec.mjs —— UP13-fix1（AM-030）· env 重建闸门回归
//
// 钉死本案的三条原始症状（`plan/103-UP13-fix1-env-freeze.md §0 / §5`）：
//   R1 冷启动进夜段   ⇒ `env.gate == 0`（无横向光带）
//   R2 白天「拖」到夜 ⇒ `env.gate` **必须跟随到 0**（旧实现冻在中间档 ⇒ 光带不消失）
//   R3 「拖」140+ 帧后 `rebuilds` 不得随帧数线性爆炸（旧实现每帧重建 ⇒ 烧光终身配额）
//
// ⚠ 用 `__seek()` 连打代替真实 pointermove：两者对 20-time.js 的效果**相同**
//   （都换新 TimeState 对象 ⇒ `envDist > 0`），且不引入鼠标坐标的脆弱性。
// ⚠ 本文件**不进交付物**（dist 加载链不引用 plan/pw/**），见 playwright.config 头注。

import { test, expect } from '@playwright/test';
import { ENTRY } from '../lib/const.mjs';

const envState = `(function(){
  var e = SW.scene.env;
  return { gate: e.gate, spread: e.spread, rebuilds: e.rebuilds, deferred: e.deferred,
           ready: e.ready, err: e.err };
})()`;

test('UP13-fix1 · env 重建闸门（昼夜换档后 gate 必须跟随）', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3500);

  // ── R1 冷启动直接进夜段 → gate 必须 = 0
  await page.evaluate('window.__seek(22.5)');
  await page.waitForTimeout(1200);
  const r1 = await page.evaluate(envState);
  expect(r1.gate, 'R1 冷启动夜段 gate 必须 = 0（无光带）').toBe(0);

  // ── R2 冷启动正午 → 连续「拖」到夜 → gate 必须跟到 0
  await page.evaluate('window.__seek(12.5)');
  await page.waitForTimeout(1200);
  const noon = await page.evaluate('SW.scene.env.gate');
  expect(noon, 'R2 起点（正午）gate 必须 = 1').toBe(1);

  const frames = await page.evaluate(`(function(){
    return new Promise(function (res) {
      var h = 12.5, n = 0;
      function step() {
        window.__seek(h);
        h += 0.05; n++;
        if (h > 22.6) { res(n); return; }
        requestAnimationFrame(step);
      }
      step();
    });
  })()`);
  await page.waitForTimeout(900);            // 静默期（6 帧 ≈ 0.1 s）+ 余量
  const r2 = await page.evaluate(envState);

  expect(r2.gate, `R2 「拖」${frames} 帧到夜后 gate 必须跟随到 0（旧实现冻在中间档）`).toBe(0);
  expect(r2.ready, 'R2 env 必须仍 ready（闸门不得静默失效）').toBe(true);
  expect(r2.err, 'R2 env.err 必须为空').toBe('');
  expect(r2.deferred, 'R2 拖动中应有被静默期推迟的次数（证明 debounce 生效）').toBeGreaterThan(0);
  expect(r2.rebuilds,
    `R2 拖动 ${frames} 帧后 rebuilds 必须远小于帧数（旧实现每帧重建 ⇒ 撞 40 终身配额）`
  ).toBeLessThan(frames);

  console.log(`\n  ℹ 拖动 ${frames} 帧 → gate ${noon} → ${r2.gate}  rebuilds=${r2.rebuilds}  deferred=${r2.deferred}`);
});
