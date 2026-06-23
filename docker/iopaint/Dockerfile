FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir iopaint

EXPOSE 8081

CMD ["iopaint", "start", "--model=lama", "--device=cpu", "--host=0.0.0.0", "--port=8081", "--model-dir=/models"]
