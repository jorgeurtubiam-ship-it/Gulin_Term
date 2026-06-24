CREATE TABLE chat_message (
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    api_type TEXT NOT NULL,
    model TEXT NOT NULL,
    extra_data TEXT,
    PRIMARY KEY (message_id)
);

CREATE INDEX idx_chat_message_chat_id ON chat_message (chat_id);
CREATE INDEX idx_chat_message_created_at ON chat_message (created_at);
