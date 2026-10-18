"""Asimog: one small read helper for the Query and Media adapters (docs/SLOW-MIND.md B3, B4). Reads only the slow.* views as the
slow_reader role, from DATABASE_URL (set by asimog_worker.py from BETTAFISH_DB_URL). Each call opens and closes its own
event loop, so it is safe from the engines' worker threads."""
import asyncio
import os
import re
from typing import Any, Dict, List

import asyncpg


def _dsn() -> str:
    return re.sub(r"^postgresql\+asyncpg://", "postgresql://", os.environ["DATABASE_URL"])


def query(sql: str, *args: Any) -> List[Dict[str, Any]]:
    async def run():
        conn = await asyncpg.connect(_dsn())
        try:
            return [dict(r) for r in await conn.fetch(sql, *args)]
        finally:
            await conn.close()

    return asyncio.run(run())
