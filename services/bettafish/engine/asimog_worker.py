"""
Asimog patch B8 (docs/SLOW-MIND.md section 7): a headless worker that runs the real BettaFish engines for the Slow Bridge.

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
import contextvars
import hmac
import json
import os
import re
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("ASIMOG_FORK", "1")
if os.getenv("BETTAFISH_DB_URL"):  # BettaFish reads DATABASE_URL; ours is the read-only slow_reader role
    os.environ["DATABASE_URL"] = re.sub(r"^postgres(ql)?://", "postgresql+asyncpg://", os.environ["BETTAFISH_DB_URL"])

REQUIRED = ["INSIGHT_ENGINE_API_KEY", "INSIGHT_ENGINE_BASE_URL", "INSIGHT_ENGINE_MODEL_NAME", "DATABASE_URL", "LLM_PRICE_IN_PER_M", "LLM_PRICE_OUT_PER_M", "BETTAFISH_WORKER_TOKEN"]
TOKEN_ENV = "BETTAFISH_WORKER_TOKEN"
KINDS, PRESETS = {"feed", "coin"}, {"nano", "lite", "full"}
MAX_CONCURRENT = int(os.getenv("BETTAFISH_MAX_CONCURRENT") or 2)
CID = re.compile(r"\[cid:([A-Za-z0-9_\-]+)\]")
RUNS: dict[str, dict] = {}
LOCK = threading.Lock()


class SpendCap(BaseException):
    """The run passed its usd_cap. A BaseException on purpose: upstream's retry catches Exception (and sleeps a minute
    before each of six tries), and the engines' own `except Exception` blocks would swallow it; this reaches run_engine."""


class Meter:
    """Real spend of one run (D2): each model response's token usage times the prices in env (USD per million tokens,
    LLM_PRICE_IN_PER_M and LLM_PRICE_OUT_PER_M; never a price in code). `over` once spend passes the run's usd_cap."""

    def __init__(self, cap: float | None):
        self.usd, self.cap, self.lock, self.cancelled = 0.0, cap, threading.Lock(), False
        self.price_in, self.price_out = float(os.environ["LLM_PRICE_IN_PER_M"]) / 1e6, float(os.environ["LLM_PRICE_OUT_PER_M"]) / 1e6

    def over(self) -> bool:
        return self.cap is not None and self.usd > self.cap

    def add(self, usage) -> None:
        if usage is not None:
            with self.lock:
                self.usd += (getattr(usage, "prompt_tokens", 0) or 0) * self.price_in + (getattr(usage, "completion_tokens", 0) or 0) * self.price_out


METER: contextvars.ContextVar = contextvars.ContextVar("asimog_meter", default=None)
METERS: dict[str, Meter] = {}


class _MeteredStream:
    """A streamed answer: its usage arrives on the last chunk (stream_options.include_usage)."""

    def __init__(self, stream, meter: Meter):
        self._s, self._m = stream, meter

    def __iter__(self):
        for chunk in self._s:
            self._m.add(getattr(chunk, "usage", None))
            yield chunk

    def __getattr__(self, name):
        return getattr(self._s, name)


def meter_openai(over_cap) -> None:
    """Every chat call through the openai client checks the run's cap first (raising `over_cap`), then adds its usage."""
    from openai.resources.chat.completions import AsyncCompletions, Completions

    sync, aio = Completions.create, AsyncCompletions.create

    def gate(k: dict):
        m = METER.get()
        if m and (m.cancelled or m.over()):
            raise over_cap("cancelled" if m.cancelled else f"spent {m.usd:.4f} of {m.cap} USD")
        if m and k.get("stream"):
            k.setdefault("stream_options", {"include_usage": True})
        return m

    def create(self, *a, **k):
        m = gate(k)
        r = sync(self, *a, **k)
        if m:
            if k.get("stream"):
                return _MeteredStream(r, m)
            m.add(getattr(r, "usage", None))
        return r

    async def acreate(self, *a, **k):
        m = gate(k)
        r = await aio(self, *a, **k)
        if m and not k.get("stream"):
            m.add(getattr(r, "usage", None))
        return r

    Completions.create, AsyncCompletions.create = create, acreate


def check_env() -> None:
    """patch B9: refuse to start on a missing provider value instead of using upstream's defaults."""
    missing = [k for k in REQUIRED if not os.getenv(k)]
    if missing:
        raise SystemExit(f"asimog_worker: missing env {', '.join(missing)}")


def cites(text: str) -> list[str]:
    return list(dict.fromkeys(CID.findall(text or "")))[:12]


def plain(text: str, n: int) -> str:
    """Prose for core: citation markers removed (they travel only as the separate `cites` field), whitespace folded."""
    return re.sub(r"\s+", " ", CID.sub("", text or "")).strip()[:n]


def query_for(req: dict) -> str:
    w = int(req.get("window_min") or 60)
    if req["kind"] == "feed":
        return f"Pump.fun callout feed, last {w} minutes: which coins and narratives are callers pushing, who is early, what looks suspicious"
    return f"Pump.fun coin {req['subject']}: what callers say about it, how early they are, their track records, the trade flow, and any swarm reports"


def run_engine(name: str, query: str, forum: "Forum | None" = None):
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
    if forum:  # patch B5: every finished paragraph is a forum speech; the host steers every N speeches
        for step in ("_initial_search_and_summary", "_reflection_loop"):
            orig = getattr(agent, step)

            def hooked(i, _orig=orig):
                out = _orig(i)
                forum.speak(name, agent.state.paragraphs[i].research.latest_summary)
                return out

            setattr(agent, step, hooked)
    try:
        report = agent.research(query, save_report=False)
    except SpendCap:  # the cap stops the engine; the paragraphs it finished are kept
        report = ""
    return name, agent.state, report


class Forum:
    """Patch B5: upstream's forum.log (LogMonitor writes it, ForumHost speaks, forum_reader feeds the host's speech back
    into each engine's next summary) driven by paragraph completions instead of by tailing Streamlit logs."""

    def __init__(self, host_every: int, max_host: int):
        from ForumEngine.monitor import LogMonitor

        self.mon = LogMonitor(log_dir="logs")  # forum_reader reads logs/forum.log
        self.mon.clear_forum_log()
        self.every, self.max_host, self.pending, self.hosts = host_every, max_host, 0, 0
        self.lines: list[dict] = []
        self.lock = threading.Lock()
        self.host = None
        if host_every > 0 and max_host > 0:
            from ForumEngine.llm_host import ForumHost

            self.host = ForumHost(api_key=os.getenv("FORUM_HOST_API_KEY"), base_url=os.getenv("FORUM_HOST_BASE_URL"), model_name=os.getenv("FORUM_HOST_MODEL_NAME"))

    def speak(self, source: str, text: str) -> None:
        if not text:
            return
        with self.lock:
            self.mon.write_to_forum_log(text, source.upper())
            self.lines.append({"round": self.hosts, "agent": source, "text": plain(text, 600), "cites": cites(text)})
            self.pending += 1
            due = self.host and self.pending >= self.every and self.hosts < self.max_host
            if due:
                self.pending = 0
                self.hosts += 1
        if due:
            speech = self.host.generate_host_speech(self.mon.get_forum_log_content())
            if speech:
                with self.lock:
                    self.mon.write_to_forum_log(speech, "HOST")
                    self.lines.append({"round": self.hosts, "agent": "host", "text": plain(speech, 600), "cites": cites(speech)})


TEMPLATES = {"feed": "asimog_callout_feed_synthesis.md", "coin": "asimog_coin_synthesis.md"}


def full_report(req: dict, results: list, forum: "Forum | None") -> dict | None:
    """Patch B6: ReportEngine over the engines' reports, the forum and MiroShark's swarm reports (SIMULATED), with our
    template. Returns a bettafish.report entry with the Document IR and its Markdown rendering, or None when off."""
    if os.getenv("BETTAFISH_REPORT", "signals") == "signals":
        return None
    from ReportEngine.agent import ReportAgent
    from ReportEngine.renderers.markdown_renderer import MarkdownRenderer
    import asimog_db

    swarm = asimog_db.query("select report_id, summary, markdown from slow.report_feed where report_id = any($1::text[])", req.get("parent_reports") or [])
    from asimog_voice import fence
    by_engine = {name: md for name, _, md in results}  # upstream's order: Query, Media, Insight, then swarm reports
    inputs = [by_engine.get(e, "") for e in ("query", "media", "insight")] + [f"SIMULATED swarm report {s['report_id']}:\n{fence(s['markdown'] or s['summary'], 20000)}" for s in swarm]
    ra = ReportAgent()
    captured: dict = {}
    render = ra.renderer.render

    def capture(ir, *a, **k):
        captured["ir"] = ir
        return render(ir, *a, **k)

    ra.renderer.render = capture
    template = (Path(__file__).parent / "ReportEngine" / "report_template" / TEMPLATES[req["kind"]]).read_text(encoding="utf-8")
    forum_text = "\n".join(f"[{l['agent'].upper()}] {l['text']}" for l in (forum.lines if forum else []))
    ra.generate_report(query_for(req), inputs, forum_logs=forum_text, custom_template=template, save_report=False)
    ir = captured.get("ir") or {}
    if ir:  # upstream's IR validator on every chapter, recorded with the IR
        from ReportEngine.ir.validator import IRValidator
        bad = [(c.get("chapterId"), errs[:3]) for c in ir.get("chapters", []) for ok, errs in [IRValidator().validate_chapter(c)] if not ok]
        ir["asimogChecks"] = {"chapters": len(ir.get("chapters", [])), "invalid": bad}
    md = MarkdownRenderer().render(ir) if ir else ""
    return {"producer": "bettafish.report", "kind": req["kind"], "subject": req["subject"], "summary": re.sub(r"\s+", " ", CID.sub("", md)).strip()[:580] or "Report generated.",
            "cites": cites(md + "\n" + "\n".join(x for _, _, x in results)), "ir": ir, "markdown": md}


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
            "narratives": [{"title": plain(t, 120), "summary": plain(x, 600), "cites": cites(x)} for t, x in paragraphs][:12],
            "coin_stances": [], "suspicious": [],
        }
    else:
        # a stance only from claims that cite our data, and whole words only: "rugged" in passing is not a rug (fix plan 5.5)
        joined = " ".join(x for _, x in paragraphs if cites(x)).lower()
        stance = "avoid" if re.search(r"\b(rug|bundl\w*|scam)\b", joined) else "bearish" if re.search(r"\b(dump|sell|exit)\b", joined) else "bullish" if re.search(r"\b(early|buy|strong)\b", joined) else "neutral"
        out["synthesis_coin"] = {"stance": stance, "narrative": re.sub(r"\s+", " ", CID.sub("", paragraphs[0][1] if paragraphs else ""))[:600], "claims": [{"text": re.sub(r"\s+", " ", CID.sub("", x))[:400], "cites": cites(x)} for _, x in paragraphs][:20]}
    return out


def execute(run_id: str, req: dict) -> None:
    engines = [e.strip() for e in os.getenv("BETTAFISH_ENGINES", "insight").split(",") if e.strip()]
    query = query_for(req)
    import asimog_db
    asimog_db.AS_OF.set(req.get("as_of") or None)  # the Bridge's slot: reads see nothing after it
    meter = METERS[run_id]
    METER.set(meter)
    ctx = contextvars.copy_context()
    try:
        forum = Forum(int(os.getenv("BETTAFISH_HOST_EVERY_N", "5")), int(os.getenv("BETTAFISH_FORUM_ROUNDS", "2"))) if len(engines) > 1 or os.getenv("BETTAFISH_FORUM_ALWAYS") == "1" else None
        import importlib
        for e in engines:  # import once, in this thread: parallel first imports of the same package race
            importlib.import_module({"insight": "InsightEngine.agent", "query": "QueryEngine.agent", "media": "MediaEngine.agent"}[e])
        with ThreadPoolExecutor(max_workers=len(engines)) as pool:
            results = list(pool.map(lambda e: ctx.copy().run(run_engine, e, query, forum), engines))
        if meter.cancelled:
            raise SpendCap("cancelled")
        out = to_output(req, results)
        if forum:
            out["forum_lines"] = forum.lines
        try:
            rep = None if meter.over() else full_report(req, results, forum)
            if rep:
                out["reports"].append(rep)
        except SpendCap:
            pass  # the engines' own reports still stand
        except Exception as err:  # noqa: BLE001 - the engines' own reports still stand
            out["report_error"] = f"{type(err).__name__}: {err}"[:300]
            traceback.print_exc()
        out["cost_usd"], out["truncated"] = meter.usd, meter.over()
        with LOCK:
            RUNS[run_id] = {"state": "done", "output": out}
    except SpendCap as err:  # cancelled, or the cap hit outside an engine (the forum host): nothing kept is complete
        with LOCK:
            RUNS[run_id] = {"state": "failed", "error": "cancelled" if meter.cancelled else f"SpendCap: {err}"[:300]}
    except Exception as err:  # noqa: BLE001 - the Bridge records the reason
        with LOCK:
            RUNS[run_id] = {"state": "failed", "error": f"{type(err).__name__}: {err}"[:300]}
        traceback.print_exc()


def bad_request(req) -> str | None:
    """Patch D4: the reason a start request is refused (400), or None. The Bridge's contract, services/slow-bridge/src/types.ts."""
    if not isinstance(req, dict):
        return "body must be a JSON object"
    for k in ("job_id", "kind", "subject", "preset", "as_of"):
        if not isinstance(req.get(k), str) or not req[k]:
            return f"missing {k}"
    if req["kind"] not in KINDS:
        return f"unknown kind {req['kind'][:20]}"
    if req["preset"] not in PRESETS:
        return f"unknown preset {req['preset'][:20]}"
    try:
        datetime.fromisoformat(req["as_of"].replace("Z", "+00:00"))
    except ValueError:
        return "as_of is not an ISO time"
    for k, lo in (("window_min", 1), ("usd_cap", 0)):
        v = req.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < lo:
            return f"{k} must be a number of at least {lo}"
    return None


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        """Patch D4: every route but health needs the Bridge's bearer token (constant-time compare)."""
        return hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {os.environ[TOKEN_ENV]}".encode())

    def do_GET(self):  # noqa: N802
        if self.path == "/asimog/health":
            return self._send(200, {"ok": True})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        m = re.match(r"^/asimog/runs/(.+)$", self.path)
        if m:
            with LOCK:
                r = RUNS.get(m.group(1))
                spent = METERS.get(m.group(1))
            return self._send(200 if r else 404, {**r, "cost_usd": spent.usd if spent else 0.0} if r else {"state": "failed", "error": "unknown run"})
        self._send(404, {})

    def do_DELETE(self):  # noqa: N802
        """Cancel: the run stops at its next model call and is finished `failed: cancelled`."""
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        m = re.match(r"^/asimog/runs/(.+)$", self.path)
        with LOCK:
            meter = METERS.get(m.group(1)) if m else None
            if meter:
                meter.cancelled = True
        self._send(200 if meter else 404, {"ok": bool(meter)})

    def do_POST(self):  # noqa: N802
        if self.path != "/asimog/runs":
            return self._send(404, {})
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "body is not JSON"})
        why = bad_request(req)
        if why:
            return self._send(400, {"error": why})
        run_id = req["job_id"]
        with LOCK:
            if run_id in RUNS:  # a duplicate id never starts a second run
                return self._send(409, {"run_id": run_id, "state": RUNS[run_id]["state"]})
            if sum(1 for r in RUNS.values() if r["state"] == "running") >= MAX_CONCURRENT:
                return self._send(429, {"error": f"{MAX_CONCURRENT} runs already running"})
            RUNS[run_id] = {"state": "running"}
            METERS[run_id] = Meter(float(req["usd_cap"]))
        threading.Thread(target=execute, args=(run_id, req), daemon=True).start()
        self._send(200, {"run_id": run_id})

    def log_message(self, *a):  # quiet
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.getenv("BETTAFISH_PORT", "7412")))
    ap.add_argument("--host", default=os.getenv("BETTAFISH_HOST", "127.0.0.1"))
    a = ap.parse_args()
    check_env()
    meter_openai(SpendCap)
    print(json.dumps({"msg": "asimog_worker up", "host": a.host, "port": a.port, "engines": os.getenv("BETTAFISH_ENGINES", "insight")}), flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
