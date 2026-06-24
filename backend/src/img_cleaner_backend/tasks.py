"""
Celery 异步任务定义模块。

该模块定义了所有需要通过 Celery 队列异步执行的后台处理任务，
包括基础重绘和基于提示词的重绘。
"""
from __future__ import annotations

import asyncio

from img_cleaner_backend.celery_app import celery_app
from img_cleaner_backend.engines import build_engine_from_env, build_prompt_engine_from_env
from img_cleaner_backend.task_queue import decode_bytes, encode_bytes


@celery_app.task(bind=True, name="img_cleaner_backend.inpaint")
def inpaint_task(
    self,
    image_b64: str,
    mask_b64: str,
    mask_dilate: int,
    mask_blur: int,
) -> dict:
    """
    执行基础 Inpaint 图像修复的异步任务。

    参数:
        image_b64 (str): Base64 编码的原始图像。
        mask_b64 (str): Base64 编码的蒙版图像。
        mask_dilate (int): 蒙版膨胀半径。
        mask_blur (int): 蒙版模糊半径。

    返回:
        dict: 包含处理后图像数据 (Base64) 及 content_type 的字典。
    """
    self.update_state(state="STARTED", meta={"status": "running"})
    engine = build_engine_from_env()
    result = asyncio.run(
        engine.inpaint(
            decode_bytes(image_b64),
            decode_bytes(mask_b64),
            mask_dilate,
            mask_blur,
        )
    )
    return {"content_type": "image/png", "image": encode_bytes(result)}


@celery_app.task(bind=True, name="img_cleaner_backend.prompt_inpaint")
def prompt_inpaint_task(
    self,
    image_b64: str,
    mask_b64: str,
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
        image_b64 (str): Base64 编码的原始图像。
        mask_b64 (str): Base64 编码的蒙版图像。
        prompt (str): 正向提示词。
        negative_prompt (str): 反向提示词。
        strength (float): 重绘强度 (0.0 - 1.0)。
        steps (int): 扩散模型推理步数。
        guidance_scale (float): 提示词引导系数 (CFG Scale)。
        seed (int): 随机种子，-1 表示随机。

    返回:
        dict: 包含处理后图像数据 (Base64) 及 content_type 的字典。
    """
    self.update_state(state="STARTED", meta={"status": "running"})
    engine = build_prompt_engine_from_env()
    result = asyncio.run(
        engine.inpaint(
            decode_bytes(image_b64),
            decode_bytes(mask_b64),
            prompt,
            negative_prompt,
            strength,
            steps,
            guidance_scale,
            seed,
        )
    )
    return {"content_type": "image/png", "image": encode_bytes(result)}
