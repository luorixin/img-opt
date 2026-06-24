import unittest
from unittest.mock import MagicMock, patch
from io import BytesIO
import numpy as np
import pytest
from PIL import Image

from img_cleaner_backend import ai_engines
from img_cleaner_backend.ai_engines import remove_background, run_upscale

class TestAIEngines(unittest.TestCase):
    def setUp(self):
        # 创建一个 8x8 的测试图像
        self.img = Image.new("RGB", (8, 8), color="white")
        buf = BytesIO()
        self.img.save(buf, format="PNG")
        self.img_bytes = buf.getvalue()

    @patch("rembg.remove")
    def test_remove_background(self, mock_remove):
        mock_remove.return_value = b"transparent_png_bytes"
        result = remove_background(self.img_bytes)
        self.assertEqual(result, b"transparent_png_bytes")
        mock_remove.assert_called_once_with(self.img_bytes)

    @patch("img_cleaner_backend.ai_engines._get_onnx_session")
    def test_run_upscale_2x(self, mock_get_session):
        # 模拟 ONNX InferenceSession 运行返回 16x16 的图像数据特征
        # 输入 shape 为 (1, 3, 8, 8) -> 输出为 (1, 3, 16, 16)
        mock_session = MagicMock()
        mock_session.get_inputs.return_value = [MagicMock(name="input")]
        
        # Real-ESRGAN 输出是个 [1, 3, H, W] 维度的 ndarray
        fake_output = np.ones((1, 3, 16, 16), dtype=np.float32) * 0.5
        mock_session.run.return_value = [fake_output]
        mock_get_session.return_value = mock_session

        with patch("numpy.array") as mock_np_array:
            # 返回 8x8 的 numpy array
            mock_np_array.return_value = np.ones((8, 8, 3), dtype=np.uint8) * 255
            
            result_bytes = run_upscale(self.img_bytes, upscale_factor=2)
            
            # 校验导出的也是合法的 PNG
            result_img = Image.open(BytesIO(result_bytes))
            self.assertEqual(result_img.size, (16, 16))

    @patch("img_cleaner_backend.ai_engines._get_onnx_session")
    def test_run_upscale_with_crop(self, mock_get_session):
        mock_session = MagicMock()
        mock_session.get_inputs.return_value = [MagicMock(name="input")]
        
        # 裁剪 4x4 -> 放大 2x -> 8x8
        fake_output = np.ones((1, 3, 8, 8), dtype=np.float32) * 0.8
        mock_session.run.return_value = [fake_output]
        mock_get_session.return_value = mock_session

        # 裁剪 "2,2,4,4"
        result_bytes = run_upscale(self.img_bytes, upscale_factor=2, crop_str="2,2,4,4")
        result_img = Image.open(BytesIO(result_bytes))
        self.assertEqual(result_img.size, (8, 8))

    @patch("img_cleaner_backend.ai_engines._get_onnx_session")
    def test_run_upscale_3x(self, mock_get_session):
        mock_session = MagicMock()
        mock_session.get_inputs.return_value = [MagicMock(name="input")]
        
        # 输入 8x8 -> 第一次 2x 得到 16x16 -> 第二次 2x 得到 32x32 -> resize 得到 24x24
        # 为了简化模拟，让 model run 返回匹配大小
        def mock_run(names, feeds):
            img_in = list(feeds.values())[0]
            in_shape = img_in.shape
            out_h = in_shape[2] * 2
            out_w = in_shape[3] * 2
            return [np.ones((1, 3, out_h, out_w), dtype=np.float32) * 0.5]
            
        mock_session.run.side_effect = mock_run
        mock_get_session.return_value = mock_session

        result_bytes = run_upscale(self.img_bytes, upscale_factor=3)
        result_img = Image.open(BytesIO(result_bytes))
        # 8 * 3 = 24
        self.assertEqual(result_img.size, (24, 24))


def test_model_download_rejects_checksum_mismatch(tmp_path, monkeypatch):
    """模型摘要不匹配时必须删除临时内容，不能交给 ONNX Runtime 加载。"""
    model_path = tmp_path / "model.onnx"
    monkeypatch.setenv("UPSCALER_MODEL_PATH", str(model_path))
    monkeypatch.setenv("UPSCALER_MODEL_SHA256", "0" * 64)
    monkeypatch.setattr(ai_engines, "MODEL_PATH", model_path)
    monkeypatch.setattr(ai_engines, "_session", None)

    def fake_download(url, target):
        target.write_bytes(b"tampered-model")

    monkeypatch.setattr(ai_engines, "_download_to_path", fake_download, raising=False)
    monkeypatch.setattr(
        ai_engines.urllib.request,
        "urlretrieve",
        lambda url, target: target.write_bytes(b"tampered-model"),
    )

    with pytest.raises(RuntimeError, match="checksum"):
        ai_engines._get_onnx_session()

    assert model_path.exists() is False
