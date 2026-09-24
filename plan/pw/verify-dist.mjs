// plan/pw/verify-dist.mjs —— UP6 · 验收 #5：Playwright 不进交付物
//
// 做法：把 `dist/` 的**内容清单（相对路径 + sha256）**在两次之间比对。
//   ① `node plan/pw/verify-dist.mjs snapshot`  —— 落一份基线（UP6 开工前已落一份）
//   ② 跑一次 `npm run build`
//   ③ `node plan/pw/verify-dist.mjs check`     —— 逐文件比对；新增/删除/改动都报出来
//
// 为什么用哈希清单而不是 `git status`：`dist/` 被 .gitignore §4 忽略（它是一条命令就能重建的产物），
//   所以 git 看不见它变了没有 —— 只有内容哈希看得见。
//
// 运行：node plan/pw/verify-dist.mjs [snapshot|check]
// 退出码：0 = 内容一致；1 = 有差异

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DIST_BASELINE } from './lib/const.mjs';

const DIST = path.join(ROOT, 'dist');
const MODE = process.argv[2] || 'check';
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function manifest() {
  if (!fs.existsSync(DIST)) { return null; }
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); } else { out.push({ file: `./${r}`, hash: sha256(abs), size: fs.statSync(abs).size }); }
    }
  })(DIST, '');
  return out;
}

if (MODE === 'snapshot') {
  const m = manifest();
  if (!m) { console.error('dist/ 不存在'); process.exit(1); }
  fs.mkdirSync(path.dirname(DIST_BASELINE), { recursive: true });
  // 环境头（`#` 行会在 check 的正则里被跳过，不影响解析）——
  // 这条基线入库后可被任何 checkout 独立复核，故须写清它对应哪套构建环境。
  const pkgV = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return '?'; } };
  const head = [
    '# dist/ 内容基线 —— UP6 验收 #5「Playwright 不进交付物」的比对基准。',
    `# 记录环境：node ${process.version} · vite ${pkgV('vite')} · three ${pkgV('three')} · ${new Date().toISOString()}`,
    '# 复核：npm run build && npm run pw:dist      （不一致 = dist ≡ f(src) 被破坏，或有 dev-only 引用泄漏）',
    '',
  ].join('\n');
  fs.writeFileSync(DIST_BASELINE, head + m.map((x) => `${x.hash}  ${x.file}`).join('\n') + '\n');
  console.log(`已落基线 ${DIST_BASELINE} · ${m.length} 个文件`);
  for (const x of m) { console.log(`  ${x.hash.slice(0, 12)}…  ${String(x.size).padStart(9)} B  ${x.file}`); }
  process.exit(0);
}

if (!fs.existsSync(DIST_BASELINE)) { console.error(`缺少基线 ${DIST_BASELINE}（先跑 snapshot）`); process.exit(1); }
const base = new Map();
for (const line of fs.readFileSync(DIST_BASELINE, 'utf8').split('\n')) {
  const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
  if (m) { base.set(m[2].trim(), m[1]); }
}
const now = manifest();
if (!now) { console.error('dist/ 不存在 —— 先跑一次 npm run build'); process.exit(1); }
const cur = new Map(now.map((x) => [x.file, x.hash]));

const added = [...cur.keys()].filter((k) => !base.has(k));
const removed = [...base.keys()].filter((k) => !cur.has(k));
const changed = [...cur.keys()].filter((k) => base.has(k) && base.get(k) !== cur.get(k));

console.log(`验收 #5 · dist/ 内容清单比对（基线 ${base.size} 个文件 / 当前 ${cur.size} 个文件）`);
for (const x of now) { console.log(`  ${cur.get(x.file) === base.get(x.file) ? '=' : '!'} ${String(x.size).padStart(9)} B  ${x.file}`); }
if (added.length) { console.log('  新增: ' + added.join(', ')); }
if (removed.length) { console.log('  删除: ' + removed.join(', ')); }
if (changed.length) { console.log('  改动: ' + changed.join(', ')); }

// 额外的针对性检查：dev-only 的东西绝不会被引用进交付物
const distHtml = path.join(DIST, 'index.html');
let leaks = [];
if (fs.existsSync(distHtml)) {
  const html = fs.readFileSync(distHtml, 'utf8');
  for (const needle of ['playwright', 'plan/pw', 'pw-report', 'test-results', '@playwright']) {
    if (html.toLowerCase().includes(needle.toLowerCase())) { leaks.push(needle); }
  }
  console.log(`  交付物 dist/index.html 体积 ${fs.statSync(distHtml).size} B · 引用泄漏检查: ${leaks.length ? leaks.join(', ') : '无'}`);
}
const strayDirs = fs.readdirSync(DIST).filter((n) => /^(plan|pw|playwright|test-results)$/.test(n));
if (strayDirs.length) { console.log('  ⚠ dist/ 下出现非交付目录: ' + strayDirs.join(', ')); }

const bad = added.length + removed.length + changed.length + leaks.length + strayDirs.length;
console.log(bad ? `\n❌ dist/ 内容有差异或存在引用泄漏` : '\n✅ dist/ 内容逐文件一致 · 无 dev-only 引用泄漏');
process.exit(bad ? 1 : 0);
