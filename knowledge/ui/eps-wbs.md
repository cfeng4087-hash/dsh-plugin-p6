# EPS 与 WBS

> 可信度：✅ 实测（25.12，2026-10-25/26）
> 一句话：**EPS 是项目容器，WBS 是项目内部结构**；P6 的“项目名称”存在 WBS 根行里，不在 PROJECT 表。

## 1. 概念对应

| P6 界面 | 数据库 | 说明 |
|---|---|---|
| EPS 节点（可放多个项目） | `PROJECT` 一行（`project_flag='N'`）+ `PROJWBS` 一个根节点 | 不是项目，是容器 |
| 项目 | `PROJECT` 一行（`project_flag='Y'`） | 活动挂在它的 WBS 上 |
| WBS 节点 | `PROJWBS` 一行 | `proj_node_flag='Y'` 的那行是项目节点，`wbs_name` 就是项目名称 |

实测例子：`DEMO-EPS` = EPS（`proj_id=<你的 EPS proj_id>`，根 WBS `3689`），其下才是 `DEMO-04`、`DEMO-03` 等项目。

## 2. 把导入的项目挂到 EPS

XER 里的 `parent_wbs_id` 会被 P6 忽略，导入后必须显式移动：

```
p6_write action=reparent project="<PROJECT>" eps=3689 yes=true
```

- `eps=3689` 是 DEMO-EPS 的根 WBS id；换 EPS 就换成对应 id（`select wbs_id,wbs_name from PROJWBS where proj_node_flag='Y' and proj_id=<EPS的proj_id>`）。
- 该动作只改 `PROJWBS.parent_wbs_id` 一个字段，自动备份，需要 `yes=true`。
- P6 里按 **F5** 刷新后即可见。

## 3. WBS 编码的三个坑

1. **编码是拼接显示的**：P6 把每级的 `wbs_short_name` 拼起来显示，所以每级只写本级序号（`6`、`1`、`1`），不要写整条路径，否则显示成 `DEMO-02.6.6.1.6.1.1`。
2. **`WBS_SHORT_NAME` 是 TEXT(40)**：整条点分路径超 40 字符会被静默截断（曾出现 143→112 个 WBS 的“丢节点”）。
3. **名称里不要带 `.`**：P6 会把点当层级分隔符，造出幻影层级；中文名用“、”或“-”代替。

## 4. 单根原则（导入前必查）

XER 的 `PROJWBS` 只允许一个根（`parent_wbs_id` 为空且 `proj_node_flag='Y'`）。
CSV 里所有 `wbs_path` 必须以同一个根开头：

```
P.前期筹备     ✅
P.设计         ✅
1.前期筹备     ❌ 与 2.设计 会变成两个根
2.设计         ❌
```

## 5. 删除项目（高危）

- P6 删除项目是**硬删除**：`PROJECT` 行物理消失，没有回收站。
- 在 EPS 视图里**点一下单元格再按 Del**，删的是“项目代码文字”，不是项目；本轮曾把 `DEMO-01` 改成 `-VC`。
- 正确做法：**右键项目行 → 删除 → 是**；删前先 `p6_write action=backup`。
- 删不掉且提示“另一个用户打开了此项目” → `p6_write action=unlock ... yes=true`。
