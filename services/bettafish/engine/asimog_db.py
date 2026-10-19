"""Asimog: one small read helper for the Query and Media adapters (docs/SLOW-MIND.md B3, B4). Reads only the slow.* views as the
slow_reader role, from DATABASE_URL (set by asimog_worker.py from BETTAFISH_DB_URL). Each call opens and closes its own
event loop, so it is safe from the engines' worker threads. Every read is pinned to the run's AS_OF (slow.as_of), so a replay
never reads a row seen after its clock."""
import asyncio
import contextvars
import os
import re
from typing import Any, Dict, List

import asyncpg

AS_OF: contextvars.ContextVar[str | None] = contextvars.ContextVar("asimog_as_of", default=None)


def as_of() -> str:
    """The run's as-of time; a read without one fails instead of reading up to the database's now."""
    t = AS_OF.get()
    if not t:
        raise RuntimeError("asimog: slow.as_of is not pinned for this run")
    return t


def _dsn() -> str:
    return re.sub(r"^postgresql\+asyncpg://", "postgresql://", os.environ["DATABASE_URL"])


def query(sql: str, *args: Any) -> List[Dict[str, Any]]:
    async def run():
        conn = await asyncpg.connect(_dsn(), server_settings={"slow.as_of": as_of()})
        try:
            return [dict(r) for r in await conn.fetch(sql, *args)]
        finally:
            await conn.close()

    return asyncio.run(run())
