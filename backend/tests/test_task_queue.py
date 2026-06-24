from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from img_cleaner_backend.app import create_app
from img_cleaner_backend.task_queue import CeleryTaskQueue


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
        self.cancelled = []

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

    def cancel(self, task_id):
        self.cancelled.append(task_id)
        return True


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


def test_task_cancel_revokes_queued_work():
    queue = FakeTaskQueue()
    client = TestClient(create_app(FakeEngine(), task_queue=queue))

    response = client.post("/api/tasks/task-1/cancel")

    assert response.status_code == 200
    assert response.json() == {
        "task_id": "task-1",
        "status": "cancelled",
    }
    assert queue.cancelled == ["task-1"]


def test_celery_queue_stores_large_payloads_as_files(tmp_path):
    class FakeStorage:
        def __init__(self):
            self.deleted = []

        def create_input(self, image_bytes, mask_bytes, input_id=None):
            assert image_bytes == b"image-bytes"
            assert mask_bytes == b"mask-bytes"

            class StoredInput:
                pass

            stored = StoredInput()
            stored.input_id = input_id
            return stored

        def delete_input(self, input_id):
            self.deleted.append(input_id)

    class FakeTask:
        def __init__(self):
            self.calls = []

        def apply_async(self, args, task_id):
            self.calls.append((tuple(args), task_id))

            class Result:
                id = task_id

            return Result()

    storage = FakeStorage()
    queue = object.__new__(CeleryTaskQueue)
    queue.storage = storage
    queue.inpaint_task = FakeTask()

    task_id = CeleryTaskQueue.enqueue_inpaint(queue, b"image-bytes", b"mask-bytes", 3, 2)

    assert task_id
    assert queue.inpaint_task.calls == [((task_id, 3, 2), task_id)]
    assert storage.deleted == []


def test_celery_queue_refuses_to_cancel_unknown_pending_task():
    """Celery 的 PENDING 也表示未知任务，不能无条件返回取消成功。"""

    class FakeResult:
        state = "PENDING"

    class FakeControl:
        def __init__(self):
            self.calls = []

        def revoke(self, *args, **kwargs):
            self.calls.append((args, kwargs))

    class FakeCelery:
        def __init__(self):
            self.control = FakeControl()

        def AsyncResult(self, task_id):
            return FakeResult()

    class FakeStorage:
        def input_exists(self, task_id):
            return False

        def is_cancelled(self, task_id):
            return False

    queue = object.__new__(CeleryTaskQueue)
    queue.celery_app = FakeCelery()
    queue.storage = FakeStorage()

    assert queue.cancel("missing-task") is False
    assert queue.celery_app.control.calls == []


def test_celery_queue_persists_cancelled_status_for_known_task():
    """已知任务取消后应立即返回 REVOKED，而不是等待 Worker 回写状态。"""

    class FakeResult:
        state = "PENDING"
        info = None
        result = None

    class FakeControl:
        def revoke(self, task_id, terminate):
            assert task_id == "task-1"
            assert terminate is False

    class FakeCelery:
        control = FakeControl()

        def AsyncResult(self, task_id):
            return FakeResult()

    class FakeStorage:
        cancelled = False
        deleted = []

        def input_exists(self, task_id):
            return task_id == "task-1"

        def is_cancelled(self, task_id):
            return self.cancelled

        def mark_cancelled(self, task_id):
            self.cancelled = True

        def delete_input(self, task_id):
            self.deleted.append(task_id)

    queue = object.__new__(CeleryTaskQueue)
    queue.celery_app = FakeCelery()
    queue.storage = FakeStorage()

    assert queue.cancel("task-1") is True
    assert queue.get_status("task-1")["status"] == "cancelled"
    assert queue.storage.deleted == ["task-1"]
