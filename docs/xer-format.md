# XER format notes (as generated for P6 25.12)

XER is a tab-separated text export. Each table starts with `%T <TABLE>`, followed by
`%F` (field list) and `%R` (data rows). The plugin generates seven tables:

| Table | Rows | Purpose |
|---|---|---|
| `OBS` | 1 | Enterprise OBS node (565) |
| `PROJECT` | 1 | project header, 68 fields |
| `CALENDAR` | 1 | `7Day-8h`, 7×8 h |
| `SCHEDOPTIONS` | 1 | scheduler options |
| `PROJWBS` | N | project node + WBS nodes (flat, `parent_wbs_id`) |
| `TASK` | N | activities, 60 fields |
| `TASKPRED` | N | relationships, 10 fields |

## Header

```
ERMHDR	7.0	<date>	Project	admin	admin		Project Management	USD
```

25.12 accepts version `7.0`. The header is not where encoding is declared: P6 on a
Chinese Windows decodes the whole file with the system ANSI codepage (GBK/CP936).

## Fixed ObjectIds

| Object | id base |
|---|---|
| project | 9900 |
| calendar | 9001 |
| WBS | 91001 |
| activity | 920001 |
| relationship | 9300001 |

P6 remaps them on import; they only need to be unique inside the file.

## Gotchas

1. **Encoding** — GBK, not UTF-8. This is the single most common failure.
2. **One root WBS** — the `PROJWBS` row with `proj_node_flag='Y'` carries the project
   name (`wbs_name`); child rows point at it via `parent_wbs_id`.
3. **EPS is not importable this way** — a `parent_wbs_id` pointing at an existing EPS
   node is silently ignored; the project lands in the root EPS.
4. **Durations are hours** — `remain_drtn_hr_cnt` = days × 8.
5. **Lags are hours** — `TASKPRED.lag_hr_cnt` = days × 8.
6. **Dates are inputs, not outputs** — the generator leaves `early_*`/`late_*` empty and
   lets F9 fill them; `target_*` are optional.
7. **Milestones** — `TT_FinMile` with 0 duration; `CS_MSO` is the only constraint the
   generator emits.
