// plan/pw/lib/const.mjs —— UP6 共享常量（config 与 specs 都从这里取，避免两处各写一份）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));       // plan/pw/lib
export const PW_DIR = path.resolve(HERE, '..');                        // plan/pw
export const ROOT = path.resolve(PW_DIR, '..', '..');                  // 仓库根

// 所有"跑一次就改写"的产物统一落这里 —— 这个目录名已被 `.gitignore §5` 覆盖。
// ⚠ 为什么不放 `plan/pw/` 下：`.gitignore §10` 对同类问题的裁决是明确的 ——
//   `plan/wp5-assert.json` 被**专门忽略**，理由「脚本每次重跑都改写它 → 纯 diff 噪声，
//   全部读数已转录进 plan/_STATUS.md」。本包沿用同一条纪律，且**不去改 .gitignore**
//   （它不属 UP6，本波次无人拥有）。读数照样转录进 `plan/92-UP6-playwright.md` 与 `_STATUS.md`。
export const ARTIFACTS = path.join(ROOT, 'test-results');

// 与 plan/wp5-assert.js / wp5-env.js 完全相同的默认入口
export const DEFAULT_URL = 'file:///D:/projects/still_water/index.html?debug=1';
export const ENTRY = process.env.SW_URL || DEFAULT_URL;

// 冻结件（90-WAVE4 §1：本波次禁改）—— 验收 #4 要核这两条的 sha256
export const FROZEN = [
  { name: 'plan/wp5-assert.js', rel: 'plan/wp5-assert.js', file: path.join(ROOT, 'plan', 'wp5-assert.js') },
  { name: 'plan/wp5-env.js', rel: 'plan/wp5-env.js', file: path.join(ROOT, 'plan', 'wp5-env.js') },
];
// 冻结哈希表：**入库**（tiny、稳定、"永远不该变"正是它的用途）
export const FROZEN_HASHES = path.join(PW_DIR, 'frozen-hashes.json');
// dist 清单基线：**不入库**（dist 是机器本地产物、内容哈希无跨机器意义）
export const DIST_BASELINE = path.join(ARTIFACTS, 'pw-dist-baseline.txt');

// 读数落盘位置（新旧比对的输入之一）
export const READINGS_NEW = path.join(ARTIFACTS, 'pw-readings.json');
export const READINGS_OLD = path.join(ROOT, 'plan', 'wp5-assert.json');

// 稳态钉相位用的默认 (hour, uTime)。uTime 取一个"非零且非整"的值：
//   0 是水面 shader 的初值，波形在 t=0 附近最规整，用它当基线会让回归失去代表性。
export const PIN_HOUR = 12.5;
export const PIN_UTIME = 7.0;
