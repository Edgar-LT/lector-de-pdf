"""Verifica cabeceras CSP/HSTS, sincronía con el <meta> de index.html y ausencia de scripts de CDN."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.constants import HSTS_HEADER_VALUE, build_csp_header

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
INDEX_HTML = FRONTEND_DIR / "index.html"

FORBIDDEN_CDN_HOSTS = (
    "cdn.tailwindcss.com",
    "cdnjs.cloudflare.com",
)


def test_csp_header_present_and_strict() -> None:
    client = TestClient(app)
    res = client.get("/api/health")
    csp = res.headers.get("content-security-policy", "")

    assert csp == build_csp_header(include_frame_ancestors=True)
    assert "script-src 'self'" in csp
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]


def test_index_html_meta_csp_matches_backend_directives() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    match = re.search(
        r'<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"',
        html,
        re.IGNORECASE,
    )
    assert match is not None, "Falta <meta http-equiv=\"Content-Security-Policy\"> en frontend/index.html"
    assert match.group(1) == build_csp_header(include_frame_ancestors=False)


def test_index_html_does_not_reference_external_script_cdns() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    for host in FORBIDDEN_CDN_HOSTS:
        assert host not in html, f"index.html aún referencia el host externo {host}"


def test_vendored_assets_and_compiled_tailwind_are_served() -> None:
    client = TestClient(app)
    for path in (
        "/tailwind.css",
        "/storage.js",
        "/pdf-client-parser.js",
        "/vendor/pdfjs/pdf.min.js",
        "/vendor/pdfjs/pdf.worker.min.js",
    ):
        res = client.get(path)
        assert res.status_code == 200, f"{path} devolvió {res.status_code}"
        assert len(res.content) > 500


def test_accessibility_aria_labels_and_reduced_motion_present() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    buttons = re.findall(r"<button\b[^>]*>", html)
    assert len(buttons) >= 20
    missing_aria = [btn for btn in buttons if "aria-label=" not in btn]
    assert not missing_aria, f"Botones sin aria-label en index.html: {missing_aria}"

    css = (FRONTEND_DIR / "styles.css").read_text(encoding="utf-8")
    assert "prefers-reduced-motion: reduce" in css
    assert ":focus-visible" in css
    assert "tabular-nums" in css
    assert "#2997ff" in css  # Azul Óptico (luxury-editorial-web-ui)



def test_hsts_header_only_emitted_over_https() -> None:
    http_client = TestClient(app, base_url="http://testserver")
    https_client = TestClient(app, base_url="https://testserver")

    http_res = http_client.get("/api/health")
    https_res = https_client.get("/api/health")

    assert "strict-transport-security" not in http_res.headers
    assert https_res.headers.get("strict-transport-security") == HSTS_HEADER_VALUE
