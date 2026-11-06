"""Verifica el decorador ``exception_to_http``, los límites de subida y el rate limit de /api/pdf/parse."""

from __future__ import annotations

import asyncio

import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import app, rate_limiter
from backend.config import settings
from backend.services.error_handler import exception_to_http

EXTRA_REQUESTS_OVER_LIMIT = 3


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    rate_limiter.reset()


def _make_pdf_bytes(text: str = "Hola mundo. Esto es una prueba de lectura.") -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 100), text)
    data = doc.tobytes()
    doc.close()
    return data


def test_decorator_maps_unexpected_exception_to_custom_detail() -> None:
    @exception_to_http(status_code=418, detail="Soy una tetera")
    async def faulty() -> None:
        raise RuntimeError("Error interno")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(faulty())

    assert exc_info.value.status_code == 418
    assert exc_info.value.detail == "Soy una tetera"


def test_decorator_preserves_existing_http_exception() -> None:
    @exception_to_http(status_code=500, detail="genérico")
    async def already_http() -> None:
        raise HTTPException(status_code=413, detail="demasiado grande")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(already_http())

    assert exc_info.value.status_code == 413
    assert exc_info.value.detail == "demasiado grande"


def test_parse_endpoint_accepts_valid_pdf() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/pdf/parse",
        files={"file": ("documento.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total_pages"] == 1


def test_parse_endpoint_rejects_oversized_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MAX_PDF_SIZE_MB", 0)
    client = TestClient(app)
    response = client.post(
        "/api/pdf/parse",
        files={"file": ("documento.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert response.status_code == 413


def test_parse_endpoint_rejects_double_extension_filename() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/pdf/parse",
        files={"file": ("factura.exe.pdf", _make_pdf_bytes(), "application/pdf")},
    )
    assert response.status_code == 400


def _post_pdf_n_times(client: TestClient, count: int, header_for_index=None) -> list[int]:
    pdf_bytes = _make_pdf_bytes()
    return [
        client.post(
            "/api/pdf/parse",
            files={"file": ("documento.pdf", pdf_bytes, "application/pdf")},
            headers=header_for_index(i) if header_for_index else None,
        ).status_code
        for i in range(count)
    ]


def test_rate_limit_applies_after_configured_requests() -> None:
    limit = settings.RATE_LIMIT_PARSE_PER_MIN
    codes = _post_pdf_n_times(TestClient(app), limit + EXTRA_REQUESTS_OVER_LIMIT)

    assert codes == [200] * limit + [429] * EXTRA_REQUESTS_OVER_LIMIT


def test_rate_limit_cannot_be_bypassed_with_spoofed_x_forwarded_for() -> None:
    limit = settings.RATE_LIMIT_PARSE_PER_MIN
    codes = _post_pdf_n_times(
        TestClient(app),
        limit + EXTRA_REQUESTS_OVER_LIMIT,
        header_for_index=lambda i: {"X-Forwarded-For": f"10.0.0.{i}"},
    )

    assert codes == [200] * limit + [429] * EXTRA_REQUESTS_OVER_LIMIT
