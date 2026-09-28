-- Agent (MCP) connections. The OAuth library keeps tokens in KV; these rows are the part
-- Precipice reasons about: which clients a person connected, with what access, and which
-- authorization requests are waiting for the person to approve them in the app.
CREATE TABLE mcp_auth_requests (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE mcp_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scapes TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'review')),
  can_write INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX mcp_connections_user ON mcp_connections (user_id);
