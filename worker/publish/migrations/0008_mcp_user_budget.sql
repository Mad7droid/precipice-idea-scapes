-- One row per person (bounded by the users table): today's hosted MCP request count. Checked
-- before the deployment-wide `mcp_budget`, so one person's denied calls never spend it.
CREATE TABLE mcp_user_budget (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL
);

-- Whether the connection's client advertised the MCP Apps extension at initialize. The hosted
-- server is stateless, so later requests read this to decide whether app-only confirmation
-- tools are listed and callable. Existing connections start without it until they reinitialize.
ALTER TABLE mcp_connections ADD COLUMN mcp_apps INTEGER NOT NULL DEFAULT 0;
