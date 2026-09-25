// plan/pw/lib/page-lib.mjs —— UP6 · 页面内测量库
//
// ⚠ 口径纪律（UP6 §4 验收 #1/#2 的全部意义所在）：
//   `HELPERS` 是 `plan/wp5-assert.js` 顶部 HELPERS 的**逐字副本**，
//   只改了最后一行注入的全局名（`__wp5` → `__pw`）。**不要"顺手优化"里面的算法。**
//   原因：验收 #2 要求新旧两套读数逐字段一致；一旦这里的统计口径（分位数、质心定义、
//   亮度权重、LOD 投影方式）与原脚本有任何差别，读数不一致就无法区分是"实现差异"还是
//   "口径差异"。要改口径 ⇒ 两边一起改，并当作一次判据修订（走变更单）。
//
//   ⚠ 本文件是**副本**：`plan/wp5-assert.js` 本波次冻结（90-WAVE4 §0 耦合 ① / §1），
//     所以不能 import 它、也不能改它。两边独立演进，收工时由主控裁谁留。
//
// `EXTRA` 是 UP6 自己加的东西（原脚本没有的能力）：像素指纹 / 帧间差分 / 稳态钉相位。
//   它不参与"读数一致性"比对，只服务 §4 验收 #3（像素回归）与确定性证明。

// ==================================================================== 逐字副本
export const HELPERS = `(function(){
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

  W.__pw = api;
  return 'ok';
})()`;

// ============================================================== UP6 自己的扩展
// 只服务两件事：① 证明"钉住之后真的不再变"；② 量化"不钉住到底差多少"（复述 §2.1 的前提）。
export const EXTRA = `(function(){
  var api = window.__pw;
  var store = {};

  // 像素指纹（FNV-1a 32 位）。放在页面内算，避免把 3.7MB 的 buffer 搬出 CDP。
  // 用它而不是 PNG 字节：PNG 编码器是另一层不确定源，指纹只反映像素本身。
  function fnv(d){
    var h = 2166136261 >>> 0;
    for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  api.hashFrame = function(){
    var g = api.frame();
    return { w: g.w, h: g.h, len: g.d.length, hash: fnv(g.d) };
  };

  // 存一帧快照
  api.snap = function(tag){
    var g = api.frame();
    store[tag] = g;
    return { tag: tag, w: g.w, h: g.h, hash: fnv(g.d) };
  };

  // 当前帧 vs 快照：最大通道差 / 平均绝对差 / PSNR(8bit RGB) / 有差异素比例
  //   PSNR 口径：MSE 取三通道均值，PSNR = 10·log10(255²/MSE)。与 roadmap §2.1 的表同一套算法。
  api.diffVs = function(tag){
    var a = store[tag]; if (!a) { return { error: 'no snapshot ' + tag }; }
    var b = api.frame();
    if (a.w !== b.w || a.h !== b.h || a.d.length !== b.d.length) { return { error: 'size mismatch' }; }
    var n = a.d.length / 4, mse = 0, mx = 0, nz = 0;
    for (var i = 0; i < a.d.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var dv = Math.abs(a.d[i+c] - b.d[i+c]);
        mse += dv * dv;
        if (dv > mx) { mx = dv; }
      }
      if (a.d[i] !== b.d[i] || a.d[i+1] !== b.d[i+1] || a.d[i+2] !== b.d[i+2]) { nz++; }
    }
    mse /= (n * 3);
    return {
      max: mx,
      meanAbs: +Math.sqrt(mse).toFixed(3),
      psnr: mse > 0 ? +(10 * Math.log(255 * 255 / mse) / Math.LN10).toFixed(1) : Infinity,
      diffPxFrac: +(nz / n).toFixed(4),
      same: fnv(a.d) === fnv(b.d)
    };
  };

  api.drop = function(tag){ delete store[tag]; return true; };
  return 'ok';
})()`;

// ==================================================================== 稳态钉相位
// 「不动」需要同时钉住三条独立的链，缺一条帧就还在漂：
//   ① hour        —— SW.time 走 auto 时随真实时钟漂 → `__seek(h)` 置 fixed
//   ② 水面 uTime  —— 契约 §2.6 公开字段；`60-water.js:456` 每帧 `u.uTime.value = tAcc`，
//                    所以**单次赋值会被下一帧覆盖** → 必须在 `update()` 之后再钉一次
//   ③ 每帧 dt     —— 波纹 simTime / 湖底 caustic 相位 / 时间过渡都吃 dt → `__hold(true)` 置 0
//   ⚠ 只做 ②（roadmap §2.1 #3 的"钉 uTime"）是**不够**的：会被 ③ 覆盖掉一半。
//     本函数做的是 ②+③ 的超集，并且额外把 ① 钉住。
//   ⚠ 用到的全是契约公开面：`SW.water.uniforms`（§2.6）、`SW.debug.hold`（§2.9）、`SW.debug.seek`。
//     不改任何 src 文件，只包装运行时对象。
export function pinSnippet(hour, uTime) {
  return `(function(hour, uTime){
    if (window.__pwPin && window.__pwPin.on) { window.__pwPin.off(); }
    window.__seek(hour);
    window.__hold(true);
    var W = SW.water;
    var orig = W.update;
    W.update = function(dt){
      orig.call(W, dt);
      W.uniforms.uTime.value = uTime;     // ② 每帧重新钉 → 覆盖 tAcc
    };
    W.uniforms.uTime.value = uTime;
    W.__pwOrigUpdate = orig;
    window.__pwPin = {
      on: true, hour: hour, uTime: uTime,
      off: function(){ W.update = orig; window.__hold(false); this.on = false; return true; }
    };
    return window.__pwPin;
  })(${JSON.stringify(hour)}, ${JSON.stringify(uTime)})`;
}

// 钉相位之后、截图之前必须清掉的两件事（否则帧不可复现）：
//   ① `#dbg` —— 面板里是实时读数（fps / calls / hour），每帧都在变字 → 纯 diff 噪声。
//      断言一律用 `?debug=1` 起页（注入 API 只在 debug 模式暴露），所以它必然在。
//   ② 残留 DOM 遮罩（之前哨兵注入的 `#pw-px`）
export const CLEAN_SNIPPET = `(function(){
  var d = document.getElementById('dbg');
  if (d) { d.style.display = 'none'; }
  var p = document.getElementById('pw-px');
  if (p) { p.remove(); }
  return { dbgHidden: !!d, pxCleared: !p };
})()`;

// 故意改坏**一小块像素**（哨兵用）。size×size CSS px @ dpr=1 = 恰好 size² 个设备像素。
// 选品红（255,0,255）而不是近水色：Playwright 比较有 threshold(=0.2) 容差，
// 颜色太接近湖水的"坏像素"会被容差吃掉 → 哨兵假绿。
//
// 🔴 为什么默认是 **3×3 而不是 1×1**（2026-09-25 主控实测，AM-018）：
//   Playwright 的 `toHaveScreenshot` 走**内置 pixelmatch**，其默认 `includeAA:false`
//   → 判定为「反锯齿」的差异像素**不计入 diff**。判定是**内容相关**的：它看该像素在两张图
//   里的邻域极值 + `hasManySiblings`。后果 —— 一个**孤立**坏像素会被邻域"淹没"而漏检，
//   且**换一张基线就可能翻面**（同一枚坏像素、同一帧实测：旧基线检出、新基线漏检）。
//   → 于是「改坏 1 像素必红」是**对特定基线成立的经验事实，不是不变量**；
//     而 3×3 块内部像素有 ≥3 个同色邻居 ⇒ pixelmatch 的 AA 启发式必然返回 false，
//     与基线内容**无关**。实测（sim 复算，maxDelta=35215×0.2²=1408.6）：
//       1×1 → 旧基线 1 px / 新基线 **0 px**；2×2 → 4 / 2；**3×3 → 6 / 6**；4×4 → 12 / 12。
export function breakPixelsSnippet(x, y, size) {
  const n = size || 3;
  return `(function(x, y, n){
    var d = document.getElementById('pw-px');
    if (d) { d.remove(); }
    d = document.createElement('div');
    d.id = 'pw-px';
    d.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:' + n + 'px;height:' + n + 'px;' +
      'background:#ff00ff;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(d);
    return { id: d.id, x: x, y: y, size: n,
             box: (function(){ var b = d.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })() };
  })(${JSON.stringify(x)}, ${JSON.stringify(y)}, ${n})`;
}
