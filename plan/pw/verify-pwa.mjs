// plan/pw/verify-pwa.mjs —— 主控独立复核：UP17「PWA 可安装 + 离线」（AM-036）
// 用法：先起一个**支持 Range 且 .webmanifest MIME 正确**的静态服务，再
//   npx vite preview --port 8022 --strictPort          # 推荐（sirv 支持 206 + MIME）
//   node plan/pw/verify-pwa.mjs                        # 默认 http://127.0.0.1:8022/
//   VERIFY_URL=http://127.0.0.1:9000/ node plan/pw/verify-pwa.mjs
// 判据 10 条（下表数值 = 2026-09-30 03:5x 首次跑的读数）。
// ⚠ 不复用施工方脚本、不改任何文件，只读页面状态。
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = (process.env.VERIFY_URL || 'http://127.0.0.1:8022/').replace(/\/$/, '');
const ARGS = ['--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ck = (name, ok, detail) => { console.log(`${ok ? '✅' : '❌'} ${name}  ${detail}`); if (!ok) fail++; };

/* ---------------------------------------------------------------- 静态侧读数 */
const mani = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
const swjs = readFileSync('dist/sw.js', 'utf8');
const VERSION = (swjs.match(/VERSION\s*=\s*'([^']+)'/) || [])[1];
const rootHtml = readFileSync('index.html', 'utf8');

/* ------------------------------------------------------------------- 浏览器 */
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const jsErrs = [], netFail = [];
page.on('pageerror', (e) => jsErrs.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') jsErrs.push(m.text()); });
page.on('requestfailed', (r) => netFail.push(r.url() + ' :: ' + (r.failure() || {}).errorText));

await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForFunction('window.SW && SW.ready === true', null, { timeout: 60000 });
await sleep(800);

/* 1~2 · manifest：HTTP + 浏览器侧解析（CDP 才是「Chrome 认不认」的真判据） */
const mr = await page.request.get(BASE + '/manifest.webmanifest');
const mct = mr.headers()['content-type'] || '';
ck('1 manifest 200 + MIME 正确', mr.status() === 200 && /manifest\+json|application\/json/.test(mct),
   `${mr.status()} · Content-Type = ${mct}`);

const cdp = await ctx.newCDPSession(page);
const am = await cdp.send('Page.getAppManifest').catch(() => null);
const amErr = am ? (am.errors || []) : ['CDP 不可用'];
ck('2 Chrome 认可 manifest（CDP getAppManifest 零错误）', amErr.length === 0,
   `errors = ${JSON.stringify(amErr)} · url = ${am && am.url}`);

/* 3 · icons 尺寸与 sizes 逐字一致 —— 用真实解码，不读元数据 */
const iconChk = await page.evaluate(async (list) => {
  const out = [];
  for (const it of list) {
    const bmp = await createImageBitmap(await (await fetch(it.src)).blob()).catch(() => null);
    out.push({ src: it.src, want: it.sizes, got: bmp ? `${bmp.width}x${bmp.height}` : 'DECODE_FAIL' });
  }
  return out;
}, mani.icons);
ck('3 icons 真实像素 = sizes 逐字一致', iconChk.every((r) => r.got === r.want),
   iconChk.map((r) => `${r.src.split('/').pop()} ${r.got}`).join(' · '));

/* 4 · 六件静态件全部可取（含 ico / svg） */
const files = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
               'icons/apple-touch-icon.png', 'icons/favicon.ico', 'icons/favicon.svg'];
const stats = [];
for (const f of files) { const r = await page.request.get(`${BASE}/${f}`); stats.push(`${f.split('/').pop()}:${r.status()}`); }
ck('4 图标 6 件全部 200', stats.every((s) => s.endsWith(':200')), stats.join(' · '));

/* 5 · SW 注册并接管 */
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { has: !!reg, ctrl: navigator.serviceWorker.controller !== null,
           scope: reg && reg.scope, script: reg && reg.active && reg.active.scriptURL };
});
ck('5 SW 已注册并接管', sw.has && sw.ctrl, `controller=${sw.ctrl} · scope=${sw.scope} · script=${(sw.script || '').split('/').pop()}`);

/* 6 · 联网先听一次 —— 让音频入懒缓存
 * ⚠ 方法学坑（与 UP15 verify-mix 同款）：**首次手势之后 slap 池要 4s 才建好**（SLAP_DELAY 4000ms）
 *   ⇒ 「点一次就立刻读 slaps」必然得到 0（假红）。必须：预热手势 → 等池 → 再点 → 读。 */
const tap = async (x, y) => {
  await page.mouse.move(x, y); await page.mouse.down(); await sleep(150); await page.mouse.up();
  await sleep(400);
};
await tap(640, 400);                 // ① 预热：启动 AudioContext
await sleep(5600);                   // ② 等 slap 池（SLAP_DELAY 4000 + 余量）
await tap(660, 420);                 // ③ 真正的测量手势
const onlineSlaps = await page.evaluate(() => (SW.audio.probe().slaps || 0));
ck('6 联网：点击确实触发拍击', onlineSlaps > 0, `slaps = ${onlineSlaps}`);

/* 7 · 断网刷新 —— 壳离线可用 */
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
const off = await page.waitForFunction('window.SW && SW.ready === true', null, { timeout: 60000 })
  .then(() => true).catch(() => false);
const alive = await page.evaluate(() => {
  const c = document.getElementById('c');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return { ready: !!(window.SW && SW.ready), lost: gl ? gl.isContextLost() : null,
           canvas: !!c && getComputedStyle(c).display !== 'none' };
});
ck('7 断网刷新仍能开（壳预缓存生效）', off && alive.ready && alive.lost === false,
   `SW.ready=${alive.ready} · contextLost=${alive.lost} · canvas 可见=${alive.canvas}`);

/* 8 · 断网仍出声（音频懒缓存命中）—— 同样要先预热再测量（新页面 ⇒ 池要重建） */
await tap(640, 400); await sleep(5600); await tap(660, 420);
const offSlaps = await page.evaluate(() => (SW.audio.probe().slaps || 0));
ck('8 断网仍出声（音频来自 cache）', offSlaps > 0, `断网后 slaps = ${offSlaps}`);

const audioRes = await page.evaluate(async () => {
  try { const r = await fetch('assets/audio/slap1.wav'); return { ok: r.ok, status: r.status, len: (await r.blob()).size }; }
  catch (e) { return { ok: false, err: String(e) }; }
});
ck('9 断网下音频请求仍 200（非 504 降级）', audioRes.ok && audioRes.status === 200,
   `slap1.wav → ${audioRes.status} · ${audioRes.len} B`);

await ctx.setOffline(false);

/* 10 · 免构建入口保持「不对称」（根入口不引用 manifest ⇒ file:// 不产生失败请求） */
ck('10 根 index.html 未引用 manifest / sw（不对称裁定守住）',
   !/manifest\.webmanifest/.test(rootHtml) && !/serviceWorker/.test(rootHtml),
   `rel=manifest ${/manifest\.webmanifest/.test(rootHtml) ? '存在（违规）' : '无'} · serviceWorker ${/serviceWorker/.test(rootHtml) ? '存在（违规）' : '无'}`);

ck('11 VERSION 与 sw.js 一致（改 manifest 必须同步 bump）', VERSION === 'srl-v2',
   `dist/sw.js VERSION = ${VERSION} · manifest.name = ${mani.name}`);

const realErrs = jsErrs.filter((e) => !/Failed to load resource/.test(e));
ck('12 console 零 JS 报错（http 入口）', realErrs.length === 0,
   realErrs.length ? realErrs.slice(0, 2).join(' | ') : '无');

console.log(`  ℹ 失败请求（含断网期预期项）: ${netFail.length ? netFail.slice(0, 3).join(' · ') : '无'}`);
await browser.close();
console.log(fail === 0 ? '\n✅ 独立复核 12/12 通过' : `\n❌ 独立复核 ${fail} 条未通过（共 12）`);
process.exit(fail === 0 ? 0 : 1);
