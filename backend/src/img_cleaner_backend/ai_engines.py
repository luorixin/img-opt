"""
AI 图像处理引擎模块。

基于 rembg 进行背景移除，以及使用 onnxruntime 运行 Real-ESRGAN 进行超分辨率重建。
"""
from __future__ import annotations

import os
import urllib.request
import fcntl
import hashlib
import logging
import uuid
from io import BytesIO
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

from img_cleaner_backend.image_validation import parse_crop_region

# 缓存目录：~/.cache/img-cleaner
CACHE_DIR = Path.home() / ".cache" / "img-cleaner"
MODEL_PATH = CACHE_DIR / "Real-ESRGAN_x2plus.onnx"
MODEL_URL = "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/Real-ESRGAN_x2plus.onnx"
MODEL_SHA256 = "735f42fd172779c9776606298b9f744d9d488f8aa1fe90fe6c6470186020a754"
LOGGER = logging.getLogger(__name__)

_session: ort.InferenceSession | None = None

def _get_onnx_session() -> ort.InferenceSession:
    """获取并缓存 ONNX Runtime 会话，首次使用时安全下载模型。"""
    global _session
    if _session is not None:
        return _session

    model_path = _ensure_model_file()

    # 在 CPU 上运行推理，保障在无 GPU/MPS 硬件加速的环境下也能稳定运行
    _session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    return _session


def _ensure_model_file() -> Path:
    """在文件锁保护下校验或下载模型，并返回可加载的模型路径。"""
    model_path = Path(os.getenv("UPSCALER_MODEL_PATH", str(MODEL_PATH))).expanduser()
    model_url = os.getenv("UPSCALER_MODEL_URL", MODEL_URL)
    expected_sha256 = os.getenv("UPSCALER_MODEL_SHA256", MODEL_SHA256).strip().lower()
    model_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = model_path.with_suffix(f"{model_path.suffix}.lock")

    # flock 在 macOS 和 Linux 容器中均可用，可避免多个 Worker 同时覆盖模型文件。
    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        if model_path.is_file() and _sha256_file(model_path) == expected_sha256:
            return model_path
        model_path.unlink(missing_ok=True)

        temporary = model_path.with_name(f".{model_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            LOGGER.info("Downloading Real-ESRGAN model to %s", model_path)
            _download_to_path(model_url, temporary)
            if _sha256_file(temporary) != expected_sha256:
                raise RuntimeError("Real-ESRGAN model checksum verification failed.")
            os.replace(temporary, model_path)
        finally:
            temporary.unlink(missing_ok=True)
    return model_path


def _download_to_path(url: str, target: Path) -> None:
    """使用带超时的流式请求下载模型，避免无限等待和一次性占用内存。"""
    timeout = float(os.getenv("UPSCALER_MODEL_DOWNLOAD_TIMEOUT_SECONDS", "120"))
    with urllib.request.urlopen(url, timeout=timeout) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def _sha256_file(path: Path) -> str:
    """分块计算文件 SHA-256，避免模型校验时一次性读入内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def remove_background(image_bytes: bytes) -> bytes:
    """
    使用 rembg 移除图像背景，返回透明背景的 PNG 字节。
    """
    from rembg import remove
    return remove(image_bytes)


def run_upscale_pil(image: Image.Image, factor: int) -> Image.Image:
    """
    使用 Real-ESRGAN ONNX 模型对 Pillow 图像进行超分。
    支持 x2, x3, x4。
    - 2x: 运行一次 2x 导出。
    - 4x: 运行两次 2x 导出。
    - 3x: 运行两次 2x 导出得到 4x，然后使用 LANCZOS 缩小到 3x。
    """
    session = _get_onnx_session()
    
    # 辅助函数：执行单次 2x 放大
    def single_upscale_2x(img: Image.Image) -> Image.Image:
        img_rgb = img.convert("RGB")
        img_np = np.array(img_rgb).astype(np.float32) / 255.0
        
        # HWC -> BCHW
        img_np = np.transpose(img_np, (2, 0, 1))
        img_np = np.expand_dims(img_np, axis=0)
        
        # 执行推理
        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: img_np})[0]
        
        # BCHW -> HWC
        output = np.squeeze(output, axis=0)
        output = np.transpose(output, (1, 2, 0))
        output = output * 255.0
        output = np.clip(output, 0, 255).astype(np.uint8)
        
        return Image.fromarray(output)

    # 根据不同倍率执行放大逻辑
    if factor == 2:
        return single_upscale_2x(image)
    elif factor == 4:
        img_2x = single_upscale_2x(image)
        return single_upscale_2x(img_2x)
    elif factor == 3:
        # 先做 4x 放大，再缩小到 3x
        img_2x = single_upscale_2x(image)
        img_4x = single_upscale_2x(img_2x)
        target_w = image.width * 3
        target_h = image.height * 3
        return img_4x.resize((target_w, target_h), Image.Resampling.LANCZOS)
    else:
        # 未知倍率直接回退到 LANCZOS 插值
        return image.resize((image.width * factor, image.height * factor), Image.Resampling.LANCZOS)


def run_upscale(image_bytes: bytes, upscale_factor: int, crop_str: str | None = None) -> bytes:
    """
    对图像执行超分和可选的裁剪。
    
    参数:
        image_bytes: 原始图像字节。
        upscale_factor: 放大倍数 (2, 3, 4)。
        crop_str: 可选裁剪参数 "x,y,w,h" (原图坐标下)。
        
    返回:
        bytes: 处理后的 PNG 字节数据。
    """
    image = Image.open(BytesIO(image_bytes))
    
    # 1. 如果存在裁剪框，先进行裁剪 (在原图尺寸坐标下)
    crop = parse_crop_region(crop_str, image.size)
    if crop:
        image = image.crop((crop.x, crop.y, crop.x + crop.width, crop.y + crop.height))
    
    # 2. 运行超分算法
    upscaled = run_upscale_pil(image, upscale_factor)
    
    # 3. 保存并返回字节流
    output = BytesIO()
    upscaled.save(output, format="PNG")
    return output.getvalue()
