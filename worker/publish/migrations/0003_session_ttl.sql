-- Cap previously issued publication sessions to the new seven-day lifetime.
UPDATE sessions
SET expires_at = MIN(expires_at, CAST(unixepoch('now') AS INTEGER) * 1000 + 604800000);
