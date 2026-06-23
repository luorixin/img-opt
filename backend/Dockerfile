FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/src /app/backend/src

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/backend/requirements.txt \
    && pip install --no-cache-dir -e /app/backend

EXPOSE 8000

CMD ["uvicorn", "img_cleaner_backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
