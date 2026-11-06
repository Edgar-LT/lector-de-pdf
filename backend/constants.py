"""Constantes compartidas del backend (evitan números mágicos)."""

from __future__ import annotations

# Tamaño mínimo (bytes) de un MP3 en caché para considerarlo válido
MIN_CACHE_FILE_SIZE = 128

# Límites por defecto de la caché de audio TTS
DEFAULT_TTS_MAX_FILES = 150
DEFAULT_TTS_MAX_SIZE_MB = 300

# Directiva Content-Security-Policy compartida entre la cabecera HTTP y el <meta> de index.html
CSP_DIRECTIVES: dict[str, str] = {
    "default-src": "'self'",
    "script-src": "'self'",
    "style-src": "'self' https://fonts.googleapis.com",
    "style-src-attr": "'unsafe-inline'",
    "font-src": "https://fonts.gstatic.com",
    "img-src": "'self' data: blob:",
    "media-src": "'self' blob: data:",
    "connect-src": "'self'",
    "worker-src": "'self' blob:",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
}
FRAME_ANCESTORS = "'self'"
HSTS_HEADER_VALUE = "max-age=31536000"


def build_csp_header(*, include_frame_ancestors: bool = True) -> str:
    """Construye la cadena CSP a partir de ``CSP_DIRECTIVES``."""
    parts = [f"{directive} {value}" for directive, value in CSP_DIRECTIVES.items()]
    if include_frame_ancestors:
        parts.append(f"frame-ancestors {FRAME_ANCESTORS}")
    return "; ".join(parts)
