"""
Asimog: a headless MiroShark worker for the Slow Bridge (docs/24 sections 5 and 8). SIMULATED output only.

POST /asimog/runs   {job_id, kind: swarm, subject: mint, preset, dossier, parent_texts}
GET  /asimog/runs/<id>  -> {state, output?, error?}
GET  /asimog/health

A run builds the swarm from the dossier the Bridge sends (no database access here): caller personas from the callers
in the dossier with their measured record (caller.dna) and their real callout text as style samples, follower
personas by archetype, and one Pump.fun world seeded with the coin's curve and its recent real callouts. It runs the
Wonderwall engine with the `pumpfun` simulation for SWARM_ROUNDS rounds, SWARM_SAMPLES times per branch:
branch A as is, branch B with "Asimog posts a callout now" at round 1 (a buy, then the callout, like pump.fun requires).
Ways it fails: an agent errors or times out (its round is skipped, the run continues); the model never uses tools
(no simulated actions: wave_p 0 with `quiet` noted); a run passes SWARM_TIMEOUT_S (stopped, marked truncated).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sqlite3
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("ASIMOG_FORK", "1")
os.environ.setdefault("PYTHONUTF8", "1")

RUNS: dict[str, dict] = {}
LOCK = threading.Lock()
REQUIRED = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL_NAME"]
FOLLOWER_MIX = {"degen_follower": 0.3, "paper_hand": 0.15, "diamond_hand": 0.15, "sniper": 0.1, "exit_farmer": 0.1, "smart": 0.15, "bundler": 0.05}
HOUSE = "Asimog"


def env_int(k: str, d: int) -> int:
    v = os.getenv(k)
    return int(v) if v not in (None, "") else d


def check_env() -> None:
    missing = [k for k in REQUIRED if not os.getenv(k)]
    if missing:
        raise SystemExit(f"asimog_worker (miroshark): missing env {', '.join(missing)}")


def model():
    """The camel model for every agent, OpenAI-compatible, from our env (same variables MiroShark's runner reads)."""
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType

    os.environ["OPENAI_API_KEY"] = os.getenv("WONDERWALL_API_KEY") or os.environ["LLM_API_KEY"]
    os.environ["OPENAI_API_BASE_URL"] = os.getenv("WONDERWALL_BASE_URL") or os.environ["LLM_BASE_URL"]
    name = os.getenv("WONDERWALL_MODEL_NAME") or os.environ["LLM_MODEL_NAME"]
    return ModelFactory.create(model_platform=ModelPlatformType.OPENAI, model_type=name, model_config_dict={"max_tokens": env_int("SWARM_MAX_TOKENS_PER_TURN", 160)})


def personas(dossier: dict) -> list[dict]:
    """Callers from the dossier (measured record, real text as style), then followers by archetype. Handles hashed."""
    n_callers, n_followers, n_style = env_int("SWARM_CALLER_AGENTS", 30), env_int("SWARM_FOLLOWER_AGENTS", 30), env_int("SWARM_STYLE_SAMPLES", 8)
    callouts = dossier.get("callouts") or []
    by_wallet: dict[str, list[str]] = {}
    for c in callouts:
        by_wallet.setdefault(c.get("wallet") or "", []).append(c.get("text") or "")
    callers = sorted(dossier.get("callers") or [], key=lambda k: -(len(by_wallet.get(k.get("wallet"), [])) * 100 + (k.get("calls_seen") or 0)))[:n_callers]
    out = []
    for i, k in enumerate(callers):
        out.append({"name": f"caller_{abs(hash(k.get('wallet'))) % 10_000:04d}", "role": "caller", "wallet": k.get("wallet"), "record": json.dumps(k.get("dna") or {"calls_seen": k.get("calls_seen")})[:400], "style_samples": by_wallet.get(k.get("wallet"), [])[:n_style]})
    arche = [a for a, w in FOLLOWER_MIX.items() for _ in range(max(1, round(w * n_followers)))][:n_followers]
    out += [{"name": f"{a}_{j:03d}", "role": "follower", "archetype": a} for j, a in enumerate(arche)]
    return out


def graph_for(profiles: list[dict], mdl, with_house: bool):
    from wonderwall import AgentGraph
    from wonderwall.simulations.pumpfun import pumpfun_simulation
    from wonderwall.social_agent.agent import SocialAgent
    from wonderwall.social_platform.config import UserInfo

    g = AgentGraph()
    everyone = ([{"name": HOUSE, "role": "house"}] if with_house else []) + profiles
    for i, p in enumerate(everyone):
        info = UserInfo(name=p["name"], description=p.get("archetype") or p["role"], profile={"other_info": p})
        g.add_agent(SocialAgent(agent_id=i, user_info=info, model=mdl, agent_graph=g, simulation=pumpfun_simulation))
    return g, everyone


async def one_run(req: dict, branch: str, sample: int, profiles: list[dict], mdl, deadline: float) -> dict:
    import wonderwall
    from wonderwall import LLMAction, ManualAction
    from wonderwall.simulations.pumpfun import pumpfun_simulation
    from wonderwall.simulations.pumpfun.amm import curve_from_price

    d = req.get("dossier") or {}
    coin = d.get("coin") or {}
    mint, symbol = req["subject"], (coin.get("symbol") or req["subject"][:4])
    price = float(d.get("last_price_sol") or 2.8e-8)
    db = os.path.join(tempfile.mkdtemp(prefix="pumpfun-"), f"{branch}{sample}.db")
    g, everyone = graph_for(profiles, mdl, with_house=branch == "B")
    env = wonderwall.make(agent_graph=g, simulation=pumpfun_simulation, database_path=db, semaphore=env_int("SWARM_CONCURRENCY", 16))
    await env.reset()
    env.platform.seed_world([{"mint": mint, "symbol": symbol, "curve": curve_from_price(price)}], [{"real_id": c.get("callout_id"), "mint": mint, "content": c.get("text") or "", "likes": c.get("likes") or 0} for c in (d.get("callouts") or [])[:20]])
    truncated = False
    rounds = env_int("SWARM_ROUNDS", 6)
    # P6 beliefs (upstream BeliefState): stance on the coin per agent, updated each round from what was posted
    from wonderwall.social_agent.belief_state import BeliefState, inject_belief_context
    topic = symbol
    stance0 = {"caller": "supportive", "house": "supportive"}
    beliefs = {i: BeliefState.from_profile({"stance": stance0.get(p["role"], "neutral"), "sentiment_bias": 0.3 if p.get("archetype") in ("degen_follower", "exit_farmer") else 0.0}, [topic]) for i, p in enumerate(everyone)}
    drift: list[dict] = []
    seen_rows = 0
    for r in range(rounds):
        if time.time() > deadline:
            truncated = True
            break
        if branch == "B" and r == 1:  # Director Mode: our callout, disclosed size, from the house agent
            house = g.get_agent(0)
            size = float(os.getenv("SWARM_HOUSE_SIZE_SOL", "0.02"))
            await env.step({house: [ManualAction(action_type="buy", action_args={"mint_or_symbol": mint, "amount_sol": size}),
                                    ManualAction(action_type="post_callout", action_args={"mint_or_symbol": mint, "content": f"${symbol}: early callers and real flow. Holding {size} SOL. Not advice."})]})
        actions = {a: LLMAction() for i, a in g.get_agents() if not (branch == "B" and i == 0)}
        try:
            await asyncio.wait_for(env.step(actions), timeout=max(5, deadline - time.time()))
        except asyncio.TimeoutError:
            truncated = True
            break
        con = sqlite3.connect(db)
        new = con.execute("SELECT rowid, user_id, content, likes FROM callout WHERE rowid > ? UNION ALL SELECT -rowid, user_id, content, 0 FROM reply", (seen_rows,)).fetchall()
        seen_rows = max([seen_rows] + [x[0] for x in new if x[0] > 0])
        con.close()
        posts_seen = [{"content": c, "author_id": u, "num_likes": lk, "num_dislikes": 0} for (_, u, c, lk) in new]
        for i, b in beliefs.items():
            b.update_from_round([p for p in posts_seen if p["author_id"] != i], {"likes_received": 0, "dislikes_received": 0}, r)
            agent = g.get_agent(i)
            if agent is not None and getattr(agent, "system_message", None) is not None:
                # camel returns a copy on every read: edit one copy with upstream's injector, then push it back
                holder = type("H", (), {})()
                holder.system_message = agent.system_message
                inject_belief_context(holder, b.to_prompt_text())
                # reset_memory=True: camel keeps the old system record otherwise; each round's prompt carries the full feed and wallet
                agent.update_system_message(holder.system_message.content, reset_memory=True)
        by_role: dict[str, list[float]] = {}
        for i, b in beliefs.items():
            key = everyone[i].get("archetype") or everyone[i]["role"]
            by_role.setdefault(key, []).append(b.positions.get(topic, 0.0))
        drift.append({"round": r, "stance": {k: round(sum(v) / len(v), 4) for k, v in by_role.items()}})
    await env.close()
    con = sqlite3.connect(db)
    q = lambda sql, *a: con.execute(sql, a).fetchall()  # noqa: E731
    caller_ids = {i for i, p in enumerate(everyone) if p["role"] == "caller"}
    simulated_callers = {u for (u,) in q("SELECT DISTINCT user_id FROM callout WHERE real_id IS NULL") if u in caller_ids}
    net = q("SELECT coalesce(sum(CASE side WHEN 'buy' THEN lamports ELSE -lamports END), 0) FROM coin_trade")[0][0]
    posts = [{"branch": branch, "round": 0, "agent": everyone[u]["name"] if u < len(everyone) else str(u), "archetype": everyone[u].get("archetype", everyone[u]["role"]) if u < len(everyone) else "", "text": t[:280]}
             for (u, t) in q("SELECT user_id, content FROM callout WHERE real_id IS NULL UNION ALL SELECT user_id, content FROM reply")][:100]
    actions_n = q("SELECT count(*) FROM trace WHERE action NOT IN ('sign_up', 'browse_callout_feed', 'view_portfolio')")[0][0]
    con.close()
    return {"callers": len(simulated_callers), "net_lamports": net, "posts": posts, "actions": actions_n, "truncated": truncated, "drift": drift}


def execute(run_id: str, req: dict) -> None:
    try:
        mdl = model()
        profiles = personas(req.get("dossier") or {})
        samples = env_int("SWARM_SAMPLES", 3)
        branches = [b.strip() for b in os.getenv("SWARM_BRANCHES", "A,B").split(",") if b.strip()]
        deadline = time.time() + env_int("SWARM_TIMEOUT_S", 900)
        wave_at = env_int("SWARM_WAVE_CALLERS", 5)
        res = {b: [asyncio.run(one_run(req, b, s, profiles, mdl, deadline)) for s in range(samples)] for b in branches}
        a = res.get("A", [])
        b = res.get("B", [])
        mean = lambda xs: sum(xs) / len(xs) if xs else 0.0  # noqa: E731
        wave_p = mean([1.0 if x["callers"] >= wave_at else 0.0 for x in a])
        d_callers = mean([x["callers"] for x in b]) - mean([x["callers"] for x in a]) if b else 0.0
        d_net = (mean([x["net_lamports"] for x in b]) - mean([x["net_lamports"] for x in a])) / 1e9 if b else 0.0
        posts = [p for xs in res.values() for x in xs for p in x["posts"]][:400]
        truncated = any(x["truncated"] for xs in res.values() for x in xs)
        quiet = sum(x["actions"] for xs in res.values() for x in xs) == 0
        summary = (f"SIMULATED swarm on ${(req.get('dossier') or {}).get('coin', {}).get('symbol') or req['subject'][:4]}: wave probability {wave_p:.2f} over {len(a)} samples"
                   f" (wave = {wave_at} or more callers calling); our callout changes callers by {d_callers:+.1f} and net flow by {d_net:+.3f} SOL." + (" No simulated actions." if quiet else ""))
        md = "\n".join([f"# Swarm report (SIMULATED)", "", summary, "", "## Branches", *[f"- {k}: " + ", ".join(f"callers {x['callers']}, net {x['net_lamports'] / 1e9:+.3f} SOL, actions {x['actions']}" for x in v) for k, v in res.items()],
                        "", "## Seeded from", *[f"- {t['producer']} {t['report_id']}: {t['summary'][:200]}" for t in (req.get("parent_texts") or [])]])
        cites = [c.get("callout_id") for c in ((req.get("dossier") or {}).get("callouts") or [])[:20] if c.get("callout_id")]
        beliefs_out = {k: [x["drift"] for x in v] for k, v in res.items()}
        out = {"beliefs": {"topic": (req.get("dossier") or {}).get("coin", {}).get("symbol") or req["subject"][:4], "branches": beliefs_out}, "swarm": {"samples": max(1, len(a)), "usd": 0.0, "truncated": truncated, "wave_p": wave_p, "d_callers": d_callers, "d_net_sol": d_net, "posts": posts},
               "reports": [{"producer": "miroshark.report", "kind": "swarm", "subject": req["subject"], "summary": summary[:590], "cites": cites, "markdown": md, "ir": {"branches": {k: [{kk: vv for kk, vv in x.items() if kk not in ("posts",)} for x in v] for k, v in res.items()}}, "simulated": True}]}
        with LOCK:
            RUNS[run_id] = {"state": "done", "output": out}
    except Exception as err:  # noqa: BLE001
        traceback.print_exc()
        with LOCK:
            RUNS[run_id] = {"state": "failed", "error": f"{type(err).__name__}: {err}"[:300]}


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

    def log_message(self, *a):
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=env_int("MIROSHARK_PORT", 7411))
    ap.add_argument("--host", default=os.getenv("MIROSHARK_HOST", "127.0.0.1"))
    a = ap.parse_args()
    check_env()
    print(json.dumps({"msg": "asimog_worker (miroshark) up", "host": a.host, "port": a.port}), flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
