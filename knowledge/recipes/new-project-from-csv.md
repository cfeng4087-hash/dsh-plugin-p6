# 配方：从 CSV 新建一个 P6 项目

> 可信度：✅ 实测（2026-10-25，41 活动、40 关系、5 阶段，F9 后 0 偏差）
> 用时：熟练后 10 分钟（不含 P6 界面点击）。

## 0. 先决条件

- P6 25.12 已打开、已登录；`p6 action=status` 能读到库。
- 目标项目代码在库里不存在（重复会变成 `-1`）。
- 已 `p6_write action=backup`。

## 1. 写 CSV

列：`wbs_path,task_code,task_name,task_type,duration_days,predecessor_code,rel_type,lag_days,constraint_type,constraint_date`

规则：
- 所有 `wbs_path` 同一个根（`P.前期筹备`、`P.设计`…）。
- 只写工期，不写日期。
- 关系一行一条；同一活动多条前驱就多写几行（名称/工期必须一致）。
- 里程碑 `Milestone` 工期 0；固定日期才用 `CS_MSO`。

## 2. 生成前自检（脚本或人工）

- [ ] 单根 WBS
- [ ] 编码无重复；名称不含 `.`
- [ ] 每个 `lag` 能解释
- [ ] 目标窗口闭合：`succ.start = pred.finish + 1 + lag`（FS）或 `pred.start + lag`（SS）
- [ ] 总工期与合同/计划表一致

## 3. 生成 XER

```
p6_write action=xer csv="plan.csv" out="plan.xer" \
  projectCode="<CODE>" projectName="<中文名>" start="2027-01-10"
```

输出应为 GBK；活动/关系/WBS 数与 CSV 对得上。

## 4. 导入

P6 → 文件 → 导入 → **Primavera PM-(XER)** → 选文件 → 下一步×3 → 完成。
详见 `../ui/import-export.md`。

## 5. 归属与排程

```
p6_write action=reparent project="<CODE>" eps=3689 yes=true
```

P6 里 **F5** 刷新 → 打开项目 → **F9** 排程。

## 6. 核对

```
p6 action=tasks project="<CODE>" limit=200
```

- 活动数 = CSV 数（里程碑是否保留看约定）
- 日期逐项落在目标窗口（允许 0 偏差；有偏差先查 lag/约束/开口）
- 负浮时 = 0
- 关键活动数量合理

## 7. 出表

用 `p6 action=tasks` + `p6 action=relations` 的数据生成 Excel：
进度计划 / 横道图 / 逻辑关系 / 编制说明。参考 `tools/schedules/` 下的导出脚本。

## 8. 回滚

- 导入错了：先 `backup`，再在 P6 里右键项目 → 删除；或还原备份（关闭 P6 后覆盖 `.db`）。
- 只改归属：`reparent` 回原 EPS 即可。

## 9. 常见失败

| 失败 | 见 |
|---|---|
| `invalid parent WBS IDs` | `../pitfalls.md` P1 |
| 项目名变 `1` | P2 |
| 乱码 | P3 |
| 导入后日期不对 | P6（没 F9） |

