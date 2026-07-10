CREATE INDEX IF NOT EXISTS idx_chat_message_chat_id_created_at ON chat_message (chat_id, created_at DESC);
