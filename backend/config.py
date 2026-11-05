from __future__ import annotations

import os


class Settings:
    """Configuración de producción de VoxPDF Studio cargada desde variables de entorno."""

    APP_ENV: str = os.getenv("APP_ENV", "production")
    MAX_PDF_SIZE_MB: int = int(os.getenv("MAX_PDF_SIZE_MB", "20"))
    MAX_PDF_PAGES: int = int(os.getenv("MAX_PDF_PAGES", "1000"))
    RATE_LIMIT_PARSE_PER_MIN: int = int(os.getenv("RATE_LIMIT_PARSE_PER_MIN", "15"))
    RATE_LIMIT_TTS_PER_MIN: int = int(os.getenv("RATE_LIMIT_TTS_PER_MIN", "90"))
    TTS_CACHE_MAX_FILES: int = int(os.getenv("TTS_CACHE_MAX_FILES", "200"))
    TTS_CACHE_MAX_SIZE_MB: int = int(os.getenv("TTS_CACHE_MAX_SIZE_MB", "300"))
    DOCUMENT_STORE_MAX_ITEMS: int = int(os.getenv("DOCUMENT_STORE_MAX_ITEMS", "30"))
    DOCUMENT_STORE_TTL_SECONDS: int = int(os.getenv("DOCUMENT_STORE_TTL_SECONDS", "3600"))

    raw_origins: str = os.getenv(
        "ALLOWED_ORIGINS",
        "capacitor://localhost,http://localhost,http://127.0.0.1:8000,https://edgar-lt.github.io",
    )
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]


settings = Settings()
