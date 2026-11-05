from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, asdict
from typing import Any

import fitz  # PyMuPDF


PAGE_NUMBER_PATTERNS = [
    re.compile(r"^\s*(?:p[áa]gina|p[áa]g\.?|page|pg\.?)?\s*\d+\s*(?:(?:de|of|/|-)\s*\d+)?\s*$", re.IGNORECASE),
    re.compile(r"^\s*[-–—•|]\s*\d+\s*[-–—•|]\s*$"),
    re.compile(r"^\s*[ivxlcdm]+\s*$", re.IGNORECASE),
]

SENTENCE_SPLIT_REGEX = re.compile(
    r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑÜ0-9«\"'“¿¡])"
)

SPLIT_COMMAS_AND_PERIODS_REGEX = re.compile(
    r"(?<=[.!?…])\s+|(?<!\d)(?<=[,;:])\s+"
)

ABBREVIATION_PATTERN = re.compile(
    r"^(?:p[áa]g|p[áa]gs|cap|caps|art|arts|dr|dra|sr|sra|prof|ing|lic|ej|fig|figs|vs|no|n[úu]m)\.$",
    re.IGNORECASE,
)


@dataclass
class CleaningOptions:
    remove_headers_footers: bool = True
    remove_page_numbers: bool = True
    fix_line_breaks: bool = True
    split_by_commas: bool = True
    remove_academic_citations: bool = True


@dataclass
class SentenceItem:
    id: str
    page_number: int
    sentence_index: int
    paragraph_index: int
    text: str
    bbox: list[float]  # [x0, y0, x1, y1] normalized 0..1


class SmartPDFCleaner:
    """Limpiador inteligente de texto de PDF para lectura fluida como audiolibro."""

    def __init__(self, options: CleaningOptions | None = None):
        self.options = options or CleaningOptions()

    @staticmethod
    def _normalize_margin_signature(text: str) -> str:
        """Normaliza números para detectar encabezados/pies repetidos entre páginas."""
        cleaned = re.sub(r"\s+", " ", text.strip().lower())
        cleaned = re.sub(r"\d+", "#", cleaned)
        return cleaned

    @staticmethod
    def is_standalone_page_number(text: str) -> bool:
        stripped = text.strip()
        if not stripped or len(stripped) > 35:
            return False
        return any(pattern.match(stripped) for pattern in PAGE_NUMBER_PATTERNS)

    @staticmethod
    def _is_in_margin_zone(bbox: tuple[float, float, float, float], page_height: float) -> bool:
        if page_height <= 0:
            return False
        _, y0, _, y1 = bbox
        top_limit = page_height * 0.095
        bottom_limit = page_height * 0.905
        return y1 <= top_limit or y0 >= bottom_limit

    def detect_repeated_margins(self, raw_pages_blocks: list[tuple[float, list[dict[str, Any]]]]) -> set[str]:
        """Detecta textos en márgenes superiores/inferiores que se repiten en múltiples páginas."""
        if not self.options.remove_headers_footers or len(raw_pages_blocks) < 2:
            return set()

        signature_counter: Counter[str] = Counter()
        for page_height, blocks in raw_pages_blocks:
            seen_in_page: set[str] = set()
            for b in blocks:
                if self._is_in_margin_zone(b["bbox"], page_height):
                    sig = self._normalize_margin_signature(b["text"])
                    if len(sig) >= 3:
                        seen_in_page.add(sig)
            for sig in seen_in_page:
                signature_counter[sig] += 1

        min_repeats = 2 if len(raw_pages_blocks) <= 4 else max(2, int(len(raw_pages_blocks) * 0.4))
        return {sig for sig, count in signature_counter.items() if count >= min_repeats}

    def clean_paragraph_text(self, text: str) -> str:
        """Limpia un bloque de texto reparando guiones de fin de línea y saltos cortados."""
        cleaned = text.strip()
        if not cleaned:
            return ""

        if self.options.fix_line_breaks:
            # Unir palabras cortadas por guion al final de línea (ej. "mecatró-\nnica" -> "mecatrónica")
            cleaned = re.sub(
                r"([A-Za-zÁÉÍÓÚáéíóúÑñÜü]{2,})[-‐‑]\s*\n\s*([a-záéíóúñü]{2,})",
                r"\1\2",
                cleaned,
            )
            # Reemplazar saltos de línea simples por espacios
            cleaned = re.sub(r"\s*\n+\s*", " ", cleaned)

        # Normalizar letras espaciadas tipográficas (ej. "A R C O  I :  L A   F O R J A" -> "ARCO I : LA FORJA")
        # Se ejecuta antes de comprimir espacios para respetar los 2+ espacios entre palabras completas
        cleaned = re.sub(
            r"(?<=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b) (?=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b)", "", cleaned
        )

        # Omitir citas académicas entre corchetes (ej. "[1]", "[14, 21]", "[2-5]")
        if self.options.remove_academic_citations:
            cleaned = re.sub(r"\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]", "", cleaned)

        # Limpiar espacios múltiples y caracteres de control
        cleaned = re.sub(r"[ \t\r\f\v]+", " ", cleaned)
        # Reemplazar viñetas sueltas al inicio para una pausa natural
        cleaned = re.sub(r"^\s*[•●▪▸►]\s*", "", cleaned)

        cleaned = re.sub(r"[ \t\r\f\v]+", " ", cleaned)
        return cleaned.strip()

    @classmethod
    def split_into_sentences(cls, paragraph: str, split_by_commas: bool = True) -> list[str]:
        if not paragraph:
            return []

        if split_by_commas:
            parts = SPLIT_COMMAS_AND_PERIODS_REGEX.split(paragraph)
        else:
            parts = SENTENCE_SPLIT_REGEX.split(paragraph)

        raw = [p.strip() for p in parts if p.strip()]
        merged: list[str] = []
        buf = ""

        # Evitar cortes en abreviaturas comunes (ej. "pág. 15", "Dr. Pérez")
        for piece in raw:
            if buf:
                words = buf.split()
                last_word = words[-1] if words else ""
                if ABBREVIATION_PATTERN.match(last_word):
                    buf += " " + piece
                    continue
                merged.append(buf)
                buf = piece
            else:
                buf = piece
        if buf:
            merged.append(buf)

        sentences: list[str] = []
        for s in merged:
            # Si un fragmento es excesivamente largo (> 340 caracteres), dividir en punto y coma o dos puntos
            if len(s) > 340 and (";" in s or ":" in s):
                subparts = re.split(r"(?<=[;:])\s+", s)
                sentences.extend([sp.strip() for sp in subparts if sp.strip()])
            else:
                sentences.append(s)
        return sentences

    def parse_document(self, pdf_bytes: bytes, filename: str = "documento.pdf") -> dict[str, Any]:
        """Extrae páginas, capítulos, oraciones limpias y estadísticas del PDF."""
        doc_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        total_pages = len(doc)
        metadata = doc.metadata or {}
        title = (metadata.get("title") or "").strip() or filename.rsplit(".", 1)[0]
        author = (metadata.get("author") or "").strip() or "Autor desconocido"

        # 1. Extraer bloques crudos de cada página
        raw_pages_blocks: list[tuple[float, float, list[dict[str, Any]]]] = []
        for page in doc:
            rect = page.rect
            page_width = float(rect.width) if rect.width else 1.0
            page_height = float(rect.height) if rect.height else 1.0
            raw_blocks = page.get_text("blocks", sort=True)
            parsed_blocks: list[dict[str, Any]] = []
            for b in raw_blocks:
                # b = (x0, y0, x1, y1, text, block_no, block_type)
                if len(b) >= 7 and b[6] == 0:  # 0 = texto
                    text = (b[4] or "").strip()
                    if text:
                        parsed_blocks.append(
                            {
                                "bbox": (float(b[0]), float(b[1]), float(b[2]), float(b[3])),
                                "text": text,
                            }
                        )
            raw_pages_blocks.append((page_width, page_height, parsed_blocks))

        # 2. Detectar encabezados/pies repetidos
        repeated_margins = self.detect_repeated_margins(
            [(ph, blocks) for _, ph, blocks in raw_pages_blocks]
        )

        # 3. Limpiar cada página y segmentar en oraciones
        pages_output: list[dict[str, Any]] = []
        removed_headers_count = 0
        removed_page_numbers_count = 0
        removed_citations_count = 0
        total_sentences = 0
        total_words = 0

        for page_idx, (page_width, page_height, blocks) in enumerate(raw_pages_blocks):
            page_number = page_idx + 1
            page_sentences: list[dict[str, Any]] = []
            page_paragraphs: list[str] = []
            sentence_idx_in_page = 0
            paragraph_idx = 0

            for block in blocks:
                raw_text = block["text"]
                bbox = block["bbox"]
                in_margin = self._is_in_margin_zone(bbox, page_height)

                # Filtrar números de página (en margen o líneas sueltas obvias)
                if self.options.remove_page_numbers and self.is_standalone_page_number(raw_text):
                    if in_margin or len(raw_text.strip()) <= 12:
                        removed_page_numbers_count += 1
                        continue

                # Filtrar encabezados/pies repetidos en márgenes
                if self.options.remove_headers_footers and in_margin:
                    sig = self._normalize_margin_signature(raw_text)
                    if sig in repeated_margins:
                        removed_headers_count += 1
                        continue

                if self.options.remove_academic_citations:
                    found_citations = re.findall(r"\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]", raw_text)
                    if found_citations:
                        removed_citations_count += len(found_citations)

                cleaned_para = self.clean_paragraph_text(raw_text)
                if not cleaned_para:
                    continue

                # Si después de limpiar quedó solo un número de página, omitir
                if self.options.remove_page_numbers and self.is_standalone_page_number(cleaned_para) and in_margin:
                    removed_page_numbers_count += 1
                    continue

                norm_bbox = [
                    round(bbox[0] / page_width, 4),
                    round(bbox[1] / page_height, 4),
                    round(bbox[2] / page_width, 4),
                    round(bbox[3] / page_height, 4),
                ]

                sentences = self.split_into_sentences(
                    cleaned_para, split_by_commas=self.options.split_by_commas
                )
                if not sentences:
                    continue

                page_paragraphs.append(cleaned_para)
                for s_text in sentences:
                    item = SentenceItem(
                        id=f"p{page_number}_s{sentence_idx_in_page}",
                        page_number=page_number,
                        sentence_index=sentence_idx_in_page,
                        paragraph_index=paragraph_idx,
                        text=s_text,
                        bbox=norm_bbox,
                    )
                    page_sentences.append(asdict(item))
                    sentence_idx_in_page += 1
                    total_sentences += 1
                    total_words += len(s_text.split())

                paragraph_idx += 1

            pages_output.append(
                {
                    "page_number": page_number,
                    "paragraphs": page_paragraphs,
                    "sentences": page_sentences,
                    "word_count": sum(len(p.split()) for p in page_paragraphs),
                }
            )

        # 4. Extraer o inferir tabla de capítulos (TOC)
        toc_raw = doc.get_toc() or []
        chapters: list[dict[str, Any]] = []
        if toc_raw:
            for idx, entry in enumerate(toc_raw):
                level, ch_title, ch_page = entry[0], entry[1], entry[2]
                if 1 <= ch_page <= total_pages and ch_title.strip():
                    chapters.append(
                        {
                            "id": f"ch_{idx}",
                            "level": int(level),
                            "title": ch_title.strip(),
                            "page_number": int(ch_page),
                        }
                    )
        else:
            # Inferir capítulos buscando encabezados tipo "Capítulo", "Acto", "Sección", "Parte", etc.
            heading_pattern = re.compile(
                r"^(?:cap[íi]tulo|chapter|acto|secci[óo]n|parte|unidad|m[óo]dulo|libro|arco|tema|\d+(?:\.\d+)*\s+[A-ZÁÉÍÓÚÑ])",
                re.IGNORECASE,
            )
            for p in pages_output:
                for s_obj in p["sentences"][:4]:
                    s_text = s_obj["text"].strip().rstrip(":,.-")
                    if 3 <= len(s_text) <= 90 and heading_pattern.match(s_text):
                        if not any(c["page_number"] == p["page_number"] and c["title"] == s_text for c in chapters):
                            chapters.append(
                                {
                                    "id": f"ch_p{p['page_number']}_{len(chapters)}",
                                    "level": 1,
                                    "title": s_text,
                                    "page_number": p["page_number"],
                                }
                            )
            if not chapters and total_pages > 0:
                chapters.append(
                    {
                        "id": "ch_start",
                        "level": 1,
                        "title": "Inicio del documento",
                        "page_number": 1,
                    }
                )

        doc.close()

        has_scanned_warning = bool(total_pages > 0 and total_words < 5)
        estimated_minutes = round(total_words / 155, 1) if total_words else 0.0

        return {
            "doc_id": doc_hash,
            "filename": filename,
            "title": title,
            "author": author,
            "total_pages": total_pages,
            "total_sentences": total_sentences,
            "total_words": total_words,
            "is_scanned_pdf": has_scanned_warning,
            "estimated_duration_minutes": estimated_minutes,
            "cleaning_stats": {
                "removed_headers_footers": removed_headers_count,
                "removed_page_numbers": removed_page_numbers_count,
                "removed_citations": removed_citations_count,
                "fix_line_breaks": self.options.fix_line_breaks,
            },
            "chapters": chapters,
            "pages": pages_output,
        }

    @classmethod
    def create_pdf_from_text(
        cls, title: str, text: str, author: str = ""
    ) -> bytes:
        """Genera un archivo PDF maquetado profesionalmente a partir de texto plano."""
        doc = fitz.open()
        page_width, page_height = 595.0, 842.0  # Tamaño estándar A4
        margin_x, margin_top, margin_bottom = 54.0, 54.0, 54.0

        clean_title = (title or "Documento").strip()
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
        if not paragraphs:
            paragraphs = ["(Documento sin contenido)"]

        current_page = doc.new_page(width=page_width, height=page_height)
        page_num = 1
        y_cursor = margin_top

        # Portada / Título en la primera página
        current_page.insert_text(
            fitz.Point(margin_x, y_cursor + 18),
            clean_title,
            fontsize=16,
            fontname="helv",
            color=(0.12, 0.12, 0.18),
        )
        y_cursor += 30

        if author:
            current_page.insert_text(
                fitz.Point(margin_x, y_cursor),
                f"Autor: {author}",
                fontsize=9.5,
                fontname="helv",
                color=(0.4, 0.4, 0.45),
            )
            y_cursor += 18

        current_page.draw_line(
            fitz.Point(margin_x, y_cursor),
            fitz.Point(page_width - margin_x, y_cursor),
            color=(0.8, 0.8, 0.85),
            width=0.8,
        )
        y_cursor += 16

        heading_regex = re.compile(
            r"^(?:cap[íi]tulo|cap\.|acto|parte|libro|secci[óo]n|cap\s+\d+|arco)\b",
            re.IGNORECASE,
        )
        toc_entries: list[list[Any]] = []

        for p_text in paragraphs:
            is_heading = bool(heading_regex.match(p_text)) or (len(p_text) < 50 and p_text.isupper())
            font_size = 13.0 if is_heading else 10.5
            font_name = "helv"

            if is_heading:
                toc_entries.append([1, p_text[:60], page_num])

            rect = fitz.Rect(
                margin_x,
                y_cursor,
                page_width - margin_x,
                page_height - margin_bottom,
            )
            remaining = current_page.insert_textbox(
                rect,
                p_text,
                fontsize=font_size,
                fontname=font_name,
                color=(0.08, 0.12, 0.28) if is_heading else (0.15, 0.15, 0.18),
            )

            if remaining < 0:
                # Si el texto no cabe, paginar
                current_page.insert_text(
                    fitz.Point(page_width / 2 - 15, page_height - 24),
                    f"{page_num}",
                    fontsize=8.5,
                    color=(0.5, 0.5, 0.5),
                )
                current_page = doc.new_page(width=page_width, height=page_height)
                page_num += 1
                y_cursor = margin_top

                rect = fitz.Rect(
                    margin_x,
                    y_cursor,
                    page_width - margin_x,
                    page_height - margin_bottom,
                )
                current_page.insert_textbox(
                    rect,
                    p_text,
                    fontsize=font_size,
                    fontname=font_name,
                    color=(0.08, 0.12, 0.28) if is_heading else (0.15, 0.15, 0.18),
                )

            approx_lines = max(1, len(p_text) // 75 + 1)
            y_cursor += approx_lines * (font_size * 1.35) + (10 if is_heading else 6)
            if y_cursor > page_height - margin_bottom - 36:
                current_page.insert_text(
                    fitz.Point(page_width / 2 - 15, page_height - 24),
                    f"{page_num}",
                    fontsize=8.5,
                    color=(0.5, 0.5, 0.5),
                )
                current_page = doc.new_page(width=page_width, height=page_height)
                page_num += 1
                y_cursor = margin_top

        current_page.insert_text(
            fitz.Point(page_width / 2 - 15, page_height - 24),
            f"{page_num}",
            fontsize=8.5,
            color=(0.5, 0.5, 0.5),
        )

        if toc_entries:
            doc.set_toc(toc_entries)

        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes
