/* sw.js —— 静湖微澜 · Serene Ripple Lake · PWA 离线壳
 * ============================================================================
 * UP17 / AM-036（波次 18）
 *
 * 本项目之所以异常简单：`vite-plugin-singlefile` 把全部 JS/CSS 内联进 index.html
 * ⇒ **壳只有 1 个 HTML**（+ manifest + 6 个图标，合计几十 KB）。
 * 整个 dist/ 8.9 MB 里有 8.08 MB 是 `assets/audio/`，那部分走「懒缓存」——**绝不预缓存**。
 *
 * 三条策略：
 *   ① 壳（约 950 KB：内联 HTML 792 KB + manifest + 6 个图标）  install 时预缓存，cache-first
 *   ② 导航（*.html）           network-first（否则新版发不出去），断网回缓存
 *   ③ `assets/audio/**`       **懒缓存**：首次真正播放时入缓存；见下方 Range 注释
 *
 * 红线：不代理 http(s) 以外的请求 · 不缓存非本域 · 播放失败不白屏（只降级）。
 * 配套：`netlify.toml` 对 `/sw.js` 与 `/manifest.webmanifest` 写死
 *       `Cache-Control: public, max-age=0, must-revalidate`（AM-035）——
 *       两者**必须配套**，否则改了 sw.js 浏览器拿不到新版本，更新链断在第一步。
 * ========================================================================== */
'use strict';

const VERSION     = 'srl-v1';                    // ← 改这个 = 发新版（activate 会清掉旧 cache）
const SHELL_CACHE = VERSION + '-shell';
const AUDIO_CACHE = VERSION + '-audio';

/** 预缓存清单（全部相对路径 ⇒ 子路径 / 任意域名部署都成立） */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  './icons/favicon.svg'
];

/** 音频路径判定（dist/assets/audio/*.mp3|wav，8.08 MB / 14 文件） */
const AUDIO_RE = /\/assets\/audio\//;

const noop = () => {};

/* ------------------------------------------------------------------ install */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 逐条 add（不是 addAll）：缺一个图标不该把整个安装拖挂 —— 能装就先装上。
    const settled = await Promise.allSettled(
      SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn('[sw] 预缓存跳过（非致命）', SHELL[i], r.reason && r.reason.message);
      }
    });
    await self.skipWaiting();                    // 新 SW 立即接管待激活队列
  })());
});

/* ----------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 只保留当前 VERSION 的 cache —— 旧版（srl-v0-* 之类）整体删掉
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf(VERSION + '-') !== 0).map((k) => caches.delete(k)));
    await self.clients.claim();                  // 立即接管已打开的页面
  })());
});

/* -------------------------------------------------------------------- fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') { return; }          // 只处理 GET

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') { return; }  // file:// 等一律不代理
  if (url.origin !== self.location.origin) { return; }                    // 非本域不碰、不缓存

  if (AUDIO_RE.test(url.pathname)) { event.respondWith(audioStrategy(req)); return; }
  if (req.mode === 'navigate')     { event.respondWith(navStrategy(req));   return; }
  event.respondWith(shellStrategy(req));
});

/* ------------------------------------------------- ③ 音频：懒缓存 + Range 处理
 *
 * ⚠ 坑：`<audio>` 会发 `Range: bytes=…`，服务器回 **206** —— `cache.put()` 对 206 直接抛错。
 *   正解（本函数）：命中缓存 → 直接返回**全量 200 体**（浏览器自己处理 Range，
 *   服务端「忽略 Range 返回 200 全量」是合法的）；
 *   未命中 → **去掉 Range/If-Range 头**取全量 → 入缓存 → 返回。
 * 验收：联网听一次 → 断网 → 刷新 → 仍能划水出声。
 * -------------------------------------------------------------------------- */
async function audioStrategy(req) {
  const url = new URL(req.url);
  url.search = '';                               // 去查询串：同一文件的不同 Range 请求共享一个 cache key
  const key = new Request(url.toString(), { method: 'GET' });
  const cache = await caches.open(AUDIO_CACHE);

  const hit = await cache.match(key);
  if (hit) { return hit; }                       // 200 全量体

  const headers = new Headers(req.headers);
  headers.delete('range');
  headers.delete('if-range');

  let res;
  try {
    res = await fetch(new Request(key, {
      headers,
      mode: 'same-origin',
      credentials: 'same-origin'
    }));
  } catch (e) {
    // 断网且从未播放过：给 504，播放器自行降级 —— 绝不能白屏 / 不能抛
    return new Response('', { status: 504, statusText: 'offline, audio not cached' });
  }
  if (res && res.status === 200) { cache.put(key, res.clone()).catch(noop); }
  return res;
}

/* ------------------------------------------------- ② 导航：网络优先，断网回壳 */
async function navStrategy(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone()).catch(noop);
    }
    return res;
  } catch (e) {
    const hit = (await caches.match(req, { ignoreSearch: true }))
             || (await caches.match('./index.html'))
             || (await caches.match('./'));
    if (hit) { return hit; }
    return new Response('<h1>离线</h1><p>未找到缓存副本。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/* --------------------------------------- ① 其它同域资源（图标 / manifest…）：缓存优先
 * 壳内文件在一个 VERSION 周期内不会变（变了就换 VERSION ⇒ 换 cache）。
 * -------------------------------------------------------------------------- */
async function shellStrategy(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) { return hit; }
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone()).catch(noop);
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}
