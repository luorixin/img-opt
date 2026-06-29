# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 1. 先复制依赖描述文件（只要 requirements.txt 不变，依赖层就不会重新下载）
COPY backend/requirements.txt /app/backend/requirements.txt
COPY backend/pyproject.toml /app/backend/pyproject.toml

# 2. 利用 BuildKit 缓存挂载与清华镜像源加速 pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ && \
    pip install -r /app/backend/requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

# 3. 最后拷贝源代码并执行本地可编辑安装（源码变更时，此步仅需 0.1 秒即可完成）
COPY backend/src /app/backend/src
RUN pip install --no-cache-dir -e /app/backend

EXPOSE 8000

CMD ["uvicorn", "img_cleaner_backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
