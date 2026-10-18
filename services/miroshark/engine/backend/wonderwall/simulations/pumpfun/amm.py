"""Pump bonding-curve math in integers (lamports, base token units), the same as services/miroshark/src/amm.ts and
@pump-fun/pump-sdk. The amm-golden suite compares this file with the TypeScript reference on 1,000 quotes."""
from __future__ import annotations

import math
from dataclasses import dataclass

PROTOCOL_BPS = 95
CREATOR_BPS = 30
START_V_TOK = 1_073_000_000_000_000
START_V_SOL = 30_000_000_000
START_REAL_TOK = 793_100_000_000_000


@dataclass
class Curve:
    v_tok: int
    v_sol: int
    real_tok: int
    real_sol: int


def _fee(amount: int, bps: int) -> int:
    return (amount * bps + 9999) // 10_000


def _input(lamports: int) -> int:
    return ((lamports - 1) * 10_000) // (PROTOCOL_BPS + CREATOR_BPS + 10_000)


def buy_tokens(c: Curve, lamports: int) -> int:
    if lamports <= 0 or c.v_tok == 0:
        return 0
    i = _input(lamports)
    out = (i * c.v_tok) // (c.v_sol + i)
    return min(out, c.real_tok)


def sell_sol(c: Curve, tokens: int) -> int:
    if tokens <= 0 or c.v_tok == 0:
        return 0
    gross = (tokens * c.v_sol) // (c.v_tok + tokens)
    return gross - (_fee(gross, PROTOCOL_BPS) + _fee(gross, CREATOR_BPS))


def apply_buy(c: Curve, lamports: int) -> tuple[Curve, int]:
    tokens = buy_tokens(c, lamports)
    i = _input(lamports)
    return Curve(c.v_tok - tokens, c.v_sol + i, c.real_tok - tokens, c.real_sol + i), tokens


def apply_sell(c: Curve, tokens: int) -> tuple[Curve, int]:
    gross = (tokens * c.v_sol) // (c.v_tok + tokens)
    lamports = sell_sol(c, tokens)
    return Curve(c.v_tok + tokens, c.v_sol - gross, c.real_tok + tokens, max(0, c.real_sol - gross)), lamports


def _jsround(x: float) -> int:
    """JavaScript Math.round (half up), so the curve matches amm.ts; Python's round() rounds half to even."""
    return math.floor(x + 0.5)


def curve_from_price(price_sol: float) -> Curve:
    """A curve from the last traded price (SOL per whole token), like core's curveFromPrice."""
    k = START_V_SOL * START_V_TOK
    price_base = price_sol * 1e9 / 1e6
    v_sol = math.sqrt(k * price_base)
    v_tok = math.sqrt(k / price_base)
    sold = max(0.0, START_V_TOK - v_tok)
    return Curve(_jsround(v_tok), _jsround(v_sol), START_REAL_TOK - _jsround(min(sold, START_REAL_TOK)), max(0, _jsround(v_sol - START_V_SOL)))


def spot_sol_per_token(c: Curve) -> float:
    return (c.v_sol / c.v_tok) * 1e6 / 1e9
