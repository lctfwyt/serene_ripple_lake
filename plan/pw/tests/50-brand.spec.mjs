// plan/pw/tests/50-brand.spec.mjs —— UP14 · 品牌改名 + 首屏标题行（AM-033）
//
// 覆盖 `plan/106-UP14-brand.md §5` 判据 1~7（判据 9「观感定档」挂雨桐，不在此列）。
// 跑在 `main` project（文件名**不含** `env-`，否则会被 `testIgnore: /env-/` 静默忽略 —— AM-031 踩过）。
//
// 本文件的设计取舍（三条，都写明理由，方便后来者复核而不是猜）：
//
// ① **判据 4（兜底页）不用 `--disable-webgl` 启动参数**，改用 `page.addInitScript()` 覆写
//    `HTMLCanvasElement.prototype.getContext`（webgl/webgl2 返回 null）。
//    理由：用 flag 就得往 `playwright.config.mjs` 加一个 project —— 该文件**不在本包白名单**
//    （§7.4-① 只授权「本包新建的测试」）。覆写 `getContext` 与 `85-fallback.js` 的 `hasWebGL()`
//    读的是**同一个 API**，且 `addInitScript` 在页面脚本之前执行 ⇒ 效果与关 flag 等价，
//    但不碰别人文件。`env-no-webgl.spec.mjs` 保留原样（它测的是另一件事，且不属本包）。
//
// ② **判据 6/7「不该变的没变」只做绝对基线 + 内容守卫，不读 git 状态**。
//    理由：`git status` / `git diff HEAD` 的结果**随"提没提交"翻转** —— 本文件在
//    `npm run pw` 里会被反复跑（施工中 / 提交后 / 复核时各一次），靠 git 的断言会在第二次运行
//    自相矛盾。所以这里钉的是**绝对量**：冻结件 sha256（对 `frozen-hashes.json`）·
//    `vendor/three.min.js` 的 sha256 与字节数（对 `00-INDEX §8-⑤`）· `assets/audio/` 文件名全集。
//    「本包白名单外零改动」这一步是**一次性**核查，证据走完工记录里的 `git status --porcelain`
//    原文（§7.2-2），不塞进会被反复执行的测试。
//
// ③ **判据 5 的残留扫描按"产品面 / 记录面"两分**。任务书原文的排除项是
//    `.git` / `node_modules` / `plan/98*.md` / §3 不改清单，但 `plan/02-AMENDMENTS.md` 的
//    AM-033 条目、`plan/106-*.md`、`plan/00-INDEX.md` 的波次行**必然**写「`旧名` → `新名`」
//    —— 那是改名的**记录**，删掉就没法读。所以本文件把判据拆成两条更硬的断言：
//      (a) **产品面向文件**（`plan/**` `dist/**` 之外的全部仓内文本）→ 命中**必须为 0**；
//      (b) `plan/**` 的命中 → 必须全部落在**已知的改名记录文件**白名单内（多一个就红）。
//    (a) 比原文更强（原文漏 `app/index.html` 这类"记录面之外"的镜像文件就会漏检）；
//    (b) 让"新增一处旧名"和"漏改一处旧名"两种错都跑不掉。

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, ENTRY } from '../lib/const.mjs';

// ==================================================================== 常量（唯一真值源：106 §1）

const BRAND_CN = '静湖微澜';
const BRAND_EN = 'Serene Ripple Lake';
const BRAND_FULL = `${BRAND_CN} · ${BRAND_EN}`;   // ` · ` = 空格 + U+00B7 + 空格
const OLD_NAME_RE = /静水|still water/;

// 本包白名单 ①（§7.4）—— 只有这 5 个产品文件应含品牌改动
const BRAND_CARRIERS = [
  'index.html', 'app/index.html', 'README.md', 'package.json', 'src/85-fallback.js',
];
// 两条入口 HTML —— `#brand` 的 DOM/CSS 必须**逐字一致**（镜像纪律）
const HTML_ENTRIES = ['index.html', 'app/index.html'];

const sha256 = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

// ==================================================================== 判据 1 · 两入口 <title>

test('判据 1 · 两入口 <title> 均为新名（双写不漏改）', async () => {
  for (const rel of HTML_ENTRIES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = html.match(/<title>([\s\S]*?)<\/title>/);
    expect(m, `${rel} 必须有 <title>`).not.toBeNull();
    console.log(`  ℹ ${rel} → "${m[1]}"`);
    expect(m[1].trim(), `${rel} 的 <title>`).toBe(BRAND_FULL);
  }
});

test('判据 1b · 两入口的 #brand DOM/CSS 逐字一致（镜像纪律）', async () => {
  const grab = (rel, re) => {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = html.match(re);
    expect(m, `${rel} 缺少 ${re}`).not.toBeNull();
    return m[0];
  };
  const DOM_RE = /<div id="brand">[\s\S]*?<\/div>/;
  const CSS_RE = /#brand\{[\s\S]*?\}\r?\n\s*#hint\.on \+ #brand\{[^}]*\}[\s\S]*?#brand \.en\{[^}]*\}/;
  const a = { dom: grab('index.html', DOM_RE), css: grab('index.html', CSS_RE) };
  const b = { dom: grab('app/index.html', DOM_RE), css: grab('app/index.html', CSS_RE) };
  expect(b.dom, '#brand DOM 两入口必须逐字一致').toBe(a.dom);
  expect(b.css, '#brand CSS 两入口必须逐字一致').toBe(a.css);
  console.log(`  ℹ #brand DOM = ${a.dom}`);
});

// ==================================================================== 判据 5 · 残留扫描

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'test-results']);
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.txt', '.yml', '.yaml', '.toml']);
const EXTRA_TEXT = new Set(['.gitignore', '.gitattributes', '.npmrc', 'LICENSE']);
const MAX_BYTES = 3 * 1024 * 1024;

// `plan/**` 里**允许**含旧名的文件 —— 全部是"记录改名这件事"的文档（`旧名 → 新名` 必须可读）。
// 多一个文件命中 ⇒ 判据 (b) 立刻红，所以这份白名单是收口的，不是撒网。
const PLAN_RECORDS = [
  /^plan\/98[^/]*\.md$/,                  // 归档（任务书明示排除）
  /^plan\/00-INDEX\.md$/,                 // 波次 15 行：AM-033 的 `A → B` 一句话
  /^plan\/02-AMENDMENTS\.md$/,            // AM-033 变更单正文 + 总表行
  /^plan\/106-UP14-brand\.md$/,           // 本包文档（§1 格式表 / §2 改动清单 / §3 不改清单 / §5 判据）
  /^plan\/04-BOARD\.md$/,                 // 板上开包留言
  /^plan\/_STATUS\.md$/,                  // 台账行
  /^plan\/10-WP1-scaffold-lakebed\.md$/,  // 106 §3 不改清单：WP1 文档里的旧 <title> 引用（历史记录）
  /^plan\/pw\/tests\/50-brand\.spec\.mjs$/, // **本判据自身** —— `OLD_NAME_RE` 的模式串里必须写出旧名，
                                            //   否则无从扫描。属"记录面"的必要自指，不是产品残留。
];

function scanOldName() {
  const hits = [];
  let scanned = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) { walk(abs); } continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!TEXT_EXT.has(ext) && !EXTRA_TEXT.has(e.name)) { continue; }
      let st;
      try { st = fs.statSync(abs); } catch (err) { continue; }
      if (st.size > MAX_BYTES) { continue; }
      scanned++;
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((L, i) => {
        if (OLD_NAME_RE.test(L)) { hits.push({ rel, ln: i + 1, text: L.trim().slice(0, 88) }); }
      });
    }
  })(ROOT);
  return { hits, scanned };
}

test('判据 5 · 产品面旧名残留 = 0；plan/ 命中限于改名记录', async () => {
  const { hits, scanned } = scanOldName();
  console.log(`  ℹ 扫描 ${scanned} 个文本文件，旧名命中 ${hits.length} 处`);

  const product = hits.filter((h) => !h.rel.startsWith('plan/'));
  const inPlan = hits.filter((h) => h.rel.startsWith('plan/'));
  const unexpectedPlan = inPlan.filter((h) => !PLAN_RECORDS.some((re) => re.test(h.rel)));

  for (const h of product) { console.log(`  ✗ 产品面残留 ${h.rel}:${h.ln}  ${h.text}`); }
  for (const h of inPlan) { console.log(`  · 记录面 ${h.rel}:${h.ln}`); }

  expect(scanned, '扫描不能是空转（真的读到了文件）').toBeGreaterThan(50);
  expect(product, '产品面向文件（plan/** · dist/** 之外）旧名残留必须为 0').toEqual([]);
  expect(
    unexpectedPlan,
    'plan/ 下除「改名记录」白名单外，不得出现旧名（新增一处旧名 / 漏改一处旧名都要被抓到）'
  ).toEqual([]);
});

// ==================================================================== 判据 6 · 不该变的没变

test('判据 6 · 冻结件 / three / 音频资产逐字节未动', async () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(ROOT, 'plan/pw/frozen-hashes.json'), 'utf8'));
  for (const [rel, want] of Object.entries(frozen.files)) {
    const got = sha256(path.join(ROOT, rel));
    console.log(`  ℹ ${rel}\n      want ${want}\n      got  ${got}`);
    expect(got, `${rel} sha256 必须逐字一致（冻结件）`).toBe(want);
  }

  // `00-INDEX §8-⑤` 公布的 vendor 指纹 —— 绝对基线，不依赖 git 状态
  const three = path.join(ROOT, 'vendor/three.min.js');
  const st = fs.statSync(three);
  expect(st.size, 'vendor/three.min.js 字节数（00-INDEX §8-⑤）').toBe(669884);
  expect(sha256(three), 'vendor/three.min.js sha256（00-INDEX §8-⑤）')
    .toBe('170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa');

  // 音频资产：文件名全集（§3 不改清单：不改名、不重编码）
  const wantAudio = [
    'bgm-mingjing.mp3', 'bgm-weifeng.mp3',
    'bird1.wav', 'bird2.wav', 'bird3.wav', 'bird4.wav', 'bird5.wav', 'bird6.wav',
    'slap1.wav', 'slap2.wav', 'slap3.wav', 'slap4.wav', 'tick1.wav', 'tick2.wav',
  ].sort();
  const gotAudio = fs.readdirSync(path.join(ROOT, 'assets/audio')).sort();
  console.log(`  ℹ assets/audio: ${gotAudio.length} 件`);
  expect(gotAudio, 'assets/audio/ 文件名全集未动').toEqual(wantAudio);

  // 交付件本体（免构建入口）不得被追加/删除 `<script>`
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...idx.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  console.log(`  ℹ index.html 经典 <script> ${scripts.length} 条`);
  expect(scripts, 'index.html 的 <script src> 序列未动（15 条，顺序即依赖顺序）').toEqual([
    'vendor/three.min.js', 'vendor/three-post.min.js',
    'src/00-config.js', 'src/10-audio.js', 'src/20-time.js', 'src/30-scene.js',
    'src/40-lakebed.js', 'src/50-ripple.js', 'src/60-water.js', 'src/65-post.js',
    'src/70-input.js', 'src/80-ui.js', 'src/85-fallback.js', 'src/90-debug.js',
    'src/99-main.js',
  ]);
});

// ==================================================================== 判据 7 · 正反两面

test('判据 7 · 正面：该变的都变了（5 个载体逐个核）', async () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  // ① README 标题
  expect(read('README.md').split(/\r?\n/)[0], 'README.md:1 H1').toBe(`# ${BRAND_FULL}`);
  // ② package.json description
  const pkg = JSON.parse(read('package.json'));
  console.log(`  ℹ package.json description = "${pkg.description}"`);
  expect(pkg.description, 'package.json description 含新名').toContain(BRAND_FULL);
  expect(pkg.name, 'package.json name 不改（§3）').toBe('still-water');
  // ③ 兜底页品牌串
  const fb = read('src/85-fallback.js');
  expect(fb, '85-fallback.js 含新品牌串').toContain(`tag.textContent = '${BRAND_FULL}';`);
  // ④⑤ 两条入口 HTML：DOM + 开关规则 + pointer-events
  for (const rel of HTML_ENTRIES) {
    const html = read(rel);
    expect(html, `${rel} 有 #brand DOM`).toContain('<div id="brand">');
    expect(html, `${rel} 有 #hint.on + #brand 开关规则`).toContain('#hint.on + #brand{opacity:1;}');
    expect(html, `${rel} 的 #brand 有 pointer-events:none`).toMatch(/#brand\{[^}]*pointer-events:none/);
    expect(html, `${rel} 的 #brand 紧跟 #hint（相邻兄弟选择器前提）`)
      .toMatch(/id="hint">[\s\S]{0,40}?<\/div>\s*<div id="brand">/);
  }
  console.log('  ℹ 5 个载体全部命中；index.html / app/index.html 的 DOM 与开关规则同时成立');
});

test('判据 7b · 反面：品牌改动未渗进渲染路径', async () => {
  // 本包只应碰 `src/85-fallback.js` 这一个 src 文件。渲染路径上的模块**不得**出现品牌串或 `#brand`。
  const renderPath = [
    'src/00-config.js', 'src/10-audio.js', 'src/20-time.js', 'src/30-scene.js',
    'src/40-lakebed.js', 'src/50-ripple.js', 'src/60-water.js', 'src/65-post.js',
    'src/70-input.js', 'src/80-ui.js', 'src/90-debug.js', 'src/99-main.js',
  ];
  for (const rel of renderPath) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src.includes(BRAND_CN), `${rel} 不应含品牌串`).toBe(false);
    expect(src.includes('brand'), `${rel} 不应出现 brand 标识`).toBe(false);
    expect(OLD_NAME_RE.test(src), `${rel} 也不应残留旧名`).toBe(false);
  }
  console.log(`  ℹ ${renderPath.length} 个渲染路径模块：品牌串 / brand 标识 / 旧名 三项均 0 命中`);
});

// ==================================================================== 判据 2 + 3 · 首屏两行

const SNAP = `(function(){
  var h = document.getElementById('hint'), b = document.getElementById('brand');
  var op = function(el){ return el ? +getComputedStyle(el).opacity : null; };
  var box = null;
  if (b) { var r = b.getBoundingClientRect();
           box = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }
  var q = function(sel){ var e = b && b.querySelector(sel); return e ? e.textContent : null; };
  return {
    hint: op(h), brand: op(b),
    hintCls: h ? h.className : null,
    brandCls: b ? b.className : null,
    brandClsLen: b ? b.classList.length : -1,
    brandTag: b ? b.tagName : null,
    prevSibId: (b && b.previousElementSibling) ? b.previousElementSibling.id : null,
    nextSib: (b && b.nextElementSibling) ? b.nextElementSibling.id : '<none>',
    brandText: b ? (b.textContent || '').trim() : null,
    cn: q('.cn'), dot: q('.dot'), en: q('.en'),
    box: box, pe: b ? getComputedStyle(b).pointerEvents : null,
    display: b ? getComputedStyle(b).display : null
  };
})()`;

test('判据 2/3 · 首屏两行同起同落 + #brand 结构性从不被 toggle', async ({ page }) => {
  await page.goto(ENTRY);
  await page.waitForFunction('!!(window.SW && window.SW.ready === true)', null, { timeout: 40_000 });

  // —— 结构性前提（判据 3 的一部分）：`#brand` 必须是 `#hint` 的**紧邻**后一个元素，
  //    否则 `#hint.on + #brand` 这条相邻兄弟选择器失效 ⇒ 两行必然不同步。
  const before = await page.evaluate(SNAP);
  console.log(`  ℹ #brand 前一个兄弟 = #${before.prevSibId} · 结构 = ${before.brandText}`);
  console.log(`  ℹ #brand bbox(CSS, 1280×720) = [${before.box.join(', ')}] · pointer-events=${before.pe}`);
  expect(before.prevSibId, '#brand 必须紧跟 #hint（相邻兄弟选择器的前提）').toBe('hint');
  expect(before.brandTag, '品牌行是 DOM 元素（不是自动生成的）').toBe('DIV');
  expect(before.display, '#brand 不能被 display:none（否则"同起同落"无法观测）').toBe('flex');
  expect(before.pe, '#brand 必须 pointer-events:none（不吃水面手势）').toBe('none');
  expect(before.cn, '中文片段').toBe(BRAND_CN);
  expect(before.dot, '分隔符').toBe('·');
  expect(before.en, '英文片段').toBe(BRAND_EN);
  expect(before.brandClsLen, '初始：#brand 自己不带任何 class').toBe(0);

  // —— 相位 A：`#hint` 的 900ms 定时器 + 0.8s 淡入落地 ⇒ **两行都必须为 1**
  //    ⚠ 必须等**严格等于 1**（不是 `>= 0.99`）：过渡中途 `getComputedStyle` 会读到 0.9959 这种
  //    分数值，宽松阈值会在过渡没走完时就通过，然后断言读到小数而失败（首版就栽在这）。
  await page.waitForFunction(`(function(){
    var h = document.getElementById('hint'), b = document.getElementById('brand');
    return !!h && !!b && getComputedStyle(h).opacity === '1' && getComputedStyle(b).opacity === '1';
  })()`, null, { timeout: 20_000, polling: 100 });
  const A = await page.evaluate(SNAP);
  console.log(`  ℹ 相位 A（首屏）：#hint=${A.hint} · #brand=${A.brand} · #brand class.len=${A.brandClsLen}` +
    ` · #hint class="${A.hintCls}"`);
  expect(A.hint, '相位 A · #hint 不透明').toBe(1);
  expect(A.brand, '相位 A · #brand 不透明').toBe(1);
  expect(A.brandClsLen, '相位 A · #brand 仍无 class（同步来自 #hint，不是自己被 toggle）').toBe(0);

  // —— 相位 B：一次 pointerdown ⇒ **两行都必须为 0**（判据是"两者相等"，不是绝对值）
  await page.evaluate(`window.dispatchEvent(new PointerEvent('pointerdown'))`);
  await page.waitForFunction(`(function(){
    var h = document.getElementById('hint'), b = document.getElementById('brand');
    return !!h && !!b && getComputedStyle(h).opacity === '0' && getComputedStyle(b).opacity === '0';
  })()`, null, { timeout: 20_000, polling: 100 });
  const B = await page.evaluate(SNAP);
  console.log(`  ℹ 相位 B（手势后）：#hint=${B.hint} · #brand=${B.brand} · #brand class.len=${B.brandClsLen}` +
    ` · #hint class="${B.hintCls}"`);
  expect(B.hint, '相位 B · #hint 透明').toBe(0);
  expect(B.brand, '相位 B · #brand 透明').toBe(0);
  expect(B.brandClsLen, '相位 B · #brand 全程没被 toggle 过（结构性同步的决定性证据）').toBe(0);
  expect(B.brandCls, '相位 B · #brand className 恒为空串').toBe('');
  expect(A.hint - A.brand, '两行不透明度差（相位 A）').toBe(0);
  expect(B.hint - B.brand, '两行不透明度差（相位 B）').toBe(0);
  console.log('  ℹ 两相位的不透明度差均为 0 ⇒ 同起同落成立，且只由 #hint 一个开关驱动');
});

// ==================================================================== 判据 4 · 兜底页

test('判据 4 · 兜底页：品牌行不显示、说明含新名、console 零 JS 报错', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('exception: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console.error: ' + m.text()); } });

  // 与 `85-fallback.js` 的 `hasWebGL()` 读同一个 API ⇒ 效果等价于 `--disable-webgl`，
  // 但不必往 `playwright.config.mjs` 加 project（该文件不在本包白名单；见文件头 ①）。
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') { return null; }
      return orig.apply(this, arguments);
    };
  });

  await page.goto(ENTRY);
  await page.waitForFunction(`!!document.getElementById('fallback')`, null, { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(`(function(){
    var f = document.getElementById('fallback'), b = document.getElementById('brand'),
        h = document.getElementById('hint'), cv = document.getElementById('c');
    return {
      fbOn: f ? f.classList.contains('on') : null,
      fbText: f ? (f.textContent || '').trim() : '',
      brandOpacity: b ? +getComputedStyle(b).opacity : null,
      brandText: b ? (b.textContent || '').trim() : null,
      hintOn: h ? h.classList.contains('on') : null,
      hintOpacity: h ? +getComputedStyle(h).opacity : null,
      canvasDisplay: cv ? getComputedStyle(cv).display : null,
      swReady: !!SW.ready,
      fbWebgl: SW.fallback ? SW.fallback.webgl : null,
      webglCtx: (function(){ try { var t = document.createElement('canvas');
        return !!(t.getContext('webgl2') || t.getContext('webgl')); } catch (e) { return 'throw'; } })()
    };
  })()`);
  console.log('  ' + JSON.stringify(r));

  expect(r.webglCtx, '覆写真的关掉了 WebGL（否则本用例无意义）').toBe(false);
  expect(r.swReady, '未进入任何模块 init').toBe(false);
  expect(r.fbWebgl, 'SW.fallback.webgl').toBe(false);
  expect(r.fbOn, '#fallback 亮起').toBe(true);
  expect(r.canvasDisplay, '#c 已隐藏').toBe('none');

  // —— 判据 4 的三条主体
  expect(r.brandOpacity, '#brand 在兜底页不显示（#hint 无 .on ⇒ 派生值恒 0）').toBe(0);
  expect(r.hintOn, '#hint 未被点亮').toBe(false);
  expect(r.hintOpacity, '#hint 也不显示（两行一致）').toBe(0);
  expect(r.fbText, '#fallback 说明含新名').toContain(BRAND_CN);
  expect(r.fbText, '#fallback 说明含新英文名').toContain(BRAND_EN);
  expect(r.fbText, '#fallback 说明仍保留 WebGL 原因行').toContain('WebGL');
  expect(errors, 'console 零 JS 报错（走 boot 拦截器，不是 index.html 的 try/catch）').toEqual([]);
});
