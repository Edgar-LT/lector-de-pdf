from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.pdf_processor import CleaningOptions, SmartPDFCleaner
from backend.tts_engine import NeuralTTSEngine


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="VoxPDF Studio API",
    description="Conversor inteligente de PDF a Audiolibro con Voces Neuronales y Limpieza de Texto",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tts_engine = NeuralTTSEngine(cache_dir=BASE_DIR / ".tts_cache")

# Almacén en memoria del último documento procesado para exportación rápida
DOCUMENT_STORE: dict[str, dict[str, Any]] = {}


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = Field(default="es-MX-DaliaNeural")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class ExportRequest(BaseModel):
    doc_id: str | None = None
    start_page: int = Field(default=1, ge=1)
    end_page: int = Field(default=1, ge=1)
    voice: str = Field(default="es-MX-DaliaNeural")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    custom_text: str | None = None
    book_title: str = "Audiolibro"


@app.get("/api/health")
async def health_check() -> dict[str, Any]:
    return {"status": "ok", "engine": "edge-tts + PyMuPDF"}


@app.get("/api/voices")
async def list_voices() -> dict[str, Any]:
    return {"voices": tts_engine.get_available_voices()}


@app.post("/api/pdf/parse")
async def parse_pdf(
    file: UploadFile = File(...),
    remove_headers_footers: bool = Form(True),
    remove_page_numbers: bool = Form(True),
    fix_line_breaks: bool = Form(True),
) -> dict[str, Any]:
    filename = file.filename or "documento.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser un documento PDF (.pdf).")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="El archivo PDF está vacío.")

    options = CleaningOptions(
        remove_headers_footers=remove_headers_footers,
        remove_page_numbers=remove_page_numbers,
        fix_line_breaks=fix_line_breaks,
    )
    cleaner = SmartPDFCleaner(options=options)
    try:
        parsed = cleaner.parse_document(pdf_bytes=pdf_bytes, filename=filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"No se pudo procesar el PDF: {exc}") from exc

    DOCUMENT_STORE[parsed["doc_id"]] = parsed
    return parsed


@app.post("/api/tts/speak")
async def speak_sentence(req: SpeakRequest) -> FileResponse:
    try:
        audio_path = await tts_engine.synthesize_to_file(
            text=req.text,
            voice=req.voice,
            speed=req.speed,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error al sintetizar audio neuronal: {exc}") from exc

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        filename="fragmento.mp3",
    )


@app.post("/api/tts/export")
async def export_audiobook(req: ExportRequest) -> FileResponse:
    safe_title = re.sub(r"[^A-Za-z0-9_-]+", "_", req.book_title).strip("_") or "Audiolibro"

    if req.custom_text and req.custom_text.strip():
        try:
            audio_path = await tts_engine.synthesize_to_file(
                text=req.custom_text.strip(),
                voice=req.voice,
                speed=req.speed,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Error al exportar audio: {exc}") from exc

        return FileResponse(
            path=str(audio_path),
            media_type="audio/mpeg",
            filename=f"{safe_title}_p{req.start_page}-{req.end_page}.mp3",
        )

    if not req.doc_id or req.doc_id not in DOCUMENT_STORE:
        raise HTTPException(
            status_code=404,
            detail="Documento no encontrado en sesión. Vuelve a cargar el PDF o envía el texto.",
        )

    doc_data = DOCUMENT_STORE[req.doc_id]
    pages = doc_data.get("pages", [])
    start_p = max(1, min(req.start_page, len(pages)))
    end_p = max(start_p, min(req.end_page, len(pages)))

    try:
        audio_path = await tts_engine.export_audiobook_mp3(
            pages=pages,
            start_page=start_p,
            end_page=end_p,
            voice=req.voice,
            speed=req.speed,
            book_title=safe_title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error al generar audiolibro MP3: {exc}") from exc

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        filename=f"{safe_title}_Pag_{start_p}_a_{end_p}.mp3",
    )


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/styles.css")
async def serve_styles() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "styles.css"), media_type="text/css")


@app.get("/app.js")
async def serve_app_js() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "app.js"), media_type="application/javascript")

