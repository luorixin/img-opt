# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install iopaint -i https://pypi.tuna.tsinghua.edu.cn/simple

EXPOSE 8081

CMD ["iopaint", "start", "--model=lama", "--device=cpu", "--enable-interactive-seg", "--interactive-seg-model=mobile_sam", "--interactive-seg-device=cpu", "--host=0.0.0.0", "--port=8081", "--model-dir=/models"]
