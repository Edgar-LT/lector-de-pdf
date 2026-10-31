from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class SlidingWindowRateLimiter:
    """Limitador de peticiones en memoria por IP y categoría de endpoint (ventana de 60s)."""

    def __init__(self, window_seconds: int = 60):
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._hits.clear()

    @staticmethod
    def get_client_ip(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "127.0.0.1"

    def check(self, request: Request, bucket: str, max_requests: int) -> None:
        now = time.monotonic()
        ip = self.get_client_ip(request)
        key = f"{bucket}:{ip}"
        q = self._hits[key]

        cutoff = now - self.window_seconds
        while q and q[0] < cutoff:
            q.popleft()

        if len(q) >= max_requests:
            retry_after = max(1, int(round(self.window_seconds - (now - q[0]))))
            raise HTTPException(
                status_code=429,
                detail=f"Límite de uso excedido ({max_requests} solicitudes/min). Intenta de nuevo en {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        q.append(now)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Middleware que inyecta cabeceras HTTP de seguridad recomendadas en producción."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


def validate_pdf_bytes(pdf_bytes: bytes, max_size_mb: int = 20) -> None:
    """Valida tamaño máximo y firma binaria mágica (%PDF-) de un archivo PDF."""
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="El archivo PDF está vacío.")

    max_bytes = max_size_mb * 1024 * 1024
    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo supera el tamaño máximo permitido de {max_size_mb} MB.",
        )

    # La especificación PDF exige que la cabecera %PDF- aparezca en los primeros 1024 bytes
    if b"%PDF-" not in pdf_bytes[:1024]:
        raise HTTPException(
            status_code=400,
            detail="El archivo subido no tiene una firma binaria PDF válida (%PDF-).",
        )
