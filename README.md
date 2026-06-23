# 图片元素清除 / 背景补全工具

本项目是一个本地 Image Inpainting 工具。前端用 React + Vite 提供上传、框选、涂抹、橡皮擦、撤销、重做、预览和下载；后端用 FastAPI 接收原图与 mask，并把修复任务转发给本地 IOPaint/LaMa 侧车服务。

## 结构

- `frontend/`: React 单页编辑器，默认运行在 `http://127.0.0.1:5173`
- `backend/`: FastAPI API，默认运行在 `http://127.0.0.1:8000`
- IOPaint 侧车: 单独运行，默认地址 `http://127.0.0.1:8081`

## Docker Compose 启动

默认启动前端和后端：

```bash
docker compose up --build
```

打开 `http://127.0.0.1:5173`。后端在 `http://127.0.0.1:8000`。

同时启动 IOPaint/LaMa CPU 侧车：

```bash
docker compose --profile iopaint up --build
```

Docker Desktop for macOS 的 Linux 容器不能直接使用 Apple MPS，因此 Compose 里的 IOPaint 默认使用 `--device=cpu`。第一次启动会下载模型并缓存到 `iopaint-models` volume，耗时会比较久。

如果要用 Apple MPS，建议在宿主机本地启动 IOPaint，然后用环境变量覆盖后端地址，只把前端和后端放进 Docker：

```bash
docker compose -f compose.yaml -f compose.mps.yaml up -d --build backend frontend
```

此模式下，后端默认访问宿主机的 `http://host.docker.internal:8081`。如果 IOPaint 端点路径或超时需要调整，可以覆盖：

```bash
IOPAINT_INPAINT_PATH=/api/v1/inpaint IOPAINT_TIMEOUT_SECONDS=240 docker compose -f compose.yaml -f compose.mps.yaml up -d --build backend frontend
```

## 本地开发启动

### 1. IOPaint / LaMa 侧车

建议使用单独 Python 环境安装 IOPaint，避免与 FastAPI 开发环境耦合。macOS Apple Silicon 优先尝试 MPS：

```bash
python3.11 -m venv .iopaint-venv
.iopaint-venv/bin/pip install --upgrade pip
.iopaint-venv/bin/pip install iopaint
.iopaint-venv/bin/iopaint start --model=lama --device=mps --host=0.0.0.0 --port=8081
```

如果 MPS 不可用，改用 CPU：

```bash
.iopaint-venv/bin/iopaint start --model=lama --device=cpu --port=8081
```

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
- 不包含智能分割、批量处理、账号、云端存储。
