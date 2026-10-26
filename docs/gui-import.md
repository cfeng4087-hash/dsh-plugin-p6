# Importing into P6 25.12 (the only supported path)

P6 25.12 Professional cannot import headlessly: `Primavera.ImportExport.exe` rejects
project files with `Invalid import type: Flat` and then tries to use the file path as a
database alias. Do not try to script the CLI import — use the GUI.

## Steps

1. **File → Import (文件 → 导入)**
2. Choose **Primavera PM-(XER)** for a `.xer` file, or **Primavera P6-(XML)** for XML.
3. **Next** → import type **Project** → **Next**.
4. Pick the file (the `...` button opens a native file dialog). The filename field loses
   backslashes if an IME is active; paste the path or pick the file from the list.
5. **Next** → the project list page. `导入到 EPS` is **read-only** and always shows `EPS`.
6. **Next** → update-project template page (accept the default).
7. **Next** → **Finish**. The result dialog says 导入成功 or shows an error log path.

Imported projects are created **new** and land in the **root EPS**. The XER
`parent_wbs_id` is ignored by P6, so place the project afterwards:

```
p6_write action=reparent project="DEMO-03" eps=3689 yes=true
```

Then press **F5** in the Projects view and run **F9** (Tools → Schedule) before reading
dates back.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `invalid parent WBS IDs` | more than one root WBS in the CSV | make all paths start with the same root, e.g. `P.前期筹备`, `P.设计` |
| Chinese names are mojibake | XER written as UTF-8 | regenerate with the plugin (GBK) |
| Project name shows `1` | the `PROJWBS` project-node row was dropped | keep the root row (`proj_node_flag='Y'`), name it after the project |
| Project appears at top level | P6 ignores the XER EPS parent | `p6_write action=reparent …` |
| “另一个用户打开了此项目，不能删除” | stale `PROJSHAR` row from a crashed session or CLI export | `p6_write action=unlock project=… yes=true`, then F5 |
| Dates look wrong after import | F9 has not run | Tools → Schedule (F9) |

After import always verify with `p6 action=tasks project=<code>`; the plugin reads the
database copy, so it sees what P6 actually stored.
