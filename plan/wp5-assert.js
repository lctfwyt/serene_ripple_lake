// plan/wp5-assert.js —— WP5 最终验证：15 条断言（**已归档的复现工具**，不是临时件）
//
// 口径（AM-007 §6.3 动作 #7/#8 + AM-008 §3）：
//   · 窗口 --window-size=1306,876 → viewport 1280×720（aspect 1.7778，hHalf 28.53°）
//   · 像素类判据（#3 / #6 / #13）一律用这一个画布口径，不得混用 1280×664 的读数
//   · 不加 --allow-file-access-from-files（模拟双击打开的真实条件）
//   · #5 用**色度加权** chromaStep = |ΔH| × min(C_a, C_b) < 2.5，直读 SW.time.KEYS
//   · #13 用**亮带质心**（不是 argmax）+ **24 相位中位**（不是单帧）—— 见 AM-008 §3
//
// 像素读取走页面内 gl.readPixels（同 90-debug.js 的 topRowL 手法），不落 PNG、不依赖 Pillow。
//
// 运行（路径全为绝对路径，从任意目录都行）：
//   node plan/wp5-assert.js                    # 免构建入口 · 15 条断言（不写静帧）
//   node plan/wp5-assert.js <URL>              # 指定入口（UP1a 参数化）
//   node plan/wp5-assert.js --shots            # 额外导出四态静帧到 plan/shots-wp5/
// 输出：plan/wp5-assert.json（全部读数）；静帧仅在 --shots 时写（AM-013）
// 2026-09-24 实测：15/15 通过（原口径）· AM-008 §3 换口径后复跑仍 15/15
//   · UP1a 两条入口各自 15/15（免构建 / dist），读数一致。
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = 9361;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// UP1a：URL 参数化（可选 argv[2]）。不带参数时**与改动前逐字节等价**。
//   免构建入口：node plan/wp5-assert.js
//   构建入口　：node plan/wp5-assert.js file:///D:/projects/still_water/dist/index.html?debug=1
//
// AM-013：截帧改为**显式开关**，默认只跑断言、不写静帧。
//   🔴 原因：四态静帧是**时间驱动**的（水面 uTime 自走），**同一入口跑两次也拍不出逐字节相同的帧**
//      （实测：同入口两次 PSNR 20.9~30.5dB / 跨入口 20.0~46.1dB —— 两者同量级，
//       说明差异由波纹相位主导，不是入口实现差异）。
//      而它同时在 git 里追踪 → 凡是跑一次断言就产生 4 个「假改动」。
//   → 出静帧要显式：node plan/wp5-assert.js --shots
const ARGS = process.argv.slice(2);
const WANT_SHOTS = ARGS.includes('--shots');
const URL = ARGS.find((a) => !a.startsWith('--')) || 'file:///D:/projects/still_water/index.html?debug=1';
const USER_DIR = path.join(os.tmpdir(), 'sw-wp5-assert');
const SHOT_DIR = 'D:/projects/still_water/plan/shots-wp5';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 页面内测量库
const HELPERS = `(function(){
  var W = window;
  function lum(d,i){ return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; }
  function frame(){
    var r = SW.scene.renderer, gl = r.getContext();
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    r.render(SW.scene.scene, SW.scene.camera);
    var buf = new Uint8Array(w*h*4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { w: w, h: h, d: buf };
  }
  function q01(a, p){
    if (!a.length) { return 0; }
    var s = a.slice().sort(function(x,y){ return x-y; });
    return s[Math.min(s.length-1, Math.floor(p*(s.length-1)))];
  }
  var api = {};

  api.frame = frame;

  // 区域亮度统计。y 以 readPixels 原点（画面**底部**）计。
  api.regionStd = function(x0, x1, y0, y1){
    var g = frame(), s = 0, s2 = 0, n = 0, mn = 1e9, mx = -1e9;
    var X0 = Math.floor(g.w*x0), X1 = Math.floor(g.w*x1);
    var Y0 = Math.floor(g.h*y0), Y1 = Math.floor(g.h*y1);
    for (var y = Y0; y < Y1; y++) {
      for (var x = X0; x < X1; x++) {
        var v = lum(g.d, (y*g.w + x)*4);
        s += v; s2 += v*v; n++;
        if (v < mn) { mn = v; } if (v > mx) { mx = v; }
      }
    }
    var m = s/n;
    return { mean:+m.toFixed(2), std:+Math.sqrt(Math.max(0, s2/n - m*m)).toFixed(2),
             min:+mn.toFixed(0), max:+mx.toFixed(0), n:n };
  };

  // #13：中间行带逐列均值 → 一维剖面。r0/r1 为归一化行区间（对称，故不与 readPixels 原点冲突）
  //
  // ⚠ 位置判据一律用 **centroid（亮带质心）**，不要用 peakCol（argmax）。
  //   碎光的 argmax 是**相位噪声**：三次独立采集落在 643 / 671 / 716–718，
  //   而「中心 ±6%」窗口只有 640 ± 77 → 上界 717，余量 ≈ 0（换一帧就假失败）。
  //   质心实测稳定：643 / 648 = 50.3% / 50.6%。见 AM-008 §3。
  api.colProfile = function(r0, r1){
    var g = frame();
    var Y0 = Math.floor(g.h*r0), Y1 = Math.floor(g.h*r1);
    var prof = new Array(g.w).fill(0);
    for (var y = Y0; y < Y1; y++) {
      for (var x = 0; x < g.w; x++) { prof[x] += lum(g.d, (y*g.w + x)*4); }
    }
    var k = (Y1 - Y0) || 1;
    for (var i = 0; i < g.w; i++) { prof[i] /= k; }
    var pk = -1e9, pkCol = 0;
    for (var j = 0; j < g.w; j++) { if (prof[j] > pk) { pk = prof[j]; pkCol = j; } }
    var med = q01(prof, 0.5);
    // 亮带质心：只对 med 以上的部分做加权重心（否则整幅的均匀碎光把质心拉向 0.5 无意义）
    var wsum = 0, sx = 0;
    for (var m = 0; m < g.w; m++) {
      var e = prof[m] - med;
      if (e > 0) { wsum += e; sx += e * m; }
    }
    var cen = wsum > 0 ? sx / wsum : -1;
    return { w: g.w, peak:+pk.toFixed(2), median:+med.toFixed(2), peakCol: pkCol,
             ratio:+(pk / Math.max(1e-6, med)).toFixed(3),
             centroid:+cen.toFixed(1), centroidPct:+(cen / g.w * 100).toFixed(1) };
  };

  // 多相位取中位 —— 碎光强度本身也随波纹相位起伏（单帧实测 1.87 ~ 2.20），
  // 单帧判据会把阈值卡在噪声尾巴上。uTime 是 swDetail() 的相位输入、且属契约 §2.6 公开字段，
  // 显式步进它即可在**确定性**的前提下取到 n 个相位（不依赖 rAF，不靠 sleep 赌帧）。
  api.colProfileStable = function(r0, r1, n){
    n = n || 24;
    var W = SW.water, u = (W && W.uniforms) ? W.uniforms.uTime : null;
    var t0 = u ? u.value : 0;
    var ratios = [], cens = [], w = 0, last = null;
    for (var i = 0; i < n; i++) {
      if (u) { u.value = t0 + i * 0.37; }
      last = api.colProfile(r0, r1);
      ratios.push(last.ratio); cens.push(last.centroid); w = last.w;
    }
    if (u) { u.value = t0; }
    return { w: w, n: n,
             ratioMed:+q01(ratios, 0.5).toFixed(3),
             ratioLo:+q01(ratios, 0).toFixed(3), ratioHi:+q01(ratios, 1).toFixed(3),
             centroidMed:+q01(cens, 0.5).toFixed(1),
             centroidPct:+(q01(cens, 0.5) / w * 100).toFixed(1),
             single: last };
  };

  // #3：折射 on/off 的像素差分
  //   ⚠ 必须在**有涟漪**时测：60-water.js:221 的屏幕位移 = (sR + sD*0.30) × REFRACT_K × tf × uRefract，
  //   其中 sR 是大波纹 FBO 的法线 —— 没有涟漪时 sR≈0，位移只剩很小的细节项，
  //   关掉 uRefract 几乎看不出差别（实测无涟漪时 hitFrac 仅 1.8%）。测折射前先注入涟漪才是有效口径。
  api.refractDiff = function(x0, x1, y0, y1){
    SW.water.setRefract(true);  var a = frame();
    SW.water.setRefract(false); var b = frame();
    var off = SW.water.probe().refract;
    SW.water.setRefract(true);
    var on = SW.water.probe().refract;
    var X0 = Math.floor(a.w*x0), X1 = Math.floor(a.w*x1);
    var Y0 = Math.floor(a.h*y0), Y1 = Math.floor(a.h*y1);
    var n = 0, hit = 0, sum = 0, mx = 0;
    for (var y = Y0; y < Y1; y++) {
      for (var x = X0; x < X1; x++) {
        var i = (y*a.w + x)*4;
        var d = Math.abs(a.d[i]-b.d[i]) + Math.abs(a.d[i+1]-b.d[i+1]) + Math.abs(a.d[i+2]-b.d[i+2]);
        d /= 3; n++; sum += d; if (d > 8) { hit++; } if (d > mx) { mx = d; }
      }
    }
    return { flagOff: off, flagOn: on, n: n,
             hitFrac:+(hit/n).toFixed(4), meanDiff:+(sum/n).toFixed(2), maxDiff:+mx.toFixed(0) };
  };

  // #14 / #15：逐颗投影量屏幕直径 + 三层覆盖口径
  api.lodMetric = function(){
    var THREE = window.THREE, P = SW.P, cam = SW.scene.camera;
    var cv = document.querySelector('canvas'), W = cv.width;
    cam.updateMatrixWorld(true);
    var right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    var F = P.pebbleFieldZ, HW = P.pebbleFieldHalfW, LODZ = P.pebbleLodZ;
    var hwAt = function(z){ return HW[0] + (HW[1]-HW[0]) * (z - F[0]) / (F[1] - F[0]); };
    var mtx = new THREE.Matrix4(), pos = new THREE.Vector3();
    var q = new THREE.Quaternion(), sc = new THREE.Vector3();
    var pa = new THREE.Vector3(), pb = new THREE.Vector3();
    function pxDia(p, s){
      pa.copy(p).addScaledVector(right,  s); pa.project(cam);
      pb.copy(p).addScaledVector(right, -s); pb.project(cam);
      return Math.abs(pa.x - pb.x) * W / 2;
    }
    var near = [], far = [], nearFoot = 0, nearN = 0;
    [['pebbles', near], ['pebblesFar', far]].forEach(function(pair){
      var inst = SW.lakebed[pair[0]], dst = pair[1];
      if (!inst) { return; }
      for (var i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, mtx); mtx.decompose(pos, q, sc);
        dst.push({ z:+pos.z.toFixed(3), dh:+pxDia(pos, Math.max(sc.x, sc.z)).toFixed(2),
                   sx:+sc.x.toFixed(4), sz:+sc.z.toFixed(4) });
        if (dst === near) { nearFoot += Math.PI * sc.x * sc.z; nearN++; }
      }
    });
    var med = function(a){ return q01(a.map(function(o){ return o.dh; }), 0.5); };
    var band = function(a, z0, z1){
      var lo = Math.min(z0,z1), hi = Math.max(z0,z1);
      return a.filter(function(o){ return o.z >= lo && o.z <= hi; });
    };
    var sNear = med(band(near, -11, -9.5));
    var sFar  = med(band(far,  -12.5, -11));
    var nearArea = (hwAt(F[0]) + hwAt(LODZ)) * Math.abs(LODZ - F[0]);
    var a = P.pebbleScaleNear[0], b = P.pebbleScaleNear[1];
    return {
      counts: { near: near.length, far: far.length },
      seam: { nearMed:+sNear.toFixed(2), farMed:+sFar.toFixed(2),
              nNear: band(near,-11,-9.5).length, nFar: band(far,-12.5,-11).length,
              ratio: sNear ? +(sFar/sNear).toFixed(3) : 0 },
      whole: { nearMed:+med(near).toFixed(2), farMed:+med(far).toFixed(2) },
      midRatio: +(((P.pebbleScaleFar[0]+P.pebbleScaleFar[1]) / (a+b))).toFixed(3),
      coverage: {
        instance: +(nearFoot / nearArea).toFixed(4),
        analytic: +(Math.PI * (a*a + a*b + b*b) / 3 * P.pebbleCountNear / nearArea).toFixed(4),
        area: +nearArea.toFixed(2), n: nearN
      },
      screen: { nearMed:+med(near).toFixed(1), nearMax:+q01(near.map(function(o){return o.dh;}),1).toFixed(1) }
    };
  };

  // #5：色度加权色相步长（AM-007 §5.2c）
  api.chromaStep = function(){
    var K = SW.time.KEYS;
    var F = ['sun','sky','gnd','fog','wat','gli'];
    var wrap = function(d){ d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
    var mx = 0, where = '', per = {};
    for (var f = 0; f < F.length; f++) {
      var k = F[f], m = 0;
      for (var i = 0; i < K.length; i++) {
        var A = K[i][k], B = K[(i+1) % K.length][k];
        var s = Math.abs(wrap(B[2] - A[2])) * Math.min(A[1], B[1]);
        if (s > m) { m = s; }
      }
      per[k] = +m.toFixed(3);
      if (m > mx) { mx = m; where = k; }
    }
    return { max:+mx.toFixed(3), where: where, per: per,
             raw: (SW.time.maxHueStep ? SW.time.maxHueStep() : null), keys: K.length };
  };

  W.__wp5 = api;
  return 'ok';
})()`;

// ---------------------------------------------------------------- CDP 样板
async function waitPort() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return true; } catch (e) {}
    await sleep(300);
  }
  throw new Error('Chrome 调试端口未起来');
}

const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} #${id} ${name}  ${detail}`);
}

(async () => {
  if (WANT_SHOTS) { fs.mkdirSync(SHOT_DIR, { recursive: true }); }
  try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--window-size=1306,876', '--hide-scrollbars', URL
  ], { stdio: 'ignore' });

  const jsErrors = [], netErrors = [];
  try {
    await waitPort();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
        jsErrors.push('exception: ' + (m.params.exceptionDetails.text || ''));
      } else if (m.method === 'Runtime.consoleAPICalled') {
        if (m.params.type === 'error') {
          jsErrors.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
        }
      } else if (m.method === 'Log.entryAdded') {
        const en = m.params.entry;
        if (en.level === 'error') { netErrors.push(en.source + ': ' + en.text + ' ' + (en.url || '')); }
      }
    });
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const ev = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result.value; });

    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await ev('1'); await sleep(3500);
    await ev(HELPERS);

    // ---------------------------------------------------------- 环境
    const env = await ev(`(function(){
      var c = document.querySelector('canvas');
      return { winW: innerWidth, winH: innerHeight, cw: c.width, ch: c.height,
               aspect: +SW.scene.camera.aspect.toFixed(4),
               hc: navigator.hardwareConcurrency, dpr: devicePixelRatio,
               fallback: SW.fallback, bootMs: SW.bootMs, rev: window.THREE.REVISION };
    })()`);
    console.log('环境:', JSON.stringify(env));
    const A = env.aspect;
    console.log(`画布 ${env.cw}×${env.ch} · aspect ${A} · 期望 1280×720 / 1.7778`);
    console.log(`hHalf = ${(Math.atan(Math.tan(34/2*Math.PI/180)*A)*180/Math.PI).toFixed(2)}° （期望 28.53°）`);
    console.log(`mobile 降级触发: ${env.fallback.mobile}  (${env.fallback.mobileWhy || '-'})  ·  applied: ${env.fallback.applied.join(' | ')}`);
    console.log('');

    // ---------------------------------------------------------- #1 / #2
    // ⚠ AM-009 后期链落地后，renderer.info 在 composer.render() 之后只反映**末位 pass**
    //   （1 call / 1 tri 的全屏四边形）→ 直读 __probe() 的 calls/tris 已失真。
    //   重标（主控 2026-09-24）：#2 改**直渲口径** —— 临时关后期、直渲一帧读真实场景
    //   预算、再恢复后期。语义与 WP5 原判据（场景 draw-call 纪律）完全一致。
    await ev('window.__seek(12.5)'); await sleep(1500);
    let p = await ev('window.__probe()');
    check(1, '无 NaN', p.anyNaN === false, `anyNaN=${p.anyNaN}`);
    const budget = await ev(`(function(){
      var post = SW.post, was = post.active;
      if (was) { post.setEnabled(false); }
      SW.scene.renderer.render(SW.scene.scene, SW.scene.camera);
      var i = SW.scene.renderer.info.render;
      var out = { calls: i.calls, tris: i.triangles };
      if (was) { post.setEnabled(true); }
      return out;
    })()`);
    check(2, '渲染预算(直渲口径)', budget.calls <= 8 && budget.tris <= 60000,
      `calls=${budget.calls} (≤8)  tris=${budget.tris} (≤60000)  · 后期链末pass直读已失真,此为临时直渲实测`);

    // ---------------------------------------------------------- #3 折射差分（先注入涟漪）
    const emits = await ev(`(function(){
      var n = 0;
      [[0,-6,2.0],[1.2,-8,1.6],[-1.2,-8,1.6],[0,-10,1.4]].forEach(function(a){
        if (SW.ripple.emit(a[0], a[1], a[2])) { n++; }
      });
      return { n:n, active:SW.ripple.probe().active, emitCount:SW.ripple.probe().emitCount };
    })()`);
    await sleep(900);   // 让波在场里传开（源→可见位移）
    const rf = await ev('window.__wp5.refractDiff(0.20,0.80,0.08,0.58)');
    check(3, '折射差分', rf.hitFrac > 0.10 && rf.maxDiff > 30 && rf.flagOff === false && rf.flagOn === true,
      `注入 ${emits.n}/4 源(active=${emits.active}) → hitFrac=${(rf.hitFrac*100).toFixed(1)}%  mean=${rf.meanDiff}  max=${rf.maxDiff}` +
      `  · setRefract 开关生效 ${rf.flagOff}→${rf.flagOn}`);

    // ---------------------------------------------------------- #5 色度加权色相步长
    const cs = await ev('window.__wp5.chromaStep()');
    check(5, '色相步长(色度加权)', cs.max < 2.5,
      `max=${cs.max} @${cs.where} (<2.5)  · per=${JSON.stringify(cs.per)}  · 原始(仅诊断)=${JSON.stringify(cs.raw)}`);

    // ---------------------------------------------------------- #6 湖底 std（60 帧中位）
    const stds = [];
    for (let i = 0; i < 60; i++) {
      stds.push((await ev('window.__wp5.regionStd(0.35,0.65,0.06,0.34).std')));
      await sleep(28);
    }
    const sSorted = stds.slice().sort((a, b) => a - b);
    const sMed = sSorted[Math.floor(sSorted.length / 2)];
    check(6, '湖底仍可读(60帧中位)', sMed > 14,
      `median std=${sMed.toFixed(2)} (>14)  min=${sSorted[0].toFixed(2)}  max=${sSorted[sSorted.length-1].toFixed(2)}`);

    // ---------------------------------------------------------- #9 / #10 / #11 / #12 时段
    const HOURS = [2, 5.5, 8, 12.5, 18.5, 22.5];
    const states = {};
    for (const h of HOURS) {
      await ev(`window.__seek(${h})`); await sleep(1400);
      const q = await ev('window.__probe()');
      const sunI = await ev('SW.scene.sun.intensity');
      states[h] = { sunElev: q.sunElev, sunAz: q.sunAz, hours: q.hours, glitterGain: q.glitterGain,
                    glitterSpec: q.glitterSpec, sunI };
    }
    console.log('\n--- 时段读数（度）---');
    for (const h of HOURS) {
      const s = states[h];
      console.log(`  h=${String(h).padStart(5)}  elev=${(s.sunElev*180/Math.PI).toFixed(2)}°  az=${(s.sunAz*180/Math.PI).toFixed(2)}°  ` +
        `sunI=${s.sunI.toFixed(2)}  gGain=${s.glitterGain.toFixed(2)}  gSpec=${s.glitterSpec.toFixed(3)}`);
    }
    const elev = (h) => states[h].sunElev * 180 / Math.PI;
    check(9, '光源仰角恒为正', HOURS.every((h) => states[h].sunElev > 0),
      HOURS.map((h) => `h${h}:${elev(h).toFixed(1)}°`).join(' '));
    const lowOk = [5.5, 18.5, 22.5].every((h) => elev(h) >= 22 - 1e-6 && elev(h) <= 30 + 1e-6);
    const lowCap = [5.5, 18.5, 22.5].every((h) => elev(h) <= 32);
    const noonOk = elev(12.5) >= 33;
    check(10, '低光时段落 [22°,30°]·硬上限32°·正午≥33°', lowOk && lowCap && noonOk,
      `晨${elev(5.5).toFixed(4)} 昏${elev(18.5).toFixed(4)} 夜${elev(22.5).toFixed(4)} ∈[22,30]${lowOk?'✓':'✗'} ≤32${lowCap?'✓':'✗'}` +
      `  正午${elev(12.5).toFixed(2)} ≥33${noonOk?'✓':'✗'}  · 容差 ±1e-6（19.5°→22° 的 rad↔deg 往返有 ~1e-14 噪声）`);
    // AM-023（2026-09-25 雨桐裁决）：glitterGain 子判据 0.8 → **0.5**，与 #7 的硬下限对齐。
    //   原 0.8 是「夜 gGain=1.20」时代的口径；UP13 §2-C 落地 0.55 档后它只剩冗余 ——
    //   月光是否"非零"已由 **#13 像素口径**（peak/median，实测 2.54）真正兜底，
    //   另有 `sunI > 0.4`（现 0.70）守主光。**sunI 那半条一字未动。**
    check(11, '夜间月光强度非零', states[22.5].sunI > 0.4 && states[22.5].glitterGain >= 0.5,
      `sunI(22.5)=${states[22.5].sunI.toFixed(2)} (>0.4)  glitterGain=${states[22.5].glitterGain.toFixed(2)} (≥0.5)`);
    const hHalf = Math.atan(Math.tan(34 / 2 * Math.PI / 180) * A) * 180 / Math.PI;
    const azHalf = Math.min(22, Math.max(7, hHalf - 6));
    const azOk = [5.5, 12.5, 18.5, 22.5].every((h) => {
      let off = (states[h].sunAz * 180 / Math.PI - 180);
      off = ((off % 360) + 540) % 360 - 180;
      return Math.abs(off) <= azHalf + 1e-6;
    });
    check(12, '方位落在夹取区内', azOk,
      `hHalf=${hHalf.toFixed(2)}°  azHalf=${azHalf.toFixed(2)}°  ` +
      [5.5, 12.5, 18.5, 22.5].map((h) => {
        let off = (states[h].sunAz * 180 / Math.PI - 180); off = ((off % 360) + 540) % 360 - 180;
        return `h${h}:${off.toFixed(2)}°`;
      }).join(' '));

    // ---------------------------------------------------------- 7 镜面增益日调制（probe 口径）
    // ⚠ 主控裁决（2026-09-24，挂账清账）：UP8 删 `glitterSpec()` 后本字段直读 `uGlitterGain`
    //   （60-water.js 头注），不再度量 GLSL 镜面项 —— **像素级反光柱判据已由 #13 承担**。
    //   本条保留的价值 = 校验 glitter 增益的**日调制曲线**（夜强午弱是 AM-002 设计行为），
    //   故改名注明语义，不再自称「反光柱」。判据阈值不动。
    check(7, 'glitter增益日调制:夜>午(probe直读uGlitterGain)', states[22.5].glitterSpec > 0.5 && states[12.5].glitterSpec < 0.2,
      `gGain(22.5)=${states[22.5].glitterSpec.toFixed(3)} (>0.5)  gGain(12.5)=${states[12.5].glitterSpec.toFixed(4)} (<0.2)  · 像素口径归 #13`);

    // ---------------------------------------------------------- #13 像素列剖面（夜间）
    // ⚠ AM-008 §3 口径修正：位置子判据由 argmax 改为**亮带质心**，强度子判据改为**多相位中位**。
    await ev('window.__seek(22.5)'); await sleep(1600);
    const cpNight = await ev('window.__wp5.colProfileStable(0.30, 0.70, 24)');
    const cpSingle = await ev('window.__wp5.colProfile(0.30, 0.70)');
    const cenOk = cpNight.centroidMed > 0 && Math.abs(cpNight.centroidMed - cpNight.w / 2) <= 0.06 * cpNight.w;
    check(13, '反光柱可读(像素)', cpNight.ratioMed >= 1.9 && cenOk,
      `peak/median(24相位中位)=${cpNight.ratioMed} (≥1.9, 范围 ${cpNight.ratioLo}~${cpNight.ratioHi})` +
      `  亮带质心=${cpNight.centroidMed}/${cpNight.w} (${cpNight.centroidPct}%, 中心±6%=${(cpNight.w/2).toFixed(0)}±${(0.06*cpNight.w).toFixed(0)})` +
      `  · 单帧 argmax=${cpSingle.peakCol}/${cpSingle.w}(仅诊断)`);
    const cpNoon = await (async () => { await ev('window.__seek(12.5)'); await sleep(1500); return ev('window.__wp5.colProfile(0.30, 0.70)'); })();
    console.log(`  ℹ 正午列剖面 peak/median=${cpNoon.ratio}（不作为判据，AM-007 §5.2）`);

    // ---------------------------------------------------------- #14 / #15
    const lod = await ev('window.__wp5.lodMetric()');
    console.log('\n--- LOD / 覆盖 ---');
    console.log('  ' + JSON.stringify(lod));
    check(14, 'LOD 接缝不倒挂', lod.seam.ratio < 1.00,
      `farMed/nearMed=${lod.seam.ratio} (<1.00)  far=${lod.seam.farMed}px(n=${lod.seam.nFar}) / near=${lod.seam.nearMed}px(n=${lod.seam.nNear})` +
      `  · 整幅比=${(lod.whole.farMed/lod.whole.nearMed).toFixed(3)}`);
    check(15, '近带不稀(覆盖率)', lod.coverage.analytic >= 0.40,
      `解析=${lod.coverage.analytic} 逐颗=${lod.coverage.instance} (≥0.40)  近带面积=${lod.coverage.area} 颗数=${lod.coverage.n}`);
    console.log(`  ℹ midRatio=${lod.midRatio} (1.00±0.05)  near 屏幕中位=${lod.screen.nearMed}px 最大=${lod.screen.nearMax}px`);

    // ---------------------------------------------------------- #4 涟漪衰减
    // ⚠ 口径修正：`__clock(4.6)` 在本实现下**推不动模拟时间**。
    //   50-ripple.js 用固定子步 + `MAX_SUB = 4` 限流（一帧最多 4×1/60 = 0.0667s 模拟时间），
    //   并且 step() 内部把 dt 钳到 0.25。所以锁一个大 dt 只会让每帧推进 0.0667s —— 与不锁时钟一样。
    //   正确做法：① 自然衰减（源的生命周期按 `simTime` 老化，4.5s 模拟时间）；
    //            ② 若自然等待超时，用公开的 step() 显式推进来区分「源没老化」与「波没衰减」。
    await ev('window.__seek(12.5)'); await sleep(900);
    await ev('SW.ripple.emit(0, -6, 2.0)');
    await sleep(600);
    const rAct = await ev('SW.ripple.probe().active');
    let elapsed = 0, rAct2 = rAct;
    while (elapsed < 20000) {
      await sleep(250); elapsed += 250;
      rAct2 = await ev('SW.ripple.probe().active');
      if (rAct2 === 0) { break; }
    }
    let forced = null;
    if (rAct2 !== 0) {
      // 兜底：显式推进模拟时间（step(0.25) → 4 个子步 → 0.0667s/次；90 次 ≈ 6.0s 模拟时间 > lifetime 4.5s）
      forced = await ev(`(function(){
        for (var i = 0; i < 90; i++) { SW.ripple.step(0.25); }
        return SW.ripple.probe().active;
      })()`);
    }
    const rFinal = (rAct2 === 0) ? 0 : forced;
    check(4, '涟漪衰减(源按 simTime 老化)', rAct > 0 && rFinal === 0,
      `emit 后 active=${rAct} (>0) → 归零 active=${rFinal} (===0)` +
      (rAct2 === 0 ? `  自然衰减耗时 ${(elapsed/1000).toFixed(2)}s 墙钟` : `  自然等待 20s 未归零 → 显式步进 90×step(0.25) 后 ${forced}`));

    // ---------------------------------------------------------- #8 音频态（首次手势）
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(2500);
    const au = await ev('window.__probe()');
    check(8, '音频态 running', au.audioCtx === 'running', `audioCtx=${au.audioCtx}  bgmGain=${au.bgmGain}`);

    // ---------------------------------------------------------- 四态静帧（AM-013：**仅 --shots 时执行**）
    // ⚠ 截图前必须清两个东西，否则帧不能用来做审美裁决（WP5 第一轮就是这样出的脏帧）：
    //   ① `#dbg` 面板 —— 本脚本只能用 `?debug=1` 起页（注入 API 只在 debug 模式暴露），面板必然在；
    //   ② 残留波场 —— 本轮的 #3 注入过 4 个源、#8 的点击又 emit 了一个，source 会留到 screenshot。
    //   `#ui` / `#hint` **保留**（与 WP5 那套干净帧口径一致，它们本就是交付画面的一部分）。
    //
    // ⚠ 这四张帧**不可复现**（水面自走相位）→ 不要拿它做逐像素回归基线，也不要因为它 diff 了就以为改坏了。
    //   它的用途只有一个：**给人看**的审美样本。判据一律走数值断言。
    if (WANT_SHOTS) {
      await ev(`(function(){
        var d = document.getElementById('dbg');
        if (d) { d.style.display = 'none'; }
        return !!d;
      })()`);
      for (let w = 0; w < 40; w++) {                      // 等波场归零（>4.5s 模拟时间即自然老化）
        const a = await ev('SW.ripple.probe().active');
        if (a === 0) { break; }
        await sleep(250);
      }
      const resid = await ev('SW.ripple.probe().active');
      if (resid !== 0) { await ev('(function(){ for (var i=0;i<90;i++){ SW.ripple.step(0.25); } return SW.ripple.probe().active; })()'); }
      console.log(`\n截帧前：debug 面板已隐藏 · 残留波场 active=${await ev('SW.ripple.probe().active')}`);

      // 文件名带 tag + 中文态名 + hour，跑一次只产一套（不再出现「原始名 / 中文名」两套重复帧）
      const TAG = [['5.5','dawn','晨雾'], ['12.5','noon','正午'], ['18.5','dusk','黄昏'], ['22.5','night','星夜']];
      for (const [h, tag, cn] of TAG) {
        await ev(`window.__seek(${h})`); await sleep(1700);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOT_DIR, `${tag}-${cn}-h${h.replace('.','_')}.png`), Buffer.from(r.data, 'base64'));
      }
      console.log('四态静帧 → ' + SHOT_DIR);
    } else {
      console.log('\n（跳过四态静帧；需要时加 --shots。见文件头 AM-013 注：它不可复现，别拿来做回归基线）');
    }

    // ---------------------------------------------------------- console 洁净度
    // #6 是「≥60 帧中位」，所以这里只报错不判负（判据 #5 归 §6 全流程）
    console.log('\n--- console ---');
    console.log('  JS 错误 (' + jsErrors.length + '): ' + (jsErrors.slice(0, 6).join(' | ') || '无'));
    console.log('  Log error (' + netErrors.length + '): ' + (netErrors.slice(0, 6).join(' | ') || '无'));

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=========== 断言 ${pass}/${results.length} 通过 ===========`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) { console.log('失败项: ' + failed.map((r) => '#' + r.id).join(', ')); }
    fs.writeFileSync('D:/projects/still_water/plan/wp5-assert.json', JSON.stringify({
      env, results, states, lod, cpNight, cpNoon, rf, cs, jsErrors, netErrors
    }, null, 1));
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error('失败:', e.message, e.stack); process.exit(1); });
