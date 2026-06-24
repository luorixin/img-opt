from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from img_cleaner_backend.app import create_app


def png_bytes(size=(8, 8), color=(255, 255, 255, 255)):
    image = Image.new("RGBA", size, color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def upload_tuple(name, content):
    return (name, BytesIO(content), "image/png")


class FakeEngine:
    async def health(self):
        return {"available": True, "engine": "fake"}

    async def inpaint(self, image_bytes, mask_bytes, mask_dilate, mask_blur):
        return b"unused"


class FakeTaskQueue:
    enabled = True

    def __init__(self):
        self.calls = []
        self.statuses = {}
        self.results = {}

    def enqueue_inpaint(self, image_bytes, mask_bytes, mask_dilate, mask_blur):
        self.calls.append(
            {
                "image_bytes": image_bytes,
                "mask_bytes": mask_bytes,
                "mask_dilate": mask_dilate,
                "mask_blur": mask_blur,
            }
        )
        return "task-1"

    def enqueue_prompt_inpaint(
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
                "operation": "prompt_inpaint",
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "strength": strength,
                "steps": steps,
                "guidance_scale": guidance_scale,
                "seed": seed,
            }
        )
        return "task-prompt-1"

    def get_status(self, task_id):
        return self.statuses.get(task_id, {"task_id": task_id, "state": "PENDING", "status": "pending"})

    def get_result(self, task_id):
        return self.results.get(task_id)


def test_inpaint_enqueues_task_when_queue_is_enabled():
    queue = FakeTaskQueue()
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.post(
        "/api/inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8))),
        },
        data={"mask_dilate": "3", "mask_blur": "2"},
    )

    assert response.status_code == 202
    assert response.json() == {
        "task_id": "task-1",
        "status": "queued",
        "status_url": "/api/tasks/task-1",
        "result_url": "/api/tasks/task-1/result",
    }
    assert queue.calls[0]["mask_dilate"] == 3
    assert queue.calls[0]["mask_blur"] == 2


def test_task_status_returns_queue_status_payload():
    queue = FakeTaskQueue()
    queue.statuses["task-1"] = {
        "task_id": "task-1",
        "state": "STARTED",
        "status": "running",
    }
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.get("/api/tasks/task-1")

    assert response.status_code == 200
    assert response.json() == {
        "task_id": "task-1",
        "state": "STARTED",
        "status": "running",
    }


def test_task_result_returns_png_when_task_succeeded():
    queue = FakeTaskQueue()
    queue.results["task-1"] = b"png-result"
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.get("/api/tasks/task-1/result")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == b"png-result"


def test_task_result_returns_202_when_pending():
    queue = FakeTaskQueue()
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.get("/api/tasks/task-1/result")

    assert response.status_code == 202
    assert response.json() == {"task_id": "task-1", "status": "pending"}


def test_prompt_inpaint_enqueues_diffusion_task():
    queue = FakeTaskQueue()
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.post(
        "/api/prompt-inpaint",
        files={
            "image": upload_tuple("image.png", png_bytes(size=(8, 8))),
            "mask": upload_tuple("mask.png", png_bytes(size=(8, 8))),
        },
        data={"prompt": "replace with a cat"},
    )

    assert response.status_code == 202
    assert response.json()["task_id"] == "task-prompt-1"
    assert queue.calls[0]["operation"] == "prompt_inpaint"
    assert queue.calls[0]["prompt"] == "replace with a cat"
