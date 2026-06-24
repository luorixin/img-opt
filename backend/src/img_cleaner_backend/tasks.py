"""
Celery 异步任务定义模块。

该模块定义了所有需要通过 Celery 队列异步执行的后台处理任务，
包括基础重绘和基于提示词的重绘。
"""
from __future__ import annotations

import asyncio

from img_cleaner_backend.celery_app import celery_app
from img_cleaner_backend.engines import build_engine_from_env, build_prompt_engine_from_env
from img_cleaner_backend.task_storage import build_task_file_storage_from_env


@celery_app.task(bind=True, name="img_cleaner_backend.inpaint")
def inpaint_task(
    self,
    input_id: str,
    mask_dilate: int,
    mask_blur: int,
) -> dict:
    """
    执行基础 Inpaint 图像修复的异步任务。

    参数:
        input_id (str): 文件任务存储中的输入引用。
        mask_dilate (int): 蒙版膨胀半径。
        mask_blur (int): 蒙版模糊半径。

    返回:
        dict: 包含处理后图像文件路径及 content_type 的字典。
    """
    self.update_state(
        state="STARTED",
        meta={"status": "running", "progress": 5, "message": "Loading input"},
    )
    storage = build_task_file_storage_from_env()
    storage.mark_active(input_id)
    try:
        image_bytes, mask_bytes = storage.read_input(input_id)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 20, "message": "Running inpaint"},
        )
        engine = build_engine_from_env()
        result = asyncio.run(
            engine.inpaint(
                image_bytes,
                mask_bytes,
                mask_dilate,
                mask_blur,
            )
        )
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 95, "message": "Saving result"},
        )
        return {"content_type": "image/png", "image_path": storage.write_result(self.request.id, result)}
    finally:
        storage.delete_input(input_id)


@celery_app.task(bind=True, name="img_cleaner_backend.prompt_inpaint")
def prompt_inpaint_task(
    self,
    input_id: str,
    prompt: str,
    negative_prompt: str,
    strength: float,
    steps: int,
    guidance_scale: float,
    seed: int,
) -> dict:
    """
    执行基于提示词的 Inpaint 图像修复异步任务。

    参数:
        input_id (str): 文件任务存储中的输入引用。
        prompt (str): 正向提示词。
        negative_prompt (str): 反向提示词。
        strength (float): 重绘强度 (0.0 - 1.0)。
        steps (int): 扩散模型推理步数。
        guidance_scale (float): 提示词引导系数 (CFG Scale)。
        seed (int): 随机种子，-1 表示随机。

    返回:
        dict: 包含处理后图像文件路径及 content_type 的字典。
    """
    self.update_state(
        state="STARTED",
        meta={"status": "running", "progress": 5, "message": "Loading input"},
    )
    storage = build_task_file_storage_from_env()
    storage.mark_active(input_id)
    try:
        image_bytes, mask_bytes = storage.read_input(input_id)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 20, "message": "Running prompt inpaint"},
        )
        engine = build_prompt_engine_from_env()
        result = asyncio.run(
            engine.inpaint(
                image_bytes,
                mask_bytes,
                prompt,
                negative_prompt,
                strength,
                steps,
                guidance_scale,
                seed,
            )
        )
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 95, "message": "Saving result"},
        )
        return {"content_type": "image/png", "image_path": storage.write_result(self.request.id, result)}
    finally:
        storage.delete_input(input_id)


@celery_app.task(bind=True, name="img_cleaner_backend.remove_background")
def remove_background_task(
    self,
    input_id: str,
) -> dict:
    """
    执行 AI 背景分割（去除背景）的异步任务。
    """
    self.update_state(
        state="STARTED",
        meta={"status": "running", "progress": 5, "message": "Loading input"},
    )
    storage = build_task_file_storage_from_env()
    storage.mark_active(input_id)
    try:
        image_bytes, _ = storage.read_input(input_id)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 30, "message": "Removing background"},
        )
        from img_cleaner_backend.ai_engines import remove_background
        result = remove_background(image_bytes)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 90, "message": "Saving result"},
        )
        return {"content_type": "image/png", "image_path": storage.write_result(self.request.id, result)}
    finally:
        storage.delete_input(input_id)


@celery_app.task(bind=True, name="img_cleaner_backend.upscale")
def upscale_task(
    self,
    input_id: str,
    upscale_factor: int,
    crop: str | None,
) -> dict:
    """
    执行 AI 超分和裁剪的异步任务。
    """
    self.update_state(
        state="STARTED",
        meta={"status": "running", "progress": 5, "message": "Loading input"},
    )
    storage = build_task_file_storage_from_env()
    storage.mark_active(input_id)
    try:
        image_bytes, _ = storage.read_input(input_id)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 30, "message": "Running upscale"},
        )
        from img_cleaner_backend.ai_engines import run_upscale
        result = run_upscale(image_bytes, upscale_factor, crop)
        self.update_state(
            state="STARTED",
            meta={"status": "running", "progress": 90, "message": "Saving result"},
        )
        return {"content_type": "image/png", "image_path": storage.write_result(self.request.id, result)}
    finally:
        storage.delete_input(input_id)
