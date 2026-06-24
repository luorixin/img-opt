# 图片元素清除 / 背景补全工具

本项目是一个本地 Image Inpainting 工具。前端用 React + Vite 提供上传、框选、涂抹、橡皮擦、撤销、重做、预览和下载；后端用 FastAPI 接收原图与 mask，并把修复任务转发给本地 IOPaint/LaMa 侧车服务。

## 结构

- `frontend/`: React 单页编辑器，默认运行在 `http://127.0.0.1:5173`
- `backend/`: FastAPI API，默认运行在 `http://127.0.0.1:8000`
- IOPaint 侧车: 单独运行，默认地址 `http://127.0.0.1:8081`

## Docker Compose 启动

默认启动前端、后端、Redis 和 Celery worker，AI 修复任务会进入后台队列，前端自动轮询任务状态：

```bash
docker compose up --build
```

打开 `http://127.0.0.1:5173`。后端在 `http://127.0.0.1:8000`。

同时启动 IOPaint/LaMa CPU 侧车：

```bash
docker compose --profile iopaint up --build
```

同时启用提示词重绘的 diffusion CPU 侧车（首次启动会下载较大的模型）：

```bash
docker compose --profile iopaint --profile diffusion up --build
```

可通过 `IOPAINT_PROMPT_MODEL` 覆盖 diffusion 模型。CPU 推理会比较慢，Apple Silicon 更建议按下文在宿主机使用 MPS。

Docker Desktop for macOS 的 Linux 容器不能直接使用 Apple MPS，因此 Compose 里的 IOPaint 默认使用 `--device=cpu`。第一次启动会下载模型并缓存到 `iopaint-models` volume，耗时会比较久。

如果要用 Apple MPS，建议在宿主机本地启动 IOPaint，然后用环境变量覆盖后端地址，只把前端和后端放进 Docker：

```bash
docker compose -f compose.yaml -f compose.mps.yaml up -d --build backend worker frontend
```

此模式下，后端默认访问宿主机的 `http://host.docker.internal:8081`。如果 IOPaint 端点路径、SAM 插件名或超时需要调整，可以覆盖：

```bash
IOPAINT_INPAINT_PATH=/api/v1/inpaint IOPAINT_SEGMENT_PATH=/api/v1/run_plugin_gen_mask IOPAINT_SEGMENT_PLUGIN_NAME=InteractiveSeg IOPAINT_TIMEOUT_SECONDS=240 docker compose -f compose.yaml -f compose.mps.yaml up -d --build backend worker frontend
```

公网部署时建议开启 Token 和提交限流，避免 GPU/AI 任务被滥用：

```bash
API_TOKEN=change-me RATE_LIMIT_PER_MINUTE=20 docker compose up -d --build
```

如果开启了 `API_TOKEN`，前端构建时同步设置 `VITE_API_TOKEN`，或者由自己的网关注入鉴权请求头。Worker 默认 `CELERY_WORKER_CONCURRENCY=1`，用于降低多图并发时的显存/内存峰值；确认模型和机器容量足够后再调高。

## 本地开发启动

### 1. IOPaint / LaMa 侧车

建议使用单独 Python 环境安装 IOPaint，避免与 FastAPI 开发环境耦合。macOS Apple Silicon 优先尝试 MPS：

```bash
python3.11 -m venv .iopaint-venv
.iopaint-venv/bin/pip install --upgrade pip
.iopaint-venv/bin/pip install iopaint
.iopaint-venv/bin/iopaint start --model=lama --device=mps --enable-interactive-seg --interactive-seg-model=mobile_sam --interactive-seg-device=mps --host=0.0.0.0 --port=8081
```

如果 MPS 不可用，改用 CPU：

```bash
.iopaint-venv/bin/iopaint start --model=lama --device=cpu --enable-interactive-seg --interactive-seg-model=mobile_sam --interactive-seg-device=cpu --port=8081
```

提示词重绘使用独立 diffusion 侧车，另开终端启动在 8082：

```bash
.iopaint-venv/bin/iopaint start --model=runwayml/stable-diffusion-inpainting --device=mps --low-mem --host=0.0.0.0 --port=8082
```

后端默认通过 `IOPAINT_PROMPT_BASE_URL=http://127.0.0.1:8082` 访问该服务。独立进程避免 LaMa 擦除和 diffusion 重绘在请求期间切换模型。

第一次启动会下载模型。若 IOPaint 的运行时 API 与当前适配不一致，以 `http://127.0.0.1:8081/docs` 为准调整 `backend/src/img_cleaner_backend/engines.py`。

### 2. FastAPI 后端

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/pip install -e backend
IOPAINT_BASE_URL=http://127.0.0.1:8081 .venv/bin/python -m img_cleaner_backend
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

本地如需启用异步队列，先启动 Redis，再分别启动后端和 worker：

```bash
TASK_QUEUE_ENABLED=true CELERY_BROKER_URL=redis://127.0.0.1:6379/0 CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1 .venv/bin/python -m img_cleaner_backend
CELERY_BROKER_URL=redis://127.0.0.1:6379/0 CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1 .venv/bin/celery -A img_cleaner_backend.celery_app:celery_app worker --loglevel=INFO --concurrency=1
```

### 3. React 前端

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

打开 `http://127.0.0.1:5173`。

## 测试与构建

```bash
.venv/bin/python -m pytest backend/tests -q
cd frontend && npm test
cd frontend && npm run build
```

## 第一版范围

- 支持 PNG/JPEG/WebP 上传，可点击选择或拖拽图片到编辑区上传/替换。
- Mask 工具：画笔、矩形框选、橡皮擦、撤销、重做、清空。
- Mask 约定：白色区域修复，黑色区域保留。
- 导出格式：PNG。
- 支持一键透明背景：基于图片四角背景色做边缘连通区域检测，并通过“背景容差”调节近似背景颜色范围，适合纯色或接近纯色背景。
- 支持一键清晰：基于浏览器 Canvas 高质量放大和轻量锐化生成 2x-4x PNG，适合图标、截图、UI 小图的快速提高清晰度。
- 支持一键切图：使用“切图”工具可连续矩形框选多个原始图片区域，按当前“清晰倍率”逐张高清化后一次性触发 PNG 下载，并在结果预览显示最后一张切图。
- 支持批量透明背景与批量清晰增强：多选 PNG/JPEG/WebP 后按顺序端侧处理并自动下载 PNG，结果预览显示最后一张产物。
- 支持 SAM 智能选区：启用 IOPaint InteractiveSeg 后，选择“智能选区”并点击物体即可把分割结果合并到当前 Mask，之后仍可用画笔、橡皮擦和撤销/重做修整。
- 支持提示词重绘：绘制或智能生成 Mask 后输入提示词，通过独立 diffusion IOPaint 侧车异步生成局部替换结果。
- 不包含账号、云端存储。
