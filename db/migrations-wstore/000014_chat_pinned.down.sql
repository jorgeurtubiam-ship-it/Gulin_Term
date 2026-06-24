-- SQLite does not support dropping columns easily, but we can at least have the file.
-- In a real scenario, this would involve creating a temp table, copying data, and renaming.
-- For now, we leave it as is or provide the manual steps.
PRAGMA foreign_keys=off;
CREATE TABLE chat_message_dg_tmp(chat_id TEXT NOT NULL, message_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, api_type TEXT NOT NULL, model TEXT NOT NULL, extra_data TEXT, PRIMARY KEY(message_id));
INSERT INTO chat_message_dg_tmp(chat_id, message_id, role, content, created_at, api_type, model, extra_data) SELECT chat_id, message_id, role, content, created_at, api_type, model, extra_data FROM chat_message;
DROP TABLE chat_message;
ALTER TABLE chat_message_dg_tmp RENAME TO chat_message;
CREATE INDEX idx_chat_message_chat_id ON chat_message (chat_id);
CREATE INDEX idx_chat_message_created_at ON chat_message (created_at);
PRAGMA foreign_keys=on;
