from __future__ import annotations

import os


class Settings:
    """Configuración de producción de VoxPDF Studio cargada desde variables de entorno."""

    APP_ENV: str = os.getenv("APP_ENV", "production")
    MAX_PDF_SIZE_MB: int = int(os.getenv("MAX_PDF_SIZE_MB", "20"))
    RATE_LIMIT_PARSE_PER_MIN: int = int(os.getenv("RATE_LIMIT_PARSE_PER_MIN", "15"))
    RATE_LIMIT_TTS_PER_MIN: int = int(os.getenv("RATE_LIMIT_TTS_PER_MIN", "90"))
    RATE_LIMIT_EXPORT_PER_MIN: int = int(os.getenv("RATE_LIMIT_EXPORT_PER_MIN", "8"))
    TTS_CACHE_MAX_FILES: int = int(os.getenv("TTS_CACHE_MAX_FILES", "150"))

    raw_origins: str = os.getenv(
        "ALLOWED_ORIGINS",
        "*,capacitor://localhost,http://localhost,https://edgar-lt.github.io",
    )
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]


settings = Settings()
