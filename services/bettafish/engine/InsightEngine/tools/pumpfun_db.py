"""
Asimog patch B1 (docs/24 section 7): the Insight engine's five database tools over our Pump.fun read surface.

PumpfunDB subclasses MediaCrawlerDB and keeps every tool's name, signature and return type, so the DeepSearchAgent,
its nodes and prompts run unchanged. The data comes from the read-only `slow` schema (role slow_reader): callouts are
the "notes", replies and updates are the "comments". The upstream MediaCrawlerDB stays as it is and is still used when
ASIMOG_FORK is not set.

Every result's text starts with "[cid:<id>]" so the model can cite the callout it read; core keeps only claims whose
cited ids exist (the citation rule) and Jev verify checks they support the claim.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from loguru import logger

from .search import DBResponse, MediaCrawlerDB, QueryResult

W_QUALITY = float(os.getenv("W_QUALITY", "20"))


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


class PumpfunDB(MediaCrawlerDB):
    """Pump.fun callouts, replies and updates in the crawled-posts shape the Insight tools expect."""

    HOT = (
        "coalesce(liked_count, 0) * :w_like + coalesce(comment_count, 0) * :w_comment + coalesce(share_count, 0) * :w_share"
        " + coalesce(viewd_count, 0) * :w_view"
    )

    def _weights(self) -> Dict[str, float]:
        return {"w_like": self.W_LIKE, "w_comment": self.W_COMMENT, "w_share": self.W_SHARE, "w_view": self.W_VIEW}

    def _note(self, r: Dict[str, Any], tool_table: str = "pumpfun_callout") -> QueryResult:
        return QueryResult(
            platform="pumpfun",
            content_type="callout",
            title_or_content=f"[cid:{r['note_id']}] {r.get('title') or ''} {r.get('content') or ''}".strip(),
            author_nickname=r.get("nickname"),
            url=r.get("note_url"),
            publish_time=self._to_datetime(r.get("create_time")),
            engagement=self._extract_engagement(r),
            source_keyword=r.get("source_keyword"),
            hotness_score=float(r.get("hotness_score") or 0.0),
            source_table=tool_table,
        )

    def _comment(self, r: Dict[str, Any], table: str) -> QueryResult:
        return QueryResult(
            platform="pumpfun",
            content_type="comment",
            title_or_content=f"[cid:{r['note_id']}] reply: {r.get('content') or ''}",
            author_nickname=r.get("nickname"),
            publish_time=self._to_datetime(r.get("create_time")),
            engagement={"likes": int(r.get("like_count") or 0)},
            source_table=table,
        )

    # ---- the five upstream tools ----

    def search_hot_content(self, time_period: str = "week", limit: int = 50) -> DBResponse:
        params_for_log = {"time_period": time_period, "limit": limit}
        start = datetime.now() - timedelta(days={"24h": 1, "week": 7}.get(time_period, 365))
        rows = self._execute_query(
            f"select *, ({self.HOT}) as hotness_score from slow.pumpfun_callout where create_time >= :since order by hotness_score desc, create_time desc limit :limit",
            {**self._weights(), "since": _ms(start), "limit": limit},
        )
        out = [self._note(r) for r in rows]
        return DBResponse("search_hot_content", params_for_log, results=out, results_count=len(out))

    def search_topic_globally(self, topic: str, limit_per_table: int = 100) -> DBResponse:
        params_for_log = {"topic": topic, "limit_per_table": limit_per_table}
        term = f"%{topic}%"
        notes = self._execute_query(
            "select * from slow.pumpfun_callout where content ilike :t or title ilike :t or source_keyword ilike :t or nickname ilike :t order by create_time desc limit :limit",
            {"t": term, "limit": limit_per_table},
        )
        comments = self._execute_query(
            "select * from slow.pumpfun_callout_comment where content ilike :t order by create_time desc limit :limit", {"t": term, "limit": limit_per_table}
        )
        out = [self._note(r) for r in notes] + [self._comment(r, "pumpfun_callout_comment") for r in comments]
        return DBResponse("search_topic_globally", params_for_log, results=out, results_count=len(out))

    def search_topic_by_date(self, topic: str, start_date: str, end_date: str, limit_per_table: int = 100) -> DBResponse:
        params_for_log = {"topic": topic, "start_date": start_date, "end_date": end_date, "limit_per_table": limit_per_table}
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            end = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            return DBResponse("search_topic_by_date", params_for_log, error_message="date format must be YYYY-MM-DD")
        rows = self._execute_query(
            "select * from slow.pumpfun_callout where (content ilike :t or title ilike :t or source_keyword ilike :t) and create_time >= :a and create_time < :b order by create_time desc limit :limit",
            {"t": f"%{topic}%", "a": _ms(start), "b": _ms(end), "limit": limit_per_table},
        )
        out = [self._note(r) for r in rows]
        return DBResponse("search_topic_by_date", params_for_log, results=out, results_count=len(out))

    def get_comments_for_topic(self, topic: str, limit: int = 500) -> DBResponse:
        params_for_log = {"topic": topic, "limit": limit}
        term = f"%{topic}%"
        replies = self._execute_query(
            "select r.* from slow.pumpfun_callout_comment r join slow.pumpfun_callout c on c.note_id = r.note_id"
            " where r.content ilike :t or c.content ilike :t or c.source_keyword ilike :t order by r.create_time desc limit :limit",
            {"t": term, "limit": limit},
        )
        updates = self._execute_query(
            "select u.* from slow.pumpfun_update u join slow.pumpfun_callout c on c.note_id = u.note_id"
            " where u.content ilike :t or c.source_keyword ilike :t order by u.create_time desc limit :limit",
            {"t": term, "limit": limit},
        )
        out = [self._comment(r, "pumpfun_callout_comment") for r in replies] + [self._comment(r, "pumpfun_update") for r in updates]
        return DBResponse("get_comments_for_topic", params_for_log, results=out[:limit], results_count=min(len(out), limit))

    def search_topic_on_platform(self, platform: str, topic: str, start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 20) -> DBResponse:
        # Every platform name maps to Pump.fun: the prompts may still name upstream platforms.
        r = self.search_topic_by_date(topic, start_date, end_date, limit) if start_date and end_date else self.search_topic_globally(topic, limit)
        r.tool_name = "search_topic_on_platform"
        r.parameters = {"platform": platform, "topic": topic, "start_date": start_date, "end_date": end_date, "limit": limit}
        return r

    # ---- our three extra tools (callers, flow, swarm reports) ----

    def search_caller_record(self, handle_or_wallet: str, limit: int = 5) -> DBResponse:
        rows = self._execute_query(
            "select * from slow.pumpfun_caller where handle ilike :t or wallet = :w order by calls_seen desc limit :limit",
            {"t": f"%{handle_or_wallet}%", "w": handle_or_wallet, "limit": limit},
        )
        out = [QueryResult(platform="pumpfun", content_type="caller", title_or_content=f"caller {r.get('handle') or r['wallet'][:6]}: {r.get('calls_seen')} calls, dna {r.get('dna')}", author_nickname=r.get("handle"), source_table="pumpfun_caller") for r in rows]
        return DBResponse("search_caller_record", {"handle_or_wallet": handle_or_wallet}, results=out, results_count=len(out))

    def search_coin_flow(self, mint: str, minutes: int = 60) -> DBResponse:
        rows = self._execute_query(
            "select * from slow.pumpfun_trade_flow where mint = :m order by minute desc limit :limit", {"m": mint, "limit": minutes}
        )
        out = [QueryResult(platform="pumpfun", content_type="flow", title_or_content=f"{r['minute']}: buyers {r.get('unique_buyers')}, net {r.get('net_flow_sol')} SOL, buys {r.get('buys')}, sells {r.get('sells')}", publish_time=self._to_datetime(r.get("minute")), source_table="pumpfun_trade_flow") for r in rows]
        return DBResponse("search_coin_flow", {"mint": mint, "minutes": minutes}, results=out, results_count=len(out))

    def search_swarm_reports(self, subject: str, limit: int = 3) -> DBResponse:
        rows = self._execute_query(
            "select report_id, producer, summary, published_at from slow.report_feed where subject = :s and producer like 'miroshark.%' order by published_at desc limit :limit",
            {"s": subject, "limit": limit},
        )
        out = [QueryResult(platform="miroshark", content_type="report", title_or_content=f"[report:{r['report_id']}] SIMULATED {r.get('summary')}", publish_time=self._to_datetime(r.get("published_at")), source_table="report_feed") for r in rows]
        return DBResponse("search_swarm_reports", {"subject": subject}, results=out, results_count=len(out))


def make_search_agency() -> MediaCrawlerDB:
    """PumpfunDB under ASIMOG_FORK=1, upstream MediaCrawlerDB otherwise."""
    if os.getenv("ASIMOG_FORK") == "1":
        logger.info("Insight search: PumpfunDB over slow.* (asimog)")
        return PumpfunDB()
    return MediaCrawlerDB()
