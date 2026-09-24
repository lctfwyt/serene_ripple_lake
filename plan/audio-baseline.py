#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""plan/audio-baseline.py —— 音频资产基线体检器 + 源码常量漂移检测

【为什么存在】
src/10-audio.js 里有 4 组**手工实测**的常量，它们决定了两件用户能听见的事：

    BGM_LUFS_RAW = -15.06    ┐ 母带是否命中 -16 LUFS
    BGM_TRIM     = 0.8974    ┘
    BGM_TRUE_DUR = 146.832   →  循环出点是否落在**真实音频**内（不是元素估算的时长末端）
    SLAP_LUFS_TRIM = [...]   →  4 段拍击响度是否配平（峰值统一 ≠ 响度统一）

它们的推导路径原来是**一次性的临时无头 Chrome 脚本**（按项目纪律 `_*.js` 已删）。
于是留下一个洞：**README 明确教用户换曲**（`cp assets/audio/bgm-cand1.mp3
assets/audio/bgm-stillwater.mp3`，见 README §音频资产），换完这 4 组常量就全错，
而没有任何一条命令能把它们重算出来。

本脚本把「手工快照」变成「可复跑推导」：一条命令算全部常量，并**检测源码里的常量
是否已经与实测漂移**（换曲后跑一次就知道该改哪几个数、改成多少）。

【口径】（与 UP5 验收同源，见 plan/91-UP5-audio.md §2）
  · 解码    libsndfile（soundfile）—— mp3 支持需 libsndfile ≥ 1.1
  · 响度    pyloudnorm —— ITU-R BS.1770-4 集成响度（K 加权 + 双门限）
            🔴 与 UP5 的浏览器自写实现**交叉验证**过：系统性偏差 **0.04 LU**
               （同向；来自 mp3 解码器差异，libsndfile vs Chrome 内置）。远小于 ±1 LU 验收带。
  · 真峰值  4× 过采样取峰（BS.1770-4 Annex 2）—— EBU R128 要求 ≤ -1 dBTP
  · 静音    -80 dBFS 门（= 源码里的 `1e-4`，"数字静音"判据）

【运行】
  python plan/audio-baseline.py              # 体检 + 漂移检测（写 audio-build/baseline.json）
  python plan/audio-baseline.py --emit-js    # 额外打印可粘贴的常量块
  python plan/audio-baseline.py --seam-ab    # 额外导出循环接缝 A/B 试听对照（audio-build/seam-ab/）
  python plan/audio-baseline.py --os 8       # 真峰值过采样倍数（默认 4）

【产物落点】audio-build/ —— .gitignore 第 8 段已忽略（"能被一条命令重建的产物一律忽略"）。
  唯一该入库的是**本脚本自身**。

2026-09-24 建立（UP5 完工后的口径补齐）。
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import resample_poly

# Windows 终端默认 GBK，中文会炸
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC_JS = ROOT / "src" / "10-audio.js"
ASSETS = ROOT / "assets" / "audio"
OUTDIR = ROOT / "audio-build"

DB = lambda x: 20.0 * np.log10(max(float(x), 1e-12))


# --------------------------------------------------------------------------- 度量
def true_peak(data, oversample=4):
    """真峰值 = 过采样后取峰。BS.1770-4 Annex 2 规定 4×（48kHz → 192kHz）。"""
    up = resample_poly(data, oversample, 1, axis=0)
    return float(np.abs(up).max())


def silence_edges(data, thresh=1e-4):
    """首/尾静音的毫秒数（阈值 1e-4 = -80dBFS，与源码判据一致）。"""
    mono = np.abs(data).max(axis=1) if data.ndim > 1 else np.abs(data)
    nz = np.flatnonzero(mono > thresh)
    if nz.size == 0:
        return None, None
    return float(nz[0]), float(len(mono) - 1 - nz[-1])


def analyze(path, oversample=4):
    data, sr = sf.read(str(path), always_2d=True)
    frames = len(data)
    head, tail = silence_edges(data)
    sp = float(np.abs(data).max())
    tp = true_peak(data, oversample)
    # pyloudnorm 的积分块固定 0.4 s：比它短的资产（咔嗒 ~0.12 s）量不出响度 → 记 nan，
    #   不要让它把整份体检崩掉（UP9/AM-010：tick1/tick2 比块长还短）。
    try:
        lufs = float(pyln.Meter(sr).integrated_loudness(data)) if frames / sr > 0.45 else float("nan")
    except Exception:
        lufs = float("nan")
    return {
        "file": path.name,
        "dur": frames / sr,
        "frames": frames,
        "sr": sr,
        "ch": data.shape[1],
        "sample_peak": sp,
        "sample_peak_dbfs": DB(sp),
        "true_peak": tp,
        "true_peak_dbtp": DB(tp),
        "true_peak_oversample": oversample,
        "lufs": lufs,
        "head_silence_ms": None if head is None else head / sr * 1000.0,
        "tail_silence_ms": None if tail is None else tail / sr * 1000.0,
        "_data": data,
        "_sr": sr,
    }


# --------------------------------------------------------------------------- 源码常量
def read_js_constants(src_text):
    """从 src/10-audio.js 抓出需要体检的常量。"""
    out = {}

    def scalar(name):
        # 允许 `var A = 1, B = 2;` 这种一条 var 声明多个常量（源码就这么写的）
        m = re.search(r"(?:^|[\s,;(])%s\s*=\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)" % name,
                      src_text, re.M)
        return float(m.group(1)) if m else None

    def numbers(name):
        m = re.search(r"var\s+%s\s*=\s*\[([^\]]*)\]" % name, src_text)
        if not m:
            return None
        return [float(x) for x in re.findall(r"[-+]?[\d.]+(?:[eE][-+]?\d+)?", m.group(1))]

    for n in ("BGM_LUFS_RAW", "BGM_LUFS_TARGET", "BGM_TRIM", "BGM_TRUE_DUR",
              "BGM_TRUE_GUARD", "SLAP_TRIM", "LOOP_IN", "LOOP_TAIL",
              "LOOP_FADE_IN", "LOOP_FADE_OUT", "LOOP_TICK", "PAN_WORLD_REF", "PAN_MAX"):
        out[n] = scalar(n)
    out["SLAP_LUFS_TRIM"] = numbers("SLAP_LUFS_TRIM")
    return out


def derive_constants(bgm, slaps):
    """从实测反推全部常量（这就是那套已删的临时脚本在做的事）。"""
    raw = bgm["lufs"]
    target = -16.00
    trim = 10.0 ** ((target - raw) / 20.0)

    lu = [s["lufs"] for s in slaps]
    mean_lu = sum(lu) / len(lu)
    slap_trim = [10.0 ** ((mean_lu - x) / 20.0) for x in lu]

    return {
        "BGM_LUFS_RAW": raw,
        "BGM_LUFS_TARGET": target,
        "BGM_TRIM": trim,
        "BGM_TRUE_DUR": bgm["dur"],
        "SLAP_LUFS_TRIM": slap_trim,
        "SLAP_LUFS_MEAN": mean_lu,
        "SLAP_LUFS": lu,
    }


# --------------------------------------------------------------------------- 漂移检测
def check_drift(js, got, bgm, slaps, bgm_vol=0.6):
    """逐项比对源码常量与实测。返回 [(名称, 源码值, 实测值, 差, 容差, 状态, 说明)]。

    判据分两类，**不要混**：
      · 一致性：源码常量 ↔ 资产实测（容差须容纳**解码器差异**：libsndfile vs Chrome
        对同一 mp3 给出 0.04 LU，禁止把容差定到解码器精度以下 → 会假报警）
      · 自洽性：源码常量 ↔ 源码自己的其他常量（纯算术，容差可以很严）
    """
    rows = []

    def row(name, src, live, tol, note=""):
        if src is None:
            rows.append((name, None, live, None, tol, "缺失", note))
            return
        d = abs(src - live)
        rows.append((name, src, live, d, tol, "OK" if d <= tol else "漂移", note))

    # ① 母带 —— 分两层验
    #   ①a 算术自洽：BGM_TRIM 必须等于 10^((TARGET-RAW)/20)（用**源码自己的** LUFS 常量）
    #       这是纯算术，容差可以严到 1e-4。改 LUFS 忘了改 TRIM（或反之）会立刻被抓。
    src_raw, src_tgt, src_trim = js["BGM_LUFS_RAW"], js["BGM_LUFS_TARGET"], js["BGM_TRIM"]
    if None not in (src_raw, src_tgt, src_trim):
        expect = 10.0 ** ((src_tgt - src_raw) / 20.0)
        row("BGM_TRIM(自洽)", src_trim, expect, 1e-4,
            "= 10^((BGM_LUFS_TARGET-BGM_LUFS_RAW)/20)，纯算术；容差 1e-4")
    #   ①b 与资产一致：LUFS 常量 ↔ 实测（容差 0.15，容解码器差异 0.04）
    row("BGM_LUFS_RAW", src_raw, got["BGM_LUFS_RAW"], 0.15,
        "源: 实测集成响度（容差 0.15 = 容解码器差异 0.04 + 余量）\n"
        "        ⚠ 本项只要与实测一致，BGM_TRIM **不必**跟着 Python 的值走 ——\n"
        "          0.04 LU 的解码器差异传导到 trim 是 0.5%，两边各自自洽即正确。")
    # ② 真实时长
    row("BGM_TRUE_DUR", js["BGM_TRUE_DUR"], got["BGM_TRUE_DUR"], 0.05,
        "源: 实测内容时长（容差 0.05 = 容解码器 padding 差异；实测差 11ms）")
    # ③ 拍击配平（逐段）
    srcs, lives = js["SLAP_LUFS_TRIM"] or [], got["SLAP_LUFS_TRIM"]
    if srcs is None or len(srcs) != len(lives):
        rows.append(("SLAP_LUFS_TRIM", srcs, lives, None, 5e-3, "缺失/长度不符", "应 4 段"))
    else:
        worst = max(abs(a - b) for a, b in zip(srcs, lives))
        rows.append(("SLAP_LUFS_TRIM", srcs, lives, worst, 5e-3,
                     "OK" if worst <= 5e-3 else "漂移",
                     "源: 10^((均值-Li)/20)，逐段；括号内为最差段差"))

    # ④ 预检：换资产后会不会**静默劣化**
    guard = js["BGM_TRUE_GUARD"] or 1.0
    est_bias = abs(147.164 - 146.832)          # file:// 下 Chrome 估算时长的偏差（UP5 实测）
    rows.append(("BGM_TRUE_GUARD(够宽?)", guard, est_bias, abs(guard - est_bias), None,
                 "OK" if guard > est_bias * 1.5 else "偏窄",
                 "守卫须 > 元素时长估算偏差（实测 %.3fs），否则封顶不生效" % est_bias))

    # ⑤ 预检：真峰值余量 —— 判的是**母带后**（EBU R128 的 ≤ -1 dBTP 是交付端的口径）
    #    源资产本身可以超（母带的意义就是留 headroom 再压下来），源超 β 不是缺陷。
    if src_trim is not None:
        after = bgm["true_peak"] * src_trim          # 元素路 = 最坏情形（只乘 trim，不乘用户音量）
        rows.append(("母带后 true peak", None, DB(after), None, None,
                     "OK" if DB(after) <= -1.0 else "🔴 已超 -1 dBTP",
                     "源 %.2f dBTP × BGM_TRIM → %.2f dBTP（元素路 = 最坏情形）\n"
                     "        依据 EBU R128：交付端 ≤ -1 dBTP。源资产本身 %.2f dBTP 超限属正常"
                     % (bgm["true_peak_dbtp"], DB(after), bgm["true_peak_dbtp"])))

    # ⑥ 预检：拍击配平后的最大有效峰值（防削波）
    max_trim = max(lives)
    valid_pk = max(s["sample_peak"] for s in slaps) * max_trim * (js["SLAP_TRIM"] or 1.0)
    rows.append(("拍击配平后有效峰值", None, valid_pk, None, None,
                 "OK" if valid_pk < 1.0 else "🔴 会削波",
                 "= 源峰值 × max(trim) × SLAP_TRIM（两者是**串联**的，缺一不可）"
                 "；应 < 1.0（余量 %.2f dB）\n"
                 "        ⚠ 源码注释曾写 0.62×1.1312 = 0.701，**漏乘了 SLAP_TRIM=0.85**；"
                 "实际最坏 %.4f" % (-DB(valid_pk), valid_pk)))
    return rows


# --------------------------------------------------------------------------- 接缝变体研究
# UP5 的循环修法是「手动区间 + 两侧**对称**淡变」。但对称淡变有个副作用从来没人量过：
# 出点淡出到 0、入点再从 0 淡入 → 接缝处必然出现一个 **V 形音量凹陷**。
# 它**替代**了改前的「曲首 ~100ms 数字静音」（都是"接缝处有凹陷"，只是成因不同）。
# 凹陷宽度 = 2 × fade（因为两侧各一段），所以 fade 时长直接决定听感。
# 这个 trade-off 只能靠耳朵定，所以这里把候选版本都渲出来，并给出**客观宽度**。
SEAM_VARIANTS = [
    # (标签, fade 秒, tick 秒, 说明) —— fade=None 表示"改前的 el.loop=true 硬切"
    ("V0-before-hardcut", None, None,
     "改前 el.loop=true：曲尾硬切曲首（曲首含数字静音）；无淡变、无台阶"),
    ("V1-current-40ms-5ms", 0.040, 0.005,
     "**当前实现**（AM-012）：fade 40ms / tick 5ms → 8 级台阶"),
    ("V2-8ms-5ms", 0.008, 0.005,
     "只缩 fade、不缩 tick → 台阶掉到 2 级（**反例**：file:// 元素路会更糟）"),
    ("V3-8ms-1ms", 0.008, 0.001,
     "fade 与 tick 一起缩 → 凹陷 11ms 且台阶仍 8 级（⚠ 但 1ms 定时器不可靠，见下文）"),
    ("V4-20ms-4ms", 0.020, 0.004,
     "折中候选：fade 20ms / tick 4ms —— 4ms 是浏览器嵌套定时器的**可靠下限**"),
]


def render_variant(data, sr, js, fade, tick, loops=3, half=2.0):
    """渲一个接缝变体（重复 loops 圈，便于听重复感）。

    🔴 关键：**file:// 下 BGM 元素不进图**，淡入淡出只能靠 `el.volume` 台阶实现 ——
    loopTick() 每 LOOP_TICK 毫秒把 `el.volume` 设成当时的连续包络值，于是 gain 是**阶梯**，
    每级之间是一个 Δgain 的突变（听感 = "咔"）。所以这里必须把包络**按 tick 量化**，
    否则会得出"fade 越短越好"的错误结论（fade 缩短会同时把台阶变粗）。
    """
    loop_in = js["LOOP_IN"]
    true_dur = len(data) / sr
    out_pt = min(true_dur - js["LOOP_TAIL"], js["BGM_TRUE_DUR"] - js["LOOP_TAIL"])
    n_half = int(half * sr)
    n_out = int(out_pt * sr)
    i_in = int(loop_in * sr)

    if fade is None:                                    # 改前：硬切曲首
        seg = np.concatenate([data[n_out - n_half:n_out], data[0:n_half]], axis=0)
        return np.tile(seg, (loops, 1)), seg, out_pt, {"dip_ms": 0.0, "tick": None, "levels": 0}

    t_out = np.arange(n_out - n_half, n_out) / sr
    t_in = np.arange(i_in, i_in + n_half) / sr
    g_out = np.clip((out_pt - t_out) / fade, 0.0, 1.0)
    g_in = np.clip((t_in - loop_in) / fade, 0.0, 1.0)

    def quantize(g, tick_s):
        """零阶保持：模拟 setInterval(tick) 每 tick 设一次 el.volume。"""
        n = max(1, int(round(tick_s * sr)))
        return g[(np.arange(len(g)) // n) * n], n

    levels = 0
    if tick:
        g_out, n = quantize(g_out, tick)
        g_in, _ = quantize(g_in, tick)
        levels = int(round(fade / tick))                # 淡变跨几个 tick = 几级

    seg_out = data[n_out - n_half:n_out] * g_out[:, None]
    seg_in = data[i_in:i_in + n_half] * g_in[:, None]
    seg = np.concatenate([seg_out, seg_in], axis=0)
    # 台阶最大 Δgain：相邻 tick 的差（含接缝处"最后一级 → 0"）
    jumps = [np.abs(np.diff(g_out)).max(), np.abs(np.diff(g_in)).max(), abs(g_out[-1]), abs(g_in[0])]
    dip = (np.count_nonzero(g_out < 0.707) + np.count_nonzero(g_in < 0.707)) / sr * 1000.0
    return np.tile(seg, (loops, 1)), seg, out_pt, {
        "dip_ms": dip, "tick": tick, "levels": levels, "max_dgain": float(max(jumps))}


def seam_metrics(seg, sr, at, extra=None):
    """接缝处（样本下标 at）的质量读数。"""
    w50 = int(0.05 * sr)
    h, t = seg[at - w50:at], seg[at:at + w50]
    rms = lambda x: DB(np.sqrt(np.mean(x ** 2))) if x.size else -240.0
    d = np.abs(np.diff(seg, axis=0)).max(axis=1)
    m = {
        "head50ms_db": rms(h),
        "tail50ms_db": rms(t),
        "min_side_db": min(rms(h), rms(t)),          # 空洞探测：某一侧是否近乎静音
        "step": float(np.abs(seg[at] - seg[at - 1]).max()),
        "win_step_p999": float(np.percentile(d, 99.9)),
        "rms_db": rms(seg),
    }
    if extra:
        m.update(extra)
        dg = extra.get("max_dgain") or 0.0
        # 台阶"咔"的绝对电平 ≈ Δgain 相对满幅 + 该处信号电平（台阶是乘性的）
        m["click_db"] = (DB(dg) + rms(seg)) if dg > 0 else -240.0
    return m


def seam_study(bgm, js):
    data, sr = bgm["_data"], bgm["_sr"]
    d = OUTDIR / "seam-ab"
    d.mkdir(parents=True, exist_ok=True)
    half = 2.0
    at = int(half * sr)          # 接缝在每圈的中点
    results, tracks, meta = {}, [], {}

    for label, fade, tick, note in SEAM_VARIANTS:
        looped, seg, out_pt, extra = render_variant(data, sr, js, fade, tick, 3, half)
        m = seam_metrics(seg, sr, at, extra)
        m["note"] = note
        results[label] = m
        sf.write(str(d / (label + ".wav")), looped, sr)
        tracks.append(seg)      # 合并件只放**每版 1 圈** —— 与单版文件信息相同，省 3 倍体积

    meta = {"out_point": out_pt, "loop_in": js["LOOP_IN"], "half": half}

    gap = np.zeros((int(0.5 * sr), tracks[0].shape[1]))
    parts = []
    for i, x in enumerate(tracks):
        if i:
            parts.append(gap)          # 段间 0.5s 静音
        parts.append(x)
    allx = np.concatenate(parts, axis=0)
    sf.write(str(d / "ALL-compare.wav"), allx, sr)
    return results, d, meta


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="音频资产基线体检器")
    ap.add_argument("--os", type=int, default=4, help="真峰值过采样倍数（默认 4）")
    ap.add_argument("--emit-js", action="store_true", help="打印可粘贴的常量块")
    ap.add_argument("--seam-ab", action="store_true", help="导出循环接缝 A/B 试听对照")
    ap.add_argument("--json", default=None, help="JSON 输出路径")
    args = ap.parse_args()

    # 用户音量从源码读（不硬编码 —— 它改过，读数要跟着走）
    cfg = (ROOT / "src" / "00-config.js").read_text(encoding="utf-8")
    m = re.search(r"bgmVolume:\s*([\d.]+)", cfg)
    bgm_vol = float(m.group(1)) if m else 0.60

    OUTDIR.mkdir(exist_ok=True)
    js = read_js_constants(SRC_JS.read_text(encoding="utf-8"))

    bgm = analyze(ASSETS / "bgm-stillwater.mp3", args.os)
    slaps = [analyze(ASSETS / ("slap%d.wav" % i), args.os) for i in (1, 2, 3, 4)]
    others = [analyze(p, args.os) for p in sorted(ASSETS.glob("*")) if p.name not in
              {"bgm-stillwater.mp3", "slap1.wav", "slap2.wav", "slap3.wav", "slap4.wav"}]

    got = derive_constants(bgm, slaps)

    W = 78
    print("=" * W)
    print("still_water · 音频资产基线体检")
    print("=" * W)
    print("%-22s %9s %9s %9s %9s" % ("资产", "时长(s)", "峰值(dBFS)", "真峰(dBTP)", "响度(LUFS)"))
    print("-" * W)
    for a in [bgm] + slaps + others:
        print("%-22s %9.3f %9.2f %9.2f %9.2f" % (a["file"], a["dur"],
                                                 a["sample_peak_dbfs"], a["true_peak_dbtp"], a["lufs"]))
    print()
    print("曲首/曲尾静音(-80dBFS 门)：bgm stillwater  首 %s ms · 尾 %s ms" % (
        "%.1f" % bgm["head_silence_ms"] if bgm["head_silence_ms"] is not None else "-",
        "%.1f" % bgm["tail_silence_ms"] if bgm["tail_silence_ms"] is not None else "-"))

    # 母带后链路核查
    tp = bgm["true_peak"]
    print()
    print("母带后真峰值链路（EBU R128 要求 ≤ -1 dBTP）：")
    for label, g in (("图路  ×BGM_TRIM ×bgmVolume(%.2f)" % bgm_vol, got["BGM_TRIM"] * bgm_vol),
                     ("元素路 ×BGM_TRIM（最坏）", got["BGM_TRIM"])):
        v = tp * g
        flag = "✅" if DB(v) <= -1.0 else "⚠"
        print("  %-36s %.4f = %6.2f dBTP  %s" % (label, v, DB(v), flag))

    print()
    print("=" * W)
    print("源码常量漂移检测（src/10-audio.js）")
    print("=" * W)
    rows = check_drift(js, got, bgm, slaps, bgm_vol)
    bad = 0
    for name, src, live, d, tol, st, note in rows:
        mark = {"OK": "✅", "漂移": "🔴", "偏窄": "⚠", "缺失": "⚠", "缺失/长度不符": "⚠",
                "🔴 已超 -1 dBTP": "🔴", "🔴 会削波": "🔴"}.get(st, "•")
        if st.startswith("🔴"):
            bad += 1
        if isinstance(live, list) or isinstance(src, list):
            shown = "源码 %s\n%*s实测 %s" % (src, len(name) + 2, "", [round(x, 4) for x in live])
            print("%s %-22s %s" % (mark, name, shown))
            print("%*s 最差段差 %.5f（容差 %.5f）· %s" % (len(name) + 3, "", d, tol, note))
        else:
            s = "-" if src is None else ("%.4f" % src)
            l = "-" if live is None else ("%.4f" % live)
            print("%s %-22s 源码 %-10s 实测 %-10s 差 %-9s %s" % (
                mark, name, s, l, "-" if d is None else "%.5f" % d, st))
            print("%*s %s" % (len(name) + 3, "", note))
    print()
    print("判决：%s" % ("✅ 全部一致，源码常量仍是当前资产的忠实快照" if bad == 0
                      else "🔴 %d 项需处理（资产已换？跑 --emit-js 取新值）" % bad))

    if args.emit_js:
        print()
        print("=" * W)
        print("可粘贴常量块（--emit-js）")
        print("=" * W)
        print("  var BGM_LUFS_RAW = %.2f;          // %s 实测集成响度" % (got["BGM_LUFS_RAW"], bgm["file"]))
        print("  var BGM_LUFS_TARGET = %.2f;       // 母带目标" % got["BGM_LUFS_TARGET"])
        print("  var BGM_TRIM = %.4f;              // 10^((TARGET-RAW)/20) = 10^(%.2f/20)"
              % (got["BGM_TRIM"], got["BGM_LUFS_TARGET"] - got["BGM_LUFS_RAW"]))
        print("  var BGM_TRUE_DUR = %.3f;" % got["BGM_TRUE_DUR"])
        print("  var SLAP_LUFS_TRIM = [%s];" % ", ".join("%.4f" % x for x in got["SLAP_LUFS_TRIM"]))
        print("  // 拍击实测响度 = [%s]，均值 %.2f" % (
            ", ".join("%.2f" % x for x in got["SLAP_LUFS"]), got["SLAP_LUFS_MEAN"]))

    seam = None
    if args.seam_ab:
        results, d, meta = seam_study(bgm, js)
        seam = {"variants": results, "meta": meta}
        print()
        print("=" * W)
        print("循环接缝变体研究（--seam-ab）· 每版渲 3 圈，每圈 = 出点前 2s + 入点后 2s")
        print("=" * W)
        print("%-22s %8s %8s %6s %8s %8s %10s" % (
            "变体", "最弱侧", "凹陷宽", "级数", "Δgain", "台阶咔", "接缝跳变"))
        print("%-22s %8s %8s %6s %8s %8s %10s" % (
            "", "(dB)", "(ms)", "", "", "(dB)", ""))
        print("-" * W)
        for label, m in results.items():
            lv = "-" if not m.get("levels") else str(m["levels"])
            dg = "-" if not m.get("max_dgain") else "%.3f" % m["max_dgain"]
            ck = "-" if not m.get("max_dgain") else "%.1f" % m["click_db"]
            print("%-22s %8.2f %8.1f %6s %8s %8s %10.2e" % (
                label, m["min_side_db"], m["dip_ms"], lv, dg, ck, m["step"]))
        print()
        for label, m in results.items():
            hole = "🔴 有空洞（一侧近静音）" if m["min_side_db"] < -60 else \
                   ("⚠ 偏弱" if m["min_side_db"] < -40 else "✅ 两侧都有声")
            boom = "🔴 超自然跳变 p99.9" if m["step"] > m["win_step_p999"] else "✅ 在自然跳变内"
            print("  %-22s %s · %s（跳变 %.2e vs 自然 p99.9 %.2e）" % (
                label, hole, boom, m["step"], m["win_step_p999"]))
            print("  %-22s %s" % ("", m["note"]))
        print()
        print("读法（三列陷阱）：")
        print("  · 凹陷宽 = 包络低于 -3dB 的时长 ≈ 2 × fade × 0.707（**越短越好**）")
        print("  · 台阶咔 = 20log10(Δgain) + 信号电平 —— file:// 元素路专属，"
              "每 LOOP_TICK 毫秒一次 el.volume 突变的响度（**越低越好**）")
        print("  · 接缝跳变 vs 自然 p99.9 —— 超过就是在波形上真的爆了一下")
        print("  ⚠ 只缩 fade 不缩 tick（V2）会把台阶变粗 → 咔反而更响。两者必须一起缩。")
        print("文件（%s）：" % d)
        tot = 0
        for f in sorted(d.glob("*.wav")):
            sz = f.stat().st_size
            tot += sz
            print("  %-24s %5.1fs  %5.1f MB" % (f.name, sf.info(str(f)).duration, sz / 1e6))
        print("  单版文件各含 %d 圈（听重复感）；ALL-compare 每版只放 1 圈。目录共 %.1f MB"
              % (3, tot / 1e6))
        print("  · 48kHz 立体声 16bit，与上表读数是**同一份 PCM**（听到 = 读到）")
        print("  · 本目录是可重建的临时产物（.gitignore 第 8 段），听完可整目录删除")

    out = {
        "assets": [{k: v for k, v in a.items() if not k.startswith("_")}
                   for a in [bgm] + slaps + others],
        "derived": got,
        "source_constants": js,
        "drift": [{"name": n, "src": s, "live": l, "diff": d, "tol": t, "status": st, "note": note}
                  for n, s, l, d, t, st, note in rows],
        "verdict": "clean" if bad == 0 else "drift",
    }
    if seam:
        out["seam"] = seam
    p = Path(args.json) if args.json else OUTDIR / "baseline.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print("读数已写入 %s" % p)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
