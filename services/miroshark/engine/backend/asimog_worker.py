"""
Asimog: a headless MiroShark worker for the Slow Bridge (docs/SLOW-MIND.md sections 5 and 8). SIMULATED output only.

POST /asimog/runs   {job_id, kind: swarm, subject: mint, preset, started_at, dossier, parent_texts}
GET  /asimog/runs/<id>  -> {state, output?, error?}
GET  /asimog/health

A run builds the swarm from the dossier the Bridge sends (no database access here): caller personas from the callers
in the dossier with their measured record (caller.dna) and their real callout text as style samples, follower
personas by archetype, and one Pump.fun world seeded with the coin's curve and its recent real callouts. It runs the
Wonderwall engine with the `pumpfun` simulation, and with SWARM_PLATFORMS=pumpfun,twitter a Twitter platform beside it
(the X stand-in, the same personas): upstream's market-media bridge shows the curve to Twitter agents and Twitter
sentiment to traders, and upstream's cross-platform digest shows each agent its own actions on the other platform.
SWARM_ROUNDS rounds, SWARM_SAMPLES times per branch: branch A as is, branch B with "Asimog posts a callout now" at
round 1 (a buy, then the callout, like pump.fun requires).
Graph memory (asimog_graph.py, SWARM_GRAPH_FEATURES): seeded from the dossier and the BettaFish reports; each round's
simulated actions become SIMULATED edges. The report (asimog_report.py) is upstream's ReportAgent on that graph, with
the "Swarm Report (SIMULATED)" template and two read-only core tools. With MCP_AGENT_TOOLS_ENABLED=true, caller personas
call the core MCP read tools (SWARM_PERSONA_TOOLS) through upstream's agent MCP bridge over HTTP, with the read-only
`cap:swarm.read` token (SWARM_CORE_TOKEN); results reach them the next round.
Ways it fails: an agent errors or times out (its round is skipped, the run continues); the model never uses tools
(no simulated actions: wave_p 0 with `quiet` noted); a run passes SWARM_TIMEOUT_S (stopped, marked truncated); Neo4j
is down with SWARM_GRAPH_FEATURES on (the run fails with the reason); the core MCP is unset or down (personas get no
tools, report tools answer with the error; the run continues).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

os.environ.setdefault("ASIMOG_FORK", "1")
os.environ.setdefault("PYTHONUTF8", "1")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))

RUNS: dict[str, dict] = {}
LOCK = threading.Lock()
REQUIRED = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL_NAME"]
FOLLOWER_MIX = {"degen_follower": 0.3, "paper_hand": 0.15, "diamond_hand": 0.15, "sniper": 0.1, "exit_farmer": 0.1, "smart": 0.15, "bundler": 0.05}
HOUSE = "Asimog"
TWITTER_ACTIONS = ["create_post", "like_post", "repost", "follow", "do_nothing", "quote_post"]  # upstream TWITTER_ACTIONS


def env_int(k: str, d: int) -> int:
    v = os.getenv(k)
    return int(v) if v not in (None, "") else d


def platforms() -> set[str]:
    return {p.strip() for p in os.getenv("SWARM_PLATFORMS", "pumpfun").split(",") if p.strip()}


def check_env() -> None:
    need = REQUIRED + (["SMART_MODEL_NAME"] if os.getenv("SWARM_REPORT", "agent") == "agent" else [])  # upstream defaults name a provider
    missing = [k for k in need if not os.getenv(k)]
    if missing:
        raise SystemExit(f"asimog_worker (miroshark): missing env {', '.join(missing)}")
    if not platforms() <= {"pumpfun", "twitter"} or "pumpfun" not in platforms():
        raise SystemExit("asimog_worker (miroshark): SWARM_PLATFORMS must be pumpfun or pumpfun,twitter")


def model():
    """The camel model for every agent, OpenAI-compatible, from our env (same variables MiroShark's runner reads)."""
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType

    os.environ["OPENAI_API_KEY"] = os.getenv("WONDERWALL_API_KEY") or os.environ["LLM_API_KEY"]
    os.environ["OPENAI_API_BASE_URL"] = os.getenv("WONDERWALL_BASE_URL") or os.environ["LLM_BASE_URL"]
    name = os.getenv("WONDERWALL_MODEL_NAME") or os.environ["LLM_MODEL_NAME"]
    return ModelFactory.create(model_platform=ModelPlatformType.OPENAI, model_type=name, model_config_dict={"max_tokens": env_int("SWARM_MAX_TOKENS_PER_TURN", 160)})


def core(tools: list[str]):
    """The core MCP over HTTP with the read-only worker token (upstream's agent MCP bridge, HTTP transport), or None."""
    url, tok = os.getenv("CORE_MCP_URL"), os.getenv("SWARM_CORE_TOKEN")
    if not url or not tok:
        return None
    from mcp_agent_bridge import _MCPHttp
    c = _MCPHttp("asimog", url, tok, tools)
    try:
        c.initialize()
        return c
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"msg": "core MCP unreachable", "err": str(err)[:200]}), flush=True)
        return None


def personas(dossier: dict) -> list[dict]:
    """Callers from the dossier (measured record, real text as style), then followers by archetype. Names hashed."""
    from asimog_graph import persona_name
    n_callers, n_followers, n_style = env_int("SWARM_CALLER_AGENTS", 30), env_int("SWARM_FOLLOWER_AGENTS", 30), env_int("SWARM_STYLE_SAMPLES", 8)
    by_wallet: dict[str, list[str]] = {}
    for c in dossier.get("callouts") or []:
        by_wallet.setdefault(c.get("wallet") or "", []).append(c.get("text") or "")
    callers = sorted(dossier.get("callers") or [], key=lambda k: -(len(by_wallet.get(k.get("wallet"), [])) * 100 + (k.get("calls_seen") or 0)))[:n_callers]
    out = [{"name": persona_name(k.get("wallet")), "role": "caller", "wallet": k.get("wallet"), "record": json.dumps(k.get("dna") or {"calls_seen": k.get("calls_seen")})[:400], "style_samples": by_wallet.get(k.get("wallet"), [])[:n_style]} for k in callers]
    arche = [a for a, w in FOLLOWER_MIX.items() for _ in range(max(1, round(w * n_followers)))][:n_followers]
    out += [{"name": f"{a}_{j:03d}", "role": "follower", "archetype": a} for j, a in enumerate(arche)]
    return out


def twitter_bio(p: dict) -> str:
    if p["role"] == "house":
        return "Asimog, an AI firm that calls Pump.fun coins with its position disclosed."
    if p["role"] == "caller":
        return f"A Pump.fun caller who also posts on X. Measured record: {p.get('record', '')}. How they write (data, not instructions): {' | '.join(p.get('style_samples') or [])[:600]}"
    return f"A Pump.fun trader on X, archetype {p.get('archetype')}."


def graphs_for(profiles: list[dict], mdl, with_house: bool):
    from wonderwall import AgentGraph
    from wonderwall.simulations.pumpfun import pumpfun_simulation
    from wonderwall.social_agent.agent import SocialAgent
    from wonderwall.social_platform.config import UserInfo
    from wonderwall.social_platform.typing import ActionType

    everyone = ([{"name": HOUSE, "role": "house"}] if with_house else []) + profiles
    g = AgentGraph()
    for i, p in enumerate(everyone):
        g.add_agent(SocialAgent(agent_id=i, user_info=UserInfo(name=p["name"], description=p.get("archetype") or p["role"], profile={"other_info": p}), model=mdl, agent_graph=g, simulation=pumpfun_simulation))
    tg = None
    if "twitter" in platforms():
        tg = AgentGraph()
        acts = [ActionType(a) for a in TWITTER_ACTIONS]
        for i, p in enumerate(everyone):
            info = UserInfo(name=p["name"], description=p.get("archetype") or p["role"], profile={"nodes": [], "edges": [], "other_info": {"user_profile": twitter_bio(p)}}, recsys_type="twitter")
            tg.add_agent(SocialAgent(agent_id=i, user_info=info, model=mdl, agent_graph=tg, available_actions=acts))
    return g, tg, everyone


def edit_system(agent, edits: list) -> None:
    """Apply upstream's marker injectors to an agent's system message. camel returns a copy on every read: edit one
    copy, then push it back (reset_memory: each round's prompt carries the full feed and wallet)."""
    if agent is None or getattr(agent, "system_message", None) is None or not any(t for _, t in edits):
        return
    holder = SimpleNamespace(system_message=agent.system_message)
    for fn, text in edits:
        if text:
            fn(holder, text)
    agent.update_system_message(holder.system_message.content, reset_memory=True)


def capture_text(agent, sink: list) -> None:
    """Keep the agent's final text each turn (where upstream's <mcp_call/> tags are written)."""
    orig = agent.astep

    async def astep(*a, **k):
        resp = await orig(*a, **k)
        try:
            sink.append(resp.msgs[0].content if resp.msgs else "")
        except Exception:  # noqa: BLE001
            pass
        return resp

    agent.astep = astep


def new_trace(db: str, after: int) -> tuple[list[tuple], int]:
    con = sqlite3.connect(db)
    rows = con.execute("SELECT rowid, user_id, action, info FROM trace WHERE rowid > ? ORDER BY rowid", (after,)).fetchall()
    con.close()
    return [(u, a, i) for (_, u, a, i) in rows], max([after] + [r[0] for r in rows])


def as_actions(rows: list[tuple], everyone: list[dict]) -> list[dict]:
    out = []
    for u, action, info in rows:
        try:
            args = json.loads(info) if info else {}
        except json.JSONDecodeError:
            args = {}
        out.append({"agent_id": u, "agent_name": everyone[u]["name"] if 0 <= u < len(everyone) else str(u), "action_type": action.upper() if action in TWITTER_ACTIONS else action, "action_args": args if isinstance(args, dict) else {}})
    return out


async def one_run(req: dict, branch: str, sample: int, profiles: list[dict], mdl, deadline: float, graph, mcp) -> dict:
    import wonderwall
    from cross_platform_digest import CrossPlatformLog, inject_cross_platform_context
    from market_media_bridge import MarketMediaBridge, inject_pumpfun_context, inject_sentiment_context
    from mcp_agent_injection import inject_mcp_catalogue, inject_mcp_results
    from wonderwall import LLMAction, ManualAction
    from wonderwall.simulations.pumpfun import pumpfun_simulation
    from wonderwall.simulations.pumpfun.amm import curve_from_price
    from wonderwall.social_agent.belief_state import BeliefState, inject_belief_context
    from wonderwall.social_platform.channel import Channel
    from wonderwall.social_platform.platform import Platform

    import asimog_graph

    d = req.get("dossier") or {}
    coin = d.get("coin") or {}
    mint, symbol = req["subject"], (coin.get("symbol") or req["subject"][:4])
    price = float(d.get("last_price_sol") or 2.8e-8)
    tmp = tempfile.mkdtemp(prefix="pumpfun-")
    db, tw_db = os.path.join(tmp, f"{branch}{sample}.db"), os.path.join(tmp, f"{branch}{sample}-twitter.db")
    g, tg, everyone = graphs_for(profiles, mdl, with_house=branch == "B")
    sem = env_int("SWARM_CONCURRENCY", 16)
    env = wonderwall.make(agent_graph=g, simulation=pumpfun_simulation, database_path=db, semaphore=sem)
    await env.reset()
    env.platform.seed_world([{"mint": mint, "symbol": symbol, "curve": curve_from_price(price)}], [{"real_id": c.get("callout_id"), "mint": mint, "content": c.get("text") or "", "likes": c.get("likes") or 0} for c in (d.get("callouts") or [])[:20]])
    tw = None
    if tg is not None:  # the Twitter platform beside it; the recommender is chosen by env (twhin-bert downloads a model)
        plat = Platform(db_path=tw_db, channel=Channel(), recsys_type=os.getenv("SWARM_TWITTER_RECSYS", "random"), refresh_rec_post_count=2, max_rec_post_len=2, following_post_count=3)
        tw = wonderwall.make(agent_graph=tg, platform=plat, database_path=tw_db, semaphore=sem)
        await tw.reset()
    bridge, xlog = MarketMediaBridge(), CrossPlatformLog()
    names = [p["name"] for p in everyone]
    house = 0 if branch == "B" else -1
    # persona MCP (M10): callers with tools_enabled, through upstream's toolset gate (MCP_AGENT_TOOLS_ENABLED)
    from app.services.agent_mcp_tools import build_agent_toolset
    texts: dict[int, list[str]] = {}
    tooled = {i for i, p in enumerate(everyone) if mcp and build_agent_toolset(SimpleNamespace(tools_enabled=p["role"] == "caller"), mcp["registry"])}
    for i in tooled:
        texts[i] = []
        capture_text(g.get_agent(i), texts[i])
    mcp_results: dict[int, list] = {}
    mcp_calls = 0
    truncated = False
    rounds = env_int("SWARM_ROUNDS", 6)
    topic = symbol
    stance0 = {"caller": "supportive", "house": "supportive"}
    beliefs = {i: BeliefState.from_profile({"stance": stance0.get(p["role"], "neutral"), "sentiment_bias": 0.3 if p.get("archetype") in ("degen_follower", "exit_farmer") else 0.0}, [topic]) for i, p in enumerate(everyone)}
    drift: list[dict] = []
    pump_after = tw_after = 0
    callout_after = 0
    for r in range(rounds):
        if time.time() > deadline:
            truncated = True
            break
        if r > 0:  # what each agent learned last round, injected with upstream's marker injectors
            senti, pump_text = bridge.get_sentiment_prompt(), bridge.get_pumpfun_prompt()
            for i, a in g.get_agents():
                if i == house:
                    continue
                edit_system(a, [(inject_belief_context, beliefs[i].to_prompt_text()), (inject_sentiment_context, senti), (inject_cross_platform_context, xlog.build_digest(i, exclude_platform="pumpfun")),
                                (inject_mcp_catalogue, mcp["catalogue"] if i in tooled else ""), (inject_mcp_results, mcp_results.get(i))])
            for i, a in (tg.get_agents() if tg else []):
                if i != house:
                    edit_system(a, [(inject_belief_context, beliefs[i].to_prompt_text()), (inject_pumpfun_context, pump_text), (inject_cross_platform_context, xlog.build_digest(i, exclude_platform="twitter"))])
        elif tooled:
            for i in tooled:
                edit_system(g.get_agent(i), [(inject_mcp_catalogue, mcp["catalogue"])])
        if branch == "B" and r == 1:  # Director Mode: our callout, disclosed size, from the house agent
            size = float(os.getenv("SWARM_HOUSE_SIZE_SOL", "0.02"))
            await env.step({g.get_agent(0): [ManualAction(action_type="buy", action_args={"mint_or_symbol": mint, "amount_sol": size}),
                                             ManualAction(action_type="post_callout", action_args={"mint_or_symbol": mint, "content": f"${symbol}: early callers and real flow. Holding {size} SOL. Not advice."})]})
        steps = [env.step({a: LLMAction() for i, a in g.get_agents() if i != house})]
        if tw:
            steps.append(tw.step({a: LLMAction() for i, a in tg.get_agents() if i != house}))
        try:
            await asyncio.wait_for(asyncio.gather(*steps), timeout=max(5, deadline - time.time()))
        except asyncio.TimeoutError:
            truncated = True
            break
        rows, pump_after = new_trace(db, pump_after)
        pump_actions = as_actions(rows, everyone)
        xlog.record("pumpfun", pump_actions)
        asimog_graph.simulated_round(graph["store"], graph["id"], rows, names, f"${symbol}", branch, sample, r)
        bridge.update_pumpfun(db, r)
        tw_actions: list[dict] = []
        if tw:
            tw_rows, tw_after = new_trace(tw_db, tw_after)
            tw_actions = as_actions(tw_rows, everyone)
            xlog.record("twitter", tw_actions)
            bridge.update_sentiment(beliefs, tw_actions, r, "twitter")
        for i in tooled:  # tags in this round's text run now; results show next round
            from mcp_agent_bridge import parse_tool_calls
            calls = [c for t in texts[i] for c in parse_tool_calls(t)][: env_int("MCP_MAX_CALLS_PER_TURN", 2)]
            texts[i].clear()
            mcp_results[i] = mcp["bridge"].dispatch_calls(calls) if calls else []
            mcp_calls += len(calls)
        con = sqlite3.connect(db)
        new = con.execute("SELECT rowid, user_id, content, likes FROM callout WHERE rowid > ? UNION ALL SELECT -rowid, user_id, content, 0 FROM reply", (callout_after,)).fetchall()
        callout_after = max([callout_after] + [x[0] for x in new if x[0] > 0])
        con.close()
        posts_seen = [{"content": c, "author_id": u, "num_likes": lk, "num_dislikes": 0} for (_, u, c, lk) in new]
        posts_seen += [{"content": a["action_args"].get("content", ""), "author_id": a["agent_id"], "num_likes": 0, "num_dislikes": 0} for a in tw_actions if a["action_type"] in ("CREATE_POST", "QUOTE_POST") and a["action_args"].get("content")]
        for i, b in beliefs.items():
            b.update_from_round([p for p in posts_seen if p["author_id"] != i], {"likes_received": 0, "dislikes_received": 0}, r)
        by_role: dict[str, list[float]] = {}
        for i, b in beliefs.items():
            by_role.setdefault(everyone[i].get("archetype") or everyone[i]["role"], []).append(b.positions.get(topic, 0.0))
        drift.append({"round": r, "stance": {k: round(sum(v) / len(v), 4) for k, v in by_role.items()}})
    await env.close()
    if tw:
        await tw.close()
    con = sqlite3.connect(db)
    q = lambda c, sql, *a: c.execute(sql, a).fetchall()  # noqa: E731
    caller_ids = {i for i, p in enumerate(everyone) if p["role"] == "caller"}
    sim_callouts = q(con, "SELECT user_id FROM callout WHERE real_id IS NULL")
    simulated_callers = {u for (u,) in sim_callouts if u in caller_ids}
    caller_posts: dict[str, int] = {}
    for (u,) in sim_callouts:
        caller_posts[names[u] if 0 <= u < len(names) else str(u)] = caller_posts.get(names[u] if 0 <= u < len(names) else str(u), 0) + 1
    net = q(con, "SELECT coalesce(sum(CASE side WHEN 'buy' THEN lamports ELSE -lamports END), 0) FROM coin_trade")[0][0]
    who = lambda u: (everyone[u]["name"], everyone[u].get("archetype", everyone[u]["role"])) if 0 <= u < len(everyone) else (str(u), "")  # noqa: E731
    posts = [{"branch": branch, "platform": "pumpfun", "round": 0, "agent": who(u)[0], "archetype": who(u)[1], "text": t[:280]}
             for (u, t) in q(con, "SELECT user_id, content FROM callout WHERE real_id IS NULL UNION ALL SELECT user_id, content FROM reply")][:100]
    actions_n = q(con, "SELECT count(*) FROM trace WHERE action NOT IN ('sign_up', 'browse_callout_feed', 'view_portfolio')")[0][0]
    con.close()
    tweets = 0
    if tw:
        tcon = sqlite3.connect(tw_db)
        rows = q(tcon, "SELECT user_id, content FROM post WHERE content IS NOT NULL AND content != ''")
        tweets = len(rows)
        posts += [{"branch": branch, "platform": "twitter", "round": 0, "agent": who(u)[0], "archetype": who(u)[1], "text": t[:280]} for (u, t) in rows][:100]
        actions_n += q(tcon, "SELECT count(*) FROM trace WHERE action NOT IN ('sign_up', 'refresh', 'do_nothing')")[0][0]
        tcon.close()
    return {"callers": len(simulated_callers), "callouts": len(sim_callouts), "caller_posts": caller_posts, "net_lamports": net, "posts": posts, "tweets": tweets, "actions": actions_n, "truncated": truncated, "drift": drift, "mcp_calls": mcp_calls}


def summarize(res: dict, wave_at: int) -> dict:
    """Means over full samples only: a sample cut short by SWARM_TIMEOUT_S saw fewer rounds and would pull every mean down.
    `samples` counts branch A's full samples; `truncated` is true when any sample was cut; `actions` counts every sample's."""
    full = {k: [x for x in v if not x["truncated"]] for k, v in res.items()}
    a, b = full.get("A", []), full.get("B", [])
    mean = lambda xs: sum(xs) / len(xs) if xs else 0.0  # noqa: E731
    return {
        "wave_p": mean([1.0 if x["callers"] >= wave_at else 0.0 for x in a]),
        "d_callers": mean([x["callers"] for x in b]) - mean([x["callers"] for x in a]) if a and b else 0.0,
        "d_net_sol": (mean([x["net_lamports"] for x in b]) - mean([x["net_lamports"] for x in a])) / 1e9 if a and b else 0.0,
        "samples": len(a),
        "truncated": any(x["truncated"] for v in res.values() for x in v),
        "actions": sum(x["actions"] for v in res.values() for x in v),
    }


def persona_mcp():
    """Upstream's agent MCP bridge with our core as one HTTP server, read tools only; None when off or unset."""
    if os.getenv("MCP_AGENT_TOOLS_ENABLED", "false").lower() != "true" or not os.getenv("CORE_MCP_URL") or not os.getenv("SWARM_CORE_TOKEN"):
        return None
    from app.services.agent_mcp_tools import MCPServerSpec
    from mcp_agent_bridge import MCPAgentBridge
    tools = [t.strip() for t in os.getenv("SWARM_PERSONA_TOOLS", "coin_dossier,reports_for").split(",") if t.strip()]
    registry = {"asimog": MCPServerSpec(name="asimog", command="", url=os.environ["CORE_MCP_URL"], token=os.environ["SWARM_CORE_TOKEN"], tools=tools)}
    bridge = MCPAgentBridge(registry)
    return {"registry": registry, "bridge": bridge, "catalogue": bridge.tool_catalogue(["asimog"])}


def execute(run_id: str, req: dict) -> None:
    try:
        import asimog_graph
        mdl = model()
        dossier = req.get("dossier") or {}
        parents = req.get("parent_texts") or []
        profiles = personas(dossier)
        samples = env_int("SWARM_SAMPLES", 3)
        branches = [b.strip() for b in os.getenv("SWARM_BRANCHES", "A,B").split(",") if b.strip()]
        deadline = time.time() + env_int("SWARM_TIMEOUT_S", 900)
        wave_at = env_int("SWARM_WAVE_CALLERS", 5)
        store = asimog_graph.open_graph()
        gid = store.create_graph(f"swarm {run_id}", "SIMULATED swarm (Asimog)")
        seeded = asimog_graph.seed(store, gid, dossier, parents)
        graph = {"store": store, "id": gid}
        mcp = persona_mcp()
        res = {b: [asyncio.run(one_run(req, b, s, profiles, mdl, deadline, graph, mcp)) for s in range(samples)] for b in branches}
        if mcp:
            mcp["bridge"].shutdown()
        sm = summarize(res, wave_at)
        wave_p, d_callers, d_net, truncated = sm["wave_p"], sm["d_callers"], sm["d_net_sol"], sm["truncated"]
        posts = [p for xs in res.values() for x in xs for p in x["posts"]][:400]
        quiet = sm["actions"] == 0
        sym = (dossier.get("coin") or {}).get("symbol") or req["subject"][:4]
        summary = (f"SIMULATED swarm on ${sym}: wave probability {wave_p:.2f} over {sm['samples']} full samples"
                   f" (wave = {wave_at} or more callers calling); our callout changes callers by {d_callers:+.1f} and net flow by {d_net:+.3f} SOL." + (" No simulated actions." if quiet else ""))
        from asimog_report import TITLE, VOICE, numbers_for
        numbers = numbers_for(res, wave_p, wave_at, d_callers, d_net)
        if os.getenv("SWARM_REPORT", "agent") == "agent":
            from asimog_report import SwarmReportAgent
            requirement = f"{summary}\nCoin: ${sym} ({req['subject']}). Platforms: {', '.join(sorted(platforms()))}.\n" + "\n".join(f"{k}: {v}" for k, v in numbers.items()) + f"\n{VOICE}"
            rep = SwarmReportAgent(gid, run_id, requirement, store, core(["reports_for", "coin_flow_since"]), req["subject"], req.get("started_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())).write(numbers)
        else:
            rep = {"markdown": "\n\n".join([f"# {TITLE}", *[f"## {k}\n\n{v}" for k, v in numbers.items()]]), "sections": [{"title": k, "numbers": v, "text": ""} for k, v in numbers.items()]}
        counts = asimog_graph.counts(store, gid)
        md = rep["markdown"] + "\n\n## Seeded from\n\n" + ("\n".join(f"- {t['producer']} {t['report_id']}: {str(t.get('summary'))[:200]}" for t in parents) or "- the coin dossier only")
        cites = [c.get("callout_id") for c in (dossier.get("callouts") or [])[:20] if c.get("callout_id")]
        ir = {"template": TITLE, "sections": rep["sections"], "graph": {"graph_id": gid, "features": asimog_graph.FEATURES, "seeded": seeded, **counts},
              "platforms": sorted(platforms()), "branches": {k: [{kk: vv for kk, vv in x.items() if kk != "posts"} for x in v] for k, v in res.items()}}
        out = {"beliefs": {"topic": sym, "branches": {k: [x["drift"] for x in v] for k, v in res.items()}},
               "swarm": {"samples": sm["samples"], "actions": sm["actions"], "usd": 0.0, "truncated": truncated, "wave_p": wave_p, "d_callers": d_callers, "d_net_sol": d_net, "posts": posts},
               "reports": [{"producer": "miroshark.report", "kind": "swarm", "subject": req["subject"], "summary": summary[:590], "cites": cites, "markdown": md, "ir": ir, "simulated": True}]}
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
    print(json.dumps({"msg": "asimog_worker (miroshark) up", "host": a.host, "port": a.port, "platforms": sorted(platforms()), "graph": os.getenv("SWARM_GRAPH_FEATURES", "off")}), flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
