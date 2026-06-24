"""
图像处理引擎适配模块。

该模块定义了图像处理引擎的抽象基类，并提供了基于 IOPaint 的 Sidecar 引擎实现。
主要负责与底层的 AI 图像处理服务进行 HTTP 通信。
"""
from __future__ import annotations

import base64
from abc import ABC, abstractmethod

import httpx


class EngineUnavailable(RuntimeError):
    """引擎不可用异常，通常在底层服务无法连接或返回 500+ 错误时抛出。"""
    pass


class InpaintEngine(ABC):
    """基础图像修复引擎的抽象接口。"""
    @abstractmethod
    async def health(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> bytes:
        raise NotImplementedError

    @abstractmethod
    async def segment(self, image_bytes: bytes, x: int, y: int, label: int) -> bytes:
        raise NotImplementedError


class PromptInpaintEngine(ABC):
    """基于提示词的图像修复引擎抽象接口。"""
    @abstractmethod
    async def health(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float,
        steps: int,
        guidance_scale: float,
        seed: int,
    ) -> bytes:
        raise NotImplementedError


class IOPaintSidecarEngine(InpaintEngine):
    """
    通过 HTTP 与 IOPaint Sidecar 进程通信的基础修复引擎。
    支持基础的 Inpaint 以及交互式分割（Segment）功能。
    """
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8081",
        timeout: float = 120.0,
        health_path: str = "/docs",
        inpaint_path: str = "/api/v1/inpaint",
        segment_path: str = "/api/v1/run_plugin_gen_mask",
        segment_plugin_name: str = "InteractiveSeg",
        transport: httpx.AsyncBaseTransport | httpx.BaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.health_path = normalize_path(health_path)
        self.inpaint_path = normalize_path(inpaint_path)
        self.segment_path = normalize_path(segment_path)
        self.segment_plugin_name = segment_plugin_name
        self.transport = transport

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=2.0, transport=self.transport) as client:
                response = await client.get(self.url_for(self.health_path))
            return {
                "available": response.status_code < 500,
                "engine": "iopaint-sidecar",
                "base_url": self.base_url,
                "health_path": self.health_path,
                "inpaint_path": self.inpaint_path,
                "segment_path": self.segment_path,
                "segment_plugin_name": self.segment_plugin_name,
                "timeout_seconds": self.timeout,
            }
        except httpx.HTTPError:
            return {
                "available": False,
                "engine": "iopaint-sidecar",
                "base_url": self.base_url,
                "health_path": self.health_path,
                "inpaint_path": self.inpaint_path,
                "segment_path": self.segment_path,
                "segment_plugin_name": self.segment_plugin_name,
                "timeout_seconds": self.timeout,
            }

    async def inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        mask_dilate: int,
        mask_blur: int,
    ) -> bytes:
        files = {
            "image": ("image.png", image_bytes, "image/png"),
            "mask": ("mask.png", mask_bytes, "image/png"),
        }
        data = {
            "mask_dilate": str(mask_dilate),
            "mask_blur": str(mask_blur),
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = await client.post(
                    self.url_for(self.inpaint_path),
                    files=files,
                    data=data,
                )
        except httpx.HTTPError as exc:
            raise EngineUnavailable(f"{self.url_for(self.inpaint_path)} request failed: {exc}") from exc

        if response.status_code >= 500:
            raise EngineUnavailable(format_sidecar_error(response))
        if response.status_code >= 400:
            raise RuntimeError(format_sidecar_error(response))
        return response.content

    async def segment(self, image_bytes: bytes, x: int, y: int, label: int) -> bytes:
        payload = {
            "name": self.segment_plugin_name,
            "image": base64.b64encode(image_bytes).decode("ascii"),
            "clicks": [[x, y, label]],
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = await client.post(self.url_for(self.segment_path), json=payload)
        except httpx.HTTPError as exc:
            raise EngineUnavailable(f"{self.url_for(self.segment_path)} request failed: {exc}") from exc

        if response.status_code >= 500:
            raise EngineUnavailable(format_sidecar_error(response))
        if response.status_code >= 400:
            raise RuntimeError(format_sidecar_error(response))
        return response.content

    def url_for(self, path: str) -> str:
        return f"{self.base_url}{normalize_path(path)}"


class IOPaintPromptSidecarEngine(PromptInpaintEngine):
    """
    通过 HTTP 与支持 Diffusion 模型的 IOPaint 进程通信的提示词引擎。
    提供基于文本提示词控制的图像修复能力。
    """
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8082",
        timeout: float = 300.0,
        health_path: str = "/docs",
        inpaint_path: str = "/api/v1/inpaint",
        transport: httpx.AsyncBaseTransport | httpx.BaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.health_path = normalize_path(health_path)
        self.inpaint_path = normalize_path(inpaint_path)
        self.transport = transport

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=2.0, transport=self.transport) as client:
                response = await client.get(self.url_for(self.health_path))
            available = response.status_code < 500
        except httpx.HTTPError:
            available = False
        return {
            "available": available,
            "engine": "iopaint-prompt-sidecar",
            "base_url": self.base_url,
            "health_path": self.health_path,
            "inpaint_path": self.inpaint_path,
            "timeout_seconds": self.timeout,
        }

    async def inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float,
        steps: int,
        guidance_scale: float,
        seed: int,
    ) -> bytes:
        payload = {
            "image": base64.b64encode(image_bytes).decode("ascii"),
            "mask": base64.b64encode(mask_bytes).decode("ascii"),
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "sd_strength": strength,
            "sd_steps": steps,
            "sd_guidance_scale": guidance_scale,
            "sd_seed": seed,
            "sd_keep_unmasked_area": True,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = await client.post(self.url_for(self.inpaint_path), json=payload)
        except httpx.HTTPError as exc:
            raise EngineUnavailable(f"{self.url_for(self.inpaint_path)} request failed: {exc}") from exc

        if response.status_code >= 500:
            raise EngineUnavailable(format_sidecar_error(response))
        if response.status_code >= 400:
            raise RuntimeError(format_sidecar_error(response))
        return response.content

    def url_for(self, path: str) -> str:
        return f"{self.base_url}{normalize_path(path)}"


def build_engine_from_env() -> IOPaintSidecarEngine:
    """
    从环境变量初始化 IOPaint 基础引擎实例。

    返回:
        IOPaintSidecarEngine: 初始化后的基础修复引擎。
    """
    import os

    return IOPaintSidecarEngine(
        base_url=os.getenv("IOPAINT_BASE_URL", "http://127.0.0.1:8081"),
        health_path=os.getenv("IOPAINT_HEALTH_PATH", "/docs"),
        inpaint_path=os.getenv("IOPAINT_INPAINT_PATH", "/api/v1/inpaint"),
        segment_path=os.getenv("IOPAINT_SEGMENT_PATH", "/api/v1/run_plugin_gen_mask"),
        segment_plugin_name=os.getenv("IOPAINT_SEGMENT_PLUGIN_NAME", "InteractiveSeg"),
        timeout=float(os.getenv("IOPAINT_TIMEOUT_SECONDS", "120")),
    )


def build_prompt_engine_from_env() -> IOPaintPromptSidecarEngine:
    """
    从环境变量初始化基于提示词的 IOPaint 引擎实例。

    返回:
        IOPaintPromptSidecarEngine: 初始化后的提示词修复引擎。
    """
    import os

    return IOPaintPromptSidecarEngine(
        base_url=os.getenv("IOPAINT_PROMPT_BASE_URL", "http://127.0.0.1:8082"),
        health_path=os.getenv("IOPAINT_PROMPT_HEALTH_PATH", "/docs"),
        inpaint_path=os.getenv("IOPAINT_PROMPT_INPAINT_PATH", "/api/v1/inpaint"),
        timeout=float(os.getenv("IOPAINT_PROMPT_TIMEOUT_SECONDS", "300")),
    )


def normalize_path(path: str) -> str:
    """标准化 URL 路径，确保以斜杠开头。"""
    stripped = path.strip()
    if not stripped:
        return "/"
    return stripped if stripped.startswith("/") else f"/{stripped}"


def format_sidecar_error(response: httpx.Response) -> str:
    """格式化 HTTP 请求错误响应以便于调试和日志记录。"""
    body = response.text.strip().replace("\n", " ")
    if len(body) > 240:
        body = f"{body[:237]}..."
    return f"{response.request.url} returned status={response.status_code}: {body}"
