# P6 知识库 · 索引

> 给模型用的**路由表**。`docs/` 是给人看的说明，这里是给执行用的规则。
> 每份笔记头部必须写：来源 / 版本 / 可信度 / 时间码或页码。
> 可信度标记：`✅实测`（在 P6 25.12 上验证过）｜`📘教程`（来自课程，未实测）｜`⚠️冲突`（教程与实测不一致，以实测为准）｜`❓待确认`。

## 按问题找文件

| 你要做什么 | 先读 | 再读 |
|---|---|---|
| 从 CSV 新建一个 P6 项目 | `recipes/new-project-from-csv.md` | `ui/import-export.md` |
| 导入报错、导入后名字乱码/变成“1” | `ui/import-export.md` | `pitfalls.md` |
| 把项目挂到某个 EPS、移动项目 | `ui/eps-wbs.md` | `recipes/new-project-from-csv.md` |
| WBS 层级不对、编码被截断、出现幻影层级 | `ui/eps-wbs.md` | `pitfalls.md` |
| F9 后日期不对、浮时全是 0、有开口 | `ui/scheduling-f9.md` | `planning/logic-and-float.md` |
| 逻辑关系/延时怎么设、为什么用 SS | `planning/logic-and-float.md` | `recipes/new-project-from-csv.md` |
| 某张表/字段是什么意思 | `data-model/overview.md` | `data/p6_data_dictionary.json`（结构化字典） |
| 教程原文在哪、第几分钟 | `sources.md` | 对应主题文件 |
| 改完插件/知识库有没有变差 | `../eval/questions.md` | — |

## 收录原则

1. **只收能执行或能判断的**：菜单路径、按钮名、字段口径、错误→修法。不抄概念介绍。
2. **一条一出处**：教程来的标时间码；实测来的标“实测 + 日期”。
3. **冲突不删**：教程说法与实测不一致时，两边都留，注明以哪边为准。
4. **不写密钥/账号/客户名**；项目代码用占位符（`<PROJECT>`）。
5. **单文件 ≤200 行**；超了按主题拆，并回来改本索引。

## 现状

| 主题 | 文件 | 状态 |
|---|---|---|
| 导入/导出 | `ui/import-export.md` | ✅ 实测（25.12） |
| EPS / WBS | `ui/eps-wbs.md` | ✅ 实测 |
| F9 排程 | `ui/scheduling-f9.md` | ✅ 实测 + 📘待补 |
| 逻辑与浮时 | `planning/logic-and-float.md` | 📘 方法 + ✅ 部分实测 |
| 数据模型 | `data-model/overview.md` | ✅ 实测 |
| 配方：CSV→项目 | `recipes/new-project-from-csv.md` | ✅ 实测 |
| 坑与冲突 | `pitfalls.md` | ✅ 实测为主 |
| 教程清单 | `sources.md` | 待逐讲登记 |
| 回归题 | `../eval/questions.md` | 12 题起步 |
