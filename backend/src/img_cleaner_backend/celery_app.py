"""
Celery 应用配置模块。

该模块负责初始化 Celery 实例，并配置 Redis 作为默认的 Broker 和 Result Backend。
用于处理耗时的异步图像处理任务。
"""
from __future__ import annotations

import os

from celery import Celery


def redis_url_from_env() -> str:
    """
    从环境变量中获取 Redis URL。
    如果未设置，则默认返回本地 Redis 实例的 URL。

    返回:
        str: Redis 连接字符串。
    """
    return os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")


celery_app = Celery(
    "img_cleaner_backend",
    broker=os.getenv("CELERY_BROKER_URL", redis_url_from_env()),
    backend=os.getenv("CELERY_RESULT_BACKEND", redis_url_from_env()),
    include=["img_cleaner_backend.tasks"],
)

celery_app.conf.update(
    accept_content=["json"],
    result_expires=int(os.getenv("CELERY_RESULT_EXPIRES_SECONDS", "3600")),
    result_serializer="json",
    task_serializer="json",
    task_track_started=True,
    worker_prefetch_multiplier=1,
)
