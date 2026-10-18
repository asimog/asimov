"""
Asimog patch B8 (docs/24 section 7): a headless worker that runs the real BettaFish engines for the Slow Bridge.

POST /asimog/runs   {job_id, kind (feed|coin), subject (global|mint), preset, window_min, parent_reports}
GET  /asimog/runs/<id>  -> {state: running|done|failed, output?, error?}
GET  /asimog/health

It uses the same DeepSearchAgent classes the upstream Streamlit apps use, one per engine named in BETTAFISH_ENGINES,
run in parallel threads. Output follows services/slow-bridge/src/types.ts (RunOutput). It binds to BETTAFISH_HOST
(127.0.0.1 by default; 0.0.0.0 only inside the slow-workers container, whose port compose maps to 127.0.0.1).
Ways it fails: an engine raises (the run fails with the engine name and error; other engines' results are kept);
the model ignores the cite format (claims without a [cid:...] are sent with no cites and core drops them).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("ASIMOG_FORK", "1")
if os.getenv("BETTAFISH_DB_URL"):  # BettaFish reads DATABASE_URL; ours is the read-only slow_reader role
    os.environ["DATABASE_URL"] = re.sub(r"^postgres(ql)?://", "postgresql+asyncpg://", os.environ["BETTAFISH_DB_URL"])

REQUIRED = ["INSIGHT_ENGINE_API_KEY", "INSIGHT_ENGINE_BASE_URL", "INSIGHT_ENGINE_MODEL_NAME", "DATABASE_URL"]
CID = re.compile(r"\[cid:([A-Za-z0-9_\-]+)\]")
RUNS: dict[str, dict] = {}
LOCK = threading.Lock()


def check_env() -> None:
    """patch B9: refuse to start on a missing provider value instead of using upstream's defaults."""
    missing = [k for k in REQUIRED if not os.getenv(k)]
    if missing:
        raise SystemExit(f"asimog_worker: missing env {', '.join(missing)}")


def cites(text: str) -> list[str]:
    return list(dict.fromkeys(CID.findall(text or "")))[:12]


def query_for(req: dict) -> str:
    w = int(req.get("window_min") or 60)
    if req["kind"] == "feed":
        return f"Pump.fun callout feed, last {w} minutes: which coins and narratives are callers pushing, who is early, what looks suspicious"
    return f"Pump.fun coin {req['subject']}: what callers say about it, how early they are, their track records, the trade flow, and any swarm reports"


def run_engine(name: str, query: str):
    if name == "insight":
        from InsightEngine.agent import DeepSearchAgent
    elif name == "query":
        from QueryEngine.agent import DeepSearchAgent
    elif name == "media":
        from MediaEngine.agent import DeepSearchAgent
    else:
        raise ValueError(f"unknown engine {name}")
    if os.getenv("BETTAFISH_SENTIMENT", "on") == "off":  # patch B7: nano and tests skip the model download
        from InsightEngine.tools.sentiment_analyzer import multilingual_sentiment_analyzer
        multilingual_sentiment_analyzer.disable("BETTAFISH_SENTIMENT=off")
    agent = DeepSearchAgent()
    report = agent.research(query, save_report=False)
    return name, agent.state, report


def to_output(req: dict, results: list) -> dict:
    """Engine states -> RunOutput: one report per engine, plus feed or coin synthesis from the paragraphs."""
    reports, paragraphs = [], []
    for name, state, md in results:
        paras = [(p.title, p.research.latest_summary or p.content) for p in state.paragraphs]
        paragraphs += paras
        all_text = "\n".join(t for _, t in paras)
        first = next((t for _, t in paras if t), md or "")
        reports.append({
            "producer": f"bettafish.{name}", "kind": req["kind"], "subject": req["subject"],
            "summary": re.sub(r"\s+", " ", CID.sub("", first)).strip()[:580] or "No findings in this window.",
            "cites": cites(all_text), "ir": {"title": state.report_title, "paragraphs": [{"title": t, "text": x} for t, x in paras]}, "markdown": md,
        })
    out: dict = {"reports": reports}
    if req["kind"] == "feed":
        out["synthesis_feed"] = {
            "window_min": int(req.get("window_min") or 60),
            "narratives": [{"title": t[:120], "summary": re.sub(r"\s+", " ", x)[:600], "cites": cites(x)} for t, x in paragraphs][:12],
            "coin_stances": [], "suspicious": [],
        }
    else:
        joined = " ".join(x for _, x in paragraphs).lower()
        stance = "avoid" if re.search(r"\brug|bundl|scam\b", joined) else "bearish" if re.search(r"\bdump|sell|exit\b", joined) else "bullish" if re.search(r"\bearly|buy|strong\b", joined) else "neutral"
        out["synthesis_coin"] = {"stance": stance, "narrative": re.sub(r"\s+", " ", CID.sub("", paragraphs[0][1] if paragraphs else ""))[:600], "claims": [{"text": re.sub(r"\s+", " ", CID.sub("", x))[:400], "cites": cites(x)} for _, x in paragraphs][:20]}
    return out


def execute(run_id: str, req: dict) -> None:
    engines = [e.strip() for e in os.getenv("BETTAFISH_ENGINES", "insight").split(",") if e.strip()]
    query = query_for(req)
    try:
        with ThreadPoolExecutor(max_workers=len(engines)) as pool:
            results = list(pool.map(lambda e: run_engine(e, query), engines))
        with LOCK:
            RUNS[run_id] = {"state": "done", "output": to_output(req, results)}
    except Exception as err:  # noqa: BLE001 - the Bridge records the reason
        with LOCK:
            RUNS[run_id] = {"state": "failed", "error": f"{type(err).__name__}: {err}"[:300]}
        traceback.print_exc()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path == "/asimog/health":
            return self._send(200, {"ok": True})
        m = re.match(r"^/asimog/runs/(.+)$", self.path)
        if m:
            with LOCK:
                r = RUNS.get(m.group(1))
            return self._send(200 if r else 404, r or {"state": "failed", "error": "unknown run"})
        self._send(404, {})

    def do_POST(self):  # noqa: N802
        if self.path != "/asimog/runs":
            return self._send(404, {})
        req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        run_id = str(req["job_id"])
        with LOCK:
            RUNS[run_id] = {"state": "running"}
        threading.Thread(target=execute, args=(run_id, req), daemon=True).start()
        self._send(200, {"run_id": run_id})

    def log_message(self, *a):  # quiet
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.getenv("BETTAFISH_PORT", "7410")))
    ap.add_argument("--host", default=os.getenv("BETTAFISH_HOST", "127.0.0.1"))
    a = ap.parse_args()
    check_env()
    print(json.dumps({"msg": "asimog_worker up", "host": a.host, "port": a.port, "engines": os.getenv("BETTAFISH_ENGINES", "insight")}), flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
