"""Servicio de aplicación para procesar PDFs.

Delega en ``SmartPDFCleaner`` (dominio) y mantiene a FastAPI fuera de la lógica de negocio.
"""

from __future__ import annotations

from typing import Any

from backend.pdf_processor import CleaningOptions, SmartPDFCleaner


class PdfProcessingService:
    """Parsea un PDF con las opciones de limpieza indicadas."""

    def __init__(self, options: CleaningOptions | None = None) -> None:
        self._cleaner = SmartPDFCleaner(options=options or CleaningOptions())

    def parse(self, pdf_bytes: bytes, filename: str) -> dict[str, Any]:
        return self._cleaner.parse_document(pdf_bytes=pdf_bytes, filename=filename)
