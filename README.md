# 🎧 VoxPDF Studio — Conversor Inteligente de PDF a Audiolibro

![Estado del Despliegue](https://img.shields.io/badge/GitHub%20Pages-Activo-01e599?style=flat-square&logo=github)
![Python 3.12](https://img.shields.io/badge/Python-3.12%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=flat-square&logo=fastapi&logoColor=white)
![PyMuPDF](https://img.shields.io/badge/PyMuPDF-Extracción%20BBox-06b6d4?style=flat-square)
![Licencia MIT](https://img.shields.io/badge/Licencia-MIT-10b981?style=flat-square)

Aplicación híbrida (**Python FastAPI + Interfaz Estudio Web**) diseñada para convertir libros, manuales técnicos, artículos académicos y datasheets en **audiolibros interactivos** con limpieza inteligente de texto, seguimiento visual oración por oración y exportación a `.MP3`.

- 🌐 **Demo Web Interactiva (GitHub Pages):** [https://edgar-lt.github.io/lector-de-pdf/](https://edgar-lt.github.io/lector-de-pdf/)
- 💼 **Portafolio Principal (Edgar López):** [https://edgar-lt.github.io/portafolio/](https://edgar-lt.github.io/portafolio/)

---

## ✨ Características de Ingeniería

1. **Limpieza Inteligente de Texto por Coordenadas (`SmartPDFCleaner`)**
   - Analiza las cajas delimitadoras (`bbox`) en las franjas extremas superior e inferior de cada página mediante `PyMuPDF` (`fitz`).
   - Detecta y filtra automáticamente **encabezados y pies de página repetitivos** a lo largo del documento.
   - Omite **números de página** sueltos (`Página 1 de 10`, `- 14 -`, numeración romana en márgenes).
   - Reconstruye palabras cortadas por guion al final de línea (`microcon-\ntroladores` → `microcontroladores`) y une saltos de línea artificiales para lograr una lectura continua y natural.
2. **Reproductor de Estudio con Seguimiento Visual Sincronizado**
   - **Vista Dividida:** Muestra el renderizado original de la página con `PDF.js` (enmarcando dinámicamente el párrafo en lectura mediante sus coordenadas normalizadas) junto al guion interactivo.
   - **Resaltado activo oración por oración:** Auto-scroll suave y salto directo al hacer clic sobre cualquier oración.
   - **Precarga asíncrona (`prefetch`):** Solicita en segundo plano el audio neuronal de la siguiente oración mientras se reproduce la actual, eliminando silencios entre frases.
3. **Controles de Audiolibro y Persistencia**
   - Velocidad ajustable (`0.5x` a `2.0x`), catálogo de **8 voces neuronales** en Español e Inglés (`edge-tts`) y navegación por **Capítulos (TOC)** o cuadrícula de **Páginas**.
   - **Guardado automático de progreso (`LocalStorage`):** Al reabrir un PDF, ofrece retomar la lectura exactamente en la página y oración donde quedó.
4. **Arquitectura Dual (Servidor Python Local + Modo Web Live en GitHub Pages)**
   - **En entorno local (Python):** Utiliza `PyMuPDF` + `edge-tts` con caché en disco y habilita la **exportación directa de capítulos o libros completos en `.MP3`**.
   - **En la nube (GitHub Pages):** Detecta automáticamente la ausencia del backend Python y conmuta al motor en navegador (`PDF.js` + `Web Speech API`) para que cualquier visitante del portafolio pueda probar la aplicación en vivo sin instalar nada.

---

## 🏗️ Estructura del Proyecto

```text
lector-de-pdf/
├── backend/
│   ├── __init__.py
│   ├── app.py                 # API REST en FastAPI y servidor de archivos estáticos
│   ├── pdf_processor.py       # Motor SmartPDFCleaner con extracción por coordenadas (PyMuPDF)
│   └── tts_engine.py          # Síntesis neuronal edge-tts con caché SHA-256 y exportador MP3
├── frontend/
│   ├── index.html             # Interfaz de estudio accesible y responsiva
│   ├── styles.css             # Sistema visual Dark Studio
│   └── app.js                 # Controlador híbrido (FastAPI Neural / Browser Live Fallback)
├── scripts/
│   └── verify.ps1             # Script de auditoría de estructura y ejecución de pruebas
├── tests/
│   └── test_pipeline.py       # Pruebas unitarias y de integración (Pytest + FastAPI TestClient)
├── .editorconfig              # Estándares de codificación
├── .gitattributes             # Normalización de finales de línea
├── .gitignore                 # Exclusión de entornos virtuales y cachés
├── index.html                 # Punto de entrada para despliegue en GitHub Pages
├── iniciar_app.bat            # Lanzador rápido en Windows con un clic
├── LICENSE                    # Licencia MIT
├── pyproject.toml             # Configuración estándar PEP 621
├── pytest.ini                 # Configuración de pruebas
└── requirements.txt           # Dependencias de producción y desarrollo
```

---

## 🔌 Endpoints de la API REST (`FastAPI`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Verifica el estado del servidor Python y disponibilidad del motor TTS. |
| `GET` | `/api/voices` | Devuelve el catálogo de voces neuronales disponibles (`es-MX`, `es-ES`, `es-CO`, `es-AR`, `en-US`). |
| `POST` | `/api/pdf/parse` | Recibe un archivo `.pdf`, aplica `SmartPDFCleaner` y retorna capítulos, páginas y oraciones con coordenadas `bbox`. |
| `POST` | `/api/tts/speak` | Sintetiza una oración en formato `.mp3` neuronal usando caché en disco. |
| `POST` | `/api/tts/export` | Genera y descarga un archivo `.mp3` continuo para una página o rango de páginas del documento. |

---

## 🚀 Instalación y Ejecución Local

### Requisitos previos
- **Python 3.10+** (probado en Python 3.12)

### 1. Clonar el repositorio y crear el entorno virtual
```powershell
git clone https://github.com/Edgar-LT/lector-de-pdf.git
cd lector-de-pdf
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

### 2. Iniciar la aplicación
En Windows, haz doble clic en [`iniciar_app.bat`](./iniciar_app.bat) o ejecuta desde la terminal:
```powershell
.\.venv\Scripts\python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```
Luego abre **[http://127.0.0.1:8000](http://127.0.0.1:8000)** en tu navegador.

---

## 🧪 Pruebas Automatizadas

Para ejecutar la suite de pruebas unitarias y de integración:
```powershell
.\.venv\Scripts\pytest -v
```

---

## 👤 Autor

**Edgar López** — Ingeniería Mecatrónica, Desarrollo Web & Aplicaciones
- 🌐 Portafolio: [edgar-lt.github.io/portafolio](https://edgar-lt.github.io/portafolio/)
- 💻 GitHub: [@Edgar-LT](https://github.com/Edgar-LT)
- ✉️ Correo: [Socialedgar0710@gmail.com](mailto:Socialedgar0710@gmail.com)
