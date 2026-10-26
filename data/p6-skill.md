# P6 计划协同（Primavera P6 Professional 25.12）

> 本技能只在涉及 P6 进度数据时加载。核心原则：**P6 负责算，本技能负责读、查、比、写报告、批量填**。
> 所有事实分「已实测」和「未验证」两栏，**未验证的不得当结论说**。

## 1. 分工与边界

- **读**：一律读数据库副本（只读），不读原库、不锁库、不动 P6 进程。
- **算**：CPM/F9、校验、正式成果一律由 P6 完成；本技能**不计算**关键路径、不推测浮时、不修改计算字段。
- **写**：生成「待导入的 P6 XML 或 XER」；**CLI 导入在本版本不可用**，导入必须在 P6 界面里做（文件 → 导入）。导入后必须用快照/读回对比证明改了什么。
- **红线**：不直写 SQLite；不注入 P6；不把推测当事实；任何写操作前先备份。

## 2. 已实测事实（2026-10-23）

| 项 | 事实 |
|---|---|
| 数据库 | `%USERPROFILE%\Documents\PPMDBSQLite.db`（P6 Professional 本地库），SQLite 未加密，WAL 模式，130 表 / 1,921 字段 / 57 表有行（56 表有活行） |
| 文本编码 | 全部 UTF-8（18,027 个抽样值 0 个非法 UTF-8） |
| 软删除行 | **必须过滤**：`TASK` 2、`TASKPRED` 5、`TASKRSRC` 2、`UDFVALUE` 1 条 `delete_date` 非空（逻辑删除，行还在表里）。插件已默认加 `delete_date is null`；**原始 SQL 不会自动过滤**。P6 XML 导出同样省略这些行（`XXXX` 项目：库内活分配 49 = XML 49，总行 51）。`REFRDEL` 2,378 行全是删除登记，没有活行。 |
| 读法 | 复制副本 + `readOnly` 打开；`node:sqlite` 在 DSH 宿主 Node 24.21 可用。**P6 界面开着也能读**（副本必须连 `-wal/-shm` 一起复制，否则读到旧数据；插件已处理） |
| P6 开着时导出 | ✅ 实测可行：P6 打开并登录、未开项目的情况下，CLI 导出 `XXXX` 仍成功（335 KB / 5.8 s）。只是会多写登录审计行。 |
| 界面导入 | ✅ 可行（2026-10-23 实测）：文件 → 导入(I) → Primavera P6-(XML) → 选文件 → 默认模板 → 完成。**默认模板是「新建项目」**：导入 `XXXX` 会生成 `XXXX-1`（再导一次变 `XXXX-2`），原 `XXXX` 不动；日志写 `Project: 1 matched, 1 created`、`149 objects created`。要覆盖原项目必须在模板里改成更新/替换（尚未实测）。 |
| 百分比字段 | ⚠️ XML 的 `PhysicalPercentComplete` 是**小数比例**：`0.35` = 35%。写 `35` 会被 P6 存成 `3500%`。插件 `physical_percent` 入参 0–100，内部自动 /100 后写入（2026-10-23 已修并用 `XXXX-2` 验证 DB=35）。 |
| F9 会改什么 | 实测（`XXXX-1`，38 活动）：`total_float_hr_cnt` 由空变 0–656 h（18 条变化）；未开始活动的 `remain_drtn_hr_cnt` 被重算（A1010 999→120，剩余总工时 3775→2896 h）；**目标日期与活动/关系/分配数量不变**。所以 `remain_*` 不是纯输入，F9 后以 P6 为准。 |
| 项目代码 → 名称 | 由 `PROJWBS` 根节点（`proj_node_flag='Y'`）取得，见 `p6` 的 `projects` |
| 有活动的项目 | 示例库中 6 个项目有活动（代码因库而异）；其余为空壳（活动数 0） |
| 关系类型 | `TASKPRED.pred_type`（活行）：`PR_FS` 320、`PR_FF` 108、`PR_SS` 88（无 `PR_SF`）；`lag_hr_cnt` 单位为**小时**，可正可负 |
| 活动状态 | 活行 347 条全部 `TK_NotStart`，无实际日期（样例库，不是真实履约数据） |
| 自定义字段 | `UDFTYPE` 有 `UDF_TYPE_LABEL`：`user_field_128`=说明(TASK)、`178`=中文名称(TASK)、`179`=中文说明(PROJWBS)、`180`=中文名称(RSRC)；`UDFVALUE.TABLE_NAME` 为空，须经 `UDF_TYPE_ID` 关联 `UDFTYPE.TABLE_NAME` |
| 项目代码 → 名称 | 代码 = `PROJECT.proj_short_name`；名称 = 对应 `PROJWBS` 根节点（`proj_node_flag='Y'`）的 `wbs_name`。不同库代码不同，不要写死项目代码。 |

### CLI 导出（已验证）

`Primavera.ImportExport.exe` 能**无界面完成导出**，参数为本技能内置，不需要手工拼。要点：

- `/password` 必须是 `USERS.PASSWD` 里的 `SHA-256:…` 串（不是明文）；本技能自动从库里取。
- 必须 `importexport.mode=Export`，缺了会当成 Import。
- 输出**永远是 P6 XML**（`APIBusinessObjects`），即使文件名写 `.xer`；`importexport.type` 对导出无效。
- 副作用：每次登录会在库里**增加 1 条 `USESSION`**、给打开的项目加 `PROJSHAR` 行、推进 `NEXTKEY`；**不改变活动/关系/工期**。所以「导出不改数据」只对业务表成立。

### CLI 导入（不可用；P6 开着也一样）

- `importexport.type` 只接受 `re`（资源）、`ro`（角色）、`cppexport`，其他值一律变 `Flat`；项目 XML 导入时报 `Invalid import type: Flat. No source projects detected`。
- 继续执行会在 `EnsureSecondaryContext` 用**文件路径当 alias** 去连库，必然 `Initialize connection failed`；资源导入则停在 `EnsureOperationOptions`（缺少导入选项文件）。
- `PM.ini` 的 `ScheduleAfterImport` 只被 `PM.exe` 与其本地化资源引用，**ImportExport.exe 不读它**。所以「CLI 导入后自动 F9」在本版本不成立。

结论：**导入只能走 P6 界面**；本技能生成待导入 XML，导入后由快照对比确认结果。不要声称「已自动导入」或「P6 已重算」，除非快照里看到了相应变化。
P6 界面开着并不会让 CLI 导入变好（2026-10-23 复测：XML 仍报 `Invalid import type: Flat`，XER 仍失败/挂起）。

## 3. 工具与配方

### `p6`（只读）

| action | 用途 | 关键参数 |
|---|---|---|
| `status` | 库/表/活动/关系计数、完整性、最后重算时间 | — |
| `projects` | 项目清单（代码、名称、活动/关系/分配数） | — |
| `tasks` | 活动筛选 + 聚合（默认只回 10 行） | `project`、`status`、`code`、`text`、`incomplete`、`negativeFloat`、`floatBelow`、`targetBefore`、`limit` |
| `relations` | 逻辑关系（前驱/后继/类型/延时） | `project`、`activity`、`type`、`limit` |
| `sql` | 只读 SELECT（强制 LIMIT，禁写/DDL/PRAGMA） | `sql`、`limit` |
| `dictionary` | 字段字典：类别、可写、是否出现在 XER 样本 | `table`、`field`、`category`、`limit` |

典型问法 → 调用：

- 「现在什么情况」→ `p6 action=status`，需要时再 `projects`。
- 「哪个项目有活动」→ `p6 action=projects`（空壳项目活动数为 0）。
- 「负浮时/滞后」→ `p6 action=tasks project=DEMO-04 negativeFloat=true`；按目标日期筛用 `targetBefore=YYYY-MM-DD`。
- 「某活动的前后关系」→ `p6 action=relations project=DEMO-04 activity=A1230`。
- 「某字段能不能填」→ `p6 action=dictionary table=TASK field=phys_complete_pct`。
- 复杂统计 → `p6 action=sql sql="select ..."`（只 SELECT；结果会自动截断）。

### `p6_write`（写前准备）

| action | 用途 |
|---|---|
| `backup` | 备份原库（含 `-wal/-shm`），返回路径与 SHA256 |
| `snapshot` | 给项目拍快照（活动/关系/分配计数 + 每活动关键字段） |
| `export` | 用 P6 CLI 导出项目 XML（自动先备份） |
| `stage` | 在 XML 上按 `{activity, field, value}` 批量改，生成待导入文件并回读校验。`physical_percent` 传 0–100（如 35），写入 XML 时自动变 `0.35` |
| `compare` | 对比两个快照，输出「输入字段变化 / 计算字段变化 / 数量变化」 |
| `xer` | CSV → 可导入 XER（GBK；参数 csv/out/projectCode/projectName/start） |
| `unlock` | 清「其他用户已打开」残留：删 PROJSHAR + 清 checkout（需 `yes=true`，自动备份） |
| `reparent` | 把项目节点挂到指定 EPS（需 `yes=true`；DEMO-EPS = 3689） |

### 3.1 CSV → XER（P6 25.12 已实测通）

```
p6_write action=xer csv="plan.csv" projectCode="DEMO-03" projectName="…" start="2027-01-10"
# P6 → 文件 → 导入 → Primavera PM-(XER) → 选文件 → 下一步×3 → 完成
p6_write action=reparent project="DEMO-03" eps=3689 yes=true   # 导入只落根 EPS
p6 action=tasks project="DEMO-03" limit=100                    # F9 后核对
```

CSV 列：`wbs_path,task_code,task_name,task_type,duration_days,predecessor_code,rel_type,lag_days,constraint_type,constraint_date`；`task_type=Task|Milestone`，`rel_type=FS|SS|FF|SF`，`constraint_type=CS_MSO` 或空。

**25.12 四条硬结论（2026-10-25 实测）**：① `ERMHDR 7.0` 可直接导入；② 必须 GBK，UTF-8 会乱码；③ 项目名取 `PROJWBS` 项目节点行的 `wbs_name`；④ XER 里的 EPS 父节点会被忽略，归属只能用 `reparent`。

> 界面导入默认模板 = **新建项目**（`XXXX` → `XXXX-1`），不会覆盖原项目。要覆盖得在「更新项目选项」里改用更新/替换模板；当前未实测，**不要声称能原地替换**。

**批量填标准流程**：

1. `p6_write action=backup`
2. `p6_write action=snapshot project=<代码>`（记下文件路径，作为改前基线）
3. `p6_write action=export project=<代码>`（得到 XML）
4. `p6_write action=stage file=<XML> edits=[{activity:"A1010",field:"physical_percent",value:50}, …]`
5. **在 P6 界面导入该文件**（本机 CLI 导入不可用），必要时 F9
6. `p6_write action=compare before=<改前快照> project=<代码>`
7. 用 compare 的结果回答"改没改、P6 有没有重算"；对不上就还原备份。

`stage` 只接受这些字段：`name`、`code`、`act_start`、`act_finish`、`physical_percent`、`remaining_duration`、`target_start`、`target_finish`。
日期格式固定 `YYYY-MM-DDTHH:MM:SS`；清空传 `""`。

## 4. 字段口径

**可写（输入类，且仅通过 XML 暂存）**：`act_start_date`、`act_end_date`、`phys_complete_pct`、`remain_drtn_hr_cnt`、`act_work_qty`、`task_code`、`task_name`、`wbs_id`、`clndr_id`、`user_field_128/178/179/180`、资源分配数量。

**永不写（计算类）**：`early_*`、`late_*`、`total_float*`、`free_float*`、`driving`、`critical`、任何 P6 算出来的日期/百分比。

**读的纪律**：任何自写 SQL 都要加 `delete_date is null`；否则会把已删除的活动/关系/分配算进来（当前库里有 10 条这种行）。

**边界**：`remain_*`、`phys_complete_pct` 既像输入又会被 P6 修正 —— 只按输入填，填完看快照里 P6 是否改动，**不要自己推算**。`phys_complete_pct` 在库里是百分数（35 = 35%），在 P6 XML 里是小数（0.35）；插件 `physical_percent` 入参用 0–100。

## 5. 护栏

1. 任何写/导出前先 `backup`；`export` 会自动备份。
2. `stage` 只生成新文件，**绝不覆盖导出原件**；回读校验失败会直接报错。
3. 导入是人的动作；导入前把「改了哪几条、从什么改到什么」列给用户确认。
4. 导入后必须 `compare`；数量异常跳变（活动/关系/分配）先还原备份再查。
5. 只拿废项目（`XXXX`）练手；正式项目先备份、先小批量。
6. P6 界面开着也可以只读/导出（已实测）；但 CLI 导入仍然不可用。若 P6 正在调度/写入，导出前先等它空闲并备份。

## 6. 未验证（不得当结论）

- CLI 导入（本版本明确失败，P6 开着也一样，不要再试）。
- **覆盖/更新既有项目**：界面导入的默认模板是新建项目（`XXXX-1`、`XXXX-2`）；用「更新项目选项」里的模板原地替换尚未实测。
- `target_start/target_finish` 对应 XML 的 `PlannedStartDate/PlannedFinishDate`（按 P6 语义推测，未实测）。
- F9 基线目前只有 `XXXX-1` 一个样本（浮时 null→0–656h、未开始活动剩余工期被重算）；别的项目/日历未逐一验证。
- 数据日期：库里没有独立 data date 列；`PROJECT.LAST_RECALC_DATE` 只是重算时间，不是数据日期。XML 的 `DataDate` 才是数据日期。

## 7. Token 纪律

- 先用 `status/projects` 定位，再用 `tasks` 的聚合；**不要 `select *` 拉全表**。
- `tasks/relations/sql` 默认只回 10 行；要更多显式给 `limit`（上限 200）。
- 汇报只给结论 + 关键行；不要把脚本原始输出整段贴回。
