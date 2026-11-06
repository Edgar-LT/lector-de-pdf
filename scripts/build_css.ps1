# Compila frontend/tailwind.css usando el binario standalone de Tailwind CSS v3.4.17 (sin Node.js)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BinPath = Join-Path $env:TEMP "tailwindcss-windows-x64.exe"
$TailwindUrl = "https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-windows-x64.exe"

if (-not (Test-Path $BinPath)) {
    Write-Host "Descargando Tailwind CLI standalone v3.4.17..."
    Invoke-WebRequest -Uri $TailwindUrl -OutFile $BinPath
}

Push-Location $ProjectRoot
try {
    & $BinPath -c "frontend/tailwind.config.js" -i "frontend/src/tailwind.input.css" -o "frontend/tailwind.css" --minify
} finally {
    Pop-Location
}
