-- Invite-only beta, bounded retained snapshots, and the minimum audit trail needed to operate it.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));
ALTER TABLE publications ADD COLUMN current_bytes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS invites (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS invites_status ON invites(status, created_at DESC);

CREATE TABLE IF NOT EXISTS publish_usage (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  writes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, day)
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Audit history must not make account deletion impossible. The target/action remain
  -- immutable; only the actor reference is anonymised if that account is removed.
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at);
