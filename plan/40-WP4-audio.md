# WP4 · 音频（划水声 + 治愈系 BGM）

> 所有者文件：`src/10-audio.js` `assets/audio/*`
> 前置：**WP1 完成**（需要 `SW.P` / `SW.bus`）
> 🔴 **历史包（已收官）· 口径更新 2026-09-30**：本文件 §5「MiniMax 文生音乐」**已废案** —— MiniMax 音乐接口对新用户下线（2026-09-24 复测），**BGM 现由 Suno 生成**（`70 §6` · `107 §3.1`）。本文件仅作历史记录保留，其操作指令不再有效。
> 预计：1 天
> **可与 WP2、WP3 完全并行 —— 本包不依赖任何渲染代码。**

---

## 1. 一句话目标

**首次点击后发声；拖动划水有随速度变化的水声；治愈系 BGM 持续播放并被划水声自动压低。**

---

## 2. 开工前必读

1. `plan/01-CONTRACT.md` §2.1（你的 API 签名）+ §3 事件表（你要 `on('splash')`）+ §7
2. `plan/00-INDEX.md` §5 音频相关三条决策

**你的信息来源只有一个事件**：`SW.bus.on('splash', ({x, z, speed01}) => ...)`。
不要直接调用 `SW.ripple` 或 `SW.input` 的内部函数。

---

## 3. 三总线架构

按「**谁造成的**」分总线，而不是按听感位置分：

| 总线 | 内容 | 治理 |
|---|---|---|
| `bgm` | 治愈系音乐床 | 被 `hand` 事件 duck（速降 `P.duckDown`=0.05s / 缓升 `P.duckUp`=0.70s，量 −45%） |
| `hand` | 点击「咚」、拖动划水 | 单一 trim；由**每帧位移增量**驱动，`e *= P.handDecay`(0.62) 快衰减 |
| `amb` | 水拍岸、风 | 离散事件注入，不做"更响的床" |

```
                ┌── bgm  (GainNode) ──┐
source ─────────┼── hand (GainNode) ──┼──→ destination
                └── amb  (GainNode) ──┘
                          ↑
              splash 事件 → duck(bgm) + playHand(speed01)
```

---

## 4. 划水声：程序化 WebAudio 合成

**为什么不用录音**：真实录音**做不到**与拖动速度连续耦合的连续划水声 —— 每次拖动都是不同的速度曲线。
程序化合成可以做到"划得快声音又快又脆"，这是录音做不到的。

### 4.1 配方

```
划水声 = 白噪声 buffer
       → BiquadFilter(bandpass, 400–1400Hz, Q≈0.8)   ← P.handBand
       → GainNode(包络, e *= 0.62 每 tick)
       → hand 总线
```

| 声音 | 配方 |
|---|---|
| 划水（拖动） | 带通噪声 burst，中心频率随 `speed01` 上移，衰减 0.06–0.15s |
| 点击「咚」 | 快速下扫正弦（180 → 60Hz）+ 短噪声脉冲过带通 |
| 水拍岸（`amb`） | 粉噪 + 慢幅调 LFO |

**音色分离**：划水声偏闷（≈820Hz 段），点击声偏脆（1150–2000Hz）。
两者不能听成一个 —— 否则"点击"和"拖动"在听觉上分不开。

### 4.2 ⚠️ 由位移增量驱动，不是由事件驱动

拖动会高频发 `splash`。如果每个事件都触发一个独立声源 → 爆音、杂音、CPU 爆。

**正确做法**：维护一个持续的噪声源，`splash` 事件只**调制它的增益包络**：

```js
onSplash({ speed01 }) {
  handEnv.target = clamp(speed01, 0, 1);   // 不新建节点，只推包络
}
// 每帧：handEnv.v *= P.handDecay;  handGain.gain.value = handEnv.v * P.handVolume;
```

### 4.3 ⭐ 增益必须在看清滤波器 Q 之后再定

Q 值高时噪声会被"提纯"成啸叫，增益稍大就刺耳。
**先定 Q ≈ 0.8，再调总线增益**，顺序反了会白调。

---

## 5. BGM：MiniMax 文生音乐

### 5.1 前置条件（**已就绪，不要再重复排查**）

| 项 | 状态 |
|---|---|
| 凭据文件 | ✅ `~/.workbuddy/secrets.env` 已建（雨桐填值） |
| `requests` 依赖 | ✅ 已装进助手 venv（2.34.2） |
| 脚本可加载 | ✅ `--help` 正常 |

**两个变量都必须有**，缺一不可：

| 变量 | 说明 |
|---|---|
| `MINIMAX_API_KEY` | 雨桐填 |
| `MINIMAX_API_BASE` | 已在文件里预置 `https://api.minimaxi.com/v1`（国内平台）。**海外平台注册的 key 要改成 `https://api.minimax.io/v1`** —— Key 与 BASE 不同源会鉴权失败，且脚本不会告诉你原因 |

> ⚠️ 脚本在 **import 期**就检查 `MINIMAX_API_BASE`，不设直接 `SystemExit`。所以哪怕只想看 `--help` 也得先 source。

**Key 不得写进任何项目文件、不得提交 git、不得打印到对话里。**

### 5.2 生成命令（**逐行照抄**）

```bash
export PATH="/usr/bin:/bin:$PATH"          # 本机 bash 工具必须的第一行（见 ENVIRONMENT.md §1）
source ~/.workbuddy/secrets.env            # 注入 MINIMAX_API_KEY / MINIMAX_API_BASE
PY="C:/Users/wuyutong/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
cd "C:/Users/wuyutong/.workbuddy/skills/前端开发"

"$PY" scripts/minimax_music.py \
  --prompt "Ambient piano and soft strings, very slow tempo, calm and healing, \
            gentle water mood, no percussion, no vocals, \
            suitable for background music, not distracting, loopable" \
  --instrumental \
  --format mp3 \
  -o "D:/projects/still_water/assets/audio/bgm-stillwater.mp3"
```

注意三点：
1. 用**助手 venv 的 python 全路径** —— 托管 base python 里没有 `requests`
2. `cd` 到 skill 目录再跑（脚本路径是相对的，且它同级可能读其它模块）
3. 成功会打印 `OK: xxxxx bytes -> ...`

| 参数 | 说明 |
|---|---|
| 模型 | `music-2.5+`（**只有这个模型支持 `--instrumental`**） |
| 时长 | 默认 30s，循环可用 |
| 参考 | `references/minimax-music-guide.md`（prompt 写法与音频参数）、`references/asset-prompt-guide.md`（`bgm` 预置规格） |

**不满意就迭代 2–3 轮 prompt**，这是正常流程，不影响其它阶段。

### 5.3 ⭐ `file://` 下的加载方式（这条错了就静音）

| 方式 | `file://` 是否可用 |
|---|---|
| `fetch()` + `decodeAudioData()` | ❌ **被 CORS 挡死** |
| `<audio src="assets/audio/bgm.mp3">` + `createMediaElementSource()` | ✅ **可用** |

```js
const el = new Audio(P.bgmFile);
el.loop = true;
el.crossOrigin = 'anonymous';
const src = ctx.createMediaElementSource(el);
src.connect(bgmGain);
```

### 5.4 兜底

若 BGM 文件不存在（比如 Key 还没配）→ **自动退回程序化合成**：
2–3 个微失谐正弦/三角振荡器过低通 + 慢 LFO 的 pad。
`P.audioMode`：`'auto'`（有文件走文件，否则合成）| `'synth'` | `'file'` | `'off'`。

---

## 6. 自动播放策略

浏览器**禁止未交互自动播放**。正确处理：

```js
// 首次 pointerdown / touchstart 时调用一次
SW.audio.init();   // 创建 AudioContext → ctx.resume() → 启动 amb 总线
```

| 时机 | 行为 |
|---|---|
| 页面加载 | **不创建** `AudioContext`（创建了也是 `suspended`） |
| 首次手势 | `init()`，`ctx.state` 变 `'running'`，置 `ready = true` |
| 之后 | 每次 `splash` 只管推包络 |

`#snd` 开关（WP3 建的 DOM）调 `SW.audio.setEnabled(bool)`。

---

## 7. 验证判据

| # | 判据 | 怎么验 |
|---|---|---|
| 1 | 首手势后 `audioCtx.state === 'running'` | `?debug=1` 看 `audioCtx` |
| 2 | 划水有声音且随速度变化 | 慢拖 / 快拖对比听 |
| 3 | BGM 被 duck | 划水时 `bgmGain` 下降，0.7s 内恢复 |
| 4 | 划水声不被听成环境底噪 | **自己听**（主判据） |
| 5 | 点击声与划水声可区分 | 自己听 |
| 6 | 无爆音/无杂音 | 快速连续拖动 10 秒 |
| 7 | 音频文件缺失时不报错 | 删掉 mp3 打开，应静默退回合成 |

**"治愈"是听觉判据，只能自己听。** 断言只钉第 1、3 条。

---

## 8. 常见坑

| 坑 | 症状 | 解法 |
|---|---|---|
| 用了 `fetch` + `decodeAudioData` | `file://` 下静音 + CORS 报错 | 改 `<audio>` 元素方案 |
| 每帧新建 oscillator | CPU 飙升、爆音 | 复用节点，只推增益包络 |
| Q 值过大 | 啸叫、刺耳 | 先定 Q≈0.8 再调增益 |
| 未等首次手势 | 无声且报 `suspended` | 首手势调 `init()` |
| 忘记 duck 恢复 | 划水后 BGM 一直很小 | `gain.linearRampToValueAtTime` 回真值 |
| 音量叠乘 | 总线音量大到削波 | 各总线先各自 trim，再总限幅 |

---

## 9. 完成后

1. `plan/_STATUS.md` 追加一行（**注明 BGM 用的是生成文件还是程序化兜底**）
2. 删临时脚本
3. 通知我：**WP4 完成**
