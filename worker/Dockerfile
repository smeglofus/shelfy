FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libzbar0 \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid 1000 -m appuser
USER appuser

CMD ["celery", "-A", "celery_app", "worker", "--loglevel=info", "-Q", "default"]
