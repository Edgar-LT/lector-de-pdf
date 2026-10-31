# =============================================================================
# Script de Auditoría y Verificación de Calidad — VoxPDF Studio
# Autor: Edgar López
# =============================================================================

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "==> [1/3] Verificando estructura normativa del proyecto..." -ForegroundColor Cyan
$requiredFiles = @(
    "README.md",
    "LICENSE",
    "pyproject.toml",
    "requirements.txt",
    ".gitignore",
    ".editorconfig",
    ".gitattributes",
    "backend/app.py",
    "backend/pdf_processor.py",
    "backend/tts_engine.py",
    "frontend/index.html",
    "frontend/styles.css",
    "frontend/app.js",
    "tests/test_pipeline.py"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        throw "Falta archivo requerido por la normativa del proyecto: $file"
    }
}
Write-Host "    OK: Todos los archivos requeridos están presentes." -ForegroundColor Green

Write-Host "==> [2/3] Ejecutando pruebas automatizadas (Pytest)..." -ForegroundColor Cyan
if (Test-Path ".\.venv\Scripts\pytest.exe") {
    & ".\.venv\Scripts\pytest.exe" -v
    if ($LASTEXITCODE -ne 0) {
        throw "Las pruebas unitarias fallaron."
    }
} else {
    Write-Host "    Aviso: .venv no encontrado, omitiendo ejecución local de pytest." -ForegroundColor Yellow
}

Write-Host "==> [3/3] Auditoría completada con éxito." -ForegroundColor Green
