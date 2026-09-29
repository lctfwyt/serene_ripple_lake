// plan/pw/tests/60-envgate.spec.mjs —— UP13-fix1（AM-030）+ UP13-fix2（AM-031）· env 门控回归
//
// 钉死本案的原始症状（`plan/103-UP13-fix1-env-freeze.md §0 / §5`）：
//   R1 冷启动进夜段   ⇒ `env.gate == 0`（无横向光带）
//   R2 白天「拖」到夜 ⇒ `env.gate` **必须跟随到 0**（旧实现冻在中间档 ⇒ 光带不消失）
//   R3 「拖」140+ 帧后 `rebuilds` 不得随帧数线性爆炸（旧实现每帧重建 ⇒ 烧光终身配额）
// 追加 UP13-fix2（`plan/104-UP13-fix2-band-night-zero.md §5`）—— **消费层**硬门控：
//   R4 夜段 `probe().envTex` 必须 `'base'`（水面改采**无光带**那张 `env.equirectBase`）；
//      且**把 `SW.scene.buildEnv` 换成存根停掉重建**后仍须归零 ⇒ 证明「**不依赖重烘**」。
//      三条判据：① 冷启动夜段 `'base'` ② stale 免疫 ③ 昼段必须仍是 `'band'`（不许多修）。
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

// ═══════════════════════════════════════════════════════════════════════════════
// R4 · UP13-fix2（AM-031）—— **消费层**硬门控：夜段光带结构性为 0，且不依赖重烘
// ═══════════════════════════════════════════════════════════════════════════════
// 为什么单开一条：R1~R3 量的是**生产端**（env 该不该重烘、烘出来 gate 对不对）。
//   本包补的是**消费端** —— 即便生产端彻底不工作（贴图 stale），水面也必须自己掐掉光带。
//   判据 2 就是模拟"生产端罢工"：把 `SW.scene.buildEnv` 换成存根后仍须 `envTex === 'base'`。
test('UP13-fix2 · 光带夜段结构性归零（消费层门控 · stale 免疫）', async ({ page }) => {
  test.setTimeout(150_000);
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String((e && e.message) || e)));
  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3500);

  const waterState = `(function(){
    var e = SW.scene.env, w = SW.water.probe();
    return { tex: w.envTex, envReady: w.envReady, gate: e.gate, rebuilds: e.rebuilds,
             ready: e.ready, err: e.err, spread: e.spread };
  })()`;

  // ── 判据 1：冷启动夜段 ⇒ 必须采**无光带**那张
  await page.evaluate('window.__seek(22.5)');
  await page.waitForTimeout(1200);
  const night0 = await page.evaluate(waterState);
  expect(night0.envReady, '判据 1 env 必须在跑（否则读数无意义）').toBe(true);
  expect(night0.tex, "判据 1 冷启动夜段 envTex 必须 = 'base'（无光带版）").toBe('base');
  // 同一对象 ⇒ 选图是**空动作** ⇒ "稳态零影响"的结构前提（不是靠像素比对猜的）
  expect(await page.evaluate('SW.scene.env.equirect === SW.scene.env.equirectBase'),
    '判据 1 夜段两张贴图必须是**同一个对象**（否则"逐位不变"不成立）').toBe(true);

  // ── 判据 3：昼段必须仍是 'band' —— 不许一刀切（把白天的光带也修掉就是过度修复）
  const beforeNoon = await page.evaluate('SW.scene.env.rebuilds');
  await page.evaluate('window.__seek(12.5)');
  await page.waitForTimeout(1500);
  const noon = await page.evaluate(waterState);
  expect(noon.gate, '判据 3 正午 env.gate 必须 = 1（作为判据 2「桩生效」的对照）').toBe(1);
  expect(noon.rebuilds, '判据 3 正午必须真的烘过一次 —— 否则 envTex 只在"选同一张"，判据 3 是空的')
    .toBeGreaterThan(beforeNoon);
  expect(await page.evaluate('SW.scene.env.equirect === SW.scene.env.equirectBase'),
    '判据 3 正午两张必须是**不同对象**（否则"选图"是空动作、判据 2 也就没有对照）').toBe(false);
  expect(noon.tex, "判据 3 正午 envTex 必须 = 'band'（白天照旧）").toBe('band');

  // ── 判据 2（本包灵魂）：**停掉生产端重建** → 仍须在夜段归零
  const stubbed = await page.evaluate(`(function(){
    window.__origBuildEnv = SW.scene.buildEnv;
    SW.scene.buildEnv = function () { return true; };     // 存根：永不重烘，贴图停在正午那张
    return SW.scene.env.rebuilds;
  })()`);
  await page.evaluate('window.__seek(22.5)');
  await page.waitForTimeout(1500);
  const stale = await page.evaluate(waterState);

  expect(stale.gate,
    '判据 2 桩必须真的生效 —— env.gate 应停在正午的 1（证明 buildEnv 一次都没跑）').toBe(1);
  expect(stale.rebuilds,
    '判据 2 rebuilds 不得增加（贴图确实 stale）').toBe(stubbed);
  expect(stale.tex,
    "判据 2 贴图 stale 时夜段 envTex 仍须 = 'base' ⇒ 证明归零**不依赖重烘**").toBe('base');
  expect(stale.ready, '判据 2 env 必须仍 ready').toBe(true);
  expect(stale.err, '判据 2 env.err 必须为空').toBe('');

  // 还原桩（判据 7 要用真实 buildEnv 走一遍重开流程）
  await page.evaluate('SW.scene.buildEnv = window.__origBuildEnv;');

  // ── 判据 7：降级路径不许黑、不许炸 ──────────────────────────────────────────
  //   ① `envEnabled=false` ⇒ `envReady=0`、envTex='none'（走水面二色渐变，AM-017 原有降级路径）
  //   ② 回开 ⇒ 必须重新 ready
  //   ③ `equirectBase` 缺失（旧版 30-scene / 字段被抹）⇒ 必须回退 `equirect`，不抛错
  await page.evaluate('SW.P.envEnabled = false');
  await page.waitForTimeout(800);
  const off = await page.evaluate('SW.water.probe()');
  expect(off.envReady, '判据 7 envEnabled=false ⇒ envReady 必须 = 0').toBe(false);
  expect(off.envTex, "判据 7 envEnabled=false ⇒ envTex = 'none'").toBe('none');

  await page.evaluate('SW.P.envEnabled = true');
  await page.waitForTimeout(1000);
  const backOn = await page.evaluate(waterState);
  expect(backOn.envReady, '判据 7 回开 env 必须重新 ready（不黑、不炸）').toBe(true);
  expect(backOn.err, '判据 7 回开 env.err 必须为空').toBe('');

  await page.evaluate(`(function(){
    window.__origBuildEnv2 = SW.scene.buildEnv;
    SW.scene.buildEnv = function () { return true; };      // 冻住重建：只测**消费端**回退分支
    SW.scene.env.equirectBase = null;
    return true;
  })()`);
  await page.evaluate('window.__seek(22.5)');
  await page.waitForTimeout(1200);
  const noBase = await page.evaluate('SW.water.probe()');
  expect(noBase.envReady, '判据 7 缺 equirectBase ⇒ 仍必须 ready（回退 equirect，不炸）').toBe(true);
  expect(noBase.envTex, "判据 7 缺 equirectBase ⇒ 回退 `equirect`，envTex 仍报 'base'").toBe('base');
  await page.evaluate('SW.scene.buildEnv = window.__origBuildEnv2');

  expect(jsErrors, '本用例全程 JS 错误必须为 0（降级路径不许抛）').toEqual([]);

  console.log(`\n  ℹ R4 · 夜(冷启动)=${night0.tex} · 正午=${noon.tex}(gate ${noon.gate}) ` +
    `· 桩后夜=${stale.tex}(gate ${stale.gate} · rebuilds ${stubbed}→${stale.rebuilds}) ` +
    `· 降级 off:${off.envReady}/${off.envTex} backOn:${backOn.envReady} noBase:${noBase.envReady}/${noBase.envTex}`);
});
