"""
VoxPDF Studio — Script de Auditoría de Rendimiento, Robustez y Calidad de Lectura
Prueba exhaustiva con PDFs heterogéneos del mundo real.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import fitz

from backend.pdf_processor import CleaningOptions, SmartPDFCleaner
from backend.tts_engine import NeuralTTSEngine


def run_pdf_audit():
    test_files = [
        {
            "name": "Hábitos Atómicos (James Clear) [Libro / Ensayo]",
            "path": Path(r"C:\Users\Master\Downloads\HABITOS-ATOMICOS-JAMES-CLEAR.pdf"),
            "type": "Ebook / Ensayo narrativo con capítulos e ilustraciones",
        },
        {
            "name": "Capítulo 01: El Acuerdo de la Cumbre [Narrativa / Ficción]",
            "path": Path(r"C:\Users\Master\Downloads\capitulo_01_el_acuerdo_de_la_cumbre.pdf"),
            "type": "Capítulo de novela con diálogos y saltos de escena",
        },
        {
            "name": "Attention Is All You Need (arXiv:1706.03762) [Paper Científico]",
            "path": Path(r"c:\Users\Master\Documents\Proyectos para portafolio\Lector-de-pdf\tests\sample_arxiv_attention.pdf"),
            "type": "Artículo académico a doble columna con fórmulas, citas y tablas",
        },
    ]

    cleaner_commas = SmartPDFCleaner(
        options=CleaningOptions(
            remove_headers_footers=True,
            remove_page_numbers=True,
            fix_line_breaks=True,
            split_by_commas=True,
        )
    )

    cleaner_sentences = SmartPDFCleaner(
        options=CleaningOptions(
            remove_headers_footers=True,
            remove_page_numbers=True,
            fix_line_breaks=True,
            split_by_commas=False,
        )
    )

    print("=" * 80)
    print("VOXPDF STUDIO — AUDITORÍA EXHAUSTIVA DE ARCHIVOS PDF REALES")
    print("=" * 80)

    for item in test_files:
        p = item["path"]
        if not p.exists():
            print(f"[SKIP] No encontrado: {p}")
            continue

        size_mb = p.stat().st_size / (1024 * 1024)
        print(f"\n📄 ARCHIVO: {item['name']}")
        print(f"   Ruta: {p}")
        print(f"   Tipo: {item['type']}")
        print(f"   Tamaño: {size_mb:.2f} MB")

        data_bytes = p.read_bytes()

        # Test 1: Con división por comas y puntos
        t0 = time.perf_counter()
        res_commas = cleaner_commas.parse_document(data_bytes, filename=p.name)
        t_commas = (time.perf_counter() - t0) * 1000

        # Test 2: Sin división por comas (solo puntos)
        t0 = time.perf_counter()
        res_sentences = cleaner_sentences.parse_document(data_bytes, filename=p.name)
        t_sentences = (time.perf_counter() - t0) * 1000

        print(f"   ⏱️ Tiempo de procesamiento: {t_commas:.1f} ms ({res_commas['total_pages']} páginas)")
        print(f"   📊 Métricas:")
        print(f"      - Total páginas: {res_commas['total_pages']}")
        print(f"      - Capítulos detectados: {len(res_commas['chapters'])}")
        if res_commas['chapters']:
            first_chaps = [ch['title'] for ch in res_commas['chapters'][:4]]
            print(f"        Primeros capítulos: {first_chaps}")
        print(f"      - Total palabras: {res_commas['total_words']:,}")
        print(f"      - Duración estimada: ~{res_commas['estimated_duration_minutes']:.1f} minutos de audio")
        print(f"      - Cláusulas (comas y puntos): {res_commas['total_sentences']:,}")
        print(f"      - Oraciones (solo puntos): {res_sentences['total_sentences']:,}")
        print(f"      - Encabezados/pies eliminados: {res_commas['cleaning_stats']['removed_headers_footers']}")
        print(f"      - Números de página eliminados: {res_commas['cleaning_stats']['removed_page_numbers']}")

        # Inspección de las primeras 3 cláusulas de la página 1 o primera con contenido
        first_content_page = next((pg for pg in res_commas['pages'] if pg['sentences']), None)
        if first_content_page:
            p_num = first_content_page['page_number']
            print(f"\n   🔍 Muestra de lectura (Pág. {p_num}):")
            for idx, s in enumerate(first_content_page['sentences'][:3]):
                print(f"      [{idx+1}] \"{s['text']}\"")

        # Análisis de posibles puntos débiles en este tipo de documento
        print("\n   🔎 Evaluación de calidad y particularidades:")
        # Check column interleaving for multi-column (e.g. arXiv)
        if "arxiv" in p.name.lower():
            doc = fitz.open(stream=data_bytes, filetype="pdf")
            p0 = doc[0]
            blocks = p0.get_text("blocks", sort=True)
            print(f"      - Doble columna: PyMuPDF ordenó {len(blocks)} bloques en Pág 1.")
            doc.close()

    print("\n" + "=" * 80)
    print("FIN DE LA AUDITORÍA DE DOCUMENTOS")
    print("=" * 80)


if __name__ == "__main__":
    run_pdf_audit()
