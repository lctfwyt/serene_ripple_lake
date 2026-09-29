#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""plan/audio-slap-cut.py —— UP15 slap 拍击采样「换源」选材 / 加工 / 试听工具

【为什么存在】
assets/audio/slap1~4.wav 的原源 sounds-mp3 **不可商用**（2026-09-30 主控裁决），必须换源。
新源 = 雨桐提供的 `lake-water-breaks-on-a-rocky-shore.mp3`（出处 `sound dino`，可商用免署名）。
本脚本把「从 99.253 s 岸浪环境声里挑 4 个拍击 + 加工成『低沉厚重』」变成**一条命令可复跑**的
确定性流程 —— 选材靠**读数**（包络峰 / 起跳 / 低频占比），不靠耳朵翻 99 秒。

【口径】（与 plan/audio-baseline.py 同源，见其头部）
  · 解码    libsndfile（soundfile）· 源 44.1 kHz 立体声 → 单声道取均值
  · 输出    48 000 Hz · 单声道 · PCM_16 · 峰值统一 0.6200（−4.15 dBFS）
  · 响度    pyloudnorm（ITU-R BS.1770-4），仅作读数（配平由 SLAP_LUFS_TRIM 负责）

【运行】
  python plan/audio-slap-cut.py --audition
      → 自动选材 + 渲 6 个候选（raw）+ 4 个加工档 → audio-build/slap-audition/audition.html
  python plan/audio-slap-cut.py --final --picks A1,A3,A4,A6 --level heavy
      → 渲定档四件 → audio-build/slap-final/slap1~4.wav（⚠ 不写 assets/，落地手工做）
  python plan/audio-slap-cut.py --cands 8          # 候选个数（默认 6）
  python plan/audio-slap-cut.py --src <mp3>        # 换源文件

【产物落点】audio-build/slap-audition/ · audio-build/slap-final/ —— .gitignore 第 8 段已忽略。
  唯一该入库的是**本脚本自身**（沿用 audio-baseline.py「脚本入库、产物忽略」原则）。

🔴 本脚本**从不写** assets/audio/ 与 src/** —— 落地属「定档后第二段」，由施工方手工执行。

2026-09-30 建立（UP15 / AM-034 试听段）。
"""

import argparse
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import butter, find_peaks, lfilter, resample_poly

# Windows 终端默认 GBK，中文会炸
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC_MP3 = ROOT / "audio-build" / "src" / "lake-water-breaks-on-a-rocky-shore.mp3"
OUTDIR = ROOT / "audio-build"

SRC_SHA16 = "3c0470de30191980"      # 契约 108 §3.1；不符即停
# 已登记源指纹白名单（新源进 `audio-build/src/` 时在此登记，避免 `--any` 滥用）
SRC_SHA_WHITELIST = {
    SRC_SHA16: "lake-water-breaks-on-a-rocky-shore.mp3（108 §3.1）",
    "c246ea712ffa82e9": "small-splashes-of-water.mp3（雨桐 2026-09-30 提供，出处同 §3.3 `sound dino`）",
}

OUT_SR = 48000                      # 输出采样率（§2-4 硬约束）
OUT_PEAK = 0.6200                   # 输出峰值（−4.15 dBFS，沿用旧件约定）
DUR_MIN, DUR_MAX = 0.55, 1.80       # 时长夹（§4.3 定档件上限 1.80）
# 🔴 **定长**：素材沿革里旧 slap1~4.wav 也是「从 29 s 连续戏水里**切 1.45 s**」（§1.1 实测
#    1.4500 s / 69 600 帧 @48k）⇒ 本源同为连续岸浪，**按同一刀法切定长**，而不是按自然衰减收尾
#    （自然衰减只有 0.2~0.6 s，切到那儿就成了 0.55 s 的短促声，与旧件的"一段水声"不是同一物）。
#    落点 = 起跳前 PRE_ROLL，长度 = DUR_TARGET；尾部的岸浪底噪由 150 ms 淡出收掉。
DUR_TARGET = 1.4500
WIN_HOP = 0.20                      # 定长窗扫描跳距（选材对象 = 定长窗本身，见 pick_candidates ①）

# 选材 —— 0.25 s 窗包络峰（§4.2-②）
ENV_WIN, ENV_HOP = 0.25, 0.025
ENV_PCTL = 85
# 起跳精化 —— 10 ms 窗 / 5 ms 跳（§4.2-③ 的「5 ms 窗」落在**跳距**上：
#   纯 5 ms 窗 RMS 对本源（宽带噪声）等于 |x| 本身，跨阈点被噪声抖得毫无意义；
#   故窗取 10 ms、跳取 5 ms，并要求**连续 3 跳**过阈才算起跳。）
FINE_WIN, FINE_HOP = 0.010, 0.005
FINE_HOLD = 3
# 起跳 / 衰减的阈值，都以「底噪 → 峰」的**相对高度**计（源是连续岸浪，绝对 8% 永远达不到）
ONSET_FRAC = 0.55      # 起跳 = 相对高度升到 55%
ATK_LO, ATK_HI = 0.10, 0.90
TAIL_FRAC = 0.25       # 尾 = 相对高度落到 25%
# 裁剪 —— 起跳前留 100 ms；尾后再留 100 ms（§4.3）
PRE_ROLL = 0.100
TAIL_PAD = 0.100
TAIL_MAX = 1.40        # 尾最长找 1.4 s（源无孤立瞬态，不加帽会一路拖到时长上限）
# 淡变 —— 6 ms 入 / 150 ms 出，升余弦（§4.3）
FADE_IN = 0.006
FADE_OUT = 0.150
# 低频占比带宽（§3.2）：40–250 Hz / 20–16000 Hz
LOW_BAND = (40.0, 250.0)
FULL_BAND = (20.0, 16000.0)

# 加工链四档（§4.4）—— 参数写死，禁凭手感调
HP_FREQ = 35.0                      # 高通：先切掉次声/直流，免得低架把它们一起抬起来
LEVELS = {                          # name: (低架增益 dB, 低架频率, 闷响层?, tanh drive, 降调)
    "raw":   (0.0,  0.0,  False, 0.0, 1.0),
    "soft":  (6.0,  220.0, False, 0.0, 1.0),
    "heavy": (11.0, 180.0, True,  1.6, 1.0),
    "deep":  (11.0, 180.0, True,  1.6, 0.87),
}
LEVEL_ORDER = ["raw", "soft", "heavy", "deep"]
# 闷响层（§4.4 heavy/deep）：72 Hz · 指数衰减 0.22 s · 幅 0.30×峰
THUMP_FREQ, THUMP_TAU, THUMP_AMP = 72.0, 0.22, 0.30
# deep 降调 0.87×：resample_poly(115, 100) ⇒ 样本数 ×1.15 ⇒ **变慢 + 降调**（时长 +15%）
#   ⚠ 108 §4.4 原文写 `resample_poly(100, 115)` 与其自身注解「降调 0.87× · 同时变慢 · 时长 +15%」
#     方向相反（100/115 会**变快升调**）。本实现按**注解的听感意图**取 (115, 100)；记为文本订正。
PITCH_UP, PITCH_DOWN = 115, 100


# --------------------------------------------------------------------------- 工具
def db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def rms_env(x, sr, win_s, hop_s):
    """滑动窗 RMS 包络（win_s 窗 / hop_s 跳）→ (env, t)。

    用 cumsum 而非 uniform_filter1d：后者在小窗长上会因累加抵消出现负均值 ⇒ sqrt 出 NaN。
    """
    w = max(1, int(round(win_s * sr)))
    h = max(1, int(round(hop_s * sr)))
    n = 1 + max(0, (len(x) - w) // h)
    idx = np.arange(n) * h
    c = np.concatenate([[0.0], np.cumsum(x * x)])
    return np.sqrt(np.maximum((c[idx + w] - c[idx]) / float(w), 0.0)), idx / float(sr)


def biquad_lowshelf(x, sr, f0, gain_db, q=0.707):
    """RBJ low-shelf 双二阶（alpha = sin(w0)/(2Q)，与 §4.4 的 Q 0.707 口径一致）。"""
    a = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * f0 / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * q)
    sa = 2.0 * np.sqrt(a) * alpha
    b = np.array([a * ((a + 1) - (a - 1) * cw + sa),
                  2 * a * ((a - 1) - (a + 1) * cw),
                  a * ((a + 1) - (a - 1) * cw - sa)])
    den = np.array([(a + 1) + (a - 1) * cw + sa,
                    -2 * ((a - 1) + (a + 1) * cw),
                    (a + 1) + (a - 1) * cw - sa])
    return lfilter(b / den[0], np.array([1.0, den[1] / den[0], den[2] / den[0]]), x)


def biquad_highpass(x, sr, f0, order=2):
    b, a = butter(order, f0 / (sr / 2.0), btype="highpass")
    return lfilter(b, a, x)


def soft_sat(x, drive):
    """tanh 软饱和（归一化到 ±1，便于后续统一峰值）。"""
    return np.tanh(drive * x) / np.tanh(drive)


def raise_cos(n):
    """升余弦窗 0→1（无折点，听不出接缝）。"""
    return 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, n))


def apply_fades(x, sr, fin=FADE_IN, fout=FADE_OUT):
    ni = min(int(round(fin * sr)), len(x) // 4)
    no = min(int(round(fout * sr)), len(x) // 4)
    if ni > 1:
        x[:ni] *= raise_cos(ni)
    if no > 1:
        x[-no:] *= raise_cos(no)[::-1]
    return x


def norm_peak(x, peak=OUT_PEAK):
    m = float(np.abs(x).max())
    return x if m < 1e-9 else x * (peak / m)


def low_ratio(x, sr):
    """LOW_BAND 内能量 / FULL_BAND 内能量（功率谱比）。"""
    n = len(x)
    if n < 64:
        return 0.0
    spec = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    fr = np.fft.rfftfreq(n, 1.0 / sr)
    tot = spec[(fr >= FULL_BAND[0]) & (fr <= FULL_BAND[1])].sum()
    if tot <= 0:
        return 0.0
    band = spec[(fr >= LOW_BAND[0]) & (fr <= LOW_BAND[1])].sum()
    return float(band / tot)


def lufs(x, sr):
    try:
        return float(pyln.Meter(sr).integrated_loudness(x.astype(np.float64)))
    except Exception:
        return float("nan")


def wav16(x, sr=OUT_SR):
    """浮点 → 48k 单声道 PCM_16 的 WAV 字节。"""
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0).astype(np.float64), sr,
             subtype="PCM_16", format="WAV")
    return buf.getvalue()


# --------------------------------------------------------------------------- 加载
def load_src(path, allow_any=False):
    import hashlib
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if sha[:16] not in SRC_SHA_WHITELIST:
        if not allow_any:
            sys.exit("🔴 源文件 sha256[:16] = %s 未登记 ⇒ 停工核对（先在 "
                     "SRC_SHA_WHITELIST 登记，或确认后加 --any）" % sha[:16])
        print("  ⚠ 源 %s 未登记，--any 放行（指纹 %s）" % (path.name, sha[:16]))
    x, sr = sf.read(str(path), dtype="float64", always_2d=True)
    mono = x.mean(axis=1)
    return mono, sr, sha


# --------------------------------------------------------------------------- 选材
def pick_candidates(x, sr, want=6, gap=5.0, dur_t=DUR_TARGET):
    """§4.2：0.25 s 窗包络峰 → P85 门 → 精化起跳 → 三读数 → 半强半厚挑 want 个。

    ⚠ 本源是**连续岸浪**（99 s 无静音、无孤立瞬态），底噪 RMS ≈ 0.0088，
    事件峰仅高出底噪 ~10 dB ⇒ 所有阈值取**相对高度** h = (env − bed)/(peak − bed)，
    §4.3 原文「尾降到 <8% 峰」在本源上**永远不成立**（8% 峰已低于底噪），
    改按 TAIL_FRAC = 0.25 的相对高度裁；记为口径订正。
    """
    env, t = rms_env(x, sr, ENV_WIN, ENV_HOP)
    hop = t[1] - t[0]
    bed = float(np.median(env))
    thr = float(np.percentile(env, ENV_PCTL))
    pk, _ = find_peaks(env, height=thr, distance=max(1, int(round(0.25 / hop))))
    if pk.size == 0:
        sys.exit("🔴 未检出任何事件（P85 门太高 / 源不对）")

    fine, tfine = rms_env(x, sr, FINE_WIN, FINE_HOP)
    hfine = tfine[1] - tfine[0]

    def crossing(e, h, frac, lo, hi, rise=True):
        """在 [lo,hi] 内找相对高度过 frac 的位置（rise=升 / 降），无解返回 None。"""
        tgt = bed + frac * h
        seg = e[lo:hi]
        ok = (seg >= tgt) if rise else (seg <= tgt)
        if not ok.any():
            return None
        i = int(np.flatnonzero(ok)[0] if rise else np.flatnonzero(ok)[0])
        if rise:                                   # 连续 FINE_HOLD 跳都过阈才算数
            for j in range(i, min(i + 6 * FINE_HOLD, len(seg))):
                if ok[j:j + FINE_HOLD].all():
                    return lo + j
            return lo + i
        return lo + i

    # ① **定长窗扫描**（沿用旧件沿革 §1.1：从连续素材里按能量挑片段，而不是"按孤立事件峰切短片"）
    #    理由（实测反转）：按事件峰切 1.45 s ⇒ 段内除了一小下全是底噪 ⇒ 峰值归一后 crest 极高，
    #    6 段 LUFS 只有 −27.9~−31.9，比旧件 mean −20.09 **轻 8~12 LU**。旧件之所以 1.45 s 还能
    #    −20 LU，是因为它是「连续戏水」的**密段**。故选材对象改为**定长窗本身**。
    w = int(round(dur_t * sr))
    hs = max(1, int(round(WIN_HOP * sr)))
    starts = np.arange(0, max(1, len(x) - w + 1), hs)
    cs = np.concatenate([[0.0], np.cumsum(x * x)])
    e_win = np.sqrt(np.maximum((cs[starts + w] - cs[starts]) / float(w), 0.0))
    low_win = np.array([low_ratio(x[s:s + w], sr) for s in starts])
    # 排序键：强拍用 win_rms；厚拍用 **低频能量** win_rms × win_low（**不用占比** ——
    #   占比会偏好"安静的底噪段"（底噪低频占比反而高）⇒ 初版 4 段全选到同一处。记为实测反转。）
    wins = [{"s": int(s), "t": float(s) / sr, "win_rms": float(e),
             "win_low": float(l), "win_lowe": float(e * l)}
            for s, e, l in zip(starts, e_win, low_win)]

    def locate(win):
        """在定长窗内定位最强事件峰 → 起跳 / attack / 衰减尾 读数 + 切片边界。"""
        s0, s1 = win["s"], win["s"] + w
        inside = [q for q in pk if s0 <= int(round(float(t[q]) * sr)) <= s1]
        if not inside:                              # 窗内无事件 ⇒ 退到**窗内**包络最大点
            lq = int(round(s0 / sr / hop)); hq = min(len(env), int(round(s1 / sr / hop)))
            inside = [lq + int(np.argmax(env[lq:hq]))] if hq > lq else [int(np.argmax(env))]
        p = max(inside, key=lambda q: float(env[q]))
        ref = float(env[p])
        hgt = max(ref - bed, 1e-9)
        pk_t = float(t[p])
        # 粗起跳 → 10 ms 包络精化（两级包络量纲不同，90% 必须取 10 ms 包络**自身的峰**）
        lo_c = max(0, p - int(round(1.0 / hop)))
        seg = env[lo_c:p + 1]
        below = np.flatnonzero(seg <= bed + ONSET_FRAC * hgt)
        coarse_t = float(t[lo_c + (int(below[-1]) if below.size else 0)])
        lo_f = max(0, int(round((coarse_t - 0.12) / hfine)))
        hi_f = min(len(fine), int(round((pk_t + 0.05) / hfine)))
        hgt_f = max(float(fine[lo_f:hi_f].max()) - bed, 1e-9)
        io = crossing(fine, hgt_f, ONSET_FRAC, lo_f, hi_f, rise=True)
        onset_t = float(tfine[io]) if io is not None else coarse_t
        i10 = crossing(fine, hgt_f, ATK_LO, lo_f, hi_f, rise=True)
        i90 = crossing(fine, hgt_f, ATK_HI, lo_f, hi_f, rise=True)
        atk = ((i90 - i10) * hfine * 1000.0) if (i10 is not None and i90 is not None) else float("nan")
        atk = max(0.0, atk)                 # 两级包络的跳距差可能读出小负值，无物理意义
        hi_t = min(len(env), p + int(round(TAIL_MAX / hop)))
        it = crossing(env, hgt, TAIL_FRAC, p + max(1, int(round(0.06 / hop))), hi_t, rise=False)
        tail_t = float(t[it]) if it is not None else float(t[hi_t - 1])

        a = max(0, int(round((onset_t - PRE_ROLL) * sr)))
        b = min(len(x), a + w)
        if b - a < int(round(DUR_MIN * sr)):        # 贴着文件尾 ⇒ 整段左移
            a, b = max(0, len(x) - w), len(x)
        nxt = [float(t[q]) for q in inside if q != p and float(t[q]) > onset_t]
        return {
            "onset_s": float(onset_t), "peak_s": pk_t, "a": int(a), "b": int(b),
            "dur": float((b - a) / sr), "attack_ms": float(atk),
            "tail_s": float(tail_t - pk_t), "env_peak": ref,
            "win_t": win["t"], "win_rms": win["win_rms"], "win_low": win["win_low"],
            "win_lowe": win["win_lowe"],
            "clean": not nxt, "next_ev": min(nxt) - onset_t if nxt else None,
        }

    def take(pool, key, n, picked):
        out = []
        for c in sorted(pool, key=lambda c: -c[key]):
            if all(abs(c["t"] - q["t"]) >= gap for q in picked + out):
                out.append(c)
                if len(out) == n:
                    break
        return out

    # 🔴 **全部按窗能量挑**（§4.2-⑤ 的「一半厚拍」在本源上**不成立**）：
    #    本源整段低频占比仅 0.0588 %（§3.2）⇒ 按低频占比挑出的段不但不"厚"（占比 0.02 %），
    #    还比按能量挑的段轻 5~7 LU（实测 −32 vs −27）⇒ 纯粹是挑到了安静段。
    #    ⇒ 选材只管「哪一次拍击对」，**厚度完全交给 B 段加工档**（heavy 把低频做到 60~86 %）。
    loud = sorted(wins, key=lambda c: -c["win_rms"])[:max(want * 2, len(wins) // 3)]
    sel = take(loud, "win_rms", want, [])
    cands = []
    for i, win in enumerate(sel, 1):
        c = locate(win)
        c["kind"] = "能量#%d" % i
        clip = x[c["a"]:c["b"]]
        c["rms"] = float(np.sqrt((clip ** 2).mean()))
        c["low"] = low_ratio(clip, sr)
        cands.append(c)
    picks = sorted(cands, key=lambda c: c["onset_s"])
    for i, c in enumerate(picks, 1):
        c["id"] = "A%d" % i
    return picks, cands, float(thr), bed, len(pk)


# --------------------------------------------------------------------------- 加工
def render(x, sr, cand, level):
    """§4.3 裁剪 + 淡变 → §4.4 加工链 → 48k / 单声道 / PCM_16 / 峰值 0.62。"""
    gain, f0, thump, drive, pitch = LEVELS[level]
    y = x[cand["a"]:cand["b"]].copy()
    y = apply_fades(y, sr)

    # 低架前先 35 Hz 高通（抬 +11 dB 时会把次声/直流一起抬起来）
    y = biquad_highpass(y, sr, HP_FREQ)
    if gain > 0:
        y = biquad_lowshelf(y, sr, f0, gain)
    if thump:
        t = np.arange(len(y)) / sr - PRE_ROLL           # 0 = 起跳点
        m = (t >= 0).astype(np.float64)
        env = np.exp(-np.maximum(t, 0.0) / THUMP_TAU) * m
        y = y + THUMP_AMP * float(np.abs(y).max()) * np.sin(2 * np.pi * THUMP_FREQ * t) * env
    if drive > 0:
        y = soft_sat(y, drive)
    if pitch != 1.0:
        y = resample_poly(y, PITCH_UP, PITCH_DOWN)

    if sr != OUT_SR:
        y = resample_poly(y, OUT_SR, int(sr))
    return norm_peak(y)


# --------------------------------------------------------------------------- 试听页
CSS = """
:root{--bg:#0b1418;--card:#122027;--line:#1e3239;--fg:#dfe9ec;--dim:#8fa4ab;--acc:#5fd0c4}
*{box-sizing:border-box}
body{margin:0;padding:28px 24px 60px;background:var(--bg);color:var(--fg);
 font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:19px;margin:0 0 4px;font-weight:600}
h2{font-size:15px;margin:32px 0 10px;font-weight:600;color:var(--acc);
 border-left:3px solid var(--acc);padding-left:9px}
.sub{color:var(--dim);font-size:12px;margin-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card.sel{border-color:var(--acc)}
.hd{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
.id{font-weight:600;color:var(--acc);font-size:15px}
.tag{font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
audio{width:100%;height:36px;margin:2px 0 8px}
.meta{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums}
.meta b{color:var(--fg);font-weight:500}
.note{margin-top:26px;padding:12px 14px;border:1px dashed var(--line);border-radius:10px;
 font-size:12.5px;color:var(--dim)}
code{background:#0e1a1f;padding:1px 5px;border-radius:3px;color:var(--acc)}
"""


def audition_html(cands, levels, rep_id):
    def card(name, tag, blob_b64, meta):
        return ("<div class='card%s'><div class='hd'><span class='id'>%s</span>"
                "<span class='tag'>%s</span></div>"
                "<audio controls preload='auto' src='data:audio/wav;base64,%s'></audio>"
                "<div class='meta'>%s</div></div>"
                % (" sel" if tag else "", name, tag, blob_b64, meta))

    parts = ["<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>slap 试听 · UP15</title><style>%s</style></head><body>" % CSS,
             "<h1>slap 拍击采样 · 试听定档</h1>",
             "<div class='sub'>源 lake-water-breaks-on-a-rocky-shore.mp3（sound dino）· "
             "48 kHz 单声道 · 峰值统一 0.62 · 离线内嵌、不联网</div>",
             "<h2>A 段 · 6 个候选（raw 档）—— 选 4 个，听「哪一次拍击对」</h2><div class='grid'>"]
    for c in cands:
        nx = "净尾 ✅" if c.get("next_ev") is None else "⚠ %.2f s 处还有一下" % c["next_ev"]
        parts.append(card(c["id"], c["kind"], c["b64"],
                          "t&nbsp;<b>%.2f s</b> · 时长 <b>%.3f s</b> · 起跳 <b>%.0f ms</b> · "
                          "低频 <b>%.2f %%</b> · 衰减尾 <b>%.2f s</b> · %s · LUFS <b>%.1f</b>"
                          % (c["onset_s"], c["dur_r"], c["attack_ms"], c["low"] * 100.0,
                             c["tail_s"], nx, c["lufs"])))
    parts.append("</div><h2>B 段 · 4 个加工档（代表段 %s，RMS 最高）—— "
                 "选 1 档，听「要多沉」</h2><div class='grid'>" % rep_id)
    for lv in levels:
        parts.append(card(lv["level"], "档位", lv["b64"],
                          "时长 <b>%.3f s</b> · 低频 <b>%.2f %%</b> · LUFS <b>%.1f</b> · "
                          "峰值 <b>%.4f</b><br>%s"
                          % (lv["dur"], lv["low"] * 100.0, lv["lufs"], lv["peak"], lv["desc"])))
    parts.append("</div><div class='note'><b>怎么回：</b>例 "
                 "<code>选 A2/A4/A5/A6，档位 heavy</code><br>"
                 "A 段只听「哪一次拍击对」（6 选 4）；B 段只听「要多沉」（4 选 1，全局同链）。<br>"
                 "同链意味着 4 件加工参数完全一致，响度由 SLAP_LUFS_TRIM 另行配平 —— "
                 "别因为某段听着轻就换段，那是配平要解决的。</div></body></html>")
    return "".join(parts)


LEVEL_DESC = {
    "raw": "基准：仅裁剪 + 淡变（听原样，沙沙的岸浪）",
    "soft": "低架 +6 dB @220 Hz —— 只加「体积感」",
    "heavy": "低架 +11 dB @180 Hz + 72 Hz 闷响层 + tanh 软饱和<br><b>目标档</b>：加体重 + 补谐波",
    "deep": "heavy + 降调 0.87×（同时变慢，时长 +15 %）—— 最深",
}


# --------------------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description="UP15 slap 选材 / 加工 / 试听（AM-034）")
    ap.add_argument("--audition", action="store_true", help="出候选 + 档位 + 试听页（默认）")
    ap.add_argument("--final", action="store_true", help="出定档四件（需 --picks / --level）")
    ap.add_argument("--picks", default="", help="例 A1,A3,A4,A6")
    ap.add_argument("--level", default="heavy", choices=LEVEL_ORDER)
    ap.add_argument("--cands", type=int, default=6, help="候选个数（默认 6）")
    ap.add_argument("--gap", type=float, default=5.0, help="候选两两最小间隔秒（短源须调小）")
    ap.add_argument("--dur", type=float, default=DUR_TARGET,
                    help="**定长**裁剪秒数（默认 1.450 = 旧 slap1~4.wav 实测时长，§1.1）")
    ap.add_argument("--src", default=str(SRC_MP3))
    ap.add_argument("--any", action="store_true", help="源指纹未登记时放行（须先确认出处）")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    if not (a.final or a.audition):
        a.audition = True

    src = Path(a.src)
    if not src.exists():
        sys.exit("🔴 源文件不存在：%s" % src)
    x, sr, sha = load_src(src, allow_any=a.any)
    print("源：%s" % src.name)
    print("  sha256[:16] %s ✅ · %.1f kHz · %.3f s · 全段低频占比 %.4f %%"
          % (sha[:16], sr / 1000.0, len(x) / sr, low_ratio(x, sr) * 100.0))

    picks, allc, thr, bed, nev = pick_candidates(x, sr, a.cands, gap=a.gap, dur_t=a.gap and a.dur or a.dur)
    print("\n候选（0.25 s 包络峰 ≥ P85 = %.5f；底噪中位 %.5f；全源 %d 个事件 ⇒ 取 %d）"
          % (thr, bed, nev, len(picks)))
    print("  %-4s %8s %8s %8s %9s %9s %8s %7s %8s"
          % ("ID", "t(s)", "时长", "起跳ms", "低频%", "RMS", "衰减尾", "净尾", "LUFS"))
    print("  " + "-" * 76)
    for c in picks:
        y = render(x, sr, c, "raw")
        c["dur_r"] = len(y) / OUT_SR
        c["lufs"] = lufs(y, OUT_SR)
        c["wav"] = wav16(y)
        c["b64"] = base64.b64encode(c["wav"]).decode()
        nx = "✅" if c.get("next_ev") is None else "⚠+%.2fs" % c["next_ev"]
        print("  %-4s %8.2f %8.3f %8.0f %9.2f %9.5f %8.2f %7s %8.1f  [%s]"
              % (c["id"], c["onset_s"], c["dur_r"], c["attack_ms"],
                 c["low"] * 100.0, c["rms"], c["tail_s"], nx, c["lufs"], c["kind"]))

    if a.audition:
        rep = max(picks, key=lambda c: c["rms"])
        lv_out = []
        print("\n档位（代表段 = %s，RMS 最高 %.5f）" % (rep["id"], rep["rms"]))
        print("  %-7s %8s %9s %8s %9s" % ("档", "时长", "低频%", "LUFS", "峰值"))
        print("  " + "-" * 46)
        for name in LEVEL_ORDER:
            y = render(x, sr, rep, name)
            lv_out.append({"level": name, "dur": len(y) / OUT_SR,
                           "low": low_ratio(y, OUT_SR), "lufs": lufs(y, OUT_SR),
                           "peak": float(np.abs(y).max()), "desc": LEVEL_DESC[name],
                           "b64": base64.b64encode(wav16(y)).decode()})
            print("  %-7s %8.3f %9.2f %8.1f %9.4f"
                  % (name, lv_out[-1]["dur"], lv_out[-1]["low"] * 100.0,
                     lv_out[-1]["lufs"], lv_out[-1]["peak"]))

        d = Path(a.out) if a.out else OUTDIR / "slap-audition"
        d.mkdir(parents=True, exist_ok=True)
        for f in d.glob("*.wav"):            # 清旧：代表段会随源/参数变，留着会误听
            f.unlink()
        for c in picks:
            (d / ("%s_raw.wav" % c["id"])).write_bytes(c["wav"])
        for lv in lv_out:
            (d / ("%s_level-%s.wav" % (rep["id"], lv["level"]))).write_bytes(
                base64.b64decode(lv["b64"]))
        html = audition_html(picks, lv_out, rep["id"])
        (d / "audition.html").write_text(html, encoding="utf-8")
        (d / "readings.json").write_text(json.dumps(
            {"src": src.name, "sha256": sha, "sr": sr, "dur": len(x) / sr,
             "env_p85": thr, "events": len(allc),
             "cands": [{k: v for k, v in c.items() if k not in ("wav", "b64")} for c in picks],
             "levels": [{k: v for k, v in l.items() if k != "b64"} for l in lv_out]},
            ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n试听页 %s（%.2f MB，音频 base64 内嵌 ⇒ 离线可播）"
              % (d / "audition.html", (d / "audition.html").stat().st_size / 1e6))
        print("候选 / 档位 wav 同目录 · 读数 readings.json · "
              "本目录 .gitignore 已忽略，听完可整删")
        print("\n⬜ 待定档：选 4 个候选 + 1 个加工档 → "
              "`--final --picks A?,A?,A?,A? --level <档>`")

    if a.final:
        ids = [s.strip().upper() for s in a.picks.split(",") if s.strip()]
        if len(ids) != 4:
            sys.exit("🔴 --picks 需恰好 4 个（例 A1,A3,A4,A6），当前 %d" % len(ids))
        byid = {c["id"]: c for c in picks}
        miss = [i for i in ids if i not in byid]
        if miss:
            sys.exit("🔴 未知候选 %s（可用 %s）" % (miss, sorted(byid)))
        d = Path(a.out) if a.out else OUTDIR / "slap-final"
        d.mkdir(parents=True, exist_ok=True)
        print("\n定档四件（档位 %s）→ %s" % (a.level, d))
        lus = []
        for i, cid in enumerate(ids, 1):
            y = render(x, sr, byid[cid], a.level)
            p = d / ("slap%d.wav" % i)
            p.write_bytes(wav16(y))
            lu = lufs(y, OUT_SR)
            lus.append(lu)
            print("  %-10s ← %-4s  %.3f s · 峰值 %.4f · LUFS %.2f · %d B"
                  % (p.name, cid, len(y) / OUT_SR, float(np.abs(y).max()), lu,
                     p.stat().st_size))
        mean = float(np.mean(lus))
        print("\n⚠ 落地（第二段，本脚本不做）："
              "拷进 assets/audio/ 后跑 `python plan/audio-baseline.py --emit-js` 取")
        trims = ", ".join("%.4f" % (10 ** ((mean - v) / 20.0)) for v in lus)
        print("  SLAP_LUFS_TRIM = [%s];   （mean LUFS %.2f）" % (trims, mean))
    return 0


if __name__ == "__main__":
    sys.exit(main())
