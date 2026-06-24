"""
异步任务队列接口及实现模块。

提供统一的 `TaskQueue` 接口以及禁用状态 (`DisabledTaskQueue`) 
和 Celery 实现 (`CeleryTaskQueue`)，以便在同步执行与异步执行之间灵活切换。
"""
from __future__ import annotations

import base64
import os
from typing import Protocol


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

    def get_status(self, task_id: str) -> dict:
        raise NotImplementedError

    def get_result(self, task_id: str) -> bytes | None:
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

    def get_status(self, task_id: str) -> dict:
        return {"task_id": task_id, "state": "DISABLED", "status": "disabled"}

    def get_result(self, task_id: str) -> bytes | None:
        return None


class CeleryTaskQueue:
    """
    基于 Celery 的任务队列实现。
    通过调用底层的 Celery 任务延迟执行 (delay) 将请求推入异步队列。
    """
    enabled = True

    def __init__(self):
        from img_cleaner_backend.celery_app import celery_app
        from img_cleaner_backend.tasks import inpaint_task, prompt_inpaint_task

        self.celery_app = celery_app
        self.inpaint_task = inpaint_task
        self.prompt_inpaint_task = prompt_inpaint_task

    def enqueue_inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> str:
        task = self.inpaint_task.delay(
            encode_bytes(image_bytes),
            encode_bytes(mask_bytes),
            mask_dilate,
            mask_blur,
        )
        return task.id

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
        task = self.prompt_inpaint_task.delay(
            encode_bytes(image_bytes),
            encode_bytes(mask_bytes),
            prompt,
            negative_prompt,
            strength,
            steps,
            guidance_scale,
            seed,
        )
        return task.id

    def get_status(self, task_id: str) -> dict:
        result = self.celery_app.AsyncResult(task_id)
        state = result.state
        payload = {
            "task_id": task_id,
            "state": state,
            "status": celery_state_to_status(state),
        }
        if state == "SUCCESS":
            payload["result_url"] = f"/api/tasks/{task_id}/result"
        elif state == "FAILURE":
            payload["error"] = str(result.result)
        return payload

    def get_result(self, task_id: str) -> bytes | None:
        result = self.celery_app.AsyncResult(task_id)
        if result.state != "SUCCESS":
            return None
        payload = result.result
        if not isinstance(payload, dict) or "image" not in payload:
            raise RuntimeError("Task completed without an image result.")
        return decode_bytes(payload["image"])


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
    }.get(state, state.lower())
