-- Callouts: a holder's public call on a coin (pump.fun requires holding the coin to call it).
CREATE TABLE IF NOT EXISTS callout (
    callout_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    coin_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    real_id     TEXT,             -- the observed callout id when seeded from our data; NULL when simulated
    likes       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS callout_update (
    update_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    callout_id  INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reply (
    reply_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    callout_id  INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS caller_follow (
    follower_id INTEGER NOT NULL,
    caller_id   INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (follower_id, caller_id)
);
