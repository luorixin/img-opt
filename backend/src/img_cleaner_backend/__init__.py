"""
Image Cleaner 图像处理后端包。

暴露工厂函数 create_app 用于构建 FastAPI 应用。
"""
__all__ = ["create_app"]

from img_cleaner_backend.app import create_app
