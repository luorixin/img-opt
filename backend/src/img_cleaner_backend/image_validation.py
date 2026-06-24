"""
图像资源边界校验模块。

该模块集中校验上传图像的解码像素数、裁剪框边界和放大后的输出像素数，
避免仅依赖压缩文件大小时被超大图片或恶意裁剪参数耗尽内存。
"""
from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_MAX_IMAGE_PIXELS = 25_000_000
DEFAULT_MAX_OUTPUT_PIXELS = 67_108_864


class ImageValidationError(ValueError):
    """携带 HTTP 状态语义的图像参数校验错误。"""

    def __init__(self, message: str, status_code: int = 400):
        """保存可安全返回给调用方的错误消息和建议状态码。"""
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class CropRegion:
    """表示原图坐标系中的矩形裁剪区域。"""

    x: int
    y: int
    width: int
    height: int

    def serialize(self) -> str:
        """将裁剪区域转换为任务队列使用的稳定字符串格式。"""
        return f"{self.x},{self.y},{self.width},{self.height}"


def validate_image_pixels(width: int, height: int) -> None:
    """校验解码后的图像像素数是否超过服务端配置上限。"""
    max_pixels = _positive_env_int("MAX_IMAGE_PIXELS", DEFAULT_MAX_IMAGE_PIXELS)
    if width <= 0 or height <= 0 or width * height > max_pixels:
        raise ImageValidationError(
            "Uploaded image exceeds the configured pixel limit.",
            status_code=413,
        )


def validate_upscale_request(
    image_size: tuple[int, int],
    upscale_factor: int,
    crop_value: str | None,
) -> str | None:
    """校验超分裁剪参数与最终像素数，并返回规范化后的裁剪字符串。"""
    width, height = image_size
    crop = parse_crop_region(crop_value, image_size)
    source_width = crop.width if crop else width
    source_height = crop.height if crop else height
    output_pixels = source_width * upscale_factor * source_height * upscale_factor
    max_output_pixels = _positive_env_int("MAX_OUTPUT_PIXELS", DEFAULT_MAX_OUTPUT_PIXELS)
    if output_pixels > max_output_pixels:
        raise ImageValidationError(
            "Requested output image exceeds the configured pixel limit.",
            status_code=413,
        )
    return crop.serialize() if crop else None


def parse_crop_region(
    crop_value: str | None,
    image_size: tuple[int, int],
) -> CropRegion | None:
    """解析并确认裁剪框完整位于原图内部。"""
    if crop_value is None or not crop_value.strip():
        return None
    parts = crop_value.split(",")
    if len(parts) != 4:
        raise ImageValidationError("Crop rectangle must use x,y,width,height integers.")
    try:
        x, y, width, height = (int(part.strip()) for part in parts)
    except ValueError as exc:
        raise ImageValidationError("Crop rectangle must use x,y,width,height integers.") from exc

    image_width, image_height = image_size
    if (
        x < 0
        or y < 0
        or width <= 0
        or height <= 0
        or x + width > image_width
        or y + height > image_height
    ):
        raise ImageValidationError("Crop rectangle must be inside the image.")
    return CropRegion(x=x, y=y, width=width, height=height)


def _positive_env_int(name: str, default: int) -> int:
    """读取正整数环境变量，无效配置回退到安全默认值。"""
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default
