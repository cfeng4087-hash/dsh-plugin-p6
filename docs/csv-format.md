# CSV format for `p6_write action=xer`

One row per activity. Header row required, UTF-8 (BOM tolerated).

| Column | Required | Meaning |
|---|---|---|
| `wbs_path` | yes | WBS path, dot-separated. The **first** segment is the project root; everything after it becomes a WBS node. Use `P.前期筹备`, `P.设计`, … so there is exactly one root. |
| `task_code` | yes | Activity ID (unique). Milestones conventionally start with `M`. |
| `task_name` | yes | Display name (Chinese is fine — the XER is written as GBK). |
| `task_type` | no | `Task` (default) or `Milestone`. |
| `duration_days` | yes | Working days on a 7-day calendar (8 h/day). Milestones must be `0`. |
| `predecessor_code` | no | One predecessor per row. Add a second row with the same `task_code` to add another predecessor. |
| `rel_type` | no | `FS` (default), `SS`, `FF`, `SF`. |
| `lag_days` | no | Lag in days; may be negative for `FS` only if P6 accepts it. |
| `constraint_type` | no | Only `CS_MSO` (Must Start On) is generated. Leave empty for pure logic. |
| `constraint_date` | no | `YYYY-MM-DD`, used with `constraint_type`. |

## Example

```csv
wbs_path,task_code,task_name,task_type,duration_days,predecessor_code,rel_type,lag_days,constraint_type,constraint_date
P.前期筹备,D001,项目开工,Milestone,0,,,,,
P.设计,D010,初步设计,Task,45,D001,FS,0,,
P.设计,D011,初设审查,Task,15,D010,FS,0,,
P.施工,D020,基础施工,Task,90,D011,FS,0,,
```

## Rules and pitfalls

- **Exactly one root WBS.** If every phase row is a top-level path (`1.…`, `2.…`),
  P6 rejects the import with `invalid parent WBS IDs`.
- **Durations, not dates.** The generator writes only durations, logic and optional
  constraints; P6's F9 computes all dates. Do not put dates in the CSV.
- **Relations are per row.** The same `task_code` may appear multiple times to attach
  several predecessors; name/type/duration must be identical on every row.
- **Milestones.** A 0-duration `Milestone` linked `FS` lands on the next working day.
  For a contractual milestone on a fixed date, use `CS_MSO` with `constraint_date`.
- **Calendars.** The generated project uses a single 7-day / 8-hour calendar. If your
  plan mixes 5-day and 7-day calendars, extend `lib/p6xer.js`.
- **Encoding.** The output is GBK on purpose (P6 on Chinese Windows reads ANSI).
  Characters outside GBK make the generator fail loudly instead of writing `?`.
