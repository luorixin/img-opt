from fastapi.testclient import TestClient

from img_cleaner_backend.app import create_app


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
