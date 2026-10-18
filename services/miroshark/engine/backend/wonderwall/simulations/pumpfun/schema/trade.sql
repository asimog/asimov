CREATE TABLE IF NOT EXISTS wallet (
    user_id     INTEGER PRIMARY KEY,
    lamports    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS position (
    user_id     INTEGER NOT NULL,
    coin_id     INTEGER NOT NULL,
    tokens      INTEGER NOT NULL DEFAULT 0,
    cost        INTEGER NOT NULL DEFAULT 0,  -- lamports paid in, for PnL
    PRIMARY KEY (user_id, coin_id)
);
CREATE TABLE IF NOT EXISTS coin_trade (
    trade_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    coin_id     INTEGER NOT NULL,
    side        TEXT NOT NULL,
    lamports    INTEGER NOT NULL,
    tokens      INTEGER NOT NULL,
    created_at  TEXT NOT NULL
);
