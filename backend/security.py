from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from typing import Callable

import fitz
from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Extensiones ejecutables o de script que nunca deben estar presentes en el nombre de un PDF
DANGEROUS_EXTENSIONS = {
    "exe", "bat", "cmd", "sh", "vbs", "ps1", "js", "jse", "wsf", "wsh",
    "php", "phtml", "py", "pyw", "jar", "msi", "scr", "com", "dll", "hta",
    "cpl", "msc", "reg", "vb", "vbe", "gadget", "apk", "app", "iso", "bin",
}

# Firmas binarias (Magic Bytes) de ejecutables y scripts peligrosos
DANGEROUS_MAGIC_HEADERS: list[tuple[bytes, str]] = [
    (b"MZ", "Ejecutable binario de Windows (PE / EXE / DLL)"),
    (b"\x7fELF", "Ejecutable binario de Linux (ELF)"),
    (b"\xca\xfe\xba\xbe", "Bytecode binario de Java Class / Mach-O"),
    (b"\xfe\xed\xfa\xce", "Binario ejecutable Mach-O 32-bit"),
    (b"\xfe\xed\xfa\xcf", "Binario ejecutable Mach-O 64-bit"),
    (b"\xce\xfa\xed\xfe", "Binario ejecutable Mach-O"),
    (b"\xcf\xfa\xed\xfe", "Binario ejecutable Mach-O"),
    (b"<?php", "Script ejecutable PHP"),
    (b"#!/", "Script ejecutable de consola / Shell script"),
    (b"<script", "Script Web embebido (HTML/JS polyglot)"),
    (b"<html", "Documento Web HTML disfrazado de PDF"),
]

# Vectores conocidos de exploits y ejecución remota en documentos PDF
DANGEROUS_PDF_TOKENS: list[tuple[bytes, str]] = [
    (b"/Launch", "Acción de ejecución de comandos del sistema operativo (/Launch)"),
]


# Clave de bucket para clientes sin IP identificable (no debe compartirse con 127.0.0.1)
UNKNOWN_CLIENT_KEY = "unknown"


def sanitize_and_validate_filename(filename: str) -> str:
    """Valida y sanitiza el nombre de archivo para prevenir Path Traversal, caracteres nulos y doble extensión maliciosa."""
    if not filename or not isinstance(filename, str):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido o ausente.")

    # 1. Caracteres nulos (técnica de truncamiento de extensiones)
    if "\x00" in filename:
        raise HTTPException(status_code=400, detail="Nombre de archivo contiene caracteres nulos no permitidos.")

    # 2. Path Traversal y caracteres de ruta
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nombre de archivo contiene secuencias de ruta no permitidas.")

    # 3. Longitud máxima y mínima
    cleaned = filename.strip()
    if len(cleaned) < 5 or len(cleaned) > 255:
        raise HTTPException(
            status_code=400, detail="La longitud del nombre de archivo debe estar entre 5 y 255 caracteres."
        )

    # 4. Extensión final obligatoria .pdf
    if not cleaned.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe tener extensión .pdf.")

    # 5. Detección de doble extensión maliciosa (ej. factura.exe.pdf o documento.vbs.pdf)
    parts = cleaned.lower().split(".")
    if len(parts) > 2:
        for mid_ext in parts[1:-1]:
            if mid_ext in DANGEROUS_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Archivo bloqueado por seguridad: doble extensión potencialmente maliciosa (.{mid_ext}.pdf).",
                )

    # 6. Sanitizar caracteres preservando caracteres alfanuméricos, acentos y guiones
    safe_name = re.sub(r"[^\w\s.-]", "", cleaned)
    return safe_name or "documento.pdf"


class TTLCacheStore:
    """Almacén seguro en memoria con caducidad TTL y tamaño máximo acotado (LRU)."""

    def __init__(self, max_items: int = 30, ttl_seconds: int = 3600):
        self.max_items = max_items
        self.ttl_seconds = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}

    def set(self, key: str, value: Any) -> None:
        self.purge_expired()
        if len(self._data) >= self.max_items and key not in self._data:
            # Eliminar la clave más antigua
            oldest_key = next(iter(self._data))
            self._data.pop(oldest_key, None)
        self._data[key] = (time.time() + self.ttl_seconds, value)

    def get(self, key: str) -> Any | None:
        self.purge_expired()
        entry = self._data.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.time() > expires_at:
            self._data.pop(key, None)
            return None
        return value

    def __contains__(self, key: str) -> bool:
        return self.get(key) is not None

    def __getitem__(self, key: str) -> Any:
        val = self.get(key)
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key: str, value: Any) -> None:
        self.set(key, value)

    def __len__(self) -> int:
        self.purge_expired()
        return len(self._data)

    def purge_expired(self) -> None:
        now = time.time()
        expired_keys = [k for k, (exp, _) in self._data.items() if now > exp]
        for k in expired_keys:
            self._data.pop(k, None)


class SlidingWindowRateLimiter:
    """Limitador de peticiones en memoria por IP y categoría de endpoint (ventana de 60s)."""

    def __init__(self, window_seconds: int = 60):
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._hits.clear()

    @staticmethod
    def get_client_ip(request: Request) -> str:
        """IP del cliente según el scope ASGI.

        No se lee X-Forwarded-For aquí: cualquier cliente puede fijarlo. Detrás de un proxy,
        uvicorn (--proxy-headers + FORWARDED_ALLOW_IPS) ya normaliza request.client.host
        recorriendo la cabecera de derecha a izquierda solo a través de proxies de confianza.
        """
        if request.client and request.client.host:
            return request.client.host
        return UNKNOWN_CLIENT_KEY

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


def validate_pdf_bytes(pdf_bytes: bytes, max_size_mb: int = 20, max_pages: int = 1500) -> None:
    """Valida tamaño, firma binaria mágica, ausencia de malware y estructura íntegra del PDF."""
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="El archivo PDF está vacío.")

    # 1. Tamaño mínimo realista (un PDF válido pesa más de 32 bytes)
    if len(pdf_bytes) < 32:
        raise HTTPException(status_code=400, detail="El archivo es demasiado pequeño para ser un PDF válido.")

    # 2. Tamaño máximo permitido
    max_bytes = max_size_mb * 1024 * 1024
    if len(pdf_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo supera el tamaño máximo permitido de {max_size_mb} MB.",
        )

    # 3. Comprobar que no sea un binario ejecutable o script disfrazado con extensión .pdf
    start_bytes = pdf_bytes[:32]
    for magic, description in DANGEROUS_MAGIC_HEADERS:
        if start_bytes.startswith(magic):
            raise HTTPException(
                status_code=400,
                detail=f"Archivo bloqueado por seguridad: se detectó firma de {description}.",
            )

    # 4. Firma binaria obligatoria %PDF- en los primeros 1024 bytes (norma ISO 32000-1)
    if b"%PDF-" not in pdf_bytes[:1024]:
        raise HTTPException(
            status_code=400,
            detail="El archivo subido no tiene una firma binaria PDF válida (%PDF-).",
        )

    # 5. Escaneo de vectores de exploit y ejecución en el flujo del PDF
    for token, reason in DANGEROUS_PDF_TOKENS:
        if token in pdf_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"Archivo bloqueado por seguridad: contiene {reason}.",
            )

    # Verificar si contiene adjuntos embebidos ejecutables (/EmbeddedFiles)
    if b"/EmbeddedFiles" in pdf_bytes:
        lower_stream = pdf_bytes.lower()
        for dangerous_ext in [b".exe", b".bat", b".cmd", b".sh", b".vbs", b".ps1", b".js", b".jar"]:
            if dangerous_ext in lower_stream:
                raise HTTPException(
                    status_code=400,
                    detail="Archivo bloqueado por seguridad: contiene archivos adjuntos ejecutables ocultos.",
                )

    # 6. Verificación estructural con PyMuPDF en entorno de inspección
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Estructura PDF corrupta o no legible: {exc}",
        ) from exc

    try:
        if doc.is_encrypted and not doc.authenticate(""):
            raise HTTPException(
                status_code=400,
                detail="El archivo PDF está protegido con contraseña. Desbloquéalo antes de subirlo.",
            )

        if doc.page_count > max_pages:
            raise HTTPException(
                status_code=400,
                detail=f"El documento supera el límite de seguridad de {max_pages} páginas (tiene {doc.page_count}).",
            )

        if doc.page_count < 1:
            raise HTTPException(
                status_code=400,
                detail="El documento PDF no contiene páginas legibles.",
            )
    finally:
        doc.close()
