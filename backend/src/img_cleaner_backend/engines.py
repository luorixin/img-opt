from __future__ import annotations

from abc import ABC, abstractmethod

import httpx


class EngineUnavailable(RuntimeError):
    pass


class InpaintEngine(ABC):
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


class IOPaintSidecarEngine(InpaintEngine):
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8081",
        timeout: float = 120.0,
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
            return {
                "available": response.status_code < 500,
                "engine": "iopaint-sidecar",
                "base_url": self.base_url,
                "health_path": self.health_path,
                "inpaint_path": self.inpaint_path,
                "timeout_seconds": self.timeout,
            }
        except httpx.HTTPError:
            return {
                "available": False,
                "engine": "iopaint-sidecar",
                "base_url": self.base_url,
                "health_path": self.health_path,
                "inpaint_path": self.inpaint_path,
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

    def url_for(self, path: str) -> str:
        return f"{self.base_url}{normalize_path(path)}"


def normalize_path(path: str) -> str:
    stripped = path.strip()
    if not stripped:
        return "/"
    return stripped if stripped.startswith("/") else f"/{stripped}"


def format_sidecar_error(response: httpx.Response) -> str:
    body = response.text.strip().replace("\n", " ")
    if len(body) > 240:
        body = f"{body[:237]}..."
    return f"{response.request.url} returned status={response.status_code}: {body}"
