// plan/pw/tests/30-pixel.spec.mjs —— UP6 · 像素回归（限定在确定性区域）+ 哨兵
//
// 🔴 90-WAVE4 §4 约束 ③ 的落地：
//   「toHaveScreenshot() 不能罩整幅水面 —— 相位抖动本身就是 20~46dB。
//     要么先钉 SW.water.uniforms.uTime + animations:'disabled'，
//     要么只罩非水面区域（UI / 湖底局部）。
//     且必须证明它在「故意改坏一个像素」时会红，否则是摆设。」
//
// 本文件的选择与理由：
//   · 走「钉相位」这一路。**不是偷懒，是唯一可行**：本场景的水面是 90×90 的平面铺满整屏，
//     `#ui` 的子元素全是半透明叠在湖水上 —— **全库不存在"非水面区域"可罩**。
//     （`#fallback` 是 WebGL 不可用时的兜底，正常情况下 `display:none`。）
//   · `animations: 'disabled'` 是 `toHaveScreenshot` 的**默认值**，这里仍显式写出，免得被误改。
//   · 钉相位能不能让画面稳定，不靠"我觉得可以"——由 20-determinism.spec.mjs 用例 C 证明
//     （4 次采样指纹恒等）。本文件先跑，用例 C 是它的前提；两个文件都跑才算完整证据。
//
// 覆盖的三块区域（按"确定性强度"从高到低）：
//   ① `ui-panel`  —— 左上时段面板（纯 DOM 文本 + 半透明底）
//   ② `bed-clip`  —— 湖底清晰带局部裁切（y 轴 66%~94%，见下 BED_CLIP 推导）
//   ③ `full`      —— 整幅视口（含水面碎光）—— 只在①有钉相位的前提下才允许
//
// 哨兵（验收 #3 的硬要求）：注入**一小块**品红像素 → 同一条断言必须变红。
//   · 为什么用品红：Playwright 比较带 `threshold: 0.2` 感知容差，
//     近湖水色的"坏像素"会被容差吃掉 → 哨兵假绿。
//   · 🔴 为什么是 **3×3 块**而不是 1 个像素（2026-09-25 主控实测，AM-018）：
//     `toHaveScreenshot` 走 pixelmatch 且默认 `includeAA:false` —— **判为反锯齿的差异像素
//     不计入 diff**，而该判定**依赖基线内容**。实测同一枚坏像素、同一帧：
//     **旧基线检出、新基线漏检**（重录基线会悄悄把哨兵弄哑）。3×3 块因有足够同色邻居，
//     必然不被判 AA ⇒ 与基线内容无关。详见 `../lib/page-lib.mjs` 的 `breakPixelsSnippet`。
//     ⚠ 这条是**校验链自身的缺陷修复**，走变更单 **AM-018**；判据阈值一个没动。
//   · 为什么「控制组」也要跑：否则无法区分"因为坏了才红"和"本来就一直红"。
//   · ⚠ `--update-snapshots` 那次运行里哨兵会**自己跳过**：更新模式下断言不比较、直接改写基线，
//     坏的画面会把干净基线覆盖掉 → 之后所有运行都对着坏基线比。见下方 test.skip 的判据。

import { test, expect } from '@playwright/test';
import { HELPERS, EXTRA, pinSnippet, CLEAN_SNIPPET, breakPixelsSnippet } from '../lib/page-lib.mjs';
import { ENTRY, PIN_HOUR, PIN_UTIME } from '../lib/const.mjs';

// 湖底清晰带局部裁切，由 断言 #6 的采样区反推（readPixels 原点在**底部**，CSS 原点在顶部）：
//   x ∈ [0.35,0.65] × 1280 = [448, 832]
//   y ∈ [0.06,0.34]（自底）→ CSS y ∈ [(1−0.34)×720, (1−0.06)×720] = [475.2, 676.8]
const BED_CLIP = { x: 448, y: 475, width: 384, height: 202 };
// 裁切区中心（哨兵打点用）
const BED_CENTER = { x: Math.round(BED_CLIP.x + BED_CLIP.width / 2), y: Math.round(BED_CLIP.y + BED_CLIP.height / 2) };

// 快照里出现"1 像素坏掉"时，diff 产物落这里（.gitignore §5 已忽略 test-results/）
test.describe.configure({ mode: 'serial' });

// 哨兵必须在"会**覆写**基线"的运行里跳过。
// ⚠ 别写成 `updateSnapshots !== 'none'` —— Playwright 的默认值是 **'missing'**（不是 'none'），
//   那样写会让哨兵**永远被跳过**（UP6 第一版就是这么错的：3 个哨兵全报 skipped 而我没看输出）。
//   真正危险的只有 'all' / 'changed'：那两种模式下失败断言**不抛错、直接改写基线**，
//   坏帧会把干净基线覆盖掉 → 之后所有运行都对着坏基线比，回归彻底失去意义。
const OVERWRITES_BASELINE = (t) =>
  t.config.updateSnapshots === 'all' || t.config.updateSnapshots === 'changed';

async function boot(page) {
  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(HELPERS);
  await page.evaluate(EXTRA);
  // 钉住三条链（hour + uTime + dt），并把 #dbg 这类"每帧都在变"的 DOM 清掉
  await page.evaluate(pinSnippet(PIN_HOUR, PIN_UTIME));
  await page.evaluate(CLEAN_SNIPPET);
  // 让 #hint 的 900ms 定时器与 0.8s 淡入都落地（animations:'disabled' 会把它快进到终态）
  await page.waitForTimeout(1500);
}

test('像素回归 ① · UI 顶部时段面板（钉相位）', async ({ page }) => {
  await boot(page);
  const panel = page.locator('#ui > div').first();
  await expect(panel).toHaveScreenshot('ui-panel.png', { animations: 'disabled' });
});

test('像素回归 ② · 湖底清晰带局部裁切（钉相位）', async ({ page }) => {
  await boot(page);
  await expect(page).toHaveScreenshot('bed-clip.png', { clip: BED_CLIP, animations: 'disabled' });
});

test('像素回归 ③ · 整幅视口（钉相位 —— 确定性由 20-determinism 用例 C 证明）', async ({ page }) => {
  await boot(page);
  await expect(page).toHaveScreenshot('full.png', { animations: 'disabled' });
});

// ==================================================================== 哨兵
test('哨兵 A · 故意改坏 1 个像素 ⇒ UI 面板回归必须变红', async ({ page }, testInfo) => {
  test.skip(OVERWRITES_BASELINE(testInfo),
    '更新快照的运行里哨兵无意义：断言不比较、直接改写基线，脏帧会把干净基线覆盖掉');
  await boot(page);

  const panel = page.locator('#ui > div').first();
  const quick = expect.configure({ timeout: 4000 });

  // —— 控制组：不坏的时候必须**绿**（否则这条断言是摆设，无法区分"坏了"与"一直红"）
  await quick(panel).toHaveScreenshot('ui-panel.png', { animations: 'disabled' });
  console.log('  ℹ 控制组（未注入坏像素）→ 绿 ✔');

  // —— 实验组：注入 3×3 CSS px 品红块，压在面板 bbox 内（面板 left:22 top:20）
  const brk = await page.evaluate(breakPixelsSnippet(30, 26));
  console.log(`  ℹ 注入坏像素 @(${brk.x},${brk.y}) 实测 bbox=[${brk.box.join(', ')}]`);

  let threw = null;
  try {
    await quick(panel).toHaveScreenshot('ui-panel.png', { animations: 'disabled' });
  } catch (e) { threw = e; }

  expect(threw, '故意改坏 1 个像素后，同一条 toHaveScreenshot 必须失败').not.toBeNull();
  const msg = String(threw && threw.message || '').split('\n').slice(0, 6).join(' | ');
  console.log(`  ℹ 失败原因（截断）: ${msg}`);
});

test('哨兵 B · 故意改坏 1 个像素 ⇒ 湖底裁切回归必须变红', async ({ page }, testInfo) => {
  test.skip(OVERWRITES_BASELINE(testInfo),
    '更新快照的运行里哨兵无意义（同哨兵 A）');
  await boot(page);

  const quick = expect.configure({ timeout: 4000 });
  await quick(page).toHaveScreenshot('bed-clip.png', { clip: BED_CLIP, animations: 'disabled' });
  console.log('  ℹ 控制组（未注入坏像素）→ 绿 ✔');

  const brk = await page.evaluate(breakPixelsSnippet(BED_CENTER.x, BED_CENTER.y));
  console.log(`  ℹ 注入坏像素 @(${brk.x},${brk.y}) 实测 bbox=[${brk.box.join(', ')}]`);

  let threw = null;
  try {
    await quick(page).toHaveScreenshot('bed-clip.png', { clip: BED_CLIP, animations: 'disabled' });
  } catch (e) { threw = e; }

  expect(threw, '故意改坏 1 个像素后，同一条 toHaveScreenshot 必须失败').not.toBeNull();
  const msg = String(threw && threw.message || '').split('\n').slice(0, 6).join(' | ');
  console.log(`  ℹ 失败原因（截断）: ${msg}`);

  // 清掉坏像素，避免影响后续用例
  await page.evaluate(CLEAN_SNIPPET);
});

// ==================================================================== 反向对照
// 上面两条哨兵证明"断言不会漏报"。这条证明"断言也不会虚报"：
// 注入的坏像素被**移除**之后，同一帧必须回到绿。少了它，前面两条可以靠"永远红"通过。
test('哨兵 C · 撤掉坏像素 ⇒ 必须回到绿（防"永远红"）', async ({ page }, testInfo) => {
  test.skip(OVERWRITES_BASELINE(testInfo), '更新快照的运行里哨兵无意义（同哨兵 A）');
  await boot(page);

  const panel = page.locator('#ui > div').first();
  const quick = expect.configure({ timeout: 4000 });

  await page.evaluate(breakPixelsSnippet(30, 26));
  let threw1 = null;
  try { await quick(panel).toHaveScreenshot('ui-panel.png', { animations: 'disabled' }); } catch (e) { threw1 = e; }
  expect(threw1, '带坏像素 → 红').not.toBeNull();

  await page.evaluate(CLEAN_SNIPPET);
  await quick(panel).toHaveScreenshot('ui-panel.png', { animations: 'disabled' });
  console.log('  ℹ 坏像素移除后 → 绿 ✔（证明这条断言既不漏报、也不虚报）');
});
