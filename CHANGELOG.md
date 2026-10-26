# Changelog

## 0.2.0 — 2026-10-25

- **New `xer`**: CSV → importable XER for P6 Professional 25.12, encoded as GBK
  (bundled 21,791-character table, no third-party dependency).
- **New `unlock`**: clears stale `PROJSHAR` shares and checkout flags after a crashed
  session or a CLI export ("opened by another user" on delete). Backs up first.
- **New `reparent`**: moves a project node under an EPS node (`DEMO-EPS` = 3689).
  Needed because P6 ignores the XER `parent_wbs_id` on import.
- Verified a full 42-activity round trip: CSV → XER → GUI import → reparent → F9 →
  read-back with 0 date mismatches.
- Sanitized defaults: database path now comes from `P6_DB` or `~/Documents`,
  not a machine-specific path.
- README rewritten with the 25.12 verified matrix.

## 0.1.0 — 2026-10-23

- Read-only `p6` tool: status / projects / tasks / relations / guarded SQL / dictionary.
- `p6_write`: backup, snapshot, export (P6 CLI → XML), stage, compare.
- Discovery: CLI import is broken on 25.12 (`Invalid import type: Flat`); GUI import
  always creates a new project; XML percentage is a fraction; soft-deleted rows must
  be filtered.
