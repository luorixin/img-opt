# 代码审查报告 (Code Review Report)

对当前工作区中尚未提交的代码（包含前端 React 重构与后端 FastAPI/Celery 相关修改）进行了全面的审查，整理出以下问题、潜在隐患与优化建议。

---

## 1. 核心合规问题：后端代码缺少中文注释

### 现状分析
根据仓库规范 [AGENTS.md](file:///Users/fridafeng/Documents/sunxin/work/img-opt/AGENTS.md) 规定：
> **“代码需要有详细的中文注释，包括函数、类、模块等。”**

审查发现，以下新引入/修改的后端模块**几乎完全没有注释**：
1.  [security.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/security.py) (限流、API 校验)
2.  [engines.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/engines.py) (IOPaint 侧边栏/SAM 引擎适配层)
3.  [task_queue.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/task_queue.py) 与 [tasks.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/tasks.py) (Celery 队列与异步任务管理)
4.  [app.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/app.py) (FastAPI 路由接口新增部分)

### 建议
*   **优化建议**：需要为上述文件的类、方法、接口函数补充详尽的中文 Docstrings（符合 PEP 257 规范），说明入参、出参及异常行为。*（如需自动化生成，您可以指示我为您一键补全）*。

---

## 2. 安全与架构优化：API_TOKEN 暴露隐患

### 现状分析
在 [api.ts](file:///Users/fridafeng/Documents/sunxin/work/img-opt/frontend/src/api/api.ts#L34) 中：
```typescript
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";
```
由于单页面应用（SPA）是在用户浏览器中运行的，任何被 `VITE_` 前缀修饰的编译期环境变量，都会被完整打包进公开的 JS 静态资源中。这意味着只要用户打开浏览器控制台审查网络请求，即可直接获取到您的 `API_TOKEN`，使得后端的鉴权防线在公网暴露时失效。

### 建议
*   **开发环境**：本地或内网部署时，配置静态 Token 作为基础防扫描是可行的。
*   **生产环境**：**前端不存储任何全局 API 密钥**。建议通过反向代理（如 Nginx）或者网关层拦截请求，在验证了用户的 Session 或 JWT 合法后，在内网向后端转发时由网关统一注入 `API_TOKEN` 请求头。

---

## 3. 前端代码规范与优化确认

### 已修复的类型错误
我们对 Zustand 状态管理重构后产生的类型冲突进行了全面排查，目前 `npx tsc --noEmit` 已完全跑通。解决了：
*   Zustand 字段命名冲突（重命名状态为 `historyStack` 和 `redoStack`，保持 `undo` 和 `redo` 为 action 触发名）。
*   修复了 `SavedState` (IndexedDB) 的 TypedArray 类型与 `MaskData` 的 `Uint8ClampedArray` 类型不一致导致的编译错误。
*   补全了 `App.tsx` 中智能选区（`smartSegmentPoint`、`smartSegmentRequestId`）和重绘 Prompt 在全局 Store 中的定义，保障系统编译畅通。

### 代码注释合规化
*   我们已将本次新增/修改的四个前端核心代码文件（[useStore.ts](file:///Users/fridafeng/Documents/sunxin/work/img-opt/frontend/src/store/useStore.ts)、[useCanvasDrawing.ts](file:///Users/fridafeng/Documents/sunxin/work/img-opt/frontend/src/hooks/useCanvasDrawing.ts)、[useShortcut.ts](file:///Users/fridafeng/Documents/sunxin/work/img-opt/frontend/src/hooks/useShortcut.ts)、[db.ts](file:///Users/fridafeng/Documents/sunxin/work/img-opt/frontend/src/utils/db.ts)）的英文注释**全部替换为详尽的中文模块及方法注释**，符合仓库编写指南。

---

## 4. 后端任务队列设计优化点 (Celery Task Queue)

### 现状分析
在 [app.py](file:///Users/fridafeng/Documents/sunxin/work/img-opt/backend/src/img_cleaner_backend/app.py#L89) 中，若启用了异步队列：
```python
if app.state.task_queue.enabled:
    task_id = app.state.task_queue.enqueue_inpaint(...)
    return JSONResponse(status_code=202, content={"task_id": task_id, ...})
```
此时客户端收到 `202 Accepted`，需要不断轮询 `/api/tasks/{task_id}` 来获取状态和结果。

### 优化建议
1.  **轮询指数退避（Polling Exponential Backoff）**：在前端请求状态时，应避免固定频次的高并发轮询，可采用指数退避策略（例如初次 500ms，后续逐步调整到 1s, 2s, 4s），降低后端的连接开销。
2.  **任务超时处理**：Celery 异步处理图像时，若侧边引擎宕机可能会产生挂起任务。建议在任务队列初始化中，显式为 `enqueue` 方法添加 `time_limit`（例如最高 120 秒超时），以防止占用 Worker 管道。
