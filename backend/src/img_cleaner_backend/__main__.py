"""
应用程序的命令行执行入口。

支持通过 python -m img_cleaner_backend 启动本地开发服务器。
"""
import uvicorn

from img_cleaner_backend.app import app


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
