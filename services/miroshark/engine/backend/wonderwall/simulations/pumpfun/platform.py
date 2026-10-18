"""Pump.fun platform for Wonderwall (Asimog, docs/SLOW-MIND.md section 8.1). SIMULATED.

The server side of a Pump.fun swarm: one or more coins on their bonding curve, the callout feed, updates, replies,
caller follows, trades and positions. The nine actions of docs/SLOW-MIND.md are methods here; BaseAction turns the agent-side
signatures in actions.py into tools. Seeded from our real data (the coin's curve and its recent real callouts) through
`seed_world`, so agents start from what the market looked like at the escalation.

Rules that mirror pump.fun: a callout needs a position in the coin; a sell cannot exceed the position; trades move the
curve with the same integer math as the SDK (amm.py).
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from wonderwall.clock.clock import Clock
from wonderwall.simulations.base import BasePlatform
from wonderwall.simulations.pumpfun.amm import Curve, apply_buy, apply_sell, spot_sol_per_token

logger = logging.getLogger(__name__)
LAMPORTS = 1_000_000_000


class PumpfunPlatform(BasePlatform):
    required_schemas = ["coin.sql", "callout.sql", "trade.sql"]
    core_schemas = ["user.sql", "trace.sql"]

    def __init__(self, db_path: str, channel: Any = None, sandbox_clock: Clock | None = None, start_time: datetime | None = None, initial_sol: float = 1.0, max_buy_sol: float = 0.5):
        self.initial_lamports = int(initial_sol * LAMPORTS)
        self.max_buy_lamports = int(max_buy_sol * LAMPORTS)
        super().__init__(db_path=db_path, channel=channel, sandbox_clock=sandbox_clock, start_time=start_time)

    # ---- setup ----

    async def sign_up(self, agent_id, user_message):
        result = await super().sign_up(agent_id, user_message)
        if result["success"]:
            self._execute_db_command("INSERT OR IGNORE INTO wallet (user_id, lamports) VALUES (?, ?)", (agent_id, self.initial_lamports), commit=True)
        return result

    def seed_world(self, coins: list[dict], callouts: list[dict]) -> None:
        """coins: [{mint, symbol, curve: Curve}]; callouts: [{real_id, mint, content, likes, user_id}] (observed, not simulated)."""
        now = self.get_current_time()
        for c in coins:
            cv: Curve = c["curve"]
            self._execute_db_command("INSERT OR IGNORE INTO coin (mint, symbol, v_tok, v_sol, real_tok, real_sol) VALUES (?, ?, ?, ?, ?, ?)", (c["mint"], c["symbol"], cv.v_tok, cv.v_sol, cv.real_tok, cv.real_sol), commit=True)
        for x in callouts:
            coin_id = self._coin_id(x["mint"])
            if coin_id is not None:
                self._execute_db_command("INSERT INTO callout (user_id, coin_id, content, real_id, likes, created_at) VALUES (?, ?, ?, ?, ?, ?)", (x.get("user_id", -1), coin_id, x["content"], x["real_id"], int(x.get("likes", 0)), now), commit=True)

    # ---- helpers ----

    def _coin_id(self, mint_or_symbol: str) -> int | None:
        key = str(mint_or_symbol).lstrip("$")
        self._execute_db_command("SELECT coin_id FROM coin WHERE mint = ? OR upper(symbol) = upper(?)", (key, key))
        row = self.db_cursor.fetchone()
        return row[0] if row else None

    def _curve(self, coin_id: int) -> Curve:
        self._execute_db_command("SELECT v_tok, v_sol, real_tok, real_sol FROM coin WHERE coin_id = ?", (coin_id,))
        r = self.db_cursor.fetchone()
        return Curve(*r)

    def _position(self, agent_id: int, coin_id: int) -> tuple[int, int]:
        self._execute_db_command("SELECT tokens, cost FROM position WHERE user_id = ? AND coin_id = ?", (agent_id, coin_id))
        r = self.db_cursor.fetchone()
        return (r[0], r[1]) if r else (0, 0)

    # ---- the nine actions (docs/SLOW-MIND.md) ----

    async def browse_callout_feed(self, agent_id):
        self._execute_db_command(
            "SELECT c.callout_id, c.user_id, k.symbol, k.mint, c.content, c.likes, c.real_id, "
            "(SELECT count(*) FROM reply r WHERE r.callout_id = c.callout_id) FROM callout c JOIN coin k USING (coin_id) "
            "ORDER BY c.callout_id DESC LIMIT 20")
        rows = self.db_cursor.fetchall()
        self._record_trace(agent_id, "browse_callout_feed", {"n": len(rows)}, self.get_current_time())
        return {"success": True, "callouts": [{"callout_id": r[0], "caller_id": r[1], "symbol": r[2], "mint": r[3], "content": r[4], "likes": r[5], "observed": r[6] is not None, "replies": r[7]} for r in rows]}

    async def view_coin(self, agent_id, mint_or_symbol):
        coin_id = self._coin_id(mint_or_symbol)
        if coin_id is None:
            return {"success": False, "error": f"no coin {mint_or_symbol}"}
        cv = self._curve(coin_id)
        self._execute_db_command("SELECT count(DISTINCT user_id), coalesce(sum(CASE side WHEN 'buy' THEN lamports ELSE -lamports END), 0) FROM coin_trade WHERE coin_id = ?", (coin_id,))
        buyers, net = self.db_cursor.fetchone()
        self._execute_db_command("SELECT symbol, mint FROM coin WHERE coin_id = ?", (coin_id,))
        sym, mint = self.db_cursor.fetchone()
        tokens, cost = self._position(agent_id, coin_id)
        self._record_trace(agent_id, "view_coin", {"coin_id": coin_id}, self.get_current_time())
        progress = 1 - cv.real_tok / 793_100_000_000_000
        return {"success": True, "symbol": sym, "mint": mint, "price_sol": spot_sol_per_token(cv), "curve_progress": round(progress, 4), "sim_traders": buyers, "sim_net_sol": net / LAMPORTS, "your_tokens": tokens / 1e6, "your_cost_sol": cost / LAMPORTS}

    async def buy(self, agent_id, message):
        mint_or_symbol, amount_sol = message
        coin_id = self._coin_id(mint_or_symbol)
        if coin_id is None:
            return {"success": False, "error": f"no coin {mint_or_symbol}"}
        lamports = min(int(float(amount_sol) * LAMPORTS), self.max_buy_lamports)
        self._execute_db_command("SELECT lamports FROM wallet WHERE user_id = ?", (agent_id,))
        row = self.db_cursor.fetchone()
        if not row or row[0] < lamports or lamports <= 0:
            return {"success": False, "error": "insufficient SOL", "balance_sol": (row[0] if row else 0) / LAMPORTS}
        cv, tokens = apply_buy(self._curve(coin_id), lamports)
        if tokens <= 0:
            return {"success": False, "error": "nothing left on the curve"}
        now = self.get_current_time()
        self._execute_db_command("UPDATE coin SET v_tok = ?, v_sol = ?, real_tok = ?, real_sol = ?, graduated = ? WHERE coin_id = ?", (cv.v_tok, cv.v_sol, cv.real_tok, cv.real_sol, int(cv.real_tok == 0), coin_id), commit=True)
        self._execute_db_command("UPDATE wallet SET lamports = lamports - ? WHERE user_id = ?", (lamports, agent_id), commit=True)
        self._execute_db_command("INSERT INTO position (user_id, coin_id, tokens, cost) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, coin_id) DO UPDATE SET tokens = tokens + ?, cost = cost + ?", (agent_id, coin_id, tokens, lamports, tokens, lamports), commit=True)
        self._execute_db_command("INSERT INTO coin_trade (user_id, coin_id, side, lamports, tokens, created_at) VALUES (?, ?, 'buy', ?, ?, ?)", (agent_id, coin_id, lamports, tokens, now), commit=True)
        self._record_trace(agent_id, "buy", {"coin_id": coin_id, "sol": lamports / LAMPORTS, "tokens": tokens / 1e6}, now)
        return {"success": True, "tokens": tokens / 1e6, "sol_spent": lamports / LAMPORTS, "price_after": spot_sol_per_token(cv)}

    async def sell(self, agent_id, message):
        mint_or_symbol, fraction = message
        coin_id = self._coin_id(mint_or_symbol)
        if coin_id is None:
            return {"success": False, "error": f"no coin {mint_or_symbol}"}
        held, cost = self._position(agent_id, coin_id)
        tokens = int(held * max(0.0, min(1.0, float(fraction))))
        if tokens <= 0:
            return {"success": False, "error": "no position to sell"}
        cv, lamports = apply_sell(self._curve(coin_id), tokens)
        now = self.get_current_time()
        self._execute_db_command("UPDATE coin SET v_tok = ?, v_sol = ?, real_tok = ?, real_sol = ? WHERE coin_id = ?", (cv.v_tok, cv.v_sol, cv.real_tok, cv.real_sol, coin_id), commit=True)
        self._execute_db_command("UPDATE wallet SET lamports = lamports + ? WHERE user_id = ?", (lamports, agent_id), commit=True)
        self._execute_db_command("UPDATE position SET tokens = tokens - ?, cost = cost - ? WHERE user_id = ? AND coin_id = ?", (tokens, int(cost * tokens / held), agent_id, coin_id), commit=True)
        self._execute_db_command("INSERT INTO coin_trade (user_id, coin_id, side, lamports, tokens, created_at) VALUES (?, ?, 'sell', ?, ?, ?)", (agent_id, coin_id, lamports, tokens, now), commit=True)
        self._record_trace(agent_id, "sell", {"coin_id": coin_id, "sol": lamports / LAMPORTS, "tokens": tokens / 1e6}, now)
        return {"success": True, "sol_received": lamports / LAMPORTS, "tokens_sold": tokens / 1e6}

    async def post_callout(self, agent_id, message):
        mint_or_symbol, content = message
        coin_id = self._coin_id(mint_or_symbol)
        if coin_id is None:
            return {"success": False, "error": f"no coin {mint_or_symbol}"}
        if self._position(agent_id, coin_id)[0] <= 0:  # pump.fun: you must hold the coin to call it
            return {"success": False, "error": "you must hold the coin to post a callout; buy first"}
        now = self.get_current_time()
        self._execute_db_command("INSERT INTO callout (user_id, coin_id, content, created_at) VALUES (?, ?, ?, ?)", (agent_id, coin_id, str(content)[:280], now), commit=True)
        cid = self.db_cursor.lastrowid
        self._record_trace(agent_id, "post_callout", {"callout_id": cid, "coin_id": coin_id, "content": str(content)[:280]}, now)
        return {"success": True, "callout_id": cid}

    async def update_callout(self, agent_id, message):
        callout_id, content = message
        self._execute_db_command("SELECT user_id FROM callout WHERE callout_id = ?", (int(callout_id),))
        row = self.db_cursor.fetchone()
        if not row or row[0] != agent_id:
            return {"success": False, "error": "you can only update your own callout"}
        now = self.get_current_time()
        self._execute_db_command("INSERT INTO callout_update (callout_id, user_id, content, created_at) VALUES (?, ?, ?, ?)", (int(callout_id), agent_id, str(content)[:280], now), commit=True)
        self._record_trace(agent_id, "update_callout", {"callout_id": int(callout_id), "content": str(content)[:280]}, now)
        return {"success": True}

    async def reply(self, agent_id, message):
        callout_id, content = message
        now = self.get_current_time()
        self._execute_db_command("INSERT INTO reply (callout_id, user_id, content, created_at) VALUES (?, ?, ?, ?)", (int(callout_id), agent_id, str(content)[:280], now), commit=True)
        self._record_trace(agent_id, "reply", {"callout_id": int(callout_id), "content": str(content)[:280]}, now)
        return {"success": True}

    async def follow_caller(self, agent_id, caller_id):
        now = self.get_current_time()
        self._execute_db_command("INSERT OR IGNORE INTO caller_follow (follower_id, caller_id, created_at) VALUES (?, ?, ?)", (agent_id, int(caller_id), now), commit=True)
        self._record_trace(agent_id, "follow_caller", {"caller_id": int(caller_id)}, now)
        return {"success": True}

    async def view_portfolio(self, agent_id):
        self._execute_db_command("SELECT lamports FROM wallet WHERE user_id = ?", (agent_id,))
        row = self.db_cursor.fetchone()
        self._execute_db_command("SELECT k.symbol, k.mint, p.tokens, p.cost, p.coin_id FROM position p JOIN coin k USING (coin_id) WHERE p.user_id = ? AND p.tokens > 0", (agent_id,))
        out = []
        for sym, mint, tokens, cost, coin_id in self.db_cursor.fetchall():
            from wonderwall.simulations.pumpfun.amm import sell_sol
            value = sell_sol(self._curve(coin_id), tokens)
            out.append({"symbol": sym, "mint": mint, "tokens": tokens / 1e6, "cost_sol": cost / LAMPORTS, "value_sol": value / LAMPORTS})
        return {"success": True, "sol": (row[0] if row else 0) / LAMPORTS, "positions": out}
