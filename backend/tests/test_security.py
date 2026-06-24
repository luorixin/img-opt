from fastapi.testclient import TestClient

from img_cleaner_backend.app import create_app
from img_cleaner_backend.security import RedisFixedWindowRateLimiter, build_rate_limiter_from_env


class FakeEngine:
    async def health(self):
        return {"available": True, "engine": "fake"}

    async def inpaint(self, image_bytes, mask_bytes, mask_dilate, mask_blur):
        return b"png"


def test_api_token_is_required_when_configured(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "secret")
    client = TestClient(create_app(FakeEngine()))

    response = client.get("/api/tasks/example")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing or invalid API token."


def test_api_token_accepts_bearer_token_when_configured(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "secret")
    client = TestClient(create_app(FakeEngine()))

    response = client.get("/api/tasks/example", headers={"Authorization": "Bearer secret"})

    assert response.status_code in {200, 202, 404}
    assert response.status_code != 401


def test_inpaint_rate_limit_applies_when_configured(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1")
    client = TestClient(create_app(FakeEngine()))

    first = client.post("/api/inpaint")
    second = client.post("/api/inpaint")

    assert first.status_code == 422
    assert second.status_code == 429
    assert second.json()["detail"] == "Rate limit exceeded."


def test_rate_limiter_uses_redis_when_configured(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "10")
    monkeypatch.setenv("RATE_LIMIT_REDIS_URL", "redis://redis:6379/2")

    limiter = build_rate_limiter_from_env()

    assert isinstance(limiter, RedisFixedWindowRateLimiter)
    assert limiter.limit_per_minute == 10


def test_redis_rate_limiter_does_not_store_raw_api_token():
    """Redis 键只能保存不可逆指纹，不能包含调用方提交的原始凭证。"""

    class FakeRedis:
        def __init__(self):
            self.keys = []

        def incr(self, key):
            self.keys.append(key)
            return 1

        def expire(self, key, seconds):
            assert seconds == 120

    redis_client = FakeRedis()
    limiter = RedisFixedWindowRateLimiter(
        "redis://unused",
        10,
        redis_client=redis_client,
    )

    assert limiter.allow("Bearer top-secret-token") is True
    assert redis_client.keys
    assert "top-secret-token" not in redis_client.keys[0]


def test_upload_size_limit_rejects_large_payloads(monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")
    client = TestClient(create_app(FakeEngine()))

    response = client.post(
        "/api/inpaint",
        files={
            "image": ("image.png", b"larger-than-ten-bytes", "image/png"),
            "mask": ("mask.png", b"also-too-large", "image/png"),
        },
        data={"mask_dilate": "0", "mask_blur": "0"},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Uploaded image or mask exceeds the configured size limit."
