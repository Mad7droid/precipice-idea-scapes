-- One bounded singleton row: no document content, timers, or accumulating daily records.
CREATE TABLE mcp_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  requests INTEGER NOT NULL
);
