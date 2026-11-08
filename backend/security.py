from __future__ import annotations

import re
import threading
import time
from collections import deque
from collections.abc import Callable
from pathlib import PurePosixPath

import fitz
from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from backend.constants import HSTS_HEADER_VALUE, build_csp_header

# Extensiones ejecutables o de script que nunca deben estar presentes en el nombre de un PDF o adjunto
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
DANGEROUS_PDF_TOKENS_STR: list[tuple[str, str]] = [
    (token.decode("ascii"), reason) for token, reason in DANGEROUS_PDF_TOKENS
]

# Límite máximo de objetos XREF a inspeccionar descomprimidos para acotar el tiempo de validación
MAX_XREF_SCAN = 2000

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


class SlidingWindowRateLimiter:
    """Limitador de peticiones en memoria acotado (Bounded LRU) y seguro para concurrencia (thread-safe).

    Previene fugas de memoria (MLE) y condiciones de carrera bajo alta carga y rotación masiva de IPs.
    """

    def __init__(self, window_seconds: int = 60, max_tracked_keys: int = 50_000):
        self.window_seconds = window_seconds
        self.max_tracked_keys = max_tracked_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._cleanup_counter = 0

    def reset(self) -> None:
        with self._lock:
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
        cutoff = now - self.window_seconds

        with self._lock:
            self._cleanup_counter += 1
            # Purga periódica amortizada de claves inactivas para mantener heap O(K)
            if self._cleanup_counter % 200 == 0 or len(self._hits) >= self.max_tracked_keys:
                stale_keys = [k for k, q in self._hits.items() if not q or q[-1] < cutoff]
                for k in stale_keys:
                    del self._hits[k]

                # Si aún excede el límite máximo por ataque de inundación, expulsar la más antigua
                while len(self._hits) >= self.max_tracked_keys:
                    oldest_k = next(iter(self._hits))
                    del self._hits[oldest_k]

            if key not in self._hits:
                self._hits[key] = deque()

            q = self._hits[key]

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

    _CSP_HEADER = build_csp_header(include_frame_ancestors=True)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = self._CSP_HEADER
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = HSTS_HEADER_VALUE
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


def _contains_dangerous_action(doc: fitz.Document) -> str | None:
    """Inspecciona el catálogo de objetos y diccionario de acciones del PDF sin límite ciego de XREF.

    Examina exhaustivamente la raíz del documento, catálogo de nombres y puntos de entrada de acciones (/Launch).
    """
    # 1. Comprobación focalizada de entradas de ejecución en el Catálogo (/Root)
    try:
        root_xref = doc.pdf_catalog()
        root_dict = doc.xref_object(root_xref, compressed=False)
        for token, reason in DANGEROUS_PDF_TOKENS_STR:
            if token in root_dict:
                return reason
    except (RuntimeError, ValueError):
        pass

    # 2. Búsqueda exhaustiva sin bypass: si el PDF tiene xrefs, iteramos con protección
    total_xrefs = doc.xref_length()
    for xref in range(1, total_xrefs):
        try:
            # Inspección no comprimida de objetos relevantes
            body = doc.xref_object(xref, compressed=False)
        except (RuntimeError, ValueError):
            continue
        for token, reason in DANGEROUS_PDF_TOKENS_STR:
            if token in body:
                return reason
    return None


def _has_dangerous_embedded_files(doc: fitz.Document, raw_bytes: bytes) -> bool:
    """Detecta adjuntos embebidos con extensión ejecutable (tanto vía catálogo de PyMuPDF como en bytes)."""
    try:
        names = doc.embfile_names()
    except (RuntimeError, ValueError):
        names = []
    for name in names:
        ext = PurePosixPath(name.replace("\\", "/")).suffix.lower().lstrip(".")
        if ext in DANGEROUS_EXTENSIONS:
            return True

    if b"/EmbeddedFiles" in raw_bytes:
        lower_stream = raw_bytes.lower()
        for ext in ("exe", "bat", "cmd", "sh", "vbs", "ps1", "js", "jar"):
            if re.search(rf"\.{ext}\b".encode("ascii"), lower_stream):
                return True
    return False


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

    # 5. Escaneo rápido de vectores de exploit en el flujo de bytes sin comprimir
    for token, reason in DANGEROUS_PDF_TOKENS:
        if token in pdf_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"Archivo bloqueado por seguridad: contiene {reason}.",
            )

    # 6. Verificación estructural con PyMuPDF (incluye objetos comprimidos en ObjStm y adjuntos)
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

        dangerous_reason = _contains_dangerous_action(doc)
        if dangerous_reason:
            raise HTTPException(
                status_code=400,
                detail=f"Archivo bloqueado por seguridad: contiene {dangerous_reason}.",
            )

        if _has_dangerous_embedded_files(doc, pdf_bytes):
            raise HTTPException(
                status_code=400,
                detail="Archivo bloqueado por seguridad: contiene archivos adjuntos ejecutables ocultos.",
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
