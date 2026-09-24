// plan/pw/verify-frozen.mjs —— UP6 · 验收 #4：两个冻结脚本的 sha256 未变
//
// 90-WAVE4 §1 / §0 耦合 ①：`plan/wp5-assert.js` 与 `plan/wp5-env.js` 本波次冻结
//   （UP8 / UP5 正拿它们跑回归）。UP6 的全部工作必须在**不碰它们**的前提下完成。
//
// 基线是 `plan/pw/frozen-hashes.json`（UP6 开工前一刻落的），不是硬编码常量 ——
//   硬编码会让"改了什么"不可见；用开工基线，diff 一出来就见分晓。
//
// 运行：node plan/pw/verify-frozen.mjs
// 退出码：0 = 未变；1 = 有文件被改动

import fs from 'node:fs';
import crypto from 'node:crypto';
import { FROZEN, FROZEN_HASHES } from './lib/const.mjs';

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

if (!fs.existsSync(FROZEN_HASHES)) {
  console.error(`缺少开工基线 ${FROZEN_HASHES}`);
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(FROZEN_HASHES, 'utf8')).files || {};

let bad = 0;
console.log('验收 #4 · 冻结件 sha256');
console.log(`  基线来源: ${FROZEN_HASHES}`);
for (const f of FROZEN) {
  const now = sha256(f.file);
  const ref = base[f.rel];
  const ok = ref === now;
  if (!ok) { bad++; }
  console.log(`  ${ok ? '✅' : '❌'} ${f.name}`);
  console.log(`      基线 ${ref || '(缺)'}`);
  console.log(`      当前 ${now}`);
}

// 顺带核一遍：本波次还冻结了 `plan/shots-wp5/`（升级前的证据帧）
const SHOTS = ['dawn-晨雾-h5_5.png', 'noon-正午-h12_5.png', 'dusk-黄昏-h18_5.png', 'night-星夜-h22_5.png'];
const shotsDir = FROZEN[0].file.replace(/wp5-assert\.js$/, 'shots-wp5');
for (const n of SHOTS) {
  const f = `${shotsDir}/${n}`;
  if (!fs.existsSync(f)) { console.log(`  ⚠ 证据帧缺失: ${f}`); continue; }
  const st = fs.statSync(f);
  console.log(`  ℹ 证据帧 ${n} · ${st.size} B · ${st.mtime.toISOString()}`);
}

console.log(bad ? `\n❌ ${bad} 个冻结件被改动 —— 本波次不允许` : '\n✅ 冻结件未被改动');
process.exit(bad ? 1 : 0);
