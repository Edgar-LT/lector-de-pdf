FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY index.html ./

RUN useradd -m appuser && mkdir -p /app/.tts_cache && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; sys_exit = 0 if urllib.request.urlopen('http://localhost:8000/api/health').getcode() == 200 else 1; exit(sys_exit)"

# FORWARDED_ALLOW_IPS (env) define los proxies de confianza para X-Forwarded-For; por defecto solo 127.0.0.1.
# Con "*" cualquier cliente podría falsear su IP y evadir el rate limit.
# El rate limit vive en memoria por proceso: con --workers 2 el límite efectivo por IP es el doble del configurado.
ENV FORWARDED_ALLOW_IPS=127.0.0.1
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
