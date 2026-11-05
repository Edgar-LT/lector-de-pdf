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

    # 1. Subir un archivo falso que termina en .pdf pero no tiene firma %PDF- (mayor a 32 bytes)
    fake_pdf = b"ESTE NO ES UN ARCHIVO PDF REAL - TEXTO DE RELLENO MAYOR A 32 BYTES"
    bad_res = client.post(
        "/api/pdf/parse",
        files={"file": ("falso.pdf", fake_pdf, "application/pdf")},
    )
    assert bad_res.status_code == 400
    assert "firma binaria PDF" in bad_res.json()["detail"]

    # 1b. Subir archivo demasiado pequeño (< 32 bytes)
    tiny_pdf = b"%PDF-1.4 corto"
    tiny_res = client.post(
        "/api/pdf/parse",
        files={"file": ("tiny.pdf", tiny_pdf, "application/pdf")},
    )
    assert tiny_res.status_code == 400
    assert "demasiado pequeño" in tiny_res.json()["detail"]

    # 2. Verificar auto-purga de caché de audio (LRU)
    temp_engine = NeuralTTSEngine(cache_dir=tmp_path / "cache_test")
    for idx in range(5):
        f = temp_engine.cache_dir / f"sample_{idx}.mp3"
        f.write_bytes(b"ID3" + b"\x00" * 200)
    removed = temp_engine.prune_cache(max_files=2)
    assert removed == 3
    assert len(list(temp_engine.cache_dir.glob("*.mp3"))) == 2


def test_neural_tts_speak(tmp_path, monkeypatch):
    """Verifica el flujo de análisis PDF y síntesis de audio neuronal por fragmentos."""
    rate_limiter.reset()
    if os.environ.get("CI") == "true":
        async def _mock_synth(text: str, voice: str = "es-MX-DaliaNeural", speed: float = 1.0, max_cache_files: int = 150, max_cache_size_mb: int = 300) -> Path:
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
    assert "doc_id" in parse_res.json()

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


def test_citation_cleaning_and_kerning_despacing(tmp_path):
    """Verifica la eliminación de citas bibliográficas tipo [1, 28] y la normalización de kerning tipográfico."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    # Título tipográfico espaciado y citas entre corchetes
    page.insert_text(fitz.Point(55, 60), "A R C O  I :  L A   F O R J A", fontsize=14)
    rect = fitz.Rect(55, 100, 540, 300)
    page.insert_textbox(
        rect,
        "Los modelos basados en Transformers [14, 21, 28] superan a los recurrentes [1] en traducción neuronal.",
        fontsize=11.5,
    )
    pdf_path = tmp_path / "test_citations.pdf"
    doc.save(str(pdf_path))
    doc.close()

    cleaner = SmartPDFCleaner(
        options=CleaningOptions(
            remove_academic_citations=True,
            fix_line_breaks=True,
        )
    )
    result = cleaner.parse_document(pdf_bytes=pdf_path.read_bytes(), filename="test_citations.pdf")
    page_text = " ".join(s["text"] for s in result["pages"][0]["sentences"])

    # Comprobar que las citas numéricas se eliminaron
    assert "[14, 21, 28]" not in page_text
    assert "[1]" not in page_text
    assert "superan a los recurrentes en traducción neuronal" in page_text
    # Comprobar que el espaciado de título se normalizó
    assert "ARCO I : LA FORJA" in page_text


def test_heuristic_chapter_detection_when_no_toc(tmp_path):
    """Verifica que documentos sin tabla de contenidos (TOC) detecten capítulos heurísticamente."""
    doc = fitz.open()
    # Página 1: Capítulo 1
    p1 = doc.new_page(width=595, height=842)
    p1.insert_text(fitz.Point(55, 60), "Capítulo 1: El Despertar de la IA", fontsize=14)
    p1.insert_text(fitz.Point(55, 100), "Texto del primer capítulo.", fontsize=11)
    # Página 2: Sin título de capítulo
    p2 = doc.new_page(width=595, height=842)
    p2.insert_text(fitz.Point(55, 60), "Continuación de la trama en la página dos.", fontsize=11)
    # Página 3: Capítulo 2
    p3 = doc.new_page(width=595, height=842)
    p3.insert_text(fitz.Point(55, 60), "Capítulo 2: La Gran Convergencia", fontsize=14)
    p3.insert_text(fitz.Point(55, 100), "Texto del segundo capítulo.", fontsize=11)

    pdf_path = tmp_path / "test_heuristic_toc.pdf"
    # Guardar SIN doc.set_toc(...)
    doc.save(str(pdf_path))
    doc.close()

    cleaner = SmartPDFCleaner()
    result = cleaner.parse_document(pdf_bytes=pdf_path.read_bytes(), filename="test_heuristic_toc.pdf")
    chapters = result.get("chapters", [])
    assert len(chapters) >= 2
    assert any("Capítulo 1" in c["title"] for c in chapters)
    assert any("Capítulo 2" in c["title"] for c in chapters)


def test_ttl_cache_store_eviction_and_expiry():
    """Verifica que TTLCacheStore respete la expiración por tiempo y el límite máximo de elementos."""
    from backend.security import TTLCacheStore

    cache = TTLCacheStore(max_items=3, ttl_seconds=1)
    cache.set("a", 10)
    cache.set("b", 20)
    cache.set("c", 30)
    assert len(cache) == 3
    assert cache.get("a") == 10

    # Agregar el 4to elemento debe purgar el más antiguo ("a")
    cache.set("d", 40)
    assert len(cache) == 3
    assert cache.get("a") is None
    assert cache.get("d") == 40

    # Simular paso del tiempo expirando entradas
    cache._data["b"] = (1.0, 20)  # forzar expiración en el pasado
    assert cache.get("b") is None
    assert "b" not in cache
