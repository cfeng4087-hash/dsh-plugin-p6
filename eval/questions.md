# 回归题（12 题）

> 用途：改插件、改知识库、喂完新教程后跑一遍，防“越学越偏”。
> 判定：答案必须**给出动作/命令 + 引用 knowledge 里的文件**；只给结论不算过。

| # | 问题 | 期望要点 | 引用 |
|---|---|---|---|
| 1 | 导入 XER 后中文全是乱码，为什么？ | XER 必须 GBK；UTF-8 会被按 ANSI 解码 | `ui/import-export.md` §4 |
| 2 | 导入报 `invalid parent WBS IDs` 怎么修？ | CSV 里多个根 WBS；统一成 `P.…` 单根 | `pitfalls.md` P1 |
| 3 | 导入后项目名称显示成 `1`，原因？ | 删了 `proj_node_flag='Y'` 的根行；`wbs_name` 才是项目名 | `ui/eps-wbs.md` §1 |
| 4 | 项目导入后跑到顶层 EPS，怎么挂到 DEMO-EPS？ | `p6_write action=reparent project=… eps=3689 yes=true`，F5 | `ui/eps-wbs.md` §2 |
| 5 | 删除项目提示“另一个用户打开了此项目” | 残留 PROJSHAR；`unlock … yes=true`，F5 再删 | `pitfalls.md` P11 |
| 6 | F9 后日期没变化/还是导入时的值 | 没执行 F9，或项目未重新打开；工具→进度 | `ui/scheduling-f9.md` §1 |
| 7 | 两次导入后关系数翻倍、浮时全 0 | 更新模式只增不删；删项目重导 | `pitfalls.md` P5 |
| 8 | WBS 编码显示成 `DEMO-EPS.6.6.1`，且节点变少 | 每级写了完整路径 + `TEXT(40)` 截断；每级只写本级序号 | `ui/eps-wbs.md` §3 |
| 9 | 查询结果里 `row.proj_id` 是 `undefined` | node:sqlite 裸列名返回大写；用别名/转小写 | `data-model/overview.md` §2 |
| 10 | 活动数比界面上多 | 没过滤 `delete_date is null` | `data-model/overview.md` §2 |
| 11 | 工期 50 天，写进 `remain_drtn_hr_cnt` 应该是多少？ | 400（8 小时/工日） | `data-model/overview.md` §3 |
| 12 | 要出 Excel 进度表，日期从哪来？ | 取 P6 的 `early_start/early_end`、`total_float`，不自己算 | `recipes/new-project-from-csv.md` §6–7 |

## 打分

- 12/12：可发布；
- 10–11：允许发，但把错的两题补进知识库；
- ≤9：说明知识库有断层或教程说法污染，先修再发。
