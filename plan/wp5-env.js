// _wp5-env.js —— WP5 环境类判据（临时件，交付前删）
//   判据 #2 375px 窄屏不崩、UI 不重叠
//   判据 #3 prefers-reduced-motion 下是静帧且不自动走时
//   判据 #4 强制关 WebGL → 显示渐变兜底，不白屏、console 无 JS 报错
// 每个判据用独立的 Chrome 实例（启动 flag / 媒体模拟条件不同）。
//
// 运行：C:/Users/wuyutong/.workbuddy/binaries/node/versions/22.22.2-3/node.exe plan/wp5-env.js
// 输出：plan/wp5-env.json      2026-09-24 实测：16/16 通过。
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///D:/projects/still_water/index.html?debug=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port, flags, url) {
  const userDir = path.join(os.tmpdir(), 'sw-wp5-env-' + port);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', ...flags, url
  ], { stdio: 'ignore' });

  const errors = [];
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch (e) {}
    await sleep(300);
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.text || ''));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const t = m.params.entry.text || '';
      if (!/ERR_FILE_NOT_FOUND|net::ERR_/.test(t)) { errors.push('log: ' + t); }
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  return { chrome, send, ev, errors };
}

const out = [];
const rec = (name, ok, detail) => { out.push({ name, ok, detail }); console.log(`${ok ? '  ✅' : '  ❌'} ${name}  ${detail}`); };

(async () => {
  // ================================================================ 判据 #2 窄屏 375px
  console.log('\n=== 判据 #2 · 375×812 窄屏 ===');
  {
    const c = await connect(9371, ['--window-size=375,812'], URL);
    try {
      await c.ev('1'); await sleep(3200);
      const r = await c.ev(`(function(){
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
      rec('#2 窄屏不崩', r.ready === true && r.fallback.mobile === true && r.cw > 100,
        `viewport ${r.winW}×${r.winH} · canvas ${r.cw}×${r.ch} · bootMs=${(r.bootMs||0).toFixed(0)} · mobile=${r.fallback.mobile}(${r.fallback.mobileWhy})`);
      rec('#2 降级生效', r.fieldSize === 256 && r.pebbles === '50+70' && r.caustics === false,
        `fieldSize=${r.fieldSize} pebbles=${r.pebbles} caustics=${r.caustics} applied=[${r.fallback.applied.join(' | ')}]`);
      rec('#2 UI 不重叠', r.overs.length === 0, r.overs.length ? r.overs.join(' ; ')
        : `${r.uiCount} 个可见元素（已排除祖先/后代对）两两无交叠 · 顶层: ${r.topLevel.join(' | ')}`);
      rec('#2 UI 不出屏', r.outOfBounds.length === 0, r.outOfBounds.length ? r.outOfBounds.join(' ; ') : '全部在视口内');
      rec('#2 console 无 JS 报错', c.errors.length === 0, c.errors.join(' | ') || '无');
    } finally { c.chrome.kill(); }
  }

  // ================================================================ 判据 #3 reduced-motion
  console.log('\n=== 判据 #3 · prefers-reduced-motion: reduce ===');
  {
    const c = await connect(9372, ['--window-size=1306,876'], URL);
    try {
      await c.ev('1'); await sleep(3000);
      // 媒体模拟必须在页面加载前生效 → 设置后重新导航一次
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await c.send('Page.navigate', { url: URL });
      await sleep(4200);
      const t0 = await c.ev('({ h: SW.time.getHour(), mode: SW.time.getMode(), rm: matchMedia("(prefers-reduced-motion: reduce)").matches, fb: SW.fallback })');
      const s0 = await c.ev('(function(){ var r = SW.scene.renderer, gl = r.getContext(); var w=gl.drawingBufferWidth,h=gl.drawingBufferHeight; r.render(SW.scene.scene,SW.scene.camera); var b=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b); var s=0,n=0; for(var y=Math.floor(h*0.2);y<Math.floor(h*0.6);y+=3){for(var x=0;x<w;x+=3){var i=(y*w+x)*4; s+=0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2]; n++;}} return +(s/n).toFixed(2); })()');
      await sleep(4000);
      const t1 = await c.ev('SW.time.getHour()');
      const s1 = await c.ev('(function(){ var r = SW.scene.renderer, gl = r.getContext(); var w=gl.drawingBufferWidth,h=gl.drawingBufferHeight; r.render(SW.scene.scene,SW.scene.camera); var b=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b); var s=0,n=0; for(var y=Math.floor(h*0.2);y<Math.floor(h*0.6);y+=3){for(var x=0;x<w;x+=3){var i=(y*w+x)*4; s+=0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2]; n++;}} return +(s/n).toFixed(2); })()');
      const rm = await c.ev('({ rm: SW.fallback.reducedMotion, cam: SW.P.cameraSway, jit: SW.P.glitterJitter, applied: SW.fallback.applied })');
      // 自走相位是否钉住：连取两次 uTime（必须完全相同）
      const u0 = await c.ev('SW.water.uniforms.uTime.value');
      await sleep(1200);
      const u1 = await c.ev('SW.water.uniforms.uTime.value');
      const frozen = await c.ev('!!SW.water.__rmFrozen');
      // 「只响应显式点击」：模拟一次真实点击，涟漪源必须被创建
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 430, button: 'left', clickCount: 1, buttons: 1 });
      await sleep(80);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 430, button: 'left', clickCount: 1, buttons: 0 });
      await sleep(500);
      const clickAct = await c.ev('SW.ripple.probe().active');
      console.log('  ' + JSON.stringify({ t0, s0, t1, s1, rm, u0, u1, frozen, clickAct }));
      rec('#3 命中媒体查询', t0.rm === true && rm.rm === true, `matchMedia(reduce)=${t0.rm} · SW.fallback.reducedMotion=${rm.rm}`);
      rec('#3 不自动走时', t0.mode === 'fixed' && Math.abs(t1 - t0.h) < 1e-6,
        `mode=${t0.mode} · hour ${t0.h.toFixed(4)} → ${t1.toFixed(4)}（4s 后）· 差 ${Math.abs(t1-t0.h).toExponential(2)}`);
      rec('#3 环境动效关闭', rm.cam === false && rm.jit === 0,
        `cameraSway=${rm.cam} · glitterJitter=${rm.jit} · applied=[${rm.applied.join(' | ')}]`);
      rec('#3 水面自走相位已钉住', frozen === true && u0 === u1 && rm.applied.some((a) => a.indexOf('uTime=') === 0),
        `uTime ${u0} → ${u1}（1.2s 后，必须相等）· __rmFrozen=${frozen}`);
      rec('#3 点击仍出涟漪(只响应显式)', clickAct > 0, `点击后 ripple.active=${clickAct} (>0)`);
      rec('#3 画面非空(静帧)', s0 > 10 && s1 > 10, `区间均亮 ${s0} → ${s1}（两次采样，画面有效）`);
      rec('#3 console 无 JS 报错', c.errors.length === 0, c.errors.join(' | ') || '无');
    } finally { c.chrome.kill(); }
  }

  // ================================================================ 判据 #4 WebGL 关闭
  console.log('\n=== 判据 #4 · 强制关 WebGL ===');
  {
    const c = await connect(9373, ['--window-size=1306,876', '--disable-3d-apis', '--disable-webgl'], URL);
    try {
      await c.ev('1'); await sleep(3000);
      const r = await c.ev(`(function(){
        var f = document.getElementById('fallback'), cv = document.getElementById('c');
        return { fb: SW.fallback, hasFallback: !!f, fbOn: f ? f.classList.contains('on') : null,
                 fbText: f ? (f.textContent || '').trim() : '',
                 canvasDisplay: cv ? getComputedStyle(cv).display : null,
                 uiDisplay: (function(){ var u = document.getElementById('ui'); return u ? getComputedStyle(u).display : null; })(),
                 webglCtx: (function(){ try { var t = document.createElement('canvas'); return !!(t.getContext('webgl2') || t.getContext('webgl')); } catch(e){ return 'throw'; } })(),
                 swReady: !!SW.ready, probeExposed: typeof window.__probe };
      })()`);
      console.log('  ' + JSON.stringify(r));
      rec('#4 兜底显示', r.fbOn === true && r.canvasDisplay === 'none',
        `#fallback.on=${r.fbOn} · #c display=${r.canvasDisplay} · #ui display=${r.uiDisplay}`);
      rec('#4 未进入模块 init', r.swReady === false && r.fb.webgl === false,
        `SW.ready=${r.swReady} · SW.fallback.webgl=${r.fb.webgl} · reason="${r.fb.reason}" · bootWrapped=${r.fb.bootWrapped}`);
      rec('#4 有说明文字', r.fbText.indexOf('WebGL') >= 0, `#fallback 文案="${r.fbText}"`);
      rec('#4 console 无 JS 报错', c.errors.length === 0, c.errors.join(' | ') || '无（走了 boot 拦截器，未触发 index.html 的 try/catch）');
    } finally { c.chrome.kill(); }
  }

  const pass = out.filter((o) => o.ok).length;
  console.log(`\n=========== 环境判据 ${pass}/${out.length} 通过 ===========`);
  fs.writeFileSync('D:/projects/still_water/plan/wp5-env.json', JSON.stringify(out, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch((e) => { console.error('失败:', e.message, e.stack); process.exit(1); });
