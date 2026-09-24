// plan/pw/tests/10-assert.spec.mjs —— UP6 · 断言套件（Playwright 版）
//
// 目的（90-WAVE4 §4 验收 #1）：把 `plan/wp5-assert.js` 的 15 条断言**包一层**，
// 一个不缺地跑通，并把读数字段名对齐落盘到 `plan/pw/pw-readings.json`，供 #2 逐字段比对。
//
// ⚠ 这是**搬运**，不是重写：
//   · 页面内测量库 = `plan/wp5-assert.js` HELPERS 的逐字副本（见 lib/page-lib.mjs 头注）
//   · 等待时长 / 判据阈值 / 检查顺序**照抄**，否则读数差异到底是"实现差异"还是"口径差异"说不清
//   · 旧脚本用 `check()` 记录不中断（一条失败仍跑完 15 条）—— 这里保留同一行为，
//     最后统一断言。这样失败时也拿得到完整读数，而不是第一处就断在半路。
//
// ⚠ 用例内顺序**不可调换**：#3 会往波场注入 4 个源，#8 的点击再注入 1 个，
//   残留波场会污染 #6（湖底 std）与 #13（反光柱剖面）。旧脚本就是这个顺序。

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { HELPERS, EXTRA } from '../lib/page-lib.mjs';
import { ENTRY, READINGS_NEW, READINGS_OLD } from '../lib/const.mjs';

const HOURS = [2, 5.5, 8, 12.5, 18.5, 22.5];

test('UP6 · 15 条断言（Playwright 版）', async ({ page }) => {
  test.setTimeout(300_000);

  const jsErrors = [], netErrors = [], results = [];
  page.on('pageerror', (e) => { jsErrors.push('exception: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { jsErrors.push('console.error: ' + m.text()); } });
  page.on('requestfailed', (r) => {
    const t = (r.failure() && r.failure().errorText) || '';
    netErrors.push(t + ' ' + r.url());
  });

  const check = (id, name, ok, detail) => {
    results.push({ id, name, ok: !!ok, detail });
    console.log(`${ok ? '  ✅' : '  ❌'} #${id} ${name}  ${detail}`);
  };
  const ev = (expr) => page.evaluate(expr);

  // ================================================================ 起页
  await test.step('起页 + 注入测量库', async () => {
    await page.goto(ENTRY);
    await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
    await page.waitForTimeout(3500);          // 旧脚本：await ev('1'); await sleep(3500)
    await ev(HELPERS);
    await ev(EXTRA);
  });

  // ================================================================ 环境
  const env = await ev(`(function(){
    var c = document.querySelector('canvas');
    return { winW: innerWidth, winH: innerHeight, cw: c.width, ch: c.height,
             aspect: +SW.scene.camera.aspect.toFixed(4),
             hc: navigator.hardwareConcurrency, dpr: devicePixelRatio,
             fallback: SW.fallback, bootMs: SW.bootMs, rev: window.THREE.REVISION };
  })()`);
  console.log('环境:', JSON.stringify(env));
  const A = env.aspect;
  console.log(`画布 ${env.cw}×${env.ch} · aspect ${A} · 期望 1280×720 / 1.7778`);
  console.log(`hHalf = ${(Math.atan(Math.tan(34 / 2 * Math.PI / 180) * A) * 180 / Math.PI).toFixed(2)}° （期望 28.53°）`);
  console.log(`mobile 降级触发: ${env.fallback.mobile}  (${env.fallback.mobileWhy || '-'})  ·  applied: ${env.fallback.applied.join(' | ')}`);

  // ================================================================ #1 / #2
  await ev('window.__seek(12.5)');
  await page.waitForTimeout(1500);
  const p = await ev('window.__probe()');
  check(1, '无 NaN', p.anyNaN === false, `anyNaN=${p.anyNaN}`);
  check(2, '渲染预算', p.calls <= 8 && p.tris <= 60000, `calls=${p.calls} (≤8)  tris=${p.tris} (≤60000)`);

  // ================================================================ #3 折射差分（先注入涟漪）
  const emits = await ev(`(function(){
    var n = 0;
    [[0,-6,2.0],[1.2,-8,1.6],[-1.2,-8,1.6],[0,-10,1.4]].forEach(function(a){
      if (SW.ripple.emit(a[0], a[1], a[2])) { n++; }
    });
    return { n:n, active:SW.ripple.probe().active, emitCount:SW.ripple.probe().emitCount };
  })()`);
  await page.waitForTimeout(900);
  const rf = await ev('window.__pw.refractDiff(0.20,0.80,0.08,0.58)');
  check(3, '折射差分', rf.hitFrac > 0.10 && rf.maxDiff > 30 && rf.flagOff === false && rf.flagOn === true,
    `注入 ${emits.n}/4 源(active=${emits.active}) → hitFrac=${(rf.hitFrac * 100).toFixed(1)}%  mean=${rf.meanDiff}  max=${rf.maxDiff}` +
    `  · setRefract 开关生效 ${rf.flagOff}→${rf.flagOn}`);

  // ================================================================ #5 色度加权色相步长
  const cs = await ev('window.__pw.chromaStep()');
  check(5, '色相步长(色度加权)', cs.max < 2.5,
    `max=${cs.max} @${cs.where} (<2.5)  · per=${JSON.stringify(cs.per)}  · 原始(仅诊断)=${JSON.stringify(cs.raw)}`);

  // ================================================================ #6 湖底 std（60 帧中位）
  const stds = [];
  for (let i = 0; i < 60; i++) {
    stds.push(await ev('window.__pw.regionStd(0.35,0.65,0.06,0.34).std'));
    await page.waitForTimeout(28);
  }
  const sSorted = stds.slice().sort((a, b) => a - b);
  const sMed = sSorted[Math.floor(sSorted.length / 2)];
  check(6, '湖底仍可读(60帧中位)', sMed > 14,
    `median std=${sMed.toFixed(2)} (>14)  min=${sSorted[0].toFixed(2)}  max=${sSorted[sSorted.length - 1].toFixed(2)}`);

  // ================================================================ #9 / #10 / #11 / #12 时段
  const states = {};
  for (const h of HOURS) {
    await ev(`window.__seek(${h})`);
    await page.waitForTimeout(1400);
    const q = await ev('window.__probe()');
    const sunI = await ev('SW.scene.sun.intensity');
    states[h] = { sunElev: q.sunElev, sunAz: q.sunAz, hours: q.hours, glitterGain: q.glitterGain,
                  glitterSpec: q.glitterSpec, sunI };
  }
  console.log('\n--- 时段读数（度）---');
  for (const h of HOURS) {
    const s = states[h];
    console.log(`  h=${String(h).padStart(5)}  elev=${(s.sunElev * 180 / Math.PI).toFixed(2)}°  az=${(s.sunAz * 180 / Math.PI).toFixed(2)}°  ` +
      `sunI=${s.sunI.toFixed(2)}  gGain=${s.glitterGain.toFixed(2)}  gSpec=${s.glitterSpec.toFixed(3)}`);
  }
  const elev = (h) => states[h].sunElev * 180 / Math.PI;
  check(9, '光源仰角恒为正', HOURS.every((h) => states[h].sunElev > 0),
    HOURS.map((h) => `h${h}:${elev(h).toFixed(1)}°`).join(' '));
  const lowOk = [5.5, 18.5, 22.5].every((h) => elev(h) >= 22 - 1e-6 && elev(h) <= 30 + 1e-6);
  const lowCap = [5.5, 18.5, 22.5].every((h) => elev(h) <= 32);
  const noonOk = elev(12.5) >= 33;
  check(10, '低光时段落 [22°,30°]·硬上限32°·正午≥33°', lowOk && lowCap && noonOk,
    `晨${elev(5.5).toFixed(4)} 昏${elev(18.5).toFixed(4)} 夜${elev(22.5).toFixed(4)} ∈[22,30]${lowOk ? '✓' : '✗'} ≤32${lowCap ? '✓' : '✗'}` +
    `  正午${elev(12.5).toFixed(2)} ≥33${noonOk ? '✓' : '✗'}  · 容差 ±1e-6（19.5°→22° 的 rad↔deg 往返有 ~1e-14 噪声）`);
  check(11, '夜间月光强度非零', states[22.5].sunI > 0.4 && states[22.5].glitterGain >= 0.8,
    `sunI(22.5)=${states[22.5].sunI.toFixed(2)} (>0.4)  glitterGain=${states[22.5].glitterGain.toFixed(2)} (≥0.8)`);
  const hHalf = Math.atan(Math.tan(34 / 2 * Math.PI / 180) * A) * 180 / Math.PI;
  const azHalf = Math.min(22, Math.max(7, hHalf - 6));
  const azOk = [5.5, 12.5, 18.5, 22.5].every((h) => {
    let off = (states[h].sunAz * 180 / Math.PI - 180);
    off = ((off % 360) + 540) % 360 - 180;
    return Math.abs(off) <= azHalf + 1e-6;
  });
  check(12, '方位落在夹取区内', azOk,
    `hHalf=${hHalf.toFixed(2)}°  azHalf=${azHalf.toFixed(2)}°  ` +
    [5.5, 12.5, 18.5, 22.5].map((h) => {
      let off = (states[h].sunAz * 180 / Math.PI - 180); off = ((off % 360) + 540) % 360 - 180;
      return `h${h}:${off.toFixed(2)}°`;
    }).join(' '));

  // ================================================================ 7 反光柱 probe 口径
  check(7, '反光柱:夜强于午(probe)', states[22.5].glitterSpec > 0.5 && states[12.5].glitterSpec < 0.2,
    `gSpec(22.5)=${states[22.5].glitterSpec.toFixed(3)} (>0.5)  gSpec(12.5)=${states[12.5].glitterSpec.toFixed(4)} (<0.2)`);

  // ================================================================ #13 像素列剖面（夜间）
  await ev('window.__seek(22.5)');
  await page.waitForTimeout(1600);
  const cpNight = await ev('window.__pw.colProfileStable(0.30, 0.70, 24)');
  const cpSingle = await ev('window.__pw.colProfile(0.30, 0.70)');
  const cenOk = cpNight.centroidMed > 0 && Math.abs(cpNight.centroidMed - cpNight.w / 2) <= 0.06 * cpNight.w;
  check(13, '反光柱可读(像素)', cpNight.ratioMed >= 1.8 && cenOk,
    `peak/median(24相位中位)=${cpNight.ratioMed} (≥1.8, 范围 ${cpNight.ratioLo}~${cpNight.ratioHi})` +
    `  亮带质心=${cpNight.centroidMed}/${cpNight.w} (${cpNight.centroidPct}%, 中心±6%=${(cpNight.w / 2).toFixed(0)}±${(0.06 * cpNight.w).toFixed(0)})` +
    `  · 单帧 argmax=${cpSingle.peakCol}/${cpSingle.w}(仅诊断)`);
  await ev('window.__seek(12.5)');
  await page.waitForTimeout(1500);
  const cpNoon = await ev('window.__pw.colProfile(0.30, 0.70)');
  console.log(`  ℹ 正午列剖面 peak/median=${cpNoon.ratio}（不作为判据，AM-007 §5.2）`);

  // ================================================================ #14 / #15
  const lod = await ev('window.__pw.lodMetric()');
  console.log('\n--- LOD / 覆盖 ---');
  console.log('  ' + JSON.stringify(lod));
  check(14, 'LOD 接缝不倒挂', lod.seam.ratio < 1.00,
    `farMed/nearMed=${lod.seam.ratio} (<1.00)  far=${lod.seam.farMed}px(n=${lod.seam.nFar}) / near=${lod.seam.nearMed}px(n=${lod.seam.nNear})` +
    `  · 整幅比=${(lod.whole.farMed / lod.whole.nearMed).toFixed(3)}`);
  check(15, '近带不稀(覆盖率)', lod.coverage.analytic >= 0.40,
    `解析=${lod.coverage.analytic} 逐颗=${lod.coverage.instance} (≥0.40)  近带面积=${lod.coverage.area} 颗数=${lod.coverage.n}`);
  console.log(`  ℹ midRatio=${lod.midRatio} (1.00±0.05)  near 屏幕中位=${lod.screen.nearMed}px 最大=${lod.screen.nearMax}px`);

  // ================================================================ #4 涟漪衰减
  // ⚠ 与旧脚本同一口径：`__clock(4.6)` 推不动模拟时间（50-ripple.js 固定子步 + MAX_SUB=4 限流），
  //   所以走「自然衰减」，超时再显式 step()。page.clock 那条更干净的路径见 40-clock.spec.mjs。
  await ev('window.__seek(12.5)');
  await page.waitForTimeout(900);
  await ev('SW.ripple.emit(0, -6, 2.0)');
  await page.waitForTimeout(600);
  const rAct = await ev('SW.ripple.probe().active');
  let elapsed = 0, rAct2 = rAct;
  while (elapsed < 20000) {
    await page.waitForTimeout(250); elapsed += 250;
    rAct2 = await ev('SW.ripple.probe().active');
    if (rAct2 === 0) { break; }
  }
  let forced = null;
  if (rAct2 !== 0) {
    forced = await ev(`(function(){
      for (var i = 0; i < 90; i++) { SW.ripple.step(0.25); }
      return SW.ripple.probe().active;
    })()`);
  }
  const rFinal = (rAct2 === 0) ? 0 : forced;
  check(4, '涟漪衰减(源按 simTime 老化)', rAct > 0 && rFinal === 0,
    `emit 后 active=${rAct} (>0) → 归零 active=${rFinal} (===0)` +
    (rAct2 === 0 ? `  自然衰减耗时 ${(elapsed / 1000).toFixed(2)}s 墙钟` : `  自然等待 20s 未归零 → 显式步进 90×step(0.25) 后 ${forced}`));

  // ================================================================ #8 音频态（首次手势）
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const au = await ev('window.__probe()');
  check(8, '音频态 running', au.audioCtx === 'running', `audioCtx=${au.audioCtx}  bgmGain=${au.bgmGain}`);

  // ================================================================ console 洁净度
  console.log('\n--- console ---');
  console.log('  JS 错误 (' + jsErrors.length + '): ' + (jsErrors.slice(0, 6).join(' | ') || '无'));
  console.log('  requestfailed (' + netErrors.length + '): ' + (netErrors.slice(0, 6).join(' | ') || '无'));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=========== 断言 ${pass}/${results.length} 通过 ===========`);

  // ================================================================ 落盘（验收 #2 的输入）
  fs.writeFileSync(READINGS_NEW, JSON.stringify({
    generator: 'plan/pw/tests/10-assert.spec.mjs (UP6)',
    entry: ENTRY,
    oldReadings: READINGS_OLD,
    env, results, states, lod, cpNight, cpNoon, rf, cs, jsErrors, netErrors,
    budget: { calls: p.calls, tris: p.tris },
  }, null, 1));

  const failed = results.filter((r) => !r.ok);
  expect(failed.map((r) => `#${r.id} ${r.name}`), '失败的断言').toEqual([]);
  expect(results.length, '断言条数').toBe(15);
  expect(jsErrors, 'console 无 JS 报错').toEqual([]);
});
