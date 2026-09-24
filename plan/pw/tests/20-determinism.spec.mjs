// plan/pw/tests/20-determinism.spec.mjs —— UP6 · 确定性证明
//
// 这个文件回答一个问题：**"钉住状态之后，同一入口跑两次能不能拍出同一帧？"**
//
// 为什么必须回答它（60-UPGRADE-ROADMAP.md §2.1）：
//   UP1a 实测过，四态静帧是**时间驱动**的（水面 uTime 自走相位）——
//   同入口跑两次 PSNR 只有 20.9~30.5 dB，跨入口 20.0~46.1 dB，两种差异**同量级**。
//   所以「静帧 diff 了」不构成"改坏了"的证据，而 `toHaveScreenshot()` 若直接罩上去就是**一条永远红的断言**。
//
// 三个用例，一条推理链：
//   A. 只钉 uTime → **不够**（`60-water.js:456` 每帧 `u.uTime.value = tAcc` 会把它覆盖掉）
//   B. 不钉任何东西 → 复现 §2.1 的漂移量级（复述前提）
//   C. 钉住三条链（hour + uTime + dt）→ 帧指纹逐位相同（这才让 toHaveScreenshot 有意义）

import { test, expect } from '@playwright/test';
import { HELPERS, EXTRA, pinSnippet } from '../lib/page-lib.mjs';
import { ENTRY, PIN_HOUR, PIN_UTIME } from '../lib/const.mjs';

const HOURS4 = [5.5, 12.5, 18.5, 22.5];
const NAMES = { 5.5: 'dawn', 12.5: 'noon', 18.5: 'dusk', 22.5: 'night' };
const drift = [];

test.beforeEach(async ({ page }) => {
  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(HELPERS);
  await page.evaluate(EXTRA);
});

test('A · 只钉 uTime 是不够的：update() 每帧会把它覆盖回 tAcc', async ({ page }) => {
  await page.evaluate('window.__seek(12.5)');
  await page.waitForTimeout(1200);

  // 模拟 roadmap §2.1 #3 的第一条路子："先 SW.water.uniforms.uTime.value = 固定值"
  const r = await page.evaluate(`(function(){
    SW.water.uniforms.uTime.value = 7.0;
    var justAfter = SW.water.uniforms.uTime.value;
    return new Promise(function(res){
      setTimeout(function(){
        res({ justAfter: justAfter, after300ms: SW.water.uniforms.uTime.value });
      }, 300);
    });
  })()`);

  console.log(`  ℹ uTime 赋值后立即读 = ${r.justAfter} · 300ms 后读 = ${r.after300ms}`);
  // 结论：单次赋值活不过一帧 —— 所以"只钉 uTime"这条路必须配合「在 update 之后再钉一次」
  expect(r.justAfter, '赋值瞬间生效').toBe(7.0);
  expect(r.after300ms, '300ms 后已被 water.update() 覆盖回 tAcc').not.toBe(7.0);
});

test('B · 不钉任何东西 ⇒ 复现 §2.1 的相位漂移量级', async ({ page }) => {
  for (const h of HOURS4) {
    await page.evaluate(`window.__seek(${h})`);
    await page.waitForTimeout(1500);
    await page.evaluate(`window.__pw.snap('nopin-${h}')`);
    await page.waitForTimeout(900);                      // 只让水面自走 ~0.9s
    const d = await page.evaluate(`window.__pw.diffVs('nopin-${h}')`);
    drift.push({ hour: h, name: NAMES[h], ...d });
    console.log(`  ℹ ${NAMES[h].padEnd(5)} 同入口两次（不钉）: max=${String(d.max).padStart(3)}  PSNR=${String(d.psnr).padStart(4)}dB  有差异素=${(d.diffPxFrac * 100).toFixed(1)}%`);
    await page.evaluate(`window.__pw.drop('nopin-${h}')`);
  }
  console.log('  ↳ 对上 roadmap §2.1「同入口 dist #1↔#2」列（dawn 30.5 / noon 26.3 / dusk 24.4 / night 20.9 dB）');
  // 判据：不钉就一定漂 —— 这正是「不能拿静帧做像素基线」的理由，也是本文件存在的原因
  expect(drift.every((d) => d.same === false), '不钉状态时，两帧必然不同').toBe(true);
  expect(Math.max(...drift.map((d) => d.max)), '最大通道差量级').toBeGreaterThan(30);
});

test('C · 钉住 hour + uTime + dt ⇒ 帧指纹逐位相同（toHaveScreenshot 才成立）', async ({ page }) => {
  await page.evaluate(pinSnippet(PIN_HOUR, PIN_UTIME));
  await page.evaluate(`(function(){
    var d = document.getElementById('dbg'); if (d) { d.style.display = 'none'; }
    return true;
  })()`);

  const hashes = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(700);                      // 每轮之间让 rAF 至少跑 40 帧
    const s = await page.evaluate(`window.__pw.hashFrame()`);
    hashes.push(s.hash);
    console.log(`  ℹ 第 ${i + 1} 次采样 hash=${s.hash}  (${s.w}×${s.h})`);
  }
  const uniq = [...new Set(hashes)];
  console.log(`  ↳ 4 次采样 · 不同指纹数 = ${uniq.length}（期望 1）`);

  expect(uniq.length, '钉住之后同一帧必须可复现').toBe(1);
  expect(hashes[0], '指纹非 0（确认真的算过像素）').not.toBe(0);
});
