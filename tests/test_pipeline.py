from __future__ import annotations

import os
from pathlib import Path
import fitz
from fastapi.testclient import TestClient

from backend.app import app, rate_limiter, tts_engine
from backend.pdf_processor import CleaningOptions, SmartPDFCleaner
from backend.tts_engine import NeuralTTSEngine


client = TestClient(app)


def _build_test_pdf(output_path: Path) -> Path:
    """Crea un PDF temporal exclusivamente para pruebas unitarias."""
    doc = fitz.open()
    for page_num in range(1, 4):
        page = doc.new_page(width=595, height=842)
        page.insert_text(fitz.Point(55, 38), "ENCABEZADO REPETIDO DE PRUEBA", fontsize=8.5)
        page.insert_text(fitz.Point(55, 95), f"Capítulo {page_num}: Sección de Prueba", fontsize=14)
        rect = fitz.Rect(55, 135, 540, 350)
        page.insert_textbox(
            rect,
            "En un sistema embebido moderno, los microcon-\ntroladores procesan señales mediante lazos de retroali-\nmentación continua.",
            fontsize=11.5,
        )
        page.insert_text(fitz.Point(255, 805), f"Página {page_num} de 3", fontsize=9)
    doc.set_toc([[1, f"Capítulo {i}: Sección de Prueba", i] for i in range(1, 4)])
    doc.save(str(output_path))
    doc.close()
    return output_path


def test_smart_pdf_cleaner_removes_headers_and_page_numbers(tmp_path):
    """Verifica que el limpiador inteligente omita encabezados repetidos, números de página
    y una las palabras cortadas por guion al final de línea.
    """
    test_pdf = _build_test_pdf(tmp_path / "test_clean.pdf")
    pdf_bytes = test_pdf.read_bytes()

    cleaner = SmartPDFCleaner(
        options=CleaningOptions(
            remove_headers_footers=True,
            remove_page_numbers=True,
            fix_line_breaks=True,
        )
    )
    result = cleaner.parse_document(pdf_bytes=pdf_bytes, filename="test_clean.pdf")

    assert result["total_pages"] == 3
    assert len(result["chapters"]) == 3
    assert result["cleaning_stats"]["removed_headers_footers"] == 3
    assert result["cleaning_stats"]["removed_page_numbers"] == 3

    all_text = " ".join(
        s["text"] for page in result["pages"] for s in page["sentences"]
    )
    assert "microcontroladores" in all_text
    assert "retroalimentación" in all_text
    assert "ENCABEZADO REPETIDO DE PRUEBA" not in all_text
    assert "Página 1 de 3" not in all_text


def test_split_by_commas_and_periods():
    """Verifica la segmentación de lectura por comas y puntos respetando abreviaturas y números."""
    sample = "En la pág. 15 se explica que, según el Dr. Pérez, el voltaje es de 3,5 V; además, es constante."

    clauses_commas = SmartPDFCleaner.split_into_sentences(sample, split_by_commas=True)
    assert len(clauses_commas) == 5
    assert clauses_commas[0] == "En la pág. 15 se explica que,"
    assert clauses_commas[1] == "según el Dr. Pérez,"
    assert clauses_commas[2] == "el voltaje es de 3,5 V;"
    assert clauses_commas[3] == "además,"
    assert clauses_commas[4] == "es constante."

    sentences_only = SmartPDFCleaner.split_into_sentences(sample, split_by_commas=False)
    assert len(sentences_only) == 1
    assert "3,5 V" in sentences_only[0]


def test_api_endpoints_and_production_compliance():
    """Verifica endpoints REST, cabeceras de seguridad y archivos de monetización/cumplimiento."""
    rate_limiter.reset()
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.headers.get("X-Content-Type-Options") == "nosniff"
    assert health.headers.get("X-Frame-Options") == "SAMEORIGIN"

    voices = client.get("/api/voices")
    assert voices.status_code == 200
    assert len(voices.json()["voices"]) >= 6

    for route in ["/", "/privacy.html", "/ads.txt", "/app-ads.txt", "/manifest.webmanifest", "/ads.js", "/icon.svg", "/icon-192.png"]:
        res = client.get(route)
        assert res.status_code == 200, f"Fallo en ruta {route}"


def test_production_security_pdf_validation_and_rate_limiter(tmp_path):
    """Verifica el rechazo de archivos sin firma binaria %PDF-, el Rate Limiter y la purga LRU de caché."""
    rate_limiter.reset()

    # 1. Subir un archivo falso que termina en .pdf pero no tiene firma %PDF-
    fake_pdf = b"ESTE NO ES UN ARCHIVO PDF REAL"
    bad_res = client.post(
        "/api/pdf/parse",
        files={"file": ("falso.pdf", fake_pdf, "application/pdf")},
    )
    assert bad_res.status_code == 400
    assert "firma binaria PDF" in bad_res.json()["detail"]

    # 2. Verificar auto-purga de caché de audio (LRU)
    temp_engine = NeuralTTSEngine(cache_dir=tmp_path / "cache_test")
    for idx in range(5):
        f = temp_engine.cache_dir / f"sample_{idx}.mp3"
        f.write_bytes(b"ID3" + b"\x00" * 200)
    removed = temp_engine.prune_cache(max_files=2)
    assert removed == 3
    assert len(list(temp_engine.cache_dir.glob("*.mp3"))) == 2


def test_neural_tts_speak_and_export(tmp_path, monkeypatch):
    """Verifica el flujo completo de análisis PDF, síntesis de audio y exportación de audiolibro MP3."""
    rate_limiter.reset()
    if os.environ.get("CI") == "true":
        async def _mock_synth(text: str, voice: str = "es-MX-DaliaNeural", speed: float = 1.0, max_cache_files: int = 150) -> Path:
            dummy_mp3 = tmp_path / "mock_audio.mp3"
            dummy_mp3.write_bytes(b"ID3" + b"\x00" * 2048)
            return dummy_mp3

        monkeypatch.setattr(tts_engine, "synthesize_to_file", _mock_synth)

    test_pdf = _build_test_pdf(tmp_path / "libro_prueba.pdf")
    with test_pdf.open("rb") as f:
        parse_res = client.post(
            "/api/pdf/parse",
            files={"file": ("libro_prueba.pdf", f, "application/pdf")},
            data={
                "remove_headers_footers": "true",
                "remove_page_numbers": "true",
                "fix_line_breaks": "true",
            },
        )
    assert parse_res.status_code == 200
    doc_id = parse_res.json()["doc_id"]

    speak_res = client.post(
        "/api/tts/speak",
        json={
            "text": "Prueba de síntesis neuronal para el portafolio de ingeniería mecatrónica.",
            "voice": "es-MX-DaliaNeural",
            "speed": 1.0,
        },
    )
    assert speak_res.status_code == 200
    assert speak_res.headers["content-type"].startswith("audio/mpeg")
    assert len(speak_res.content) > 1000

    export_res = client.post(
        "/api/tts/export",
        json={
            "doc_id": doc_id,
            "start_page": 1,
            "end_page": 1,
            "voice": "es-MX-JorgeNeural",
            "speed": 1.25,
            "book_title": "Manual Mecatronica",
        },
    )
    assert export_res.status_code == 200
    assert export_res.headers["content-type"].startswith("audio/mpeg")
    assert len(export_res.content) > 1000
