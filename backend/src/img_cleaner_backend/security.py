"""
API 安全与限流模块。

该模块提供基于固定窗口算法的限流器实现，以及用于 FastAPI 依赖项的 API Token 校验和限流拦截逻辑。
"""
from __future__ import annotations

import os
import secrets
import time
import hashlib
from typing import Protocol

from fastapi import HTTPException, Request


class RateLimiter(Protocol):
    """限流器协议，统一内存和 Redis 实现的调用方式。"""

    limit_per_minute: int

    def allow(self, key: str) -> bool:
        raise NotImplementedError


class FixedWindowRateLimiter:
    """
    基于固定时间窗口算法的内存限流器。

    在每个一分钟的窗口内，记录各客户端标识的请求次数，超出限制则拒绝请求。
    """
    def __init__(self, limit_per_minute: int):
        """
        初始化限流器。

        参数:
            limit_per_minute (int): 每分钟允许的最大请求数。如果 <= 0，则不限制。
        """
        self.limit_per_minute = limit_per_minute
        self._hits: dict[tuple[str, int], int] = {}

    def allow(self, key: str) -> bool:
        """
        检查指定的键是否允许在该时间窗口内继续请求。

        参数:
            key (str): 客户端标识（如 IP 地址或 API Token）。

        返回:
            bool: 允许返回 True，否则返回 False。
        """
        if self.limit_per_minute <= 0:
            return True

        window = int(time.time() // 60)
        self._prune(window)
        hit_key = (key, window)
        hits = self._hits.get(hit_key, 0)
        if hits >= self.limit_per_minute:
            return False
        self._hits[hit_key] = hits + 1
        return True

    def _prune(self, current_window: int) -> None:
        """
        清理过期时间窗口的请求记录，防止内存泄漏。

        参数:
            current_window (int): 当前的时间窗口（分钟）。
        """
        stale = [key for key in self._hits if key[1] < current_window]
        for key in stale:
            del self._hits[key]


class RedisFixedWindowRateLimiter:
    """使用 Redis 保存计数的固定窗口限流器。"""

    def __init__(self, redis_url: str, limit_per_minute: int, redis_client=None):
        """初始化限流器，并允许测试注入兼容 Redis 的客户端。"""
        if redis_client is None:
            import redis

            redis_client = redis.Redis.from_url(redis_url)

        self.limit_per_minute = limit_per_minute
        self.redis = redis_client

    def allow(self, key: str) -> bool:
        """使用调用方标识的不可逆指纹计数，避免在 Redis 中暴露凭证。"""
        if self.limit_per_minute <= 0:
            return True

        window = int(time.time() // 60)
        key_fingerprint = hashlib.sha256(key.encode("utf-8")).hexdigest()
        redis_key = f"rate-limit:{window}:{key_fingerprint}"
        hits = self.redis.incr(redis_key)
        if hits == 1:
            self.redis.expire(redis_key, 120)
        return hits <= self.limit_per_minute


def build_rate_limiter_from_env() -> RateLimiter:
    """
    从环境变量初始化固定窗口限流器。
    读取 RATE_LIMIT_PER_MINUTE，默认值为 0（不限流）。

    返回:
        FixedWindowRateLimiter: 配置好的限流器实例。
    """
    limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "0"))
    redis_url = os.getenv("RATE_LIMIT_REDIS_URL", "").strip()
    if redis_url:
        return RedisFixedWindowRateLimiter(redis_url, limit)
    return FixedWindowRateLimiter(limit)


def require_api_token(request: Request) -> None:
    """
    FastAPI 依赖项：校验 API Token。

    验证请求头中的 Authorization (Bearer) 或 X-API-Token 是否匹配环境变量 API_TOKEN。
    如果配置了 API_TOKEN 且验证失败，抛出 401 异常。如果未配置，则放行。

    参数:
        request (Request): FastAPI 请求对象。
    """
    expected = os.getenv("API_TOKEN", "").strip()
    if not expected:
        return

    authorization = request.headers.get("authorization", "")
    bearer = authorization.removeprefix("Bearer ").strip()
    header_token = request.headers.get("x-api-token", "").strip()
    if not (
        secrets.compare_digest(bearer, expected)
        or secrets.compare_digest(header_token, expected)
    ):
        raise HTTPException(status_code=401, detail="Missing or invalid API token.")


def check_rate_limit(request: Request) -> None:
    """
    FastAPI 依赖项：检查当前请求是否超出了限流限制。

    使用 API Token（优先）或客户端 IP 作为限流标识。
    若被限流，则抛出 429 异常。

    参数:
        request (Request): FastAPI 请求对象。
    """
    limiter = request.app.state.rate_limiter
    client = request.client.host if request.client else "unknown"
    token = request.headers.get("authorization") or request.headers.get("x-api-token")
    key = token or client
    if not limiter.allow(key):
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")
