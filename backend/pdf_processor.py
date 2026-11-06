from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any

import fitz  # PyMuPDF

PAGE_NUMBER_PATTERNS = [
    re.compile(r"^\s*(?:p[áa]gina|p[áa]g\.?|page|pg\.?)?\s*\d+\s*(?:(?:de|of|/|-)\s*\d+)?\s*$", re.IGNORECASE),
    re.compile(r"^\s*[-–—•|]\s*\d+\s*[-–—•|]\s*$"),
    re.compile(r"^\s*[ivxlcdm]+\s*$", re.IGNORECASE),
]

SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑÜ0-9«\"'“¿¡])")

SPLIT_COMMAS_AND_PERIODS_REGEX = re.compile(r"(?<=[.!?…])\s+|(?<!\d)(?<=[,;:])\s+")

ABBREVIATION_PATTERN = re.compile(
    r"^(?:p[áa]g|p[áa]gs|cap|caps|art|arts|dr|dra|sr|sra|prof|ing|lic|ej|fig|figs|vs|no|n[úu]m)\.$",
    re.IGNORECASE,
)

CITATION_BRACKET_REGEX = re.compile(r"\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]")

HEADING_INFERENCE_PATTERN = re.compile(
    r"^(?:cap[íi]tulo|chapter|acto|secci[óo]n|parte|unidad|m[óo]dulo|libro|arco|tema|\d+(?:\.\d+)*\s+[A-ZÁÉÍÓÚÑ])",
    re.IGNORECASE,
)

PDF_TEXT_BLOCK_TYPE = 0
MARGIN_ZONE_TOP_RATIO = 0.095
MARGIN_ZONE_BOTTOM_RATIO = 0.905
MAX_CLAUSE_LENGTH_CHARS = 340
WORDS_PER_MINUTE_ESTIMATE = 155


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


@dataclass(frozen=True)
class RawPageData:
    width: float
    height: float
    blocks: list[dict[str, Any]]


@dataclass
class PageCleaningResult:
    page_dict: dict[str, Any]
    removed_headers: int
    removed_page_numbers: int
    removed_citations: int
    sentence_count: int
    word_count: int


class SmartPDFCleaner:
    """Limpiador inteligente de texto de PDF para lectura fluida como audiolibro."""

    def __init__(self, options: CleaningOptions | None = None):
        self.options = options or CleaningOptions()

    @staticmethod
    def _normalize_margin_signature(text: str) -> str:
        """Normaliza números para detectar encabezados/pies repetidos entre páginas."""
        cleaned = re.sub(r"\s+", " ", text.strip().lower())
        return re.sub(r"\d+", "#", cleaned)

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
        top_limit = page_height * MARGIN_ZONE_TOP_RATIO
        bottom_limit = page_height * MARGIN_ZONE_BOTTOM_RATIO
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
            cleaned = re.sub(
                r"([A-Za-zÁÉÍÓÚáéíóúÑñÜü]{2,})[-‐‑]\s*\n\s*([a-záéíóúñü]{2,})",
                r"\1\2",
                cleaned,
            )
            cleaned = re.sub(r"\s*\n+\s*", " ", cleaned)

        cleaned = re.sub(
            r"(?<=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b) (?=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b)", "", cleaned
        )

        if self.options.remove_academic_citations:
            cleaned = re.sub(r"\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]", "", cleaned)

        cleaned = re.sub(r"[ \t\r\f\v]+", " ", cleaned)
        cleaned = re.sub(r"^\s*[•●▪▸►]\s*", "", cleaned)
        return re.sub(r"[ \t\r\f\v]+", " ", cleaned).strip()

    @classmethod
    def split_into_sentences(cls, paragraph: str, split_by_commas: bool = True) -> list[str]:
        if not paragraph:
            return []

        splitter = SPLIT_COMMAS_AND_PERIODS_REGEX if split_by_commas else SENTENCE_SPLIT_REGEX
        raw = [p.strip() for p in splitter.split(paragraph) if p.strip()]
        merged = cls._merge_abbreviation_fragments(raw)

        sentences: list[str] = []
        for s in merged:
            if len(s) > MAX_CLAUSE_LENGTH_CHARS and (";" in s or ":" in s):
                subparts = re.split(r"(?<=[;:])\s+", s)
                sentences.extend([sp.strip() for sp in subparts if sp.strip()])
            else:
                sentences.append(s)
        return sentences

    @staticmethod
    def _merge_abbreviation_fragments(raw_parts: list[str]) -> list[str]:
        """Une fragmentos separados erróneamente tras abreviaturas (ej. 'pág. 15', 'Dr. Pérez')."""
        merged: list[str] = []
        buf = ""
        for piece in raw_parts:
            if not buf:
                buf = piece
                continue
            words = buf.split()
            last_word = words[-1] if words else ""
            if ABBREVIATION_PATTERN.match(last_word):
                buf += " " + piece
                continue
            merged.append(buf)
            buf = piece
        if buf:
            merged.append(buf)
        return merged

    @staticmethod
    def _extract_raw_pages(doc: fitz.Document) -> list[RawPageData]:
        """Extrae dimensiones y bloques de texto ordenados de todas las páginas del documento."""
        raw_pages: list[RawPageData] = []
        for page in doc:
            rect = page.rect
            page_width = float(rect.width) if rect.width else 1.0
            page_height = float(rect.height) if rect.height else 1.0
            parsed_blocks: list[dict[str, Any]] = []
            for b in page.get_text("blocks", sort=True):
                if len(b) >= 7 and b[6] == PDF_TEXT_BLOCK_TYPE:
                    text = (b[4] or "").strip()
                    if text:
                        parsed_blocks.append(
                            {
                                "bbox": (float(b[0]), float(b[1]), float(b[2]), float(b[3])),
                                "text": text,
                            }
                        )
            raw_pages.append(RawPageData(width=page_width, height=page_height, blocks=parsed_blocks))
        return raw_pages

    def _clean_and_segment_page(
        self, page_number: int, page_data: RawPageData, repeated_margins: set[str]
    ) -> PageCleaningResult:
        """Limpia márgenes, números de página y citas de una página y la segmenta en oraciones."""
        page_sentences: list[dict[str, Any]] = []
        page_paragraphs: list[str] = []
        removed_headers = 0
        removed_page_numbers = 0
        removed_citations = 0
        sentence_idx = 0
        paragraph_idx = 0
        total_words = 0

        for block in page_data.blocks:
            raw_text = block["text"]
            bbox = block["bbox"]
            in_margin = self._is_in_margin_zone(bbox, page_data.height)

            if (
                self.options.remove_page_numbers
                and self.is_standalone_page_number(raw_text)
                and (in_margin or len(raw_text.strip()) <= 12)
            ):
                removed_page_numbers += 1
                continue

            if (
                self.options.remove_headers_footers
                and in_margin
                and self._normalize_margin_signature(raw_text) in repeated_margins
            ):
                removed_headers += 1
                continue

            if self.options.remove_academic_citations:
                removed_citations += len(CITATION_BRACKET_REGEX.findall(raw_text))

            cleaned_para = self.clean_paragraph_text(raw_text)
            if not cleaned_para:
                continue

            if self.options.remove_page_numbers and self.is_standalone_page_number(cleaned_para) and in_margin:
                removed_page_numbers += 1
                continue

            sentences = self.split_into_sentences(cleaned_para, split_by_commas=self.options.split_by_commas)
            if not sentences:
                continue

            norm_bbox = [
                round(bbox[0] / page_data.width, 4),
                round(bbox[1] / page_data.height, 4),
                round(bbox[2] / page_data.width, 4),
                round(bbox[3] / page_data.height, 4),
            ]
            page_paragraphs.append(cleaned_para)
            for s_text in sentences:
                item = SentenceItem(
                    id=f"p{page_number}_s{sentence_idx}",
                    page_number=page_number,
                    sentence_index=sentence_idx,
                    paragraph_index=paragraph_idx,
                    text=s_text,
                    bbox=norm_bbox,
                )
                page_sentences.append(asdict(item))
                sentence_idx += 1
                total_words += len(s_text.split())
            paragraph_idx += 1

        page_dict = {
            "page_number": page_number,
            "paragraphs": page_paragraphs,
            "sentences": page_sentences,
            "word_count": sum(len(p.split()) for p in page_paragraphs),
        }
        return PageCleaningResult(
            page_dict=page_dict,
            removed_headers=removed_headers,
            removed_page_numbers=removed_page_numbers,
            removed_citations=removed_citations,
            sentence_count=sentence_idx,
            word_count=total_words,
        )

    @staticmethod
    def _extract_or_infer_chapters(
        doc: fitz.Document, pages_output: list[dict[str, Any]], total_pages: int
    ) -> list[dict[str, Any]]:
        """Extrae el índice (TOC) nativo del PDF o infiere capítulos a partir de encabezados."""
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
            return chapters

        for p in pages_output:
            for s_obj in p["sentences"][:4]:
                s_text = s_obj["text"].strip().rstrip(":,.-")
                if (
                    3 <= len(s_text) <= 90
                    and HEADING_INFERENCE_PATTERN.match(s_text)
                    and not any(c["page_number"] == p["page_number"] and c["title"] == s_text for c in chapters)
                ):
                    chapters.append(
                        {
                            "id": f"ch_p{p['page_number']}_{len(chapters)}",
                            "level": 1,
                            "title": s_text,
                            "page_number": p["page_number"],
                        }
                    )
        if not chapters and total_pages > 0:
            chapters.append({"id": "ch_start", "level": 1, "title": "Inicio del documento", "page_number": 1})
        return chapters

    def parse_document(self, pdf_bytes: bytes, filename: str = "documento.pdf") -> dict[str, Any]:
        """Orquesta la extracción, limpieza, segmentación e inferencia de capítulos del PDF."""
        doc_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            total_pages = len(doc)
            metadata = doc.metadata or {}
            title = (metadata.get("title") or "").strip() or filename.rsplit(".", 1)[0]
            author = (metadata.get("author") or "").strip() or "Autor desconocido"

            raw_pages = self._extract_raw_pages(doc)
            repeated_margins = self.detect_repeated_margins([(p.height, p.blocks) for p in raw_pages])

            pages_output: list[dict[str, Any]] = []
            removed_headers = 0
            removed_page_numbers = 0
            removed_citations = 0
            total_sentences = 0
            total_words = 0

            for idx, page_data in enumerate(raw_pages):
                res = self._clean_and_segment_page(idx + 1, page_data, repeated_margins)
                pages_output.append(res.page_dict)
                removed_headers += res.removed_headers
                removed_page_numbers += res.removed_page_numbers
                removed_citations += res.removed_citations
                total_sentences += res.sentence_count
                total_words += res.word_count

            chapters = self._extract_or_infer_chapters(doc, pages_output, total_pages)
        finally:
            doc.close()

        return {
            "doc_id": doc_hash,
            "filename": filename,
            "title": title,
            "author": author,
            "total_pages": total_pages,
            "total_sentences": total_sentences,
            "total_words": total_words,
            "is_scanned_pdf": bool(total_pages > 0 and total_words < 5),
            "estimated_duration_minutes": round(total_words / WORDS_PER_MINUTE_ESTIMATE, 1) if total_words else 0.0,
            "cleaning_stats": {
                "removed_headers_footers": removed_headers,
                "removed_page_numbers": removed_page_numbers,
                "removed_citations": removed_citations,
                "fix_line_breaks": self.options.fix_line_breaks,
            },
            "chapters": chapters,
            "pages": pages_output,
        }

    @staticmethod
    def _render_pdf_cover_header(
        page: fitz.Page, title: str, author: str, page_width: float, margin_x: float, margin_top: float
    ) -> float:
        """Dibuja la cabecera editorial en la primera página y devuelve el nuevo cursor vertical."""
        y_cursor = margin_top
        page.insert_text(
            fitz.Point(margin_x, y_cursor + 18),
            title,
            fontsize=16,
            fontname="helv",
            color=(0.12, 0.12, 0.18),
        )
        y_cursor += 30
        if author:
            page.insert_text(
                fitz.Point(margin_x, y_cursor),
                f"Autor: {author}",
                fontsize=9.5,
                fontname="helv",
                color=(0.4, 0.4, 0.45),
            )
            y_cursor += 18
        page.draw_line(
            fitz.Point(margin_x, y_cursor),
            fitz.Point(page_width - margin_x, y_cursor),
            color=(0.8, 0.8, 0.85),
            width=0.8,
        )
        return y_cursor + 16

    @staticmethod
    def _stamp_page_footer_number(page: fitz.Page, page_num: int, page_width: float, page_height: float) -> None:
        page.insert_text(
            fitz.Point(page_width / 2 - 15, page_height - 24),
            f"{page_num}",
            fontsize=8.5,
            color=(0.5, 0.5, 0.5),
        )

    @classmethod
    def create_pdf_from_text(cls, title: str, text: str, author: str = "") -> bytes:
        """Genera un archivo PDF maquetado profesionalmente a partir de texto plano."""
        doc = fitz.open()
        try:
            page_width, page_height = 595.0, 842.0  # Tamaño estándar A4
            margin_x, margin_top, margin_bottom = 54.0, 54.0, 54.0

            clean_title = (title or "Documento").strip()
            paragraphs = [p.strip() for p in text.split("\n") if p.strip()] or ["(Documento sin contenido)"]

            current_page = doc.new_page(width=page_width, height=page_height)
            page_num = 1
            y_cursor = cls._render_pdf_cover_header(current_page, clean_title, author, page_width, margin_x, margin_top)

            heading_regex = re.compile(
                r"^(?:cap[íi]tulo|cap\.|acto|parte|libro|secci[óo]n|cap\s+\d+|arco)\b",
                re.IGNORECASE,
            )
            toc_entries: list[list[Any]] = []

            for p_text in paragraphs:
                is_heading = bool(heading_regex.match(p_text)) or (len(p_text) < 50 and p_text.isupper())
                font_size = 13.0 if is_heading else 10.5
                text_color = (0.08, 0.12, 0.28) if is_heading else (0.15, 0.15, 0.18)

                if is_heading:
                    toc_entries.append([1, p_text[:60], page_num])

                rect = fitz.Rect(margin_x, y_cursor, page_width - margin_x, page_height - margin_bottom)
                remaining = current_page.insert_textbox(
                    rect, p_text, fontsize=font_size, fontname="helv", color=text_color
                )

                if remaining < 0:
                    cls._stamp_page_footer_number(current_page, page_num, page_width, page_height)
                    current_page = doc.new_page(width=page_width, height=page_height)
                    page_num += 1
                    y_cursor = margin_top
                    rect = fitz.Rect(margin_x, y_cursor, page_width - margin_x, page_height - margin_bottom)
                    current_page.insert_textbox(rect, p_text, fontsize=font_size, fontname="helv", color=text_color)

                approx_lines = max(1, len(p_text) // 75 + 1)
                y_cursor += approx_lines * (font_size * 1.35) + (10 if is_heading else 6)
                if y_cursor > page_height - margin_bottom - 36:
                    cls._stamp_page_footer_number(current_page, page_num, page_width, page_height)
                    current_page = doc.new_page(width=page_width, height=page_height)
                    page_num += 1
                    y_cursor = margin_top

            cls._stamp_page_footer_number(current_page, page_num, page_width, page_height)
            if toc_entries:
                doc.set_toc(toc_entries)
            return doc.tobytes()
        finally:
            doc.close()
