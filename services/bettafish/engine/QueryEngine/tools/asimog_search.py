"""
Asimog patch B4 (docs/SLOW-MIND.md section 7): the Query engine's news tools over sources chosen by env (QUERY_SEARCH).

AsimogNewsAgency keeps every TavilyNewsAgency tool name and returns TavilyResponse, so the engine runs unchanged:
- `tavily`: the upstream Tavily client (a search API, not scraping), when TAVILY_API_KEY is set;
- `x`: the X API v2 recent search (read only, the owner's X_BEARER_TOKEN, rate-limited by X);
- always: our own callouts on the topic from slow.pumpfun_callout, so the engine has data offline and in tests.
Every result from our callouts starts with [cid:<id>] so the model can cite it.
"""

from __future__ import annotations

import dataclasses
import os
import time
from datetime import datetime, timedelta
from typing import List, Optional

import requests
from loguru import logger

import asimog_db
from asimog_voice import fence
from .search import ImageResult, SearchResult, TavilyNewsAgency, TavilyResponse


class AsimogNewsAgency:
    def __init__(self) -> None:
        self.sources = [s.strip() for s in os.getenv("QUERY_SEARCH", "tavily,x").split(",") if s.strip()]
        self.tavily = TavilyNewsAgency() if "tavily" in self.sources and os.getenv("TAVILY_API_KEY") else None
        self.x_token = os.getenv("X_BEARER_TOKEN") if "x" in self.sources else None
        self.x_url = os.getenv("X_SEARCH_URL")  # from .env.example: never a URL written in code
        logger.info(f"Query search: AsimogNewsAgency (tavily={'on' if self.tavily else 'off'}, x={'on' if self.x_token else 'off'}, callouts=on)")

    def _callouts(self, query: str, since: Optional[datetime], limit: int, until: Optional[datetime] = None) -> List[SearchResult]:
        t = f"%{query}%"
        since_ms = int(since.timestamp() * 1000) if since else 0
        until_ms = int(until.timestamp() * 1000) if until else 2**62
        rows = asimog_db.query(
            "select note_id, title, content, note_url, create_time from slow.pumpfun_callout"
            " where (content ilike $1 or title ilike $1 or source_keyword ilike $1) and create_time >= $2 and create_time < $4 order by create_time desc limit $3",
            t, since_ms, limit, until_ms,
        )
        return [SearchResult(title=fence(r["title"], 60) + " callout", url=r["note_url"], content=f"[cid:{r['note_id']}] {fence(r['content'])}", published_date=datetime.fromtimestamp(r["create_time"] / 1000).isoformat()) for r in rows]

    def _x(self, query: str, since: Optional[datetime], limit: int, until: Optional[datetime] = None) -> List[SearchResult]:
        if not self.x_token or not self.x_url:
            return []
        params = {"query": f"{query} -is:retweet", "max_results": max(10, min(limit, 100)), "tweet.fields": "created_at,public_metrics"}
        if since:
            params["start_time"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")
        if until:
            params["end_time"] = until.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            r = requests.get(self.x_url, headers={"authorization": f"Bearer {self.x_token}"}, params=params, timeout=15)
            if r.status_code == 429:
                logger.warning("X search rate limited; skipped this call")
                return []
            r.raise_for_status()
            return [SearchResult(title="X post", url=f"https://x.com/i/status/{p['id']}", content=fence(p.get("text", "")), published_date=p.get("created_at")) for p in r.json().get("data", [])]
        except Exception as err:  # noqa: BLE001
            logger.warning(f"X search failed: {err}")
            return []

    def _web(self, name: str, *args):
        """Patch F13: a Tavily failure costs only the web results; X and the callouts still answer."""
        if not self.tavily:
            return None
        try:
            return getattr(self.tavily, name)(*args)
        except Exception as err:  # noqa: BLE001
            logger.warning(f"Tavily {name} failed: {err}")
            return None

    def _combine(self, query: str, upstream: Optional[TavilyResponse], since: Optional[datetime], limit: int, until: Optional[datetime] = None) -> TavilyResponse:
        t0 = time.time()
        web = [dataclasses.replace(r, content=fence(r.content, 4000)) for r in (upstream.results if upstream else [])]  # web pages are strangers' text too
        results = web + self._x(query, since, limit, until) + self._callouts(query, since, limit, until)
        return TavilyResponse(query=query, answer=upstream.answer if upstream else None, results=results, images=list(upstream.images if upstream else []), response_time=time.time() - t0)

    # the six upstream tool names
    def basic_search_news(self, query: str, max_results: int = 7) -> TavilyResponse:
        return self._combine(query, self._web("basic_search_news", query, max_results), None, max_results)

    def deep_search_news(self, query: str) -> TavilyResponse:
        return self._combine(query, self._web("deep_search_news", query), None, 20)

    def search_news_last_24_hours(self, query: str) -> TavilyResponse:
        return self._combine(query, self._web("search_news_last_24_hours", query), datetime.now() - timedelta(days=1), 20)

    def search_news_last_week(self, query: str) -> TavilyResponse:
        return self._combine(query, self._web("search_news_last_week", query), datetime.now() - timedelta(days=7), 20)

    def search_images_for_news(self, query: str) -> TavilyResponse:
        up = self._web("search_images_for_news", query)
        rows = asimog_db.query("select url, kind, mint from slow.media where mint in (select mint from slow.pumpfun_coin where symbol ilike $1) limit 10", f"%{query}%")
        r = self._combine(query, up, None, 5)
        r.images += [ImageResult(url=x["url"], description=f"{x['kind']} image for {x['mint']}") for x in rows]
        return r

    def search_news_by_date(self, query: str, start_date: str, end_date: str) -> TavilyResponse:
        up = self._web("search_news_by_date", query, start_date, end_date)
        try:
            since = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            since = None
        try:  # the end date is the day after end_date begins: the whole day is in, nothing later
            until = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            until = None
        return self._combine(query, up, since, 20, until)
