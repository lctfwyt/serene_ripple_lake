// plan/pw/compare-readings.mjs —— UP6 · 新旧读数逐字段比对（90-WAVE4 §4 验收 #2）
//
//   旧：`plan/wp5-assert.json`  —— 手搓 CDP 版（`plan/wp5-assert.js`）上一次运行落下的读数
//   新：`plan/pw/pw-readings.json` —— Playwright 版（`tests/10-assert.spec.mjs`）刚落下的读数
//
// ⚠ 为什么旧读数取**已落盘的那份**、而不是"现场再跑一遍旧脚本"：
//   `plan/wp5-assert.js` 本波次冻结（90-WAVE4 §0 耦合 ① / §1），而它每次运行都会重写
//   `plan/wp5-assert.json`。为了拿一份"同会话"的旧读数去动一个不属于 UP6 的文件、
//   并制造一个与本包无关的 diff，不划算。落盘件就是它的输出，足够用于比对。
//
// 容差分两类，理由写在第 3 列：
//   · 精确档（1e-9）：几何 / 关键帧 / 材质读数 —— 与水面相位无关，必须逐位相等
//   · 相位档（显式容差）：碎光剖面之类 —— 随 `uTime` 走，而两次运行的 uTime 起点不同
//
// 运行：node plan/pw/compare-readings.mjs
// 退出码：0 = 全部在容差内；1 = 有超差项（打印明细）

import fs from 'node:fs';
import { READINGS_NEW, READINGS_OLD } from './lib/const.mjs';

if (!fs.existsSync(READINGS_OLD)) {
  console.error(`找不到旧读数 ${READINGS_OLD}\n（先跑一次 plan/wp5-assert.js，或确认它已落盘）`);
  process.exit(1);
}
if (!fs.existsSync(READINGS_NEW)) {
  console.error(`找不到新读数 ${READINGS_NEW}\n（先跑：npm run pw）`);
  process.exit(1);
}

const OLD = JSON.parse(fs.readFileSync(READINGS_OLD, 'utf8'));
const NEW = JSON.parse(fs.readFileSync(READINGS_NEW, 'utf8'));

const rows = [];
function cmp(label, a, b, tol, why) {
  let ok, delta;
  if (typeof a === 'number' && typeof b === 'number') {
    delta = Math.abs(a - b);
    ok = delta <= tol;
  } else {
    delta = null;
    ok = a === b;
  }
  rows.push({ label, old: a, new: b, tol: typeof tol === 'number' ? `≤${tol}` : String(tol), delta, ok, why });
}

const EXACT = 1e-9;

// ---------------------------------------------------------------- env
cmp('env.canvas', `${OLD.env.cw}×${OLD.env.ch}`, `${NEW.env.cw}×${NEW.env.ch}`, '==', '画布尺寸');
cmp('env.aspect', OLD.env.aspect, NEW.env.aspect, EXACT, '几何');
cmp('env.dpr', OLD.env.dpr, NEW.env.dpr, EXACT, '像素比（像素比较的前提）');
cmp('env.rev', OLD.env.rev, NEW.env.rev, '==', 'THREE 版本');

// ---------------------------------------------------------------- #1 / #2 / 渲染预算
cmp('budget.calls', Number((OLD.results.find((r) => r.id === 2).detail.match(/calls=(\d+)/) || [])[1]),
  NEW.budget.calls, 0, 'draw call 数');
cmp('budget.tris', Number((OLD.results.find((r) => r.id === 2).detail.match(/tris=(\d+)/) || [])[1]),
  NEW.budget.tris, 0, '三角面数');

// ---------------------------------------------------------------- 6 时段
const HOURS = ['2', '5.5', '8', '12.5', '18.5', '22.5'];
for (const h of HOURS) {
  const o = OLD.states[h], n = NEW.states[h];
  if (!o || !n) { rows.push({ label: `states[${h}]`, old: !!o, new: !!n, tol: '存在', delta: null, ok: false, why: '时段缺失' }); continue; }
  cmp(`h${h}.sunElev`, o.sunElev, n.sunElev, EXACT, '关键帧仰角');
  cmp(`h${h}.sunAz`, o.sunAz, n.sunAz, EXACT, '方位夹取');
  cmp(`h${h}.sunI`, o.sunI, n.sunI, EXACT, '光照强度（直读 sun.intensity）');
  cmp(`h${h}.glitterGain`, o.glitterGain, n.glitterGain, EXACT, '反光增益 gGain');
  cmp(`h${h}.glitterSpec`, o.glitterSpec, n.glitterSpec, EXACT, '反光柱 probe #7');
}

// ---------------------------------------------------------------- #5 色相步长
cmp('chroma.max', OLD.cs.max, NEW.cs.max, EXACT, '色度加权最大步长');
cmp('chroma.where', OLD.cs.where, NEW.cs.where, '==', '最大步长所在字段');
cmp('chroma.keys', OLD.cs.keys, NEW.cs.keys, 0, 'keyframe 条数');
for (const k of Object.keys(OLD.cs.per)) { cmp(`chroma.per.${k}`, OLD.cs.per[k], NEW.cs.per[k], EXACT, 'per 表逐字段'); }
for (const k of Object.keys(OLD.cs.raw)) { cmp(`chroma.raw.${k}`, OLD.cs.raw[k], NEW.cs.raw[k], 0, '原始色相步长'); }

// ---------------------------------------------------------------- #14 / #15 LOD 全字段
cmp('lod.counts.near', OLD.lod.counts.near, NEW.lod.counts.near, 0, '近层实例数');
cmp('lod.counts.far', OLD.lod.counts.far, NEW.lod.counts.far, 0, '远层实例数');
cmp('lod.seam.nearMed', OLD.lod.seam.nearMed, NEW.lod.seam.nearMed, EXACT, '接缝近侧屏幕中位');
cmp('lod.seam.farMed', OLD.lod.seam.farMed, NEW.lod.seam.farMed, EXACT, '接缝远侧屏幕中位');
cmp('lod.seam.nNear', OLD.lod.seam.nNear, NEW.lod.seam.nNear, 0, '接缝近侧样本数');
cmp('lod.seam.nFar', OLD.lod.seam.nFar, NEW.lod.seam.nFar, 0, '接缝远侧样本数');
cmp('lod.seam.ratio', OLD.lod.seam.ratio, NEW.lod.seam.ratio, EXACT, '#14 判据本体');
cmp('lod.whole.nearMed', OLD.lod.whole.nearMed, NEW.lod.whole.nearMed, EXACT, '近层整幅中位');
cmp('lod.whole.farMed', OLD.lod.whole.farMed, NEW.lod.whole.farMed, EXACT, '远层整幅中位');
cmp('lod.midRatio', OLD.lod.midRatio, NEW.lod.midRatio, EXACT, '两层尺度比（应 = 1.000）');
cmp('lod.coverage.instance', OLD.lod.coverage.instance, NEW.lod.coverage.instance, EXACT, '逐颗覆盖口径');
cmp('lod.coverage.analytic', OLD.lod.coverage.analytic, NEW.lod.coverage.analytic, EXACT, '#15 判据本体');
cmp('lod.coverage.area', OLD.lod.coverage.area, NEW.lod.coverage.area, EXACT, '近带面积');
cmp('lod.coverage.n', OLD.lod.coverage.n, NEW.lod.coverage.n, 0, '近带颗数');
cmp('lod.screen.nearMed', OLD.lod.screen.nearMed, NEW.lod.screen.nearMed, EXACT, '近层屏幕直径中位');
cmp('lod.screen.nearMax', OLD.lod.screen.nearMax, NEW.lod.screen.nearMax, EXACT, '近层屏幕直径最大');

// ---------------------------------------------------------------- 相位相关档（显式容差）
cmp('cpNight.ratioMed', OLD.cpNight.ratioMed, NEW.cpNight.ratioMed, 0.15, '随 uTime 相位走（24 相位中位）');
cmp('cpNight.centroidMed', OLD.cpNight.centroidMed, NEW.cpNight.centroidMed, 8, '亮带质心（px）');
cmp('cpNight.w', OLD.cpNight.w, NEW.cpNight.w, 0, '剖面宽度');
cmp('cpNoon.ratio', OLD.cpNoon.ratio, NEW.cpNoon.ratio, 0.12, '正午列剖面（诊断用）');
cmp('rf.hitFrac', OLD.rf.hitFrac, NEW.rf.hitFrac, 0.05, '折射差分命中率（注入后 0.9s）');
cmp('rf.maxDiff', OLD.rf.maxDiff, NEW.rf.maxDiff, 15, '折射差分峰值');

// ---------------------------------------------------------------- 行为类
const oldStd = Number((OLD.results.find((r) => r.id === 6).detail.match(/median std=([\d.]+)/) || [])[1]);
rows.push({ label: '#6 湖底 std 中位', old: oldStd, new: '见 pw-readings.json results',
  tol: '两者都 >14', delta: null, ok: oldStd > 14, why: '60 帧采样的区间判据，不做逐位比' });
for (const id of [1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const o = OLD.results.find((r) => r.id === id), n = NEW.results.find((r) => r.id === id);
  rows.push({ label: `#${id} 判定`, old: o && o.ok, new: n && n.ok, tol: '两者皆 true',
    delta: null, ok: !!(o && o.ok && n && n.ok), why: o ? o.name : '' });
}

// ---------------------------------------------------------------- 输出
const bad = rows.filter((r) => !r.ok);
const pad = (s, n) => String(s).padEnd(n);
console.log('字段'.padEnd(26) + '旧(手搓 CDP)'.padEnd(24) + '新(Playwright)'.padEnd(24) + '容差'.padEnd(10) + 'Δ'.padEnd(12) + '结论');
console.log('-'.repeat(118));
for (const r of rows) {
  console.log(
    pad(r.label, 26) +
    pad(typeof r.old === 'object' ? JSON.stringify(r.old) : r.old, 24) +
    pad(typeof r.new === 'object' ? JSON.stringify(r.new) : r.new, 24) +
    pad(r.tol, 10) +
    pad(r.delta === null ? '-' : r.delta.toExponential ? r.delta.toFixed(9) : r.delta, 12) +
    (r.ok ? 'ok' : '❌ 超差') + (r.why ? '   · ' + r.why : '')
  );
}
console.log('-'.repeat(118));
console.log(`比对 ${rows.length} 项 · 通过 ${rows.length - bad.length} · 超差 ${bad.length}`);
if (bad.length) {
  console.log('超差明细:');
  for (const r of bad) { console.log(`  ❌ ${r.label}: 旧=${r.old} 新=${r.new} 容差=${r.tol}`); }
}
process.exit(bad.length ? 1 : 0);
