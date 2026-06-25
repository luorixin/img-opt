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

    @patch("img_cleaner_backend.ai_engines._get_onnx_session")
    def test_run_upscale_odd_dimensions(self, mock_get_session):
        """测试对奇数分辨率尺寸图像进行超分辨率重建，验证边缘填充和最终的裁剪逻辑。"""
        # 创建一个 7x9 的奇数尺寸测试图像 (宽=7, 高=9)
        odd_img = Image.new("RGB", (7, 9), color="white")
        buf = BytesIO()
        odd_img.save(buf, format="PNG")
        odd_img_bytes = buf.getvalue()

        mock_session = MagicMock()
        mock_session.get_inputs.return_value = [MagicMock(name="input")]

        # 奇数尺寸：7x9 -> 填充后为 8x10 (W=8, H=10)
        # 模型输入维度应该是 (1, 3, 10, 8) (BCHW，对应 height=10, width=8)
        # 模型输出维度应该是 (1, 3, 20, 16)
        # 裁剪后输出应该是 14x18 (W=14, H=18)
        def mock_run(names, feeds):
            img_in = list(feeds.values())[0]
            # 验证填充已经发生且尺寸正确：H=10, W=8
            self.assertEqual(img_in.shape, (1, 3, 10, 8))
            return [np.ones((1, 3, 20, 16), dtype=np.float32) * 0.5]

        mock_session.run.side_effect = mock_run
        mock_get_session.return_value = mock_session

        result_bytes = run_upscale(odd_img_bytes, upscale_factor=2)
        result_img = Image.open(BytesIO(result_bytes))

        # 验证裁剪回的目标尺寸是 14x18
        self.assertEqual(result_img.size, (14, 18))


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


def test_onnx_session_uses_configurable_thread_limits(tmp_path, monkeypatch):
    """ONNX Runtime 应使用可配置线程数，避免容器内 CPU 线程过度抢占。"""
    model_path = tmp_path / "model.onnx"
    dynamic_path = tmp_path / "model_dynamic.onnx"
    captured = {}

    class FakeSession:
        pass

    def fake_inference_session(path, providers, sess_options):
        captured["path"] = path
        captured["providers"] = providers
        captured["intra_threads"] = sess_options.intra_op_num_threads
        captured["inter_threads"] = sess_options.inter_op_num_threads
        return FakeSession()

    monkeypatch.setattr(ai_engines, "_session", None)
    monkeypatch.setenv("UPSCALER_INTRA_OP_THREADS", "2")
    monkeypatch.setenv("UPSCALER_INTER_OP_THREADS", "1")
    monkeypatch.setattr(ai_engines, "_ensure_model_file", lambda: model_path)
    monkeypatch.setattr(ai_engines, "_ensure_dynamic_model", lambda path: dynamic_path)
    monkeypatch.setattr(ai_engines.ort, "get_available_providers", lambda: ["CPUExecutionProvider"])
    monkeypatch.setattr(ai_engines.ort, "InferenceSession", fake_inference_session)

    session = ai_engines._get_onnx_session()

    assert isinstance(session, FakeSession)
    assert captured == {
        "path": str(dynamic_path),
        "providers": ["CPUExecutionProvider"],
        "intra_threads": 2,
        "inter_threads": 1,
    }


def test_ensure_dynamic_model_conversion(tmp_path):
    """测试将静态 ONNX 模型转换为动态尺寸模型的逻辑，校验各个维度参数清空及赋值。"""
    static_path = tmp_path / "model.onnx"
    static_path.write_bytes(b"dummy")

    mock_model = MagicMock()
    mock_input = MagicMock()
    # 4 维：batch, channel, height, width
    dim_h = MagicMock()
    dim_w = MagicMock()
    mock_input.type.tensor_type.shape.dim = [MagicMock(), MagicMock(), dim_h, dim_w]
    mock_model.graph.input = [mock_input]

    mock_output = MagicMock()
    dim_out_h = MagicMock()
    dim_out_w = MagicMock()
    mock_output.type.tensor_type.shape.dim = [MagicMock(), MagicMock(), dim_out_h, dim_out_w]
    mock_model.graph.output = [mock_output]

    with patch("onnx.load", return_value=mock_model) as mock_load, \
         patch("onnx.save") as mock_save, \
         patch("os.replace") as mock_replace:

        res = ai_engines._ensure_dynamic_model(static_path)

        mock_load.assert_called_once_with(str(static_path))

        # 验证输入维度属性被清空并且设置了符号名称
        dim_h.ClearField.assert_called_once_with("dim_value")
        dim_w.ClearField.assert_called_once_with("dim_value")
        assert dim_h.dim_param == "height"
        assert dim_w.dim_param == "width"

        # 验证输出维度属性被清空并且设置了符号名称
        dim_out_h.ClearField.assert_called_once_with("dim_value")
        dim_out_w.ClearField.assert_called_once_with("dim_value")
        assert dim_out_h.dim_param == "out_height"
        assert dim_out_w.dim_param == "out_width"

        # 验证生成的动态模型文件名和路径，以及调用了保存方法
        assert res == tmp_path / "model_dynamic.onnx"
        mock_save.assert_called_once()
        mock_replace.assert_called_once()
