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
from img_cleaner_backend.runtime_config import env_int_at_least

# 缓存目录：~/.cache/img-cleaner
CACHE_DIR = Path.home() / ".cache" / "img-cleaner"
MODEL_PATH = CACHE_DIR / "Real-ESRGAN_x2plus.onnx"
MODEL_URL = "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/Real-ESRGAN_x2plus.onnx"
MODEL_SHA256 = "735f42fd172779c9776606298b9f744d9d488f8aa1fe90fe6c6470186020a754"
LOGGER = logging.getLogger(__name__)

_session: ort.InferenceSession | None = None

def _get_onnx_session() -> ort.InferenceSession:
    """获取并缓存 ONNX Runtime 会话，首次使用时安全下载模型并转换为动态尺寸模型，支持 GPU 自动加速。"""
    global _session
    if _session is not None:
        return _session

    model_path = _ensure_model_file()
    dynamic_model_path = _ensure_dynamic_model(model_path)

    # 动态检测当前环境可用的 ONNX Runtime 推理加速提供者 (Execution Providers)
    available_providers = ort.get_available_providers()
    env_provider = os.getenv("UPSCALER_PROVIDER")

    if env_provider:
        providers = [p.strip() for p in env_provider.split(",") if p.strip()]
    else:
        # 默认优先考虑 CUDA (NVIDIA GPU) 加速，若不可用则降级到 CPU
        preferred = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        providers = [p for p in preferred if p in available_providers]
        if not providers:
            providers = ["CPUExecutionProvider"]

    # Docker 桌面环境中 ONNX Runtime 默认可能按宿主机 CPU 数创建较多线程。
    # 对单 worker 的本地工具而言，限制线程数能减少后台抢占和风扇/CPU 峰值；
    # 高吞吐部署可通过环境变量调大这两个值。
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = env_int_at_least("UPSCALER_INTRA_OP_THREADS", default=1)
    session_options.inter_op_num_threads = env_int_at_least("UPSCALER_INTER_OP_THREADS", default=1)

    LOGGER.info(
        "正在初始化 ONNX Runtime，系统可用 Providers: %s, 选定 Providers: %s, intra_op=%s, inter_op=%s",
        available_providers,
        providers,
        session_options.intra_op_num_threads,
        session_options.inter_op_num_threads,
    )
    _session = ort.InferenceSession(
        str(dynamic_model_path),
        providers=providers,
        sess_options=session_options,
    )
    return _session


def _ensure_dynamic_model(static_path: Path) -> Path:
    """
    如果动态模型文件不存在，则将静态 ONNX 模型转换为动态尺寸 (Dynamic Shape) 的模型并保存。
    由于 Real-ESRGAN 是全卷积网络，其数学计算天然支持任意尺寸，但原始 ONNX 导出的静态尺寸 (64x64) 会限制输入。
    通过使用 onnx 库将 input 和 output 的 H/W 维度替换为符号名称 (height/width) 实现动态输入。
    """
    dynamic_path = static_path.with_name(static_path.stem + "_dynamic.onnx")
    lock_path = dynamic_path.with_suffix(f"{dynamic_path.suffix}.lock")

    # 使用文件锁防止多进程 (如多个 Celery Worker) 同时执行转换导致文件损坏
    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        if dynamic_path.is_file():
            return dynamic_path

        LOGGER.info("正在将静态超分模型转换成动态超分模型: %s", static_path)
        import onnx
        import uuid

        temporary = dynamic_path.with_name(f".{dynamic_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            model = onnx.load(str(static_path))

            # 1. 修改输入张量的尺寸为动态尺寸
            input_tensor = model.graph.input[0]
            shape = input_tensor.type.tensor_type.shape
            shape.dim[2].ClearField("dim_value")
            shape.dim[3].ClearField("dim_value")
            shape.dim[2].dim_param = "height"
            shape.dim[3].dim_param = "width"

            # 2. 修改输出张量的尺寸为动态尺寸
            output_tensor = model.graph.output[0]
            out_shape = output_tensor.type.tensor_type.shape
            out_shape.dim[2].ClearField("dim_value")
            out_shape.dim[3].ClearField("dim_value")
            out_shape.dim[2].dim_param = "out_height"
            out_shape.dim[3].dim_param = "out_width"

            # 3. 保存动态模型至临时文件，然后执行原子重命名以保证操作安全性
            onnx.save(model, str(temporary))
            os.replace(temporary, dynamic_path)
            LOGGER.info("动态尺寸模型转换完成并成功保存至: %s", dynamic_path)
        except Exception as e:
            LOGGER.error("转换动态超分模型失败: %s", e)
            raise e
        finally:
            # 清理残留的临时文件
            temporary.unlink(missing_ok=True)

    return dynamic_path


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


def remove_background(image_bytes: bytes, format: str = "PNG") -> bytes:
    """
    使用 rembg 移除图像背景，返回透明背景的指定格式（支持 PNG, WEBP）字节。
    """
    from rembg import remove
    result_png = remove(image_bytes)

    fmt = format.upper()
    if fmt == "PNG":
        return result_png

    # 如果是 WEBP 格式，使用 Pillow 将带有透明通道的 PNG 图像重新编码
    output = BytesIO()
    img = Image.open(BytesIO(result_png))
    if fmt == "WEBP":
        img.save(output, format="WEBP", quality=90)
        return output.getvalue()

    return result_png


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
        orig_w, orig_h = img_rgb.width, img_rgb.height

        # Real-ESRGAN 模型中包含 PixelUnshuffle(2) 结构，要求输入的 H 和 W 必须是 2 的倍数（偶数）。
        # 如果是奇数尺寸，向右/向下以复制边缘的形式填充 1 像素，在推理出结果后再裁剪回正确的放大尺寸。
        pad_h = 1 if orig_h % 2 != 0 else 0
        pad_w = 1 if orig_w % 2 != 0 else 0

        img_np = np.array(img_rgb).astype(np.float32) / 255.0

        # 进行边缘像素填充
        if pad_h > 0 or pad_w > 0:
            img_np = np.pad(img_np, ((0, pad_h), (0, pad_w), (0, 0)), mode="edge")

        # HWC -> BCHW
        img_np = np.transpose(img_np, (2, 0, 1))
        img_np = np.expand_dims(img_np, axis=0)

        # 执行推理
        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: img_np})[0]

        # BCHW -> HWC
        output = np.squeeze(output, axis=0)
        output = np.transpose(output, (1, 2, 0))

        # 裁剪掉填充部分对应的超分像素
        if pad_h > 0 or pad_w > 0:
            output = output[:orig_h * 2, :orig_w * 2, :]

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


def run_upscale(
    image_bytes: bytes,
    upscale_factor: int,
    crop_str: str | None = None,
    format: str = "PNG",
) -> bytes:
    """
    对图像执行超分和可选的裁剪，并按指定格式（PNG, WEBP, JPEG）保存返回。
    
    参数:
        image_bytes: 原始图像字节。
        upscale_factor: 放大倍数 (2, 3, 4)。
        crop_str: 可选裁剪参数 "x,y,w,h" (原图坐标下)。
        format: 导出文件格式。
        
    返回:
        bytes: 处理后的图像字节数据。
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
    fmt = format.upper()
    if fmt == "WEBP":
        upscaled.save(output, format="WEBP", quality=85)
    elif fmt == "JPEG" or fmt == "JPG":
        # JPEG 不支持透明度，若模型输出是 RGBA 则将透明背景融合为白底
        if upscaled.mode == "RGBA":
            bg = Image.new("RGB", upscaled.size, (255, 255, 255))
            bg.paste(upscaled, mask=upscaled.split()[3])
            bg.save(output, format="JPEG", quality=85)
        else:
            upscaled.convert("RGB").save(output, format="JPEG", quality=85)
    else:
        upscaled.save(output, format="PNG")

    return output.getvalue()
