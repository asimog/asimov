"""
Asimog patch B3 (docs/SLOW-MIND.md section 7): the Media engine's multimodal tools over our own media (SEARCH_TOOL_TYPE=AsimogMedia).

AsimogMediaSearch keeps every BochaMultimodalSearch tool name and returns BochaResponse. Webpages are callouts that
carry media (their text, cited as [cid:<id>]); images are callout media and coin images from slow.media, which the
media cache has copied into our blob store. Nothing here fetches the web. Bocha and Anspire stay selectable by env.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from loguru import logger

import asimog_db
from asimog_voice import fence
from .search import BochaResponse, ImageResult, WebpageResult


class AsimogMediaSearch:
    def __init__(self) -> None:
        logger.info("Media search: AsimogMediaSearch over slow.media (no web fetch)")

    def _search(self, query: str, since: Optional[datetime], limit: int) -> BochaResponse:
        t = f"%{query}%"
        since_ms = int(since.timestamp() * 1000) if since else 0
        notes = asimog_db.query(
            "select note_id, title, content, note_url, media_url, mint, create_time from slow.pumpfun_callout"
            " where media_url is not null and (content ilike $1 or title ilike $1 or source_keyword ilike $1) and create_time >= $2 order by create_time desc limit $3",
            t, since_ms, limit,
        )
        mints = list({n["mint"] for n in notes})
        imgs = asimog_db.query(
            "select media_id, url, kind, mint, sha256 from slow.media where mint = any($1::text[]) or mint in (select mint from slow.pumpfun_coin where symbol ilike $2) limit $3",
            mints, t, limit,
        )
        return BochaResponse(
            query=query,
            webpages=[WebpageResult(name=f"{n['title']} callout with media", url=n["note_url"], snippet=f"[cid:{n['note_id']}] {fence(n['content'])}", date_last_crawled=datetime.fromtimestamp(n["create_time"] / 1000).isoformat()) for n in notes],
            images=[ImageResult(name=f"{i['kind']} image {i['media_id']}" + (" (cached)" if i.get("sha256") else ""), content_url=i["url"], host_page_url=f"https://pump.fun/coin/{i['mint']}") for i in imgs],
        )

    # the upstream tool names
    def comprehensive_search(self, query: str, max_results: int = 10) -> BochaResponse:
        return self._search(query, None, max_results)

    def web_search_only(self, query: str, max_results: int = 15) -> BochaResponse:
        r = self._search(query, None, max_results)
        r.images = []
        return r

    def search_for_structured_data(self, query: str) -> BochaResponse:
        return self._search(query, None, 10)

    def search_last_24_hours(self, query: str, max_results: int = 10) -> BochaResponse:
        return self._search(query, datetime.now() - timedelta(days=1), max_results)

    def search_last_week(self, query: str, max_results: int = 10) -> BochaResponse:
        return self._search(query, datetime.now() - timedelta(days=7), max_results)
