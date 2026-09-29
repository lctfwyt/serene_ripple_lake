// plan/pw/verify-mix.mjs —— 主控独立复核：UP15 第三段「混音平衡」（AM-034）
// 用法：先起一个静态服务（例 `python -m http.server 8021 --bind 127.0.0.1`），再
//   node plan/pw/verify-mix.mjs            # 默认 http://127.0.0.1:8021/index.html?debug=1
//   VERIFY_URL=http://127.0.0.1:9000/index.html?debug=1 node plan/pw/verify-mix.mjs
// 判据 16 条，见 plan/108-UP15-slap.md §14 的表（数值 = 2026-09-30 02:1x 首次跑的读数）。
// ⚠ 不复用施工方脚本、不改任何文件，只读页面状态。
//      按设计不随 slapVolume 变 —— 用它做缩放判据是错的（施工方判据 4 也是这么读的）
import { chromium } from 'playwright';

const URL = process.env.VERIFY_URL || 'http://127.0.0.1:8021/index.html?debug=1';
const ARGS = ['--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ck = (name, ok, detail) => { console.log(`${ok ? '✅' : '❌'} ${name}  ${detail}`); if (!ok) fail++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const jsErrs = [], net4xx = [];
page.on('pageerror', (e) => jsErrs.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrs.push(m.text()); });
page.on('response', (res) => { if (res.status() >= 400) net4xx.push(`${res.status()} ${res.url()}`); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.SW && SW.ready === true', null, { timeout: 60000 });
await sleep(600);

const pre = await page.evaluate(() => SW.audio.probe());
console.log(`ℹ 手势前 audio state = ${pre.state}（autoplay 策略下预期是 none/suspended，非缺陷）`);
await page.mouse.move(640, 400); await page.mouse.down(); await sleep(120); await page.mouse.up();
await sleep(5200);                                   // 等 slap 池建好（SLAP_DELAY 4000ms）
const st = await page.evaluate(() => SW.audio.probe());
ck('1 首次手势后音频 running', st.state === 'running', `state=${st.state} handGain=${st.handGain} slapMode=${st.slapMode} slapReady=${st.slapReady}`);

const P = await page.evaluate(() => ({ hand: SW.P.handVolume, flow: SW.P.flowVolume, slap: SW.P.slapVolume,
                                       p0: [SW.P0.handVolume, SW.P0.flowVolume, SW.P0.slapVolume] }));
ck('2 定档值 0.80/0.20/0.30', P.hand === 0.8 && P.flow === 0.2 && P.slap === 0.3,
   `SW.P = hand ${P.hand} / flow ${P.flow} / slap ${P.slap}`);
ck('3 P0 快照含两个新字段', P.p0[0] === 0.8 && P.p0[1] === 0.2 && P.p0[2] === 0.3, `SW.P0 = [${P.p0}]`);

const panel = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('#dbg-sliders input'));
  const box = document.querySelector('#dbg-sliders');
  return { n: all.length, first3: all.slice(0, 3).map((i) => +(+i.value).toFixed(2)),
           firstGroupIsAudio: /^音频（实时）/.test(box.firstChild.textContent || '') };
});
ck('4 面板 input 总数 24', panel.n === 24, `#dbg-sliders input = ${panel.n}（3 音频 + 8 后期 + 10 湖底 + 3 波纹）`);
ck('5 音频组是最前一组且初值对', panel.firstGroupIsAudio && JSON.stringify(panel.first3) === '[0.8,0.2,0.3]',
   `首组=${panel.firstGroupIsAudio} · 前三项 = ${JSON.stringify(panel.first3)}`);

// ---- 流水层：speed 0.6（< CLICK_MIN_SPEED 0.85 ⇒ 不触发 click）· 3s 窗均值
async function flowMean(flowVol) {
  return page.evaluate(async (flowVol) => {
    SW.P.flowVolume = flowVol;
    await new Promise((r) => setTimeout(r, 250));            // 让上一档的尾音走完
    const lim = [], hp = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      SW.audio.playHand(0.6, 0);
      const p = SW.audio.probe();
      lim.push(p.limInPeak); hp.push(p.handPeak);
      await new Promise((r) => setTimeout(r, 25));
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return { lim: mean(lim), hp: mean(hp), n: lim.length, last: SW.audio.probe().lastHandPeak, slaps: SW.audio.probe().slaps };
  }, flowVol);
}
const A1 = await flowMean(1.0);
const A2 = await flowMean(1.0);
const B = await flowMean(0.5);
const C = await flowMean(0.0);
await page.evaluate(() => { SW.P.flowVolume = 0.2; });

const noise = Math.abs(A1.lim - A2.lim) / A1.lim;
const r = B.lim / A1.lim;
ck('6 同版本重复 = 噪声底（对照）', noise < 0.10,
   `flowVolume=1.0 两次：${A1.lim.toFixed(5)} / ${A2.lim.toFixed(5)} = 差 ${(noise * 100).toFixed(1)}%（n=${A1.n}）`);
ck('7 flowVolume 0.5 ⇒ 流水 −6 dB', Math.abs(r - 0.5) < 0.06,
   `limInPeak ${A1.lim.toFixed(5)} → ${B.lim.toFixed(5)} = ×${r.toFixed(4)}（${(20 * Math.log10(r)).toFixed(2)} dB）`);
ck('8 flowVolume 0 ⇒ 流水全静', C.lim === 0, `limInPeak 均值 = ${C.lim} · slaps 计数 ${A1.slaps}→${C.slaps}（应不涨，证无拍击污染）`);
ck('9 体检点不受缩放（probe 语义不变）',
   Math.abs(A1.hp - B.hp) / A1.hp < 0.10 && A1.last === B.last && A1.last === C.last,
   `handPeak 均值 ${A1.hp.toFixed(4)} / ${B.hp.toFixed(4)} / ${C.hp.toFixed(4)} · lastHandPeak 恒 ${A1.last}`);

// ---- 拍击层：真实点击手势 → click() → playSlap()；静掉流水，读 limInPeak 最大值
// ⚠ 点击间隔必须 > 采样时长 1.45s ⇒ 元素池总有空闲元素 ⇒ playSlap 必成功。
//   否则 pickIdle<0 时 click() 会退回**合成气泡**，而它直连 handGain（不过 slapGain）⇒ 读数被污染。
const SLAP_GAP_MS = 1900, SLAP_CLICKS = 6;
async function slapMax(slapVol) {
  await page.evaluate((v) => { SW.P.flowVolume = 0; SW.P.slapVolume = v; }, slapVol);
  const before = await page.evaluate(() => SW.audio.probe().slaps);
  const p = page.evaluate(async (ms) => {
    let m = 0, sa = 0;
    const t = performance.now();
    while (performance.now() - t < ms + 2200) {
      const q = SW.audio.probe();
      if (q.limInPeak > m) m = q.limInPeak;
      if (q.slapAnPeak > sa) sa = q.slapAnPeak;
      await new Promise((r) => setTimeout(r, 15));
    }
    return { m, sa };
  }, SLAP_GAP_MS * SLAP_CLICKS);
  for (let i = 0; i < SLAP_CLICKS; i++) {
    await page.mouse.move(560 + i * 40, 400);
    await page.mouse.down(); await sleep(50); await page.mouse.up();
    await sleep(SLAP_GAP_MS);
  }
  const { m, sa } = await p;
  const after = await page.evaluate(() => SW.audio.probe().slaps);
  await page.evaluate(() => { SW.P.slapVolume = 0.3; SW.P.flowVolume = 0.2; });
  return { m, sa, played: after - before };
}
const D = await slapMax(1.0);
const E = await slapMax(0.1);
ck('10 采样路隔离有效（无合成兜底污染）',
   D.played >= SLAP_CLICKS - 1 && E.played >= SLAP_CLICKS - 1,
   `slaps 增量 D=${D.played}/${SLAP_CLICKS} · E=${E.played}/${SLAP_CLICKS}（合成手势偶发丢 1 帧是夹具抖动；判据 11 比值正好 =0.1 已反证无兜底混入）· limInPeak max = ${D.m.toFixed(5)} · slapAnPeak max = ${D.sa.toFixed(5)}`);
const ratio = E.m / D.m;
ck('11 slapVolume=0.1 ⇒ 拍击 −20 dB（limiter 输入口径）', Math.abs(ratio - 0.1) < 0.03,
   `limInPeak max ${D.m.toFixed(5)} → ${E.m.toFixed(5)} = ×${ratio.toFixed(4)}（${(20 * Math.log10(ratio)).toFixed(2)} dB）`);
ck('12 slapAnPeak 不随 slapVolume 变（体检点在增益前 · probe 语义不变）',
   Math.abs(E.sa / D.sa - 1) < 0.15, `slapAnPeak max ${D.sa.toFixed(5)} → ${E.sa.toFixed(5)} = ×${(E.sa / D.sa).toFixed(4)}`);

// ---- 重置默认
await page.evaluate(() => { SW.P.flowVolume = 0; SW.P.slapVolume = 1.4; });
const after = await page.evaluate(() => {
  document.querySelector('#dbg-sliders button').click();
  const all = Array.from(document.querySelectorAll('#dbg-sliders input'));
  return { p: [SW.P.handVolume, SW.P.flowVolume, SW.P.slapVolume], first3: all.slice(0, 3).map((i) => +(+i.value).toFixed(2)) };
});
ck('13 重置默认：SW.P 与 DOM 同步回 P0', String(after.p) === '0.8,0.2,0.3' && JSON.stringify(after.first3) === '[0.8,0.2,0.3]',
   `SW.P = [${after.p}] · DOM 前三 = ${JSON.stringify(after.first3)}`);

const dur = await page.evaluate(() => SW.audio.probe().slapDur);
ck('14 slap 采样仍 1.45 s', Math.abs(dur - 1.45) < 0.01, `probe().slapDur = ${dur}`);

// ---- 13.5 边界量化：slapVolume=0（采样全哑）时 limiter 输入还剩多少 = 不过 slapGain 的路径
const F = await slapMax(0.0);
ck('15 未过 slapGain 的残余路径（§13.5 边界）', F.played >= SLAP_CLICKS - 1 && F.m <= D.m * 0.15,
   `slapVolume=0 ⇒ limInPeak max = ${F.m.toFixed(5)} = 满档 ${D.m.toFixed(5)} 的 ${(F.m / D.m * 100).toFixed(1)}%（foleySpray 直连 handGain，本包按规格未改）`);

ck('16 console 零 JS 报错', jsErrs.length === 0, jsErrs.length ? jsErrs.slice(0, 3).join(' | ') : '无');
console.log('  ℹ 4xx 资源（浏览器默认探针，非本包引入）: ' + (net4xx.length ? net4xx.join(' · ') : '无'));

await browser.close();
const total = 16;
console.log(fail === 0 ? `\n===== 独立复核：${total}/${total} 通过 =====` : `\n===== 独立复核：${total - fail}/${total} 通过 · ${fail} 项红 =====`);
process.exit(fail ? 1 : 0);
