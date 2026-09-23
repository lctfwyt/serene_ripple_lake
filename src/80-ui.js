// src/80-ui.js —— 所有者：WP3
// 签名逐字对齐 01-CONTRACT.md §2.8：{ init, update }
// 要建的 DOM id：#snd（声音开关）、#hour（时段滑块）。#ui / #hint 由 WP1 提供。
// **不改 index.html** —— 全部 JS 创建并 append 到 #ui（契约 §4，避免并行冲突）。
//
// 设计基调（WP3 §4.6）：极简、低对比、半透明，不抢画面。字色 rgba(255,255,255,.72)。
// AM-002 §5 的「四角 UI 布局」**未采纳**，本文件不实现它。
(function (SW, window, document) {
  'use strict';

  var el = {};
  var built = false;
  var sndOn = true;          // 本地开关意图（音频未就绪时先记着，就绪后补发）
  var applied = false;       // 是否已经把 sndOn 推给 SW.audio
  var dragging = false;
  var lastTxt = '';
  var lastSndTxt = '';

  var CSS_BASE = 'position:absolute;font-family:inherit;letter-spacing:.14em;' +
    'color:rgba(255,255,255,.72);text-shadow:0 1px 3px rgba(0,0,0,.35);user-select:none;';

  // 四态名（与 SW.time.nameOf 同源的口径，但这里不依赖 SW.time 是否已就绪）
  function nameOf(h) {
    h = ((h % 24) + 24) % 24;
    if (h >= 4 && h < 10) { return '晨雾'; }
    if (h >= 10 && h < 16) { return '正午'; }
    if (h >= 16 && h < 20.5) { return '黄昏'; }
    return '星夜';
  }
  function hm(h) {
    h = ((h % 24) + 24) % 24;
    var hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 0.5);
    if (mm >= 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // range 的伪元素没法用 cssText 写 → 注入一条 <style>（仍然不动 index.html）
  function injectStyle() {
    var st = document.createElement('style');
    st.textContent = [
      '#sw-hour{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;}',
      '#sw-hour::-webkit-slider-runnable-track{height:2px;background:rgba(255,255,255,.22);border-radius:2px;}',
      '#sw-hour::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:11px;height:11px;',
      'margin-top:-4.5px;border-radius:50%;background:rgba(255,255,255,.82);border:none;}',
      '#sw-hour::-moz-range-track{height:2px;background:rgba(255,255,255,.22);border-radius:2px;}',
      '#sw-hour::-moz-range-thumb{width:11px;height:11px;border:none;border-radius:50%;background:rgba(255,255,255,.82);}',
      '#sw-snd{transition:background .25s ease,border-color .25s ease;}'
    ].join('');
    document.head.appendChild(st);
  }

  function mk(tag, css, parent) {
    var d = document.createElement(tag);
    d.style.cssText = css;
    if (parent) { parent.appendChild(d); }
    return d;
  }

  function build(ui) {
    injectStyle();

    // ── 左上：时段名 + 时刻 ────────────────────────────────────────────
    el.panel = mk('div', CSS_BASE + 'left:22px;top:20px;pointer-events:none;' +
      'font-size:13px;line-height:1.7;', ui);
    el.name = mk('div', 'font-size:15px;opacity:.92;', el.panel);
    el.clock = mk('div', 'font-size:11px;opacity:.62;', el.panel);

    // ── 右上：声音开关 ─────────────────────────────────────────────────
    el.snd = mk('button', CSS_BASE + 'right:22px;top:18px;padding:6px 13px;border-radius:14px;' +
      'border:1px solid rgba(255,255,255,.22);background:rgba(10,18,22,.26);' +
      'font-size:11px;cursor:pointer;backdrop-filter:blur(6px);', ui);
    el.snd.id = 'snd';
    el.snd.type = 'button';
    el.snd.addEventListener('click', function () {
      sndOn = !sndOn;
      applied = false;                      // 强制下一次 update 把新值推给 audio
      paint(true);
    });

    // ── 左下：时段滑块 ─────────────────────────────────────────────────
    var wrap = mk('div', CSS_BASE + 'left:22px;bottom:20px;width:min(230px,44vw);', ui);
    el.slider = mk('input', 'width:100%;margin:0;display:block;touch-action:none;', wrap);
    el.slider.id = 'hour';
    el.slider.type = 'range';
    el.slider.min = '0';
    el.slider.max = '24';
    el.slider.step = '0.05';
    el.slider.setAttribute('aria-label', '时段');

    el.slider.addEventListener('pointerdown', function () { dragging = true; });
    el.slider.addEventListener('pointerup', function () { dragging = false; });
    el.slider.addEventListener('pointercancel', function () { dragging = false; });
    el.slider.addEventListener('input', function () {
      if (SW.time && SW.time.setHour) { SW.time.setHour(parseFloat(el.slider.value)); }
    });
    // 键盘微调（不抢焦点时也能用）：[ / ] 各 ±0.5h
    window.addEventListener('keydown', function (e) {
      if (!SW.time || !SW.time.getHour) { return; }
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
      var d = 0;
      if (e.key === '[') { d = -0.5; }
      else if (e.key === ']') { d = 0.5; }
      else { return; }
      e.preventDefault();
      SW.time.setHour(SW.time.getHour() + d);
    });

    // ── 双击画面空白处 → 回到真实时钟 ──────────────────────────────────
    var canvas = document.getElementById('c');
    if (canvas) {
      canvas.addEventListener('dblclick', function () {
        if (SW.time && SW.time.setMode) { SW.time.setMode('auto'); }
      });
    }

    built = true;
  }

  function sndText() {
    var A = SW.audio;
    if (!A || A.ready === false) { return '声音 · 未启动'; }
    return sndOn ? '声音 开' : '声音 关';
  }

  function paint(force) {
    var T = SW.time;
    if (!T || !T.getHour) { return; }
    var h = T.getHour();

    var txt = nameOf(h) + '|' + hm(h) + '|' + T.getMode();
    if (force || txt !== lastTxt) {
      lastTxt = txt;
      el.name.textContent = nameOf(h);
      el.clock.textContent = hm(h) + (T.getMode() === 'auto' ? '' : ' · 已锁定');
    }

    if (!dragging) {
      var v = String(Math.round(h * 100) / 100);
      if (el.slider.value !== v) { el.slider.value = v; }
    }

    // 音频就绪后把开关意图补发一次（首次手势前 SW.audio.ready === false）
    var A = SW.audio;
    if (A && A.ready && !applied && typeof A.setEnabled === 'function') {
      A.setEnabled(sndOn);
      applied = true;
    }
    var st = sndText();
    if (force || st !== lastSndTxt) { lastSndTxt = st; el.snd.textContent = st; }
  }

  SW.ui = {
    init: function () {
      var ui = document.getElementById('ui');
      if (!ui) { return; }
      build(ui);
      paint(true);
      return this;
    },
    update: function (dt) {
      if (!built) { return; }
      paint(false);
    }
  };
})(window.SW = window.SW || {}, window, document);
