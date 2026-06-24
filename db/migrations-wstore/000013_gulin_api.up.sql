CREATE TABLE gulin_api_endpoints (
    id VARCHAR(36) PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    username TEXT,
    password TEXT,
    token TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
