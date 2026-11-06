"""Regresión de XSS por títulos de capítulo provenientes del outline del PDF (hallazgo H1 de la auditoría)."""

from __future__ import annotations

import re
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import fitz
import pytest
import uvicorn

from backend.app import app

FRONTEND_APP_JS = Path(__file__).resolve().parent.parent / "frontend" / "app.js"

HOSTILE_TITLE = '<img src=x onerror="window.__xss_executed = true">'
SERVER_START_TIMEOUT_SEC = 10.0
UI_TIMEOUT_MS = 20_000

INNER_HTML_TEMPLATE_PATTERN = re.compile(r"\.innerHTML\s*=\s*`([^`]*)`")
TEMPLATE_EXPRESSION_PATTERN = re.compile(r"\$\{([^}]*)\}")
# Expresiones internas (no controladas por el PDF) permitidas dentro de plantillas innerHTML.
SAFE_TEMPLATE_EXPRESSIONS = (
    re.compile(r"^fontStyle\.\w+$"),
    re.compile(r"^numTag$"),
    re.compile(r"^formattedText$"),  # resultado de formatSentenceWithSearch(), que aplica escapeHtml
)


def test_inner_html_templates_only_interpolate_known_safe_expressions() -> None:
    source = FRONTEND_APP_JS.read_text(encoding="utf-8")
    unsafe: list[str] = []

    for template in INNER_HTML_TEMPLATE_PATTERN.findall(source):
        for expression in TEMPLATE_EXPRESSION_PATTERN.findall(template):
            if not any(pattern.match(expression.strip()) for pattern in SAFE_TEMPLATE_EXPRESSIONS):
                unsafe.append(expression.strip())

    assert not unsafe, f"Interpolaciones sin escapar en innerHTML (riesgo XSS): {unsafe}"


def _build_pdf_with_hostile_outline(path: Path) -> None:
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), "Texto de prueba. Otra oración de relleno.")
    doc.set_toc([[1, HOSTILE_TITLE, 1]])
    doc.save(str(path))
    doc.close()


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def live_server_url() -> Iterator[str]:
    port = _find_free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + SERVER_START_TIMEOUT_SEC
    while not server.started:
        if time.monotonic() > deadline:
            server.should_exit = True
            pytest.fail("El servidor de prueba no arrancó a tiempo.")
        time.sleep(0.05)

    yield f"http://127.0.0.1:{port}"

    server.should_exit = True
    thread.join(timeout=SERVER_START_TIMEOUT_SEC)


def test_hostile_chapter_title_is_rendered_as_text_in_real_browser(
    live_server_url: str, tmp_path: Path
) -> None:
    sync_api = pytest.importorskip("playwright.sync_api")
    pdf_path = tmp_path / "hostil.pdf"
    _build_pdf_with_hostile_outline(pdf_path)

    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel="msedge")
        except sync_api.Error as exc:
            pytest.skip(f"Microsoft Edge no disponible para Playwright: {exc}")

        try:
            page = browser.new_page()
            page.goto(live_server_url)
            page.set_input_files("#pdfFileInput", str(pdf_path))
            # El panel de capítulos puede estar colapsado: basta con que el nodo exista en el DOM.
            page.wait_for_selector(
                "#chapterList li .chapter-title-text", state="attached", timeout=UI_TIMEOUT_MS
            )

            rendered_title = page.text_content("#chapterList li .chapter-title-text")
            injected_images = page.locator("#chapterList img").count()
            payload_executed = page.evaluate("window.__xss_executed === true")
        finally:
            browser.close()

    assert rendered_title == HOSTILE_TITLE
    assert injected_images == 0
    assert payload_executed is False
