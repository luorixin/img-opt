from __future__ import annotations

import os
from io import BytesIO

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

from img_cleaner_backend.engines import EngineUnavailable, InpaintEngine, IOPaintSidecarEngine

SIDECAR_HINT = (
    "IOPaint sidecar is unavailable. Start it with: "
    "iopaint start --model=lama --device=mps --port=8081 "
    "(or use --device=cpu if MPS is unavailable)."
)


def create_app(engine: InpaintEngine | None = None) -> FastAPI:
    app = FastAPI(title="Image Cleaner Backend")
    app.state.engine = engine or build_engine_from_env()

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
        engine_status = await app.state.engine.health()
        return {"ok": True, "engine": engine_status}

    @app.post("/api/inpaint")
    async def inpaint(
        image: UploadFile = File(...),
        mask: UploadFile = File(...),
        mask_dilate: int = Form(0, ge=0, le=64),
        mask_blur: int = Form(0, ge=0, le=64),
    ):
        image_bytes = await image.read()
        mask_bytes = await mask.read()
        image_size, normalized_image = _read_image(image_bytes)
        mask_size, normalized_mask = _read_image(mask_bytes)

        if image_size != mask_size:
            raise HTTPException(
                status_code=400,
                detail="Image and mask dimensions must match.",
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

    return app


def build_engine_from_env() -> IOPaintSidecarEngine:
    return IOPaintSidecarEngine(
        base_url=os.getenv("IOPAINT_BASE_URL", "http://127.0.0.1:8081"),
        health_path=os.getenv("IOPAINT_HEALTH_PATH", "/docs"),
        inpaint_path=os.getenv("IOPAINT_INPAINT_PATH", "/api/v1/inpaint"),
        timeout=float(os.getenv("IOPAINT_TIMEOUT_SECONDS", "120")),
    )


def _read_image(content: bytes) -> tuple[tuple[int, int], bytes]:
    try:
        with Image.open(BytesIO(content)) as image:
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
