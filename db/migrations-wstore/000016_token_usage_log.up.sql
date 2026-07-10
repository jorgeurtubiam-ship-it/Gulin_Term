CREATE TABLE token_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL
);

CREATE INDEX idx_token_usage_log_chat_id ON token_usage_log (chat_id);
CREATE INDEX idx_token_usage_log_timestamp ON token_usage_log (timestamp);
