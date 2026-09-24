// plan/pw/tests/env-narrow.spec.mjs —— UP6 · 环境判据 #2（对应 plan/wp5-env.js 判据 #2）
//
// 启动条件换档靠 config 的 `env-narrow` project：`viewport 375×812`。
// 原脚本为此起了一个独立的 Chrome（`--window-size=375,812`）—— 现在只是 project 的 `use`。
//
// 判据（与 wp5-env.js 同义）：
//   · 窄屏不崩：SW.ready、canvas 有尺寸、bootMs 有限
//   · 移动档降级真的生效：fieldSize 256 / 砾石 50+70 / caustics false
//   · UI 不重叠：`#ui` 下**可见**元素两两无交叠（排除祖先/后代对 —— 嵌套必然相交，那不是重叠）
//   · UI 不出屏
//   · console 无 JS 报错
//
// ⚠ 重叠检测的代码口径照抄 wp5-env.js：只比较**非祖先/后代**关系的一对。

import { test, expect } from '@playwright/test';
import { ENTRY } from '../lib/const.mjs';

test('env #2 · 375×812 窄屏不崩 + UI 不重叠', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('exception: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console.error: ' + m.text()); } });

  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });
  await page.waitForTimeout(3200);

  const r = await page.evaluate(`(function(){
    var ui = document.getElementById('ui');
    var els = [];
    var all = ui.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i], b = e.getBoundingClientRect();
      if (b.width > 1 && b.height > 1) { els.push({ el: e, tag: e.tagName, id: e.id || '', cls: e.className || '',
        x:+b.left.toFixed(1), y:+b.top.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) }); }
    }
    // 只比较**非祖先/后代**关系的一对 —— 嵌套元素必然相交，那不是重叠
    var oval = [];
    for (var a = 0; a < els.length; a++) {
      for (var b2 = a+1; b2 < els.length; b2++) {
        var A = els[a], B = els[b2];
        if (A.el.contains(B.el) || B.el.contains(A.el)) { continue; }
        var ix = Math.min(A.x+A.w, B.x+B.w) - Math.max(A.x, B.x);
        var iy = Math.min(A.y+A.h, B.y+B.h) - Math.max(A.y, B.y);
        if (ix > 2 && iy > 2) { oval.push(A.id+'/'+A.tag+' × '+B.id+'/'+B.tag+' = '+ix.toFixed(0)+'×'+iy.toFixed(0)); }
      }
    }
    var oob = els.filter(function(e){ return e.x < -1 || e.y < -1 || e.x+e.w > innerWidth+1 || e.y+e.h > innerHeight+1; })
                  .map(function(e){ return (e.id||e.tag)+'@'+e.x+','+e.y+' '+e.w+'×'+e.h; });
    var cv = document.querySelector('canvas');
    var top = [].map.call(ui.children, function(e){ var b = e.getBoundingClientRect();
      return (e.id||e.tagName)+'@'+b.left.toFixed(0)+','+b.top.toFixed(0)+' '+b.width.toFixed(0)+'×'+b.height.toFixed(0); });
    return { winW: innerWidth, winH: innerHeight, cw: cv.width, ch: cv.height,
             uiCount: els.length, topLevel: top, overs: oval, outOfBounds: oob,
             fallback: SW.fallback, ready: !!SW.ready, bootMs: SW.bootMs,
             pebbles: SW.P.pebbleCountNear + '+' + SW.P.pebbleCountFar,
             fieldSize: SW.P.fieldSize, caustics: SW.P.caustics,
             canvasDisplay: getComputedStyle(cv).display };
  })()`);
  console.log('  ' + JSON.stringify(r));

  expect(r.ready, '窄屏仍能 boot').toBe(true);
  expect(r.winW, 'viewport 宽度（project 配置生效）').toBe(375);
  expect(r.cw, 'canvas 有尺寸').toBeGreaterThan(100);
  expect(r.fallback.mobile, '移动档降级触发').toBe(true);
  console.log(`  ℹ 触发原因 ${r.fallback.mobileWhy} · canvas ${r.cw}×${r.ch} · bootMs=${(r.bootMs || 0).toFixed(0)}`);

  expect(r.fieldSize, 'fieldSize → 256').toBe(256);
  expect(r.pebbles, '砾石 → 50+70').toBe('50+70');
  expect(r.caustics, 'caustics 一律 false（AM-007 §4）').toBe(false);
  console.log(`  ℹ 降级项 [${r.fallback.applied.join(' | ')}]`);

  expect(r.overs, `UI 重叠（${r.uiCount} 个可见元素，已排除祖先/后代对）`).toEqual([]);
  expect(r.outOfBounds, 'UI 出屏').toEqual([]);
  console.log(`  ℹ 顶层元素 ${r.topLevel.join(' | ')}`);

  expect(errors, 'console 无 JS 报错').toEqual([]);
});
