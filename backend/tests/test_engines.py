import httpx
import pytest

from img_cleaner_backend.engines import EngineUnavailable, IOPaintSidecarEngine


@pytest.mark.anyio
async def test_health_uses_configured_health_path():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, text="ok")

    engine = IOPaintSidecarEngine(
        base_url="http://iopaint.local/",
        health_path="/custom/health",
        transport=httpx.MockTransport(handler),
    )

    status = await engine.health()

    assert status == {
        "available": True,
        "engine": "iopaint-sidecar",
        "base_url": "http://iopaint.local",
        "health_path": "/custom/health",
        "inpaint_path": "/api/v1/inpaint",
        "timeout_seconds": 120.0,
    }
    assert str(requests[0].url) == "http://iopaint.local/custom/health"


@pytest.mark.anyio
async def test_inpaint_uses_configured_path_and_timeout():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=b"png-result", headers={"content-type": "image/png"})

    engine = IOPaintSidecarEngine(
        base_url="http://iopaint.local",
        inpaint_path="/custom/inpaint",
        timeout=9.5,
        transport=httpx.MockTransport(handler),
    )

    result = await engine.inpaint(b"image", b"mask", 4, 2)

    assert result == b"png-result"
    assert str(requests[0].url) == "http://iopaint.local/custom/inpaint"
    assert requests[0].content


@pytest.mark.anyio
async def test_inpaint_unavailable_error_includes_status_url_and_response_summary():
    def handler(request):
        return httpx.Response(503, text="sidecar exploded " * 40)

    engine = IOPaintSidecarEngine(
        base_url="http://iopaint.local",
        inpaint_path="/broken",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EngineUnavailable) as exc_info:
        await engine.inpaint(b"image", b"mask", 0, 0)

    message = str(exc_info.value)
    assert "http://iopaint.local/broken" in message
    assert "status=503" in message
    assert "sidecar exploded" in message
