# 导入与导出（P6 Professional 25.12）

> 可信度：✅ 实测（2026-10-25，P6 25.12 + 本地 SQLite 库）
> 适用：本地 SQLite 版 P6 Professional；EPPM/网页版不适用。

## 1. 三条硬结论

1. **CLI 导入不可用**：`Primavera.ImportExport.exe` 对项目文件报
   `Invalid import type: Flat`，随后把文件路径当数据库别名，必失败。不要重试。
2. **只有界面导入这一条路**：文件 → 导入 → 选格式 → 选文件 → 下一步×3 → 完成。
3. **导入永远是“新建项目”，且落在根 EPS**：XER/XML 里写的父 EPS 会被忽略；
   导入后再用 `p6_write action=reparent` 挂到目标 EPS。

## 2. 界面步骤（两种格式）

| 步骤 | XER（新建项目首选） | XML（改既有项目） |
|---|---|---|
| 1 | 文件 → 导入 | 文件 → 导入 |
| 2 | 选 **Primavera PM-(XER)** | 选 **Primavera P6-(XML)** |
| 3 | 下一步 → 导入类型选 **项目** → 下一步 | 同左 |
| 4 | 选文件（`...` 打开原生对话框） | 同左 |
| 5 | 下一步 → 项目列表页（“导入到 EPS”只读） | 同左 |
| 6 | 下一步 → 更新项目选项（默认模板即可） | 同左 |
| 7 | 下一步 → 完成 | 同左 |

> 向导最后一页“完成”才可用；中间页是灰的，不要以为卡住。

## 3. 导入后必做

```
p6 action=tasks project=<PROJECT> limit=200     # 看活动/日期/工期
p6_write action=reparent project=<PROJECT> eps=3689 yes=true   # 挂到目标 EPS
```

然后在 P6 里 **F5** 刷新、**F9** 排程，再读一次日期。

## 4. 编码

- XER 必须 **GBK**。UTF-8 导入后项目名、活动名整片乱码。
- 生成器（`lib/p6xer.js`）内置 GBK 表；遇到 GBK 无法表示的字符会直接报错，不会写 `?`。
- XML 走 UTF-8，没有这个问题。

## 5. 错误对照

| 现象/日志 | 原因 | 修法 |
|---|---|---|
| `invalid parent WBS IDs` | CSV 里有多个根 WBS | 所有 `wbs_path` 用同一个根，如 `P.前期筹备`、`P.设计` |
| 项目名显示成 `1` | XER 里删掉了 `proj_node_flag='Y'` 的根行 | 保留根行，`wbs_name` 写项目名 |
| 中文乱码 | 写成 UTF-8 | 用插件重新生成（GBK） |
| 项目跑到顶层 EPS | P6 忽略 XER 的父节点 | `reparent` |
| `另一个用户打开了此项目，不能删除` | 残留 `PROJSHAR`（崩溃会话或 CLI 导出留下） | `p6_write action=unlock project=<PROJECT> yes=true`，再 F5 |
| 导入成功但日期不对 | 没跑 F9 | 工具 → 进度（F9） |

## 6. 导出

- `p6_write action=export` 用 P6 CLI 出 **P6 XML**（即使文件名写 `.xer`，内容仍是 XML）。
- 每次 CLI 登录会多 1 条 `USESSION`、给项目加 `PROJSHAR` 行；业务数据不变。
- 需要 XER 时，在 P6 界面：文件 → 导出 → Primavera PM-(XER)。

## 7. 待补（教程）

- [ ] 导出时“仅导出已打开项目/全部”的选项差异（📘 待教程时间码）
- [ ] 导入向导里“要导入的基线”怎么用（❓未验证）
