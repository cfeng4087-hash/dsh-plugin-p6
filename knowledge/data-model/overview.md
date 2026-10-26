# 数据模型速览（本地 SQLite 版）

> 可信度：✅ 实测（25.12）
> 完整字段见 `data/p6_data_dictionary.json`（130 表 / 1,921 字段）；这里只讲“怎么用”。

## 1. 核心表

| 表 | 一行是什么 | 关键字段 |
|---|---|---|
| `PROJECT` | 一个项目（或一个 EPS 节点） | `proj_id`、`proj_short_name`、`project_flag`、`clndr_id`、`plan_start_date` |
| `PROJWBS` | 一个 WBS 节点 | `wbs_id`、`proj_id`、`parent_wbs_id`、`proj_node_flag`、`wbs_short_name`、`wbs_name`、`seq_num` |
| `TASK` | 一个活动 | `task_id`、`task_code`、`task_name`、`wbs_id`、`clndr_id`、`remain_drtn_hr_cnt`、`early_*`、`total_float_hr_cnt`、`cstr_type`、`cstr_date` |
| `TASKPRED` | 一条逻辑关系 | `task_id`（后继）、`pred_task_id`（前驱）、`pred_type`、`lag_hr_cnt` |
| `CALENDAR` | 一个日历 | `clndr_id`、`day_hr_cnt`、`week_hr_cnt`、`clndr_data` |
| `UDFTYPE` / `UDFVALUE` | 自定义字段定义/值 | `UDF_TYPE_LABEL` 有中文标签 |

## 2. 三个必须知道的坑

1. **软删除**：`delete_date is not null` 的行是逻辑删除，仍在表里。任何查询都要加
   `delete_date is null`，否则活动/关系/分配会虚高。
2. **`node:sqlite` 裸列名返回大写**：`select proj_id` 得到 `PROJ_ID`，`row.proj_id` 是
   `undefined`；要么用别名 `as id`，要么统一转小写。
3. **项目名称不在 `PROJECT`**：取 `PROJWBS` 里 `proj_node_flag='Y'` 那行的 `wbs_name`。

## 3. 单位

| 量 | 单位 | 备注 |
|---|---|---|
| 工期 | 小时 | `remain_drtn_hr_cnt`；8 小时/工日 |
| 延时 | 小时 | `lag_hr_cnt`；可正可负 |
| 浮时 | 小时 | `total_float_hr_cnt`；÷8 得天 |
| 百分比 | 百分数 | `phys_complete_pct` 35 = 35%；XML 里是小数 0.35 |

## 4. 日历

- 默认 7 天 × 8 小时（`clndr_id=638` 在示例库中叫“全年无休”）。
- 生成器只写一个 7×8 日历；混用 5 天/7 天日历时，工期换算要按各自日历的工作日算。
- `CALENDAR.clndr_data` 是一段括号表达式，改日历优先在 P6 界面改。

## 5. 关系与外部项目

- 跨项目关系用 `pred_proj_id` 区分；本插件生成的项目内关系 `proj_id = pred_proj_id`。
- 删除项目会连带删 `TASK/TASKPRED/PROJWBS`；**硬删除，无回收站**。

## 6. 查询示例

```sql
-- 某项目的活动（已过滤软删除）
select task_code, task_name, early_start_date, early_end_date
from TASK where proj_id = :id and delete_date is null order by task_id;

-- 某项目的关系
select s.task_code as succ, p.task_code as pred, r.pred_type, r.lag_hr_cnt
from TASKPRED r
join TASK s on s.task_id = r.task_id
join TASK p on p.task_id = r.pred_task_id
where r.proj_id = :id;
```
