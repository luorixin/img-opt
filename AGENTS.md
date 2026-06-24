# Repository Guidelines

## Project Structure & Module Organization
This repository is a local image-cleaning tool with a React/Vite frontend and FastAPI backend. Frontend source lives in `frontend/src/`: UI components are in `components/`, API calls in `api/`, shared image/canvas helpers in `utils/`, app types in `types/`, and styles in `styles/`. Frontend tests are colocated as `*.test.ts`. Backend source lives in `backend/src/img_cleaner_backend/`, with tests in `backend/tests/`. Docker configuration is in `compose.yaml`, `compose.mps.yaml`, and `docker/iopaint/`.

## Build, Test, and Development Commands
- `docker compose up --build`: build and run frontend and backend.
- `docker compose --profile iopaint up --build`: also run the CPU IOPaint sidecar.
- `cd frontend && npm run dev`: start Vite on `127.0.0.1:5173`.
- `cd frontend && npm test`: run Vitest frontend tests.
- `cd frontend && npm run build`: type-check and build the frontend.
- `.venv/bin/python -m pytest backend/tests -q`: run backend pytest tests.
- `IOPAINT_BASE_URL=http://127.0.0.1:8081 .venv/bin/python -m img_cleaner_backend`: run the backend locally.

## Coding Style & Naming Conventions
Use TypeScript with React function components and hooks. Prefer explicit domain names such as `cropRects`, `maskDilate`, and `imageToTransparentBackgroundBlob`. Keep reusable canvas/image logic in `frontend/src/utils/`, not inside components. Python backend code should stay small, typed where useful, and centered around FastAPI routes plus engine adapters. Use two-space indentation for TypeScript and four-space indentation for Python.

## Testing Guidelines
Use Vitest for frontend helpers and pytest for backend API/engine behavior. Name frontend tests `*.test.ts` next to the module under test, and backend tests `test_*.py`. Add or update tests for mask logic, crop/export helpers, API validation, and sidecar error handling before changing behavior.

## Commit & Pull Request Guidelines
The current history has no detailed convention beyond `first commit`. Use short imperative commit subjects, for example `Add multi-region crop downloads`. PRs should include a brief summary, test commands run, linked issues if any, and screenshots or screen recordings for UI changes.

## Security & Configuration Tips
Do not commit `.env`, virtual environments, `node_modules/`, `dist/`, caches, or model data. Keep IOPaint endpoint settings configurable through environment variables such as `IOPAINT_BASE_URL`, `IOPAINT_INPAINT_PATH`, and `IOPAINT_TIMEOUT_SECONDS`.

不要自动构建Docker镜像。

需求完成写好更新文档，包括新增功能、修复问题、性能优化等。放入 `docs/` 目录。

代码需要有详细的中文注释，包括函数、类、模块等。