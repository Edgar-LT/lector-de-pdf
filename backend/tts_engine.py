from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any

import edge_tts


NEURAL_VOICES: list[dict[str, str]] = [
    {
        "id": "es-MX-DaliaNeural",
        "name": "Dalia (Español - México)",
        "lang": "es-MX",
        "gender": "Femenina",
        "badge": "Cálida / Narración",
    },
    {
        "id": "es-MX-JorgeNeural",
        "name": "Jorge (Español - México)",
        "lang": "es-MX",
        "gender": "Masculina",
        "badge": "Documental / Técnico",
    },
    {
        "id": "es-ES-AlvaroNeural",
        "name": "Álvaro (Español - España)",
        "lang": "es-ES",
        "gender": "Masculina",
        "badge": "Audiolibro Clásico",
    },
    {
        "id": "es-ES-ElviraNeural",
        "name": "Elvira (Español - España)",
        "lang": "es-ES",
        "gender": "Femenina",
        "badge": "Clara / Académica",
    },
    {
        "id": "es-CO-SalomeNeural",
        "name": "Salomé (Español - Colombia)",
        "lang": "es-CO",
        "gender": "Femenina",
        "badge": "Natural / Fluida",
    },
    {
        "id": "es-AR-TomasNeural",
        "name": "Tomás (Español - Argentina)",
        "lang": "es-AR",
        "gender": "Masculina",
        "badge": "Expresiva",
    },
    {
        "id": "en-US-AriaNeural",
        "name": "Aria (English - US)",
        "lang": "en-US",
        "gender": "Femenina",
        "badge": "Datasheets / Tech",
    },
    {
        "id": "en-US-GuyNeural",
        "name": "Guy (English - US)",
        "lang": "en-US",
        "gender": "Masculina",
        "badge": "Audiobook / Engineering",
    },
]


class NeuralTTSEngine:
    """Motor de síntesis de voz neuronal basado en edge-tts con caché en disco."""

    def __init__(self, cache_dir: Path | str | None = None):
        if cache_dir is None:
            cache_dir = Path(__file__).resolve().parent.parent / ".tts_cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def get_available_voices() -> list[dict[str, str]]:
        return NEURAL_VOICES

    @staticmethod
    def speed_to_rate_str(speed: float) -> str:
        """Convierte multiplicador (0.5x a 2.0x) a formato edge-tts ('+25%', '-20%')."""
        clamped = max(0.5, min(2.0, float(speed)))
        delta_pct = int(round((clamped - 1.0) * 100))
        if delta_pct >= 0:
            return f"+{delta_pct}%"
        return f"{delta_pct}%"

    def _get_cache_path(self, text: str, voice: str, speed: float) -> Path:
        rate_str = self.speed_to_rate_str(speed)
        key = f"{voice}|{rate_str}|{text.strip()}".encode("utf-8")
        digest = hashlib.sha256(key).hexdigest()[:24]
        return self.cache_dir / f"{digest}.mp3"

    def prune_cache(self, max_files: int = 150) -> int:
        """Elimina los archivos MP3 más antiguos cuando la caché supera max_files (evicción LRU)."""
        if max_files <= 0 or not self.cache_dir.exists():
            return 0
        mp3_files = sorted(
            self.cache_dir.glob("*.mp3"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        removed = 0
        for old_file in mp3_files[max_files:]:
            try:
                old_file.unlink(missing_ok=True)
                removed += 1
            except OSError:
                pass
        return removed

    async def synthesize_to_file(
        self,
        text: str,
        voice: str = "es-MX-DaliaNeural",
        speed: float = 1.0,
        max_cache_files: int = 150,
    ) -> Path:
        """Sintetiza un texto a archivo MP3 usando caché si ya fue generado."""
        cleaned_text = re.sub(r"\s*\n+\s*", " ", text.strip())
        cleaned_text = re.sub(r"\s{2,}", " ", cleaned_text).strip()
        if not cleaned_text:
            raise ValueError("El texto a sintetizar no puede estar vacío.")

        valid_voice_ids = {v["id"] for v in NEURAL_VOICES}
        selected_voice = voice if voice in valid_voice_ids else "es-MX-DaliaNeural"
        cache_path = self._get_cache_path(cleaned_text, selected_voice, speed)

        if cache_path.exists() and cache_path.stat().st_size > 128:
            return cache_path

        rate_str = self.speed_to_rate_str(speed)
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(
                    text=cleaned_text,
                    voice=selected_voice,
                    rate=rate_str,
                )
                await communicate.save(str(cache_path))
                if cache_path.exists() and cache_path.stat().st_size > 128:
                    self.prune_cache(max_files=max_cache_files)
                    return cache_path
            except Exception as exc:
                last_exc = exc
                await asyncio.sleep(0.35 * (attempt + 1))

        if last_exc:
            raise last_exc
        raise RuntimeError("No se pudo generar el archivo de audio neuronal.")

    async def export_audiobook_mp3(
        self,
        pages: list[dict[str, Any]],
        start_page: int,
        end_page: int,
        voice: str = "es-MX-DaliaNeural",
        speed: float = 1.0,
        book_title: str = "Audiolibro",
    ) -> Path:
        """Genera un archivo MP3 continuo para un rango de páginas del documento."""
        selected_chunks: list[str] = []
        for page in pages:
            p_num = int(page.get("page_number", 0))
            if start_page <= p_num <= end_page:
                paragraphs = page.get("paragraphs", [])
                if paragraphs:
                    selected_chunks.append("\n\n".join(paragraphs))

        full_script = "\n\n".join(selected_chunks).strip()
        if not full_script:
            raise ValueError("El rango de páginas seleccionado no contiene texto legible.")

        return await self.synthesize_to_file(
            text=full_script,
            voice=voice,
            speed=speed,
        )
