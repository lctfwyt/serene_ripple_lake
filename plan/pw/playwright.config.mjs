// plan/pw/playwright.config.mjs —— UP6 · Playwright 验证链（dev-only）
//
// ⚠ 本目录**不进交付物**：`dist/` / `index.html` 的加载链里一个字都不引用它。
//   验收 #5 用「跑一次 npm run build，dist/ 内容哈希清单不变」来钉死这一点。
//
// ⚠ 本仓 `package.json` **没有** `"type": "module"`（且不许加 —— 见 90-WAVE4 §1 约束 ②）：
//   `plan/wp5-assert.js` 是 CJS，加了 `type: module` 它立刻 `ERR_REQUIRE_ESM` 挂掉
//   （UP1a 的 `vite.config.mjs` 头部注释记过同一坑）。
//   → 所以本目录一律用**显式 `.mjs`**，不靠 `type` 字段。
//
// 入口参数化（与 wp5-assert.js 同一口径）：
//   npm run pw                                   # 免构建入口 file:// .../index.html?debug=1
//   SW_URL=file:///D:/.../dist/index.html?debug=1 npm run pw   # 构建入口
//
// 🔴 为什么 viewport 写 1280×720 而不是照抄 `--window-size=1306,876`：
//   那 1306×876 是**给手搓 CDP 用的**——Chrome 把 26px 边框 / 156px 工具栏吃掉，
//   剩下的 1280×720 才是 viewport（AM-007 §5.1）。Playwright 直接设 viewport，
//   不存在这层换算。两者的**画布口径完全一致**（都一样得到 canvas 1280×720 / aspect 1.7778），
//   这是验收 #2「读数一致」能成立的前提。

import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { ENTRY, ROOT, PW_DIR } from './lib/const.mjs';

// 入口与常量统一放在 lib/const.mjs（specs 也从那里取，避免两处各写一份）
export { ENTRY, DEFAULT_URL } from './lib/const.mjs';

// 与 wp5-assert.js / wp5-env.js 同款 flag：软件光栅化路径一致 → 像素才可比
const BASE_ARGS = ['--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'];

export default defineConfig({
  testDir: './tests',
  // 固化快照路径：不带 projectName/platform 后缀，避免换机器/换项目名就"快照失踪"
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',

  // 输出与报告都落在仓库根 —— 这两个名字已被 .gitignore §5 覆盖（UP6 段是早先预留的）
  outputDir: path.join(ROOT, 'test-results'),
  reporter: [
    ['list'],
    // ⚠ JSON 报告也落 test-results/ 而不是 plan/pw/：它含绝对路径与耗时，每次跑都不同，
    //   放 plan/pw/ 会变成每次运行一个 diff（同类问题的裁决见 .gitignore §10）。
    ['json', { outputFile: path.join(ROOT, 'test-results', 'pw-report.json') }],
  ],

  // 单 worker 串行：所有用例共用同一个 webgl 上下文与同一份 SW 状态，
  // 并行会让「#3 注入涟漪」污染「#6 湖底 std」这类跨用例读数。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 串行跑完（含 60 帧中位采样与 #4 的模拟时间推进）需要几分钟
  timeout: 300_000,
  expect: { timeout: 20_000 },

  use: {
    // 复用系统 Chrome（与 wp5-assert.js 的 CHROME 常量同一个可执行文件），
    // 不下载 Playwright 自带的 chromium 构建 —— 少一份 ~150MB 的重复浏览器。
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,          // 基线 wp5-assert.json 里 dpr=1，必须对齐
    headless: true,
    launchOptions: { args: BASE_ARGS },
    colorScheme: 'dark',
    screenshot: 'off',
    video: 'off',
    // 🔴 trace 只留「失败可查」那一半，**显式关掉 screencast**。
    //   起因（2026-09-25 主控实测）：`retain-on-failure` 会对**每个用例都先录**、
    //   通过后再丢弃 —— 但丢弃没清干净，`traces/screencast/*.jpeg` 全留下：
    //   **单跑 1375 帧 / 75 MB**，占 `test-results/` 条目数的 99%（1378 中的 1375）。
    //   后果有两层：① 每跑 75 MB 纯垃圾；② 它是 safe-delete 守卫（阈值 5000）被撞的
    //   唯一来源 —— 守卫拦的其实是"下一次运行启动时清理上一次残留"这个动作，
    //   这才是「`npm run pw` 第二次起必被拦」的真实机制（见 03-COLLAB-PROTOCOL §8.1）。
    //   关掉 screencast 后仍保留 trace.zip（DOM 快照 / 网络 / console），失败照样能查。
    trace: { mode: 'retain-on-failure', screenshots: false },
  },

  // ================================================================ 项目分档
  // `plan/wp5-env.js` 那三条环境判据**必须换启动条件**（窄视口 / 媒体模拟 / 关 WebGL），
  // 原脚本的做法是"一个判据起一个 Chrome 实例"（三个 spawn + 三段 CDP 样板）。
  // Playwright 的 project 就是干这个的：一套用例，多套 `use` —— 样板归零。
  projects: [
    {
      // 主档：15 条断言 + 确定性 + 像素回归 + page.clock
      name: 'main',
      testIgnore: /env-/,
    },
    {
      // 对应 wp5-env.js 判据 #2：375px 窄屏不崩 + UI 不重叠
      name: 'env-narrow',
      testMatch: /env-narrow\.spec\.mjs/,
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      // 对应判据 #3：prefers-reduced-motion: reduce
      // ⚠ 原脚本要"先导航、再 CDP 设媒体、再导航一次"，因为媒体模拟必须在页面加载前生效。
      //   这里是 context 级选项，从第一帧就生效 —— 那次多余导航可以省掉。
      name: 'env-reduced-motion',
      testMatch: /env-reduced-motion\.spec\.mjs/,
      use: { reducedMotion: 'reduce' },
    },
    {
      // 对应判据 #4：强制关 WebGL → 渐变兜底，不白屏
      name: 'env-no-webgl',
      testMatch: /env-no-webgl\.spec\.mjs/,
      // ⚠ project 的 launchOptions.args 是**整体替换**（数组不深合并）→ 基础 flag 要重复写
      use: { launchOptions: { args: [...BASE_ARGS, '--disable-3d-apis', '--disable-webgl'] } },
    },
  ],
});
