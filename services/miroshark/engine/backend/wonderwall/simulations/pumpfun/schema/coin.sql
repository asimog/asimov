-- Pump.fun coins on their bonding curve (integers: lamports and base token units, 6 decimals).
CREATE TABLE IF NOT EXISTS coin (
    coin_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    mint        TEXT NOT NULL UNIQUE,
    symbol      TEXT NOT NULL,
    v_tok       INTEGER NOT NULL,
    v_sol       INTEGER NOT NULL,
    real_tok    INTEGER NOT NULL,
    real_sol    INTEGER NOT NULL,
    graduated   INTEGER NOT NULL DEFAULT 0
);
