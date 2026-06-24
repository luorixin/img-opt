# 性能与并发优化 (Performance & Concurrency)

## 1. 批量处理并发控制 (Batch Concurrency)

**优化前**：
系统在处理多张图片批量透明或批量清晰时，采用传统的 `for` 循环和 `await` 串行处理机制。对于多文件操作来说会导致 CPU 利用率不足和用户漫长的等待。

**优化方案**：
在 `frontend/src/utils/batchProcessing.ts` 中手写并引入了一个轻量级的基于 `Set` 和 `Promise.race` 的并发队列控制机制。
*   最大并发数 (Concurrency Limit) 设置为 `3`。
*   通过追踪正在执行的 Promise 集合（`executing`），当并发达到上限时才会阻塞等待，极大加快了批量处理时的吞吐量，并充分利用了浏览器的异步能力与后端的计算池。
*   保留了原有实时的进度回调更新，保证前端界面进度的精准展示。

## 2. Service Worker 缓存策略升级 (PWA Offline Capability)

**优化前**：
传统的 `sw.js` 仅对入口文件 `/`, `/index.html` 以及 `manifest.json` 使用简单的 Cache-First 逻辑，缺乏对实际庞大的 JavaScript 和 CSS 编译产物、以及第三方库的细粒度控制。这导致了版本更新可能会出现“死锁”，或者图标等外部静态资源离线失效。

**优化方案**：
将缓存策略重构为**双轨制 (Dual Cache Strategy)**：
1.  **Cache-First (强制缓存优先)**：针对 Vite 编译产生在 `/assets/` 目录下的所有携带 Hash 命名的资源（包括所有打包好的 Lucide 图标集、字体库等）。由于带有 Hash，内容是绝对不可变的，Cache-First 可以带来毫无延迟的**“秒开”体验**和完美的离线支持。
2.  **Network-First (网络优先回退缓存)**：针对页面入口导航请求（如 `/` 或 `/index.html`），由于需要实时拿到最新的资源 Hash 表来更新客户端应用，因此采用 Network-First。网络可用时随时获取最新 HTML；网络断开时直接从缓存读取，保证应用离线可用，从而兼顾了极致性能和版本迭代的无缝升级。
