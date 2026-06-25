"""
Celery 应用配置模块。

该模块负责初始化 Celery 实例，并配置 Redis 作为默认的 Broker 和 Result Backend。
用于处理耗时的异步图像处理任务。
"""
from __future__ import annotations

import os

from celery import Celery

from img_cleaner_backend.runtime_config import env_flag_with_legacy


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


from celery.signals import worker_process_init

@worker_process_init.connect
def pre_warm_models_in_process(sender, **kwargs):
    """
    在 Celery 子进程 (Worker Process) 初始化时预载并预热 AI 超分与背景移除模型。
    这确保了每个子进程独立加载模型，避免了 ONNX Runtime 在 multiprocessing fork 后的线程池死锁问题。
    """
    import logging
    logger = logging.getLogger("celery")
    # 模型预载会显著增加空闲内存和启动 CPU 峰值，因此默认关闭。
    # WORKER_AI_PRELOAD_MODELS 优先于旧的 AI_PRELOAD_MODELS，可单独控制 Worker。
    if not env_flag_with_legacy("WORKER_AI_PRELOAD_MODELS", "AI_PRELOAD_MODELS", default=False):
        logger.info("AI 模型预载已关闭，Worker 将在首次任务执行时懒加载模型。")
        return
    logger.info("Celery 子进程已就绪，开始后台预载超分与背景移除模型...")
    try:
        from img_cleaner_backend.ai_engines import _get_onnx_session
        _get_onnx_session()
        logger.info("Celery 子进程 AI 模型预载完成。")
    except Exception as exc:
        logger.error("Celery 子进程 AI 模型预载失败: %s", exc)
