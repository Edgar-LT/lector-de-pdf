from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Protocol

import edge_tts

from backend.constants import DEFAULT_TTS_MAX_FILES, DEFAULT_TTS_MAX_SIZE_MB, MIN_CACHE_FILE_SIZE

logger = logging.getLogger(__name__)

TTS_MAX_ATTEMPTS = 3


class TtsUnavailableError(RuntimeError):
    """El servicio TTS externo no puede atender la petición (circuit breaker abierto o reintentos agotados)."""


class TtsProvider(Protocol):
    """Contrato de proveedor de síntesis de voz (Inversión de Dependencias)."""

    async def save_audio(self, text: str, voice: str, rate: str, output_path: Path) -> None: ...


class EdgeTtsProvider:
    """Adaptador de producción basado en Microsoft Edge Neural TTS."""

    async def save_audio(self, text: str, voice: str, rate: str, output_path: Path) -> None:
        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
        await communicate.save(str(output_path))


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
    """Motor de síntesis de voz neuronal con caché en disco, proveedor inyectable y Circuit Breaker."""

    def __init__(self, cache_dir: Path | str | None = None, provider: TtsProvider | None = None):
        if cache_dir is None:
            cache_dir = Path(__file__).resolve().parent.parent / ".tts_cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._provider: TtsProvider = provider or EdgeTtsProvider()
        self._consecutive_failures: int = 0
        self._circuit_open_until: float = 0.0
        self._prune_call_counter: int = 0
        # Índice en memoria O(1) de archivos en caché: digest -> (last_access_time, size_bytes)
        self._index: dict[str, tuple[float, int]] = {}
        self._index_initialized: bool = False
        self._pruning_task: asyncio.Task | None = None

    @property
    def is_circuit_open(self) -> bool:
        """Determina si el Circuit Breaker está abierto tras fallos reiterados en el servicio upstream."""
        return time.time() < self._circuit_open_until

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

    def record_failure(self, threshold: int = 4, cooldown_seconds: float = 30.0) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= threshold:
            self._circuit_open_until = time.time() + cooldown_seconds

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
        key = f"{voice}|{rate_str}|{text.strip()}".encode()
        digest = hashlib.sha256(key).hexdigest()[:24]
        return self.cache_dir / f"{digest}.mp3"

    def maybe_prune_cache(
        self, max_files: int = DEFAULT_TTS_MAX_FILES, max_size_mb: int = DEFAULT_TTS_MAX_SIZE_MB, interval: int = 25
    ) -> int:
        """Invoca la purga LRU de manera throttled (cada N llamadas) para proteger el I/O del disco bajo alta concurrencia."""
        self._prune_call_counter += 1
        if self._prune_call_counter % interval == 0:
            return self.prune_cache(max_files=max_files, max_size_mb=max_size_mb)
        return 0

    def _ensure_index(self) -> None:
        """Carga el índice en memoria una única vez de manera no bloqueante."""
        if self._index_initialized or not self.cache_dir.exists():
            return
        try:
            now = time.time()
            for p in self.cache_dir.glob("*.mp3"):
                st = p.stat()
                self._index[p.name] = (st.st_mtime or now, st.st_size)
            self._index_initialized = True
        except OSError:
            pass

    def prune_cache_async(self, max_files: int = DEFAULT_TTS_MAX_FILES, max_size_mb: int = DEFAULT_TTS_MAX_SIZE_MB) -> None:
        """Dispara la purga de caché como corrutina en segundo plano sin congelar la respuesta del endpoint."""
        if self._pruning_task and not self._pruning_task.done():
            return
        self._pruning_task = asyncio.create_task(
            asyncio.to_thread(self.prune_cache, max_files=max_files, max_size_mb=max_size_mb)
        )

    def prune_cache(self, max_files: int = DEFAULT_TTS_MAX_FILES, max_size_mb: int = DEFAULT_TTS_MAX_SIZE_MB) -> int:
        """Elimina los archivos MP3 más antiguos guiándose por el índice en memoria O(1)."""
        if (max_files <= 0 and max_size_mb <= 0) or not self.cache_dir.exists():
            return 0

        self._ensure_index()
        # Ordenamiento sobre el índice en RAM sin invocar stat() síncrono al disco
        sorted_entries = sorted(
            self._index.items(),
            key=lambda item: item[1][0],  # mtime
            reverse=True,
        )

        max_bytes = max_size_mb * 1024 * 1024 if max_size_mb > 0 else float("inf")
        total_bytes = 0
        removed = 0

        for idx, (filename, (_, size)) in enumerate(sorted_entries):
            target_path = self.cache_dir / filename
            if (max_files > 0 and idx >= max_files) or (total_bytes + size > max_bytes):
                try:
                    target_path.unlink(missing_ok=True)
                    self._index.pop(filename, None)
                    removed += 1
                except OSError as exc:
                    logger.debug("No se pudo eliminar archivo de caché %s: %s", target_path, exc)
            else:
                total_bytes += size
        return removed

    async def synthesize_to_file(
        self,
        text: str,
        voice: str = "es-MX-DaliaNeural",
        speed: float = 1.0,
        max_cache_files: int = DEFAULT_TTS_MAX_FILES,
        max_cache_size_mb: int = DEFAULT_TTS_MAX_SIZE_MB,
    ) -> Path:
        """Sintetiza un texto a archivo MP3 usando caché si ya fue generado."""
        cleaned_text = re.sub(r"\s*\n+\s*", " ", text.strip())
        cleaned_text = re.sub(r"\s{2,}", " ", cleaned_text).strip()
        if not cleaned_text:
            raise ValueError("El texto a sintetizar no puede estar vacío.")

        valid_voice_ids = {v["id"] for v in NEURAL_VOICES}
        selected_voice = voice if voice in valid_voice_ids else "es-MX-DaliaNeural"
        cache_path = self._get_cache_path(cleaned_text, selected_voice, speed)

        if cache_path.exists() and cache_path.stat().st_size > MIN_CACHE_FILE_SIZE:
            return cache_path

        if self.is_circuit_open:
            raise TtsUnavailableError(
                "Circuit breaker abierto: el servicio TTS externo no está respondiendo temporalmente."
            )

        rate_str = self.speed_to_rate_str(speed)
        last_exc: Exception | None = None
        for attempt in range(TTS_MAX_ATTEMPTS):
            try:
                await self._provider.save_audio(
                    text=cleaned_text,
                    voice=selected_voice,
                    rate=rate_str,
                    output_path=cache_path,
                )
                if cache_path.exists() and cache_path.stat().st_size > MIN_CACHE_FILE_SIZE:
                    self.record_success()
                    file_size = cache_path.stat().st_size
                    self._index[cache_path.name] = (time.time(), file_size)
                    self.prune_cache_async(max_files=max_cache_files, max_size_mb=max_cache_size_mb)
                    return cache_path
            except Exception as exc:
                last_exc = exc
                logger.warning("Intento %d/%d de síntesis TTS falló: %s", attempt + 1, TTS_MAX_ATTEMPTS, exc)
                await asyncio.sleep(0.35 * (attempt + 1))

        self.record_failure()
        raise TtsUnavailableError(
            "No se pudo generar el archivo de audio neuronal tras agotar los reintentos."
        ) from last_exc
