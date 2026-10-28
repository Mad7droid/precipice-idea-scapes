-- Each write gets its own R2 object key so concurrent updates never overwrite or delete each
-- other's snapshot. Rows written before this migration keep NULL and fall back to the
-- `publications/<id>/v<version>/scape.json` scheme.
ALTER TABLE publications ADD COLUMN snapshot_key TEXT;
ALTER TABLE superseded_versions ADD COLUMN snapshot_key TEXT;
