# dsh-plugin-p6 — Primavera P6 25.12 schedule toolkit for DeepSeek Harness

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that turns Primavera P6
Professional 25.x into a scriptable data source: read-only queries, field dictionary,
XML/XER export, CSV→XER generation, snapshot diffing, and two gated maintenance
actions (unlock, reparent).

> Built and verified against **P6 Professional 25.12** on Windows with a local
> SQLite database (`PPMDBSQLite.db`). Everything in the "Verified" table below was
> tested on a real database, not inferred from documentation.

[中文说明](docs/README.zh.md)

## Why this exists

P6 25.12 has no usable headless import (`Primavera.ImportExport.exe` fails with
`Invalid import type: Flat`) and no public API for the local SQLite build. The only
reliable write path is: generate an import file → import it in the P6 GUI → read the
result back from SQLite. This plugin automates everything except the two GUI clicks.

Two import formats are supported:

| Format | Produced by | Import menu | Notes |
|---|---|---|---|
| P6 XML | `export` (P6 CLI) + `stage` (edits) | 文件 → 导入 → Primavera P6-(XML) | good for editing an existing project |
| XER | `xer` (from CSV) | 文件 → 导入 → Primavera PM-(XER) | best for creating a new project |

## Capabilities

**`p6` (read-only)**

`status` · `projects` · `tasks` · `relations` · `sql` (guarded SELECT) · `dictionary`

Every read copies the database (with `-wal`/`-shm`) to a temp file and opens it
`readOnly`, so a running P6 is never disturbed. Soft-deleted rows
(`delete_date is not null`) are filtered by default.

**`p6_write`**

| Action | Writes | Purpose |
|---|---|---|
| `backup` | file | consistent DB snapshot + SHA-256 |
| `snapshot` / `compare` | file | baseline before a change, diff after |
| `export` | file | P6 CLI → P6 XML |
| `stage` | file | batch-edit an exported XML, read-back verified |
| `xer` | file | **CSV → importable XER (GBK)** |
| `unlock` | SQLite* | clear stale "opened by another user" shares |
| `reparent` | SQLite* | move a project node under an EPS |

\* `unlock` and `reparent` are the only actions that touch SQLite. They require
`yes=true`, take a backup first, and change exactly one kind of row each.

## Install

```powershell
$cli = "<DeepSeek Harness>\resources\runtime\cli\bin\dsh.cmd"
& $cli plugin --profile desktop add link:D:\path\to\dsh-plugin-p6-25.12
```

Fully quit and reopen the desktop client (host plugins load at startup).

Configuration (optional) goes in `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`:

```yaml
- dsh-plugin-p6:
    config:
      dbPath: "C:/Users/you/Documents/PPMDBSQLite.db"
      p6Dir: "C:/Program Files/Oracle/Primavera P6/P6 Professional/25.12.0"
```

Defaults: `P6_DB` env var or `~/Documents/PPMDBSQLite.db`; work dir `%LOCALAPPDATA%\dsh-p6`.

## Quick start: CSV → P6

```text
# 1) describe the schedule
wbs_path,task_code,task_name,task_type,duration_days,predecessor_code,rel_type,lag_days,constraint_type,constraint_date
P.前期筹备,D001,项目开工,Milestone,0,,,,,
P.设计,D010,初步设计,Task,45,D001,FS,0,,
...

# 2) in the chat / agent:
p6_write action=xer csv="demo.csv" projectCode="DEMO-01" projectName="Demo project" start="2027-01-10"

# 3) import the .xer in P6 (File → Import → Primavera PM-(XER)), then F9

# 4) the import always lands in the root EPS, so place it explicitly:
p6_write action=reparent project="DEMO-01" eps=3689 yes=true

# 5) read the scheduled dates back
p6 action=tasks project="DEMO-01" limit=100
```

See [`docs/csv-format.md`](docs/csv-format.md), [`docs/gui-import.md`](docs/gui-import.md)
and [`docs/xer-format.md`](docs/xer-format.md).

## Verified on P6 25.12

| Item | Result |
|---|---|
| Read while P6 is running | ✅ snapshot copy + `readOnly` |
| Soft-deleted rows | ❌ must filter `delete_date` (tasks/relations/assignments/UDF) |
| CLI export | ✅ XML only, even if the filename ends with `.xer` |
| CLI import | ❌ `Invalid import type: Flat` — do not retry |
| XER header `ERMHDR 7.0` | ✅ accepted by 25.12 |
| XER encoding | ⚠️ **GBK** — UTF-8 imports with mojibake |
| Project name after XER import | from `PROJWBS` row with `proj_node_flag='Y'`, column `wbs_name` |
| EPS placement in XER | ❌ `parent_wbs_id` is ignored; use `reparent` after import |
| XML percentage | `PhysicalPercentComplete` is a fraction (0.35 = 35%) |
| Full 42-activity round trip | ✅ CSV → XER → import → reparent → F9 → read-back, 0 date mismatches |

## Design

```text
CSV ──xer──► .xer (GBK) ──GUI import──► P6 ──F9──► SQLite ──p6 (read)──► report / Excel
XML ──stage──► .xml ─────GUI import──► P6
```

- **No model-side calculation.** Dates, float and critical path always come from P6's
  own scheduler; the plugin only reads them.
- **Deterministic retrieval.** No embeddings: the field dictionary is a JSON index and
  queries are SQL, so numbers never depend on "similarity".
- **Everything reversible.** `unlock`/`reparent` back up first; all other write actions
  only produce files.

## Knowledge base

`knowledge/` is the agent-facing rule book distilled from P6 training material and
from measured behaviour — not a document dump:

- `knowledge/INDEX.md` — routing table: question type → which file to read
- `ui/` — import/export, EPS/WBS, F9 scheduling
- `planning/` — logic, lags, float
- `data-model/` — table/field semantics
- `recipes/` — end-to-end recipes (CSV → project)
- `pitfalls.md` — tutorial claims vs measured behaviour
- `sources.md` — source registry (course, lesson, timecode)

Tutorial-derived facts carry a timecode; measured facts carry a date and P6 build;
conflicts resolve in favour of the measured result. `eval/questions.md` holds the
regression questions used before a release.

## Limits

- Windows + local SQLite build of P6 Professional (EPPM/web is out of scope).
- Import is a manual GUI step; the plugin prepares the file, it does not drive P6.
- XER generation covers projects/WBS/activities/relationships and one calendar.
  Resources, roles, UDFs and multiple calendars are not generated.
- `stage` (XML) covers a small whitelist of activity fields; see `data/p6-skill.md`.

## Development

```bash
node --test            # XER generation smoke tests
python tools/build-gbk-map.py   # regenerate the GBK table
```

`data/p6_data_dictionary.json` is generated by `tools/build-dictionary.mjs` from a
local P6 database and two exported XER files; regenerate it if your P6 build differs.

## License

MIT — see [LICENSE](LICENSE).

