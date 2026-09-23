// app/three-global.js —— 构建入口的第一件事：把 three 挂回全局
//
// 为什么必须这样（UP1a §2.1）：
//   src/ 下 12 个模块全部用 `var THREE = window.THREE` 取全局（它们本来是为经典 <script> 写的）。
//   构建入口因此必须把 ESM 的 three 命名空间**赋给 window** —— 这一赋值就是
//   「命名空间逃逸」，Rollup/Rolldown 无法再静态分析出用了哪些导出，
//   于是**必须保留 three 的全部导出 → tree-shaking 收益为 0**。
//
//   ⚠ 这不是疏漏，是**已知代价换零风险**：另一种做法是手写 51 条精确 import + shim 对象，
//     但漏掉任何一个成员都会变成**静默的 undefined**（本项目已吃过同类亏：glitterSpec /
//     uProbe 的静默漂移）。裁决：UP1a 不做，留给 UP1b 连同漂移守卫一起做。
//
//   ⚠ 体积因此不要指望下降。UP1a 的体积预期是「持平或略降」，见 §2.1 末尾。
//
// ⚠ 这行必须在所有 src 模块**之前**执行。保证方式：app/main.js 把它放在第一条 import。
//    ESM 的 import 是提升的，顺序 = 顶层 import 的书写顺序 —— 不要把它挪到后面。
import * as THREE from 'three';
window.THREE = THREE;
