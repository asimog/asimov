"""Golden check helper (amm-golden suite): reads cases as JSON lines on stdin, prints quotes as JSON lines.
Each case: {"op": "buy"|"sell"|"curve", "c": [v_tok, v_sol, real_tok, real_sol], "x": amount or price}."""
import json
import sys

from wonderwall.simulations.pumpfun.amm import Curve, buy_tokens, curve_from_price, sell_sol

for line in sys.stdin:
    k = json.loads(line)
    if k["op"] == "curve":
        c = curve_from_price(float(k["x"]))
        print(json.dumps([str(c.v_tok), str(c.v_sol), str(c.real_tok), str(c.real_sol)]))
        continue
    c = Curve(*(int(v) for v in k["c"]))
    print(json.dumps(str(buy_tokens(c, int(k["x"])) if k["op"] == "buy" else sell_sol(c, int(k["x"])))))
