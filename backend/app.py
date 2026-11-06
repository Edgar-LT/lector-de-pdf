from __future__ import annotations

import base64
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.config import settings
from backend.pdf_processor import CleaningOptions, SmartPDFCleaner
from backend.security import (
    SecurityHeadersMiddleware,
    SlidingWindowRateLimiter,
    sanitize_and_validate_filename,
    validate_pdf_bytes,
)
from backend.services.error_handler import exception_to_http
from backend.services.pdf_processing_service import PdfProcessingService
from backend.tts_engine import NeuralTTSEngine, TtsUnavailableError

logger = logging.getLogger(__name__)

UPLOAD_CHUNK_SIZE_BYTES = 64 * 1024
BYTES_PER_MB = 1024 * 1024

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="VoxPDF Studio Production API",
    description="Conversor inteligente de PDF a Audiolibro con Voces Neuronales, Limpieza de Texto y Monetización",
    version="1.3.0",
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tts_engine = NeuralTTSEngine(cache_dir=BASE_DIR / ".tts_cache")
rate_limiter = SlidingWindowRateLimiter(window_seconds=60)


def get_tts_engine() -> NeuralTTSEngine:
    """Proveedor de dependencia para el motor TTS (facilita overrides en pruebas)."""
    return tts_engine


def get_rate_limiter() -> SlidingWindowRateLimiter:
    """Proveedor de dependencia para el limitador de tasa."""
    return rate_limiter


class CreatePdfRequest(BaseModel):
    title: str = Field(default="Documento", max_length=200)
    text: str = Field(..., min_length=1, max_length=500000)
    author: str = Field(default="VoxPDF Studio", max_length=100)
    split_by_commas: bool = True
    remove_academic_citations: bool = True


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = Field(default="es-MX-DaliaNeural")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@app.get("/api/health")
async def health_check(engine: NeuralTTSEngine = Depends(get_tts_engine)) -> dict[str, Any]:
    try:
        mp3_files = list(engine.cache_dir.glob("*.mp3")) if engine.cache_dir.exists() else []
        cache_bytes = sum(f.stat().st_size for f in mp3_files)
        status = "ok"
    except OSError:
        mp3_files = []
        cache_bytes = 0
        status = "degraded"
    return {
        "status": status,
        "version": "1.3.0",
        "engine": "edge-tts + PyMuPDF",
        "max_pdf_size_mb": settings.MAX_PDF_SIZE_MB,
        "max_pdf_pages": settings.MAX_PDF_PAGES,
        "cache_stats": {
            "cached_mp3_files": len(mp3_files),
            "cache_size_mb": round(cache_bytes / (1024 * 1024), 2),
        },
    }


@app.get("/api/voices")
async def list_voices(engine: NeuralTTSEngine = Depends(get_tts_engine)) -> dict[str, Any]:
    return {"voices": engine.get_available_voices()}


async def _read_upload_with_limit(file: UploadFile, max_bytes: int) -> bytes:
    """Lee la subida por bloques y aborta con 413 en cuanto se excede el límite (evita agotar la RAM)."""
    chunks: list[bytes] = []
    received = 0
    while chunk := await file.read(UPLOAD_CHUNK_SIZE_BYTES):
        received += len(chunk)
        if received > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"El archivo supera el tamaño máximo permitido de {settings.MAX_PDF_SIZE_MB} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@exception_to_http(status_code=422, detail="No se pudo procesar el PDF")
async def _parse_pdf_in_threadpool(service: PdfProcessingService, pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    return await run_in_threadpool(service.parse, pdf_bytes=pdf_bytes, filename=filename)


@app.post("/api/pdf/parse")
async def parse_pdf(
    request: Request,
    file: UploadFile = File(...),
    remove_headers_footers: bool = Form(True),
    remove_page_numbers: bool = Form(True),
    fix_line_breaks: bool = Form(True),
    split_by_commas: bool = Form(True),
    remove_academic_citations: bool = Form(True),
    limiter: SlidingWindowRateLimiter = Depends(get_rate_limiter),
) -> dict[str, Any]:
    limiter.check(request, bucket="parse", max_requests=settings.RATE_LIMIT_PARSE_PER_MIN)

    filename = sanitize_and_validate_filename(file.filename or "")
    pdf_bytes = await _read_upload_with_limit(file, max_bytes=settings.MAX_PDF_SIZE_MB * BYTES_PER_MB)
    validate_pdf_bytes(pdf_bytes, max_size_mb=settings.MAX_PDF_SIZE_MB, max_pages=settings.MAX_PDF_PAGES)

    options = CleaningOptions(
        remove_headers_footers=remove_headers_footers,
        remove_page_numbers=remove_page_numbers,
        fix_line_breaks=fix_line_breaks,
        split_by_commas=split_by_commas,
        remove_academic_citations=remove_academic_citations,
    )
    parsed = await _parse_pdf_in_threadpool(PdfProcessingService(options=options), pdf_bytes, filename)
    return parsed


@app.post("/api/pdf/create-from-text")
async def create_pdf_from_text(
    request: Request,
    payload: CreatePdfRequest,
    limiter: SlidingWindowRateLimiter = Depends(get_rate_limiter),
) -> dict[str, Any]:
    limiter.check(request, bucket="parse", max_requests=settings.RATE_LIMIT_PARSE_PER_MIN)
    text_content = payload.text.strip()
    if not text_content:
        raise HTTPException(status_code=400, detail="El contenido del texto no puede estar vacío.")

    title = payload.title.strip() or "Documento"
    safe_filename = re.sub(r"[^\w\s-]", "", title).strip() or "documento"
    safe_filename = f"{safe_filename[:40]}.pdf"

    pdf_bytes = await run_in_threadpool(
        SmartPDFCleaner.create_pdf_from_text,
        title=title,
        text=text_content,
        author=payload.author,
    )

    cleaner = SmartPDFCleaner(
        options=CleaningOptions(
            split_by_commas=payload.split_by_commas,
            remove_academic_citations=payload.remove_academic_citations,
        )
    )
    parsed = await run_in_threadpool(cleaner.parse_document, pdf_bytes=pdf_bytes, filename=safe_filename)

    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "filename": safe_filename,
        "parsed": parsed,
    }


@app.post("/api/tts/speak")
async def speak_sentence(
    request: Request,
    req: SpeakRequest,
    limiter: SlidingWindowRateLimiter = Depends(get_rate_limiter),
    engine: NeuralTTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    limiter.check(request, bucket="tts", max_requests=settings.RATE_LIMIT_TTS_PER_MIN)

    try:
        audio_path = await engine.synthesize_to_file(
            text=req.text,
            voice=req.voice,
            speed=req.speed,
            max_cache_files=settings.TTS_CACHE_MAX_FILES,
            max_cache_size_mb=settings.TTS_CACHE_MAX_SIZE_MB,
        )
    except TtsUnavailableError as exc:
        logger.warning("Servicio TTS no disponible temporalmente: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="El servicio de voz neuronal no está disponible temporalmente. Reintenta en unos segundos.",
            headers={"Retry-After": "10"},
        ) from exc
    except Exception as exc:
        logger.exception("Fallo inesperado en /api/tts/speak")
        raise HTTPException(status_code=502, detail="Error al sintetizar el audio.") from exc

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        filename="fragmento.mp3",
    )


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
    vendor_dir = FRONTEND_DIR / "vendor"
    if vendor_dir.exists():
        app.mount("/vendor", StaticFiles(directory=str(vendor_dir)), name="vendor")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/tailwind.css")
async def serve_tailwind_css() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "tailwind.css"), media_type="text/css")


@app.get("/styles.css")
async def serve_styles() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "styles.css"), media_type="text/css")


@app.get("/app.js")
async def serve_app_js() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "app.js"), media_type="application/javascript")


@app.get("/storage.js")
async def serve_storage_js() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "storage.js"), media_type="application/javascript")


@app.get("/pdf-client-parser.js")
async def serve_pdf_client_parser_js() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "pdf-client-parser.js"), media_type="application/javascript")


@app.get("/ads.js")
async def serve_ads_js() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "ads.js"), media_type="application/javascript")


@app.get("/privacy.html")
async def serve_privacy() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "privacy.html"))


@app.get("/ads.txt")
async def serve_ads_txt() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "ads.txt"), media_type="text/plain")


@app.get("/app-ads.txt")
async def serve_app_ads_txt() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "app-ads.txt"), media_type="text/plain")


@app.get("/manifest.webmanifest")
async def serve_manifest() -> FileResponse:
    return FileResponse(
        str(FRONTEND_DIR / "manifest.webmanifest"),
        media_type="application/manifest+json",
    )


@app.get("/sw.js")
async def serve_sw() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "sw.js"), media_type="application/javascript")


@app.get("/icon.svg")
async def serve_icon_svg() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "icon.svg"), media_type="image/svg+xml")


@app.get("/icon-192.png")
async def serve_icon_192() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "icon-192.png"), media_type="image/png")


@app.get("/icon-512.png")
async def serve_icon_512() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "icon-512.png"), media_type="image/png")
