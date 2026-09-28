ALTER TABLE mcp_connections ADD COLUMN host TEXT NOT NULL DEFAULT 'web' CHECK (host IN ('web', 'desktop'));
CREATE TABLE mcp_hosts (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host TEXT NOT NULL CHECK (host IN ('web', 'desktop')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX mcp_hosts_user ON mcp_hosts(user_id);
CREATE TABLE mcp_host_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
