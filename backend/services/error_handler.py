from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from fastapi import HTTPException

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


def exception_to_http(
    status_code: int = 500,
    detail: str | None = None,
) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Convierte excepciones inesperadas de una corrutina en ``HTTPException``.

    Las ``HTTPException`` ya formadas se propagan intactas. El traceback completo se registra
    en el log del servidor; al cliente solo se le entrega ``detail`` (o el mensaje original si
    no se indicó), para no filtrar detalles internos.
    """

    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> R:
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("Excepción no controlada en %s", func.__name__)
                raise HTTPException(status_code=status_code, detail=detail or str(exc)) from exc

        return wrapper

    return decorator
