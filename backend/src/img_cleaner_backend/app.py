"""
FastAPI 应用程序主入口。

负责定义所有的 HTTP 路由、中间件配置、依赖注入（鉴权、限流），
并将请求转发给底层图像处理引擎或异步任务队列。
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from io import BytesIO

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from img_cleaner_backend.engines import (
    EngineUnavailable,
    InpaintEngine,
    PromptInpaintEngine,
    build_engine_from_env,
    build_prompt_engine_from_env,
)
from img_cleaner_backend.security import build_rate_limiter_from_env, check_rate_limit, require_api_token
from img_cleaner_backend.task_queue import TaskQueue, build_task_queue_from_env
from img_cleaner_backend.image_validation import (
    ImageValidationError,
    validate_image_pixels,
    validate_upscale_request,
)
from img_cleaner_backend.runtime_config import env_flag_with_legacy

SIDECAR_HINT = (
    "IOPaint sidecar is unavailable. Start it with: "
    "iopaint start --model=lama --device=mps --port=8081 "
    "(or use --device=cpu if MPS is unavailable)."
)
SAM_HINT = (
    "Start IOPaint with interactive segmentation enabled, for example: "
    "iopaint start --model=lama --device=mps --enable-interactive-seg "
    "--interactive-seg-device=mps --port=8081."
)
PROMPT_HINT = (
    "Start a diffusion-capable IOPaint sidecar, for example on port 8082, "
    "and set IOPAINT_PROMPT_BASE_URL to its address."
)


def create_app(
    engine: InpaintEngine | None = None,
    task_queue: TaskQueue | None = None,
    prompt_engine: PromptInpaintEngine | None = None,
) -> FastAPI:
    """
    创建并配置 FastAPI 应用程序实例。

    参数:
        engine: 基础图像修复引擎，如果为 None 则从环境变量构建。
        task_queue: 异步任务队列，如果为 None 则从环境变量构建。
        prompt_engine: 提示词修复引擎，如果为 None 则从环境变量构建。

    返回:
        FastAPI: 配置好的应用实例。
    """
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # 默认不在 API 容器预载 AI 模型，避免与 Celery Worker 重复常驻同一份推理内存。
        # BACKEND_AI_PRELOAD_MODELS 优先于旧的 AI_PRELOAD_MODELS，可单独控制 API 容器。
        if env_flag_with_legacy("BACKEND_AI_PRELOAD_MODELS", "AI_PRELOAD_MODELS", default=False):
            try:
                from img_cleaner_backend.ai_engines import _get_onnx_session
                await run_in_threadpool(_get_onnx_session)
            except Exception as exc:
                import logging
                logging.getLogger("img_cleaner_backend").warning("AI model pre-loading failed at startup: %s", exc)
        yield

    app = FastAPI(title="Image Cleaner Backend", lifespan=lifespan)
    app.state.engine = engine or build_engine_from_env()
    app.state.prompt_engine = prompt_engine or build_prompt_engine_from_env()
    app.state.task_queue = task_queue or build_task_queue_from_env()
    app.state.rate_limiter = build_rate_limiter_from_env()

    origins = os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins if origin.strip()],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        """
        健康检查接口。
        检查应用程序本身的存活状态，并返回底层引擎、任务队列以及 AI 模型的可用性。
        """
        engine_status = await app.state.engine.health()
        prompt_engine_status = await app.state.prompt_engine.health()

        # 检查 AI 超分 ONNX 推理模型是否已经预载成功
        from img_cleaner_backend import ai_engines
        model_loaded = ai_engines._session is not None

        return {
            "ok": True,
            "engine": engine_status,
            "prompt_engine": prompt_engine_status,
            "task_queue": {"enabled": app.state.task_queue.enabled},
            "upscaler": {"loaded": model_loaded},
        }

    @app.post(
        "/api/inpaint",
        dependencies=[Depends(require_api_token), Depends(check_rate_limit)],
    )
    async def inpaint(
        image: UploadFile = File(...),
        mask: UploadFile = File(...),
        mask_dilate: int = Form(0, ge=0, le=64),
        mask_blur: int = Form(0, ge=0, le=64),
    ):
        """
        处理基础 Inpaint 图像修复请求。
        如果启用了异步任务队列，则将任务入队并返回 202 状态码。
        否则，同步等待处理并直接返回修复后的图像。
        """
        image_bytes = await _read_upload_with_limit(image)
        mask_bytes = await _read_upload_with_limit(mask)
        image_size, normalized_image = _read_image(image_bytes)
        mask_size, normalized_mask = _read_image(mask_bytes)

        if image_size != mask_size:
            raise HTTPException(
                status_code=400,
                detail="Image and mask dimensions must match.",
            )

        if app.state.task_queue.enabled:
            task_id = app.state.task_queue.enqueue_inpaint(
                normalized_image,
                normalized_mask,
                mask_dilate,
                mask_blur,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "task_id": task_id,
                    "status": "queued",
                    "status_url": f"/api/tasks/{task_id}",
                    "result_url": f"/api/tasks/{task_id}/result",
                },
            )

        try:
            result = await app.state.engine.inpaint(
                normalized_image,
                normalized_mask,
                mask_dilate,
                mask_blur,
            )
        except EngineUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "ENGINE_UNAVAILABLE",
                    "message": str(exc),
                    "hint": SIDECAR_HINT,
                },
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "ENGINE_ERROR",
                    "message": str(exc),
                    "hint": "Check the IOPaint runtime API and backend IOPAINT_* environment settings.",
                },
            ) from exc

        return Response(content=result, media_type="image/png")

    @app.post(
        "/api/prompt-inpaint",
        dependencies=[Depends(require_api_token), Depends(check_rate_limit)],
    )
    async def prompt_inpaint(
        image: UploadFile = File(...),
        mask: UploadFile = File(...),
        prompt: str = Form(..., min_length=1, max_length=1000),
        negative_prompt: str = Form("", max_length=1000),
        strength: float = Form(0.85, gt=0.0, le=1.0),
        steps: int = Form(30, ge=1, le=100),
        guidance_scale: float = Form(7.5, ge=1.0, le=30.0),
        seed: int = Form(-1, ge=-1),
    ):
        """
        处理基于提示词的 Inpaint 图像修复请求。
        需要底层引擎支持 Diffusion 模型。
        """
        normalized_prompt = prompt.strip()
        if not normalized_prompt:
            raise HTTPException(status_code=400, detail="Prompt must not be blank.")
        image_size, normalized_image = _read_image(await _read_upload_with_limit(image))
        mask_size, normalized_mask = _read_image(await _read_upload_with_limit(mask))
        if image_size != mask_size:
            raise HTTPException(
                status_code=400,
                detail="Image and mask dimensions must match.",
            )

        if app.state.task_queue.enabled:
            task_id = app.state.task_queue.enqueue_prompt_inpaint(
                normalized_image,
                normalized_mask,
                normalized_prompt,
                negative_prompt.strip(),
                strength,
                steps,
                guidance_scale,
                seed,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "task_id": task_id,
                    "status": "queued",
                    "status_url": f"/api/tasks/{task_id}",
                    "result_url": f"/api/tasks/{task_id}/result",
                },
            )

        try:
            result = await app.state.prompt_engine.inpaint(
                normalized_image,
                normalized_mask,
                normalized_prompt,
                negative_prompt.strip(),
                strength,
                steps,
                guidance_scale,
                seed,
            )
        except EngineUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "PROMPT_ENGINE_UNAVAILABLE",
                    "message": str(exc),
                    "hint": PROMPT_HINT,
                },
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "PROMPT_ENGINE_ERROR",
                    "message": str(exc),
                    "hint": PROMPT_HINT,
                },
            ) from exc

        return Response(content=result, media_type="image/png")

    @app.get("/api/tasks/{task_id}", dependencies=[Depends(require_api_token)])
    async def task_status(task_id: str):
        """查询指定异步任务的当前执行状态。"""
        return app.state.task_queue.get_status(task_id)

    @app.post(
        "/api/segment",
        dependencies=[Depends(require_api_token), Depends(check_rate_limit)],
    )
    async def segment(
        image: UploadFile = File(...),
        x: int = Form(..., ge=0),
        y: int = Form(..., ge=0),
        label: int = Form(1, ge=0, le=1),
    ):
        """
        处理交互式分割（Segment）请求。
        基于指定的坐标点在图像上生成分割蒙版。
        """
        image_size, normalized_image = _read_image(await _read_upload_with_limit(image))
        width, height = image_size
        if x >= width or y >= height:
            raise HTTPException(
                status_code=400,
                detail="Segmentation point must be inside the image.",
            )

        try:
            result = await app.state.engine.segment(normalized_image, x, y, label)
        except EngineUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "SEGMENT_ENGINE_UNAVAILABLE",
                    "message": str(exc),
                    "hint": SAM_HINT,
                },
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "SEGMENT_ENGINE_ERROR",
                    "message": str(exc),
                    "hint": SAM_HINT,
                },
            ) from exc

        return Response(content=result, media_type="image/png")

    @app.post(
        "/api/remove-background",
        dependencies=[Depends(require_api_token), Depends(check_rate_limit)],
    )
    async def remove_background(
        image: UploadFile = File(...),
        format: str = Form("PNG"),
    ):
        """
        AI 背景分割 (去除背景) 接口。
        """
        fmt_upper = format.upper()
        if fmt_upper not in ("PNG", "WEBP"):
            raise HTTPException(
                status_code=400,
                detail="Only PNG and WEBP formats are supported for background removal.",
            )
        image_bytes = await _read_upload_with_limit(image)
        _, normalized_image = _read_image(image_bytes)
        if app.state.task_queue.enabled:
            task_id = app.state.task_queue.enqueue_remove_background(
                normalized_image,
                format=fmt_upper,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "task_id": task_id,
                    "status": "queued",
                    "status_url": f"/api/tasks/{task_id}",
                    "result_url": f"/api/tasks/{task_id}/result",
                },
            )

        try:
            from img_cleaner_backend.ai_engines import remove_background
            result = await run_in_threadpool(remove_background, normalized_image, format=fmt_upper)
            media_type = f"image/{fmt_upper.lower()}"
            return Response(content=result, media_type=media_type)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "REMOVE_BACKGROUND_ERROR",
                    "message": str(exc),
                },
            )

    @app.post(
        "/api/upscale",
        dependencies=[Depends(require_api_token), Depends(check_rate_limit)],
    )
    async def upscale(
        image: UploadFile = File(...),
        upscale_factor: int = Form(2, ge=2, le=4),
        crop: str | None = Form(None),
        format: str = Form("PNG"),
    ):
        """
        AI 超分和裁剪接口。
        """
        fmt_upper = format.upper()
        if fmt_upper not in ("PNG", "WEBP", "JPEG", "JPG"):
            raise HTTPException(
                status_code=400,
                detail="Unsupported output format. Supported: PNG, WEBP, JPEG, JPG.",
            )
        image_bytes = await _read_upload_with_limit(image)
        image_size, normalized_image = _read_image(image_bytes)
        try:
            normalized_crop = validate_upscale_request(image_size, upscale_factor, crop)
        except ImageValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        if app.state.task_queue.enabled:
            task_id = app.state.task_queue.enqueue_upscale(
                normalized_image,
                upscale_factor,
                normalized_crop,
                format=fmt_upper,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "task_id": task_id,
                    "status": "queued",
                    "status_url": f"/api/tasks/{task_id}",
                    "result_url": f"/api/tasks/{task_id}/result",
                },
            )

        try:
            from img_cleaner_backend.ai_engines import run_upscale
            result = await run_in_threadpool(
                run_upscale,
                normalized_image,
                upscale_factor,
                normalized_crop,
                format=fmt_upper,
            )
            fmt_lower = fmt_upper.lower()
            media_type = "image/jpeg" if fmt_lower in ("jpg", "jpeg") else f"image/{fmt_lower}"
            return Response(content=result, media_type=media_type)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "UPSCALE_ERROR",
                    "message": str(exc),
                },
            )

    @app.get("/api/tasks/{task_id}/result", dependencies=[Depends(require_api_token)])
    async def task_result(task_id: str):
        """
        获取异步任务的执行结果。
        如果任务成功完成，返回处理后的图像。
        如果任务还在进行中，返回 202 状态。
        """
        status = app.state.task_queue.get_status(task_id)
        result = app.state.task_queue.get_result(task_id)
        if result is not None:
            # 兼容旧的队列实现返回 bytes；新的队列结果会携带 content_type，
            # 用于 WEBP/JPEG 异步任务保持与同步接口一致的响应类型。
            if isinstance(result, dict):
                return Response(
                    content=result["content"],
                    media_type=result.get("content_type", "image/png"),
                )
            return Response(content=result, media_type="image/png")
        if status.get("status") == "failed":
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "TASK_FAILED",
                    "message": status.get("error", "Task failed."),
                },
            )
        return JSONResponse(
            status_code=202,
            content={"task_id": task_id, "status": status.get("status", "pending")},
        )

    @app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(require_api_token)])
    async def task_cancel(task_id: str):
        cancelled = app.state.task_queue.cancel(task_id)
        if not cancelled:
            raise HTTPException(status_code=404, detail="Task queue is disabled or task cannot be cancelled.")
        return {"task_id": task_id, "status": "cancelled"}

    return app


async def _read_upload_with_limit(upload: UploadFile) -> bytes:
    max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", "0"))
    if max_upload_bytes <= 0:
        return await upload.read()

    chunks = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail="Uploaded image or mask exceeds the configured size limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _read_image(content: bytes) -> tuple[tuple[int, int], bytes]:
    """
    读取并标准化上传的图像。
    将图像转换为 RGBA 格式并重新编码为 PNG 字节流，同时返回图像尺寸。

    参数:
        content (bytes): 原始上传的二进制文件内容。

    返回:
        tuple: ( (宽, 高), 规范化后的 PNG 字节流 )
    """
    try:
        with Image.open(BytesIO(content)) as image:
            try:
                validate_image_pixels(*image.size)
            except ImageValidationError as validation_error:
                raise HTTPException(
                    status_code=validation_error.status_code,
                    detail=str(validation_error),
                ) from validation_error
            normalized = image.convert("RGBA")
            output = BytesIO()
            normalized.save(output, format="PNG")
            return normalized.size, output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image or mask is not a valid image.",
        ) from exc


app = create_app()
