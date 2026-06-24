"""
异步任务队列接口及实现模块。

提供统一的 `TaskQueue` 接口以及禁用状态 (`DisabledTaskQueue`) 
和 Celery 实现 (`CeleryTaskQueue`)，以便在同步执行与异步执行之间灵活切换。
"""
from __future__ import annotations

import base64
import os
import uuid
from typing import Protocol

from img_cleaner_backend.task_storage import TaskFileStorage, build_task_file_storage_from_env


class TaskQueue(Protocol):
    """任务队列协议接口，定义了队列的核心行为。"""
    enabled: bool

    def enqueue_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> str:
        raise NotImplementedError

    def enqueue_prompt_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float,
        steps: int,
        guidance_scale: float,
        seed: int,
    ) -> str:
        raise NotImplementedError

    def enqueue_remove_background(self, image_bytes: bytes) -> str:
        raise NotImplementedError

    def enqueue_upscale(self, image_bytes: bytes, upscale_factor: int, crop: str | None) -> str:
        raise NotImplementedError

    def get_status(self, task_id: str) -> dict:
        raise NotImplementedError

    def get_result(self, task_id: str) -> bytes | None:
        raise NotImplementedError

    def cancel(self, task_id: str) -> bool:
        raise NotImplementedError


class DisabledTaskQueue:
    """
    禁用的任务队列实现。
    当且仅当未开启任务队列时使用，调用 enqueue 方法将抛出 RuntimeError。
    """
    enabled = False

    def enqueue_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> str:
        raise RuntimeError("Task queue is disabled.")

    def enqueue_prompt_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float,
        steps: int,
        guidance_scale: float,
        seed: int,
    ) -> str:
        raise RuntimeError("Task queue is disabled.")

    def enqueue_remove_background(self, image_bytes: bytes) -> str:
        raise RuntimeError("Task queue is disabled.")

    def enqueue_upscale(self, image_bytes: bytes, upscale_factor: int, crop: str | None) -> str:
        raise RuntimeError("Task queue is disabled.")

    def get_status(self, task_id: str) -> dict:
        return {"task_id": task_id, "state": "DISABLED", "status": "disabled"}

    def get_result(self, task_id: str) -> bytes | None:
        return None

    def cancel(self, task_id: str) -> bool:
        return False


class CeleryTaskQueue:
    """
    基于 Celery 的任务队列实现。
    通过调用底层的 Celery 任务延迟执行 (delay) 将请求推入异步队列。
    """
    enabled = True

    def __init__(self, storage: TaskFileStorage | None = None):
        from img_cleaner_backend.celery_app import celery_app
        from img_cleaner_backend.tasks import (
            inpaint_task,
            prompt_inpaint_task,
            remove_background_task,
            upscale_task,
        )

        self.celery_app = celery_app
        self.inpaint_task = inpaint_task
        self.prompt_inpaint_task = prompt_inpaint_task
        self.remove_background_task = remove_background_task
        self.upscale_task = upscale_task
        self.storage = storage or build_task_file_storage_from_env()

    def enqueue_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> str:
        return self._enqueue_with_files(
            self.inpaint_task,
            image_bytes,
            mask_bytes,
            mask_dilate,
            mask_blur,
        )

    def enqueue_prompt_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float,
        steps: int,
        guidance_scale: float,
        seed: int,
    ) -> str:
        return self._enqueue_with_files(
            self.prompt_inpaint_task,
            image_bytes,
            mask_bytes,
            prompt,
            negative_prompt,
            strength,
            steps,
            guidance_scale,
            seed,
        )

    def enqueue_remove_background(self, image_bytes: bytes) -> str:
        return self._enqueue_with_files(self.remove_background_task, image_bytes, b"")

    def enqueue_upscale(self, image_bytes: bytes, upscale_factor: int, crop: str | None) -> str:
        return self._enqueue_with_files(
            self.upscale_task,
            image_bytes,
            b"",
            upscale_factor,
            crop,
        )

    def _enqueue_with_files(self, task, image_bytes: bytes, mask_bytes: bytes, *arguments) -> str:
        """使用同一个 ID 保存文件和提交 Celery，便于取消与垃圾回收定位。"""
        task_id = uuid.uuid4().hex
        self.storage.create_input(image_bytes, mask_bytes, input_id=task_id)
        try:
            result = task.apply_async(args=[task_id, *arguments], task_id=task_id)
        except Exception:
            self.storage.delete_input(task_id)
            raise
        return result.id


    def get_status(self, task_id: str) -> dict:
        if self.storage.is_cancelled(task_id):
            return {"task_id": task_id, "state": "REVOKED", "status": "cancelled"}
        result = self.celery_app.AsyncResult(task_id)
        state = result.state
        payload = {
            "task_id": task_id,
            "state": state,
            "status": celery_state_to_status(state),
        }
        if isinstance(result.info, dict):
            if "progress" in result.info:
                payload["progress"] = result.info["progress"]
            if "message" in result.info:
                payload["message"] = result.info["message"]
        if state == "SUCCESS":
            payload["result_url"] = f"/api/tasks/{task_id}/result"
        elif state == "FAILURE":
            payload["error"] = str(result.result)
        return payload

    def get_result(self, task_id: str) -> bytes | None:
        if self.storage.is_cancelled(task_id):
            return None
        result = self.celery_app.AsyncResult(task_id)
        if result.state != "SUCCESS":
            return None
        payload = result.result
        if not isinstance(payload, dict):
            raise RuntimeError("Task completed without an image result.")
        if "image_path" in payload:
            return self.storage.read_result(payload["image_path"])
        if "image" not in payload:
            raise RuntimeError("Task completed without an image result.")
        return decode_bytes(payload["image"])

    def cancel(self, task_id: str) -> bool:
        result = self.celery_app.AsyncResult(task_id)
        state = result.state
        if self.storage.is_cancelled(task_id) or state in {"SUCCESS", "FAILURE", "REVOKED"}:
            return False
        if state == "PENDING" and not self.storage.input_exists(task_id):
            return False

        self.celery_app.control.revoke(task_id, terminate=state == "STARTED")
        self.storage.mark_cancelled(task_id)
        self.storage.delete_input(task_id)
        return True


def build_task_queue_from_env() -> TaskQueue:
    """
    从环境变量初始化任务队列。
    根据 TASK_QUEUE_ENABLED 决定是使用 CeleryTaskQueue 还是 DisabledTaskQueue。

    返回:
        TaskQueue: 具体的任务队列实现实例。
    """
    enabled = os.getenv("TASK_QUEUE_ENABLED", "false").strip().lower()
    if enabled in {"1", "true", "yes", "on"}:
        return CeleryTaskQueue()
    return DisabledTaskQueue()


def encode_bytes(content: bytes) -> str:
    """将二进制数据编码为 Base64 ASCII 字符串。"""
    return base64.b64encode(content).decode("ascii")


def decode_bytes(content: str) -> bytes:
    """将 Base64 ASCII 字符串解码为二进制数据。"""
    return base64.b64decode(content.encode("ascii"))


def celery_state_to_status(state: str) -> str:
    """
    将 Celery 内部状态码映射为 API 友好的前端状态。

    参数:
        state (str): Celery 任务状态（如 PENDING, STARTED）。

    返回:
        str: 友好的状态字符串（如 pending, running）。
    """
    return {
        "PENDING": "pending",
        "RECEIVED": "queued",
        "STARTED": "running",
        "RETRY": "retrying",
        "SUCCESS": "completed",
        "FAILURE": "failed",
        "REVOKED": "cancelled",
    }.get(state, state.lower())
