import asyncio
import base64
import json
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from img_cleaner_backend.app import create_app
from img_cleaner_backend.engines import EngineUnavailable, IOPaintSidecarEngine, InpaintEngine


def png_bytes(size=(8, 8), color=(255, 255, 255, 255)):
    image = Image.new("RGBA", size, color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class FakeEngine(InpaintEngine):
    def __init__(self, result=None, available=True):
        self.result = result or png_bytes(color=(10, 20, 30, 255))
        self.available = available
        self.calls = []

    async def health(self):
        return {"available": self.available, "engine": "fake"}

    async def inpaint(self, image_bytes, mask_bytes, mask_dilate, mask_blur):
        self.calls.append(
            {
                "image_bytes": image_bytes,
                "mask_bytes": mask_bytes,
                "mask_dilate": mask_dilate,
                "mask_blur": mask_blur,
            }
        )
        if not self.available:
            raise EngineUnavailable("fake sidecar unavailable")
        return self.result

    async def segment(self, image_bytes, x, y, label):
        self.calls.append(
            {
                "operation": "segment",
                "image_bytes": image_bytes,
                "x": x,
                "y": y,
                "label": label,
            }
        )
        if not self.available:
            raise EngineUnavailable("fake sidecar unavailable")
        return self.result


class FakePromptEngine:
    def __init__(self, result=None, available=True):
        self.result = result or png_bytes(color=(40, 50, 60, 255))
        self.available = available
        self.calls = []

    async def health(self):
        return {"available": self.available, "engine": "fake-prompt"}

    async def inpaint(
        self,
        image_bytes,
        mask_bytes,
        prompt,
        negative_prompt,
        strength,
        steps,
        guidance_scale,
        seed,
    ):
        self.calls.append(
            {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "strength": strength,
                "steps": steps,
                "guidance_scale": guidance_scale,
                "seed": seed,
            }
        )
        if not self.available:
            raise EngineUnavailable("fake prompt sidecar unavailable")
        return self.result


def upload_tuple(name, content):
    return (name, BytesIO(content), "image/png")


def test_health_reports_backend_and_engine_status():
    client = TestClient(
        create_app(
            FakeEngine(available=True),
            prompt_engine=FakePromptEngine(available=True),
        )
    )

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "engine": {"available": True, "engine": "fake"},
        "prompt_engine": {"available": True, "engine": "fake-prompt"},
        "task_queue": {"enabled": False},
        "upscaler": {"loaded": False},
    }


def test_backend_lifespan_does_not_preload_ai_model_by_default(monkeypatch):
    """默认情况下 API 容器不应预载 AI 模型，避免与 Worker 重复常驻推理内存。"""
    from img_cleaner_backend import ai_engines

    calls = []
    monkeypatch.delenv("AI_PRELOAD_MODELS", raising=False)
    monkeypatch.delenv("BACKEND_AI_PRELOAD_MODELS", raising=False)
    monkeypatch.setattr(ai_engines, "_session", None)
    monkeypatch.setattr(ai_engines, "_get_onnx_session", lambda: calls.append("loaded"))

    with TestClient(create_app(FakeEngine())) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert calls == []


def test_backend_lifespan_preloads_ai_model_when_enabled(monkeypatch):
    """需要低首帧延迟时，可通过环境变量显式开启 API 容器预热。"""
    from img_cleaner_backend import ai_engines

    calls = []

    def fake_get_onnx_session():
        calls.append("loaded")
        return object()

    monkeypatch.setenv("BACKEND_AI_PRELOAD_MODELS", "true")
    monkeypatch.setattr(ai_engines, "_session", None)
    monkeypatch.setattr(ai_engines, "_get_onnx_session", fake_get_onnx_session)

    with TestClient(create_app(FakeEngine())) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert calls == ["loaded"]


def test_backend_specific_preload_flag_overrides_legacy_shared_flag(monkeypatch):
    """API 专用开关应优先于旧的共享开关，避免只想预热 Worker 时误预热 API。"""
    from img_cleaner_backend import ai_engines

    calls = []
    monkeypatch.setenv("AI_PRELOAD_MODELS", "true")
    monkeypatch.setenv("BACKEND_AI_PRELOAD_MODELS", "false")
    monkeypatch.setattr(ai_engines, "_session", None)
    monkeypatch.setattr(ai_engines, "_get_onnx_session", lambda: calls.append("loaded"))

    with TestClient(create_app(FakeEngine())) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert calls == []


def test_inpaint_requires_image_and_mask_files():
    client = TestClient(create_app(FakeEngine()))

    response = client.post("/api/inpaint", data={"mask_dilate": "0", "mask_blur": "0"})

    assert response.status_code == 422


def test_inpaint_rejects_mask_with_different_dimensions():
    engine = FakeEngine()
    client = TestClient(create_app(engine))

    response = client.post(
        "/api/inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(4, 4))),
        },
        data={"mask_dilate": "0", "mask_blur": "0"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Image and mask dimensions must match."
    assert engine.calls == []


def test_inpaint_returns_png_bytes_from_engine():
    result = png_bytes(color=(3, 4, 5, 255))
    engine = FakeEngine(result=result)
    client = TestClient(create_app(engine))

    response = client.post(
        "/api/inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8), color=(0, 0, 0, 255))),
        },
        data={"mask_dilate": "3", "mask_blur": "2"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == result
    assert engine.calls[0]["mask_dilate"] == 3
    assert engine.calls[0]["mask_blur"] == 2


def test_inpaint_returns_503_when_engine_is_unavailable():
    client = TestClient(create_app(FakeEngine(available=False)))

    response = client.post(
        "/api/inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8))),
        },
        data={"mask_dilate": "0", "mask_blur": "0"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "ENGINE_UNAVAILABLE",
        "message": "fake sidecar unavailable",
        "hint": "IOPaint sidecar is unavailable. Start it with: iopaint start --model=lama --device=mps --port=8081 (or use --device=cpu if MPS is unavailable).",
    }


def test_inpaint_rejects_invalid_image_uploads():
    client = TestClient(create_app(FakeEngine()))

    response = client.post(
        "/api/inpaint",
        files={
            "image": upload_tuple("image.png", b"not an image"),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8))),
        },
        data={"mask_dilate": "0", "mask_blur": "0"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded image or mask is not a valid image."


def test_segment_returns_png_mask_from_engine():
    result = png_bytes(color=(255, 203, 0, 186))
    engine = FakeEngine(result=result)
    client = TestClient(create_app(engine))

    response = client.post(
        "/api/segment",
        files={"image": upload_tuple("image.png", png_bytes(size=(8, 8)))},
        data={"x": "3", "y": "4", "label": "1"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == result
    assert engine.calls[0]["operation"] == "segment"
    assert engine.calls[0]["x"] == 3
    assert engine.calls[0]["y"] == 4
    assert engine.calls[0]["label"] == 1


def test_segment_rejects_points_outside_the_image():
    engine = FakeEngine()
    client = TestClient(create_app(engine))

    response = client.post(
        "/api/segment",
        files={"image": upload_tuple("image.png", png_bytes(size=(8, 8)))},
        data={"x": "8", "y": "4", "label": "1"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Segmentation point must be inside the image."
    assert engine.calls == []


def test_prompt_inpaint_returns_png_from_prompt_engine():
    result = png_bytes(color=(70, 80, 90, 255))
    prompt_engine = FakePromptEngine(result=result)
    client = TestClient(create_app(FakeEngine(), prompt_engine=prompt_engine))

    response = client.post(
        "/api/prompt-inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8))),
        },
        data={
            "prompt": "an orange cat",
            "negative_prompt": "blurry",
            "strength": "0.8",
            "steps": "24",
            "guidance_scale": "6.5",
            "seed": "42",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == result
    assert prompt_engine.calls == [
        {
            "prompt": "an orange cat",
            "negative_prompt": "blurry",
            "strength": 0.8,
            "steps": 24,
            "guidance_scale": 6.5,
            "seed": 42,
        }
    ]


def test_create_app_builds_iopaint_engine_from_environment(monkeypatch):
    monkeypatch.setenv("IOPAINT_BASE_URL", "http://host.docker.internal:8081")
    monkeypatch.setenv("IOPAINT_HEALTH_PATH", "/healthz")
    monkeypatch.setenv("IOPAINT_INPAINT_PATH", "/custom/inpaint")
    monkeypatch.setenv("IOPAINT_SEGMENT_PATH", "/custom/segment")
    monkeypatch.setenv("IOPAINT_SEGMENT_PLUGIN_NAME", "CustomSeg")
    monkeypatch.setenv("IOPAINT_TIMEOUT_SECONDS", "42.5")

    app = create_app()

    engine = app.state.engine
    assert isinstance(engine, IOPaintSidecarEngine)
    assert engine.base_url == "http://host.docker.internal:8081"
    assert engine.health_path == "/healthz"
    assert engine.inpaint_path == "/custom/inpaint"
    assert engine.segment_path == "/custom/segment"
    assert engine.segment_plugin_name == "CustomSeg"
    assert engine.timeout == 42.5


def test_iopaint_segment_posts_plugin_json_payload():
    captured = {}

    def handler(request: httpx.Request):
        captured["url"] = str(request.url)
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, content=b"mask-png", request=request)

    engine = IOPaintSidecarEngine(
        base_url="http://iopaint.test",
        segment_path="/custom/segment",
        segment_plugin_name="InteractiveSeg",
        transport=httpx.MockTransport(handler),
    )

    result = asyncio.run(engine.segment(b"image-png", 12, 34, 1))

    assert result == b"mask-png"
    assert captured["url"] == "http://iopaint.test/custom/segment"
    assert captured["payload"] == {
        "name": "InteractiveSeg",
        "image": base64.b64encode(b"image-png").decode("ascii"),
        "clicks": [[12, 34, 1]],
    }


def test_remove_background_returns_png():
    from unittest.mock import patch
    with patch("img_cleaner_backend.ai_engines.remove_background") as mock_remove:
        mock_remove.return_value = b"fake-no-bg-png"
        client = TestClient(create_app(FakeEngine()))
        response = client.post(
            "/api/remove-background",
            files={"image": upload_tuple("image.png", png_bytes())},
        )
        assert response.status_code == 200
        assert response.content == b"fake-no-bg-png"
        mock_remove.assert_called_once()


def test_upscale_returns_png():
    from unittest.mock import patch
    with patch("img_cleaner_backend.ai_engines.run_upscale") as mock_run:
        mock_run.return_value = b"fake-upscaled-png"
        client = TestClient(create_app(FakeEngine()))
        response = client.post(
            "/api/upscale",
            files={"image": upload_tuple("image.png", png_bytes())},
            data={"upscale_factor": "3", "crop": "1,2,3,4"},
        )
        assert response.status_code == 200
        assert response.content == b"fake-upscaled-png"
        mock_run.assert_called_once_with(mock_run.call_args[0][0], 3, "1,2,3,4", format="PNG")


def test_upscale_rejects_crop_outside_image_bounds():
    """裁剪框必须完整位于原图内部，避免构造超大空白图导致内存耗尽。"""
    from unittest.mock import patch

    with patch("img_cleaner_backend.ai_engines.run_upscale", return_value=b"unused"):
        client = TestClient(create_app(FakeEngine()))
        response = client.post(
            "/api/upscale",
            files={"image": upload_tuple("image.png", png_bytes(size=(8, 8)))},
            data={"upscale_factor": "2", "crop": "0,0,999999,999999"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Crop rectangle must be inside the image."


def test_upscale_rejects_output_over_pixel_limit(monkeypatch):
    """限制放大后的总像素数，而不仅是上传文件的压缩字节数。"""
    from unittest.mock import patch

    monkeypatch.setenv("MAX_OUTPUT_PIXELS", "100")
    with patch("img_cleaner_backend.ai_engines.run_upscale", return_value=b"unused"):
        client = TestClient(create_app(FakeEngine()))
        response = client.post(
            "/api/upscale",
            files={"image": upload_tuple("image.png", png_bytes(size=(8, 8)))},
            data={"upscale_factor": "2"},
        )

    assert response.status_code == 413
    assert response.json()["detail"] == "Requested output image exceeds the configured pixel limit."


def test_remove_background_runs_sync_engine_in_threadpool(monkeypatch):
    """队列关闭时也不能在异步路由中直接阻塞事件循环。"""
    calls = []

    async def fake_run_in_threadpool(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return b"thread-result"

    from unittest.mock import patch

    monkeypatch.setattr("img_cleaner_backend.app.run_in_threadpool", fake_run_in_threadpool, raising=False)
    with patch("img_cleaner_backend.ai_engines.remove_background", return_value=b"direct-result"):
        client = TestClient(create_app(FakeEngine()))
        response = client.post(
            "/api/remove-background",
            files={"image": upload_tuple("image.png", png_bytes(size=(8, 8)))},
        )

    assert response.status_code == 200
    assert response.content == b"thread-result"
    assert len(calls) == 1
