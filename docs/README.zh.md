# dsh-plugin-p6（中文说明）

DeepSeek Harness 的 Primavera P6 Professional 25.12 计划数据插件：只读查询、字段字典、
XML/XER 导出、CSV→XER 生成、快照对比，以及两个受控维护动作（解锁、挂 EPS）。

> 在 **P6 25.12 + 本地 SQLite 库**上逐项实测过；“已验证”表里的结论都来自真实库，
> 不是按文档推测。

## 为什么做这个

P6 25.12 没有可用的命令行导入（`Invalid import type: Flat`），本地 SQLite 版也没有公开
API。唯一可靠的写入路径是：生成导入文件 → 在 P6 界面导入 → 从 SQLite 读回结果。
插件把除“界面点两下”以外的环节都自动化了。

## 能力

- `p6`（只读）：`status` / `projects` / `tasks` / `relations` / `sql` / `dictionary`
- `p6_write`：`backup` / `snapshot` / `compare` / `export` / `stage` / **`xer`** /
  **`unlock`** / **`reparent`**
- 所有读取都复制数据库副本（含 `-wal/-shm`）并以 `readOnly` 打开，P6 开着也不受影响；
  默认过滤 `delete_date` 软删除行。

## 安装

```powershell
$cli = "<DeepSeek Harness>\resources\runtime\cli\bin\dsh.cmd"
& $cli plugin --profile desktop add link:D:\path\to\dsh-plugin-p6-25.12
```

装完**完全退出并重开桌面客户端**。数据库路径默认取 `P6_DB` 或
`%USERPROFILE%\Documents\PPMDBSQLite.db`。

## 五分钟跑通

```text
p6_write action=xer csv="examples/demo.csv" projectCode="DEMO-01" ^
         projectName="演示项目" start="2027-01-10"
# P6：文件 → 导入 → Primavera PM-(XER) → 选文件 → 下一步×3 → 完成
p6_write action=reparent project="DEMO-01" eps=3689 yes=true
# P6 里 F9，然后：
p6 action=tasks project="DEMO-01" limit=100
```

## 25.12 硬结论

| 项 | 结论 |
|---|---|
| XER 头 `ERMHDR 7.0` | 25.12 可直接导入 |
| XER 编码 | **必须 GBK**，UTF-8 会乱码 |
| 项目名 | 取 `PROJWBS` 中 `proj_node_flag='Y'` 行的 `wbs_name` |
| EPS 归属 | XER 里的父节点被忽略，导入后用 `reparent` |
| CLI 导入 | 不可用，只能走界面 |
| XML 百分比 | 小数（0.35 = 35%） |

## 已知限制

- 仅 Windows + 本地 SQLite 版 P6；EPPM/网页版不在范围。
- 导入是人工界面步骤；插件只负责生成文件。
- XER 只生成 项目/WBS/活动/关系 + 一个日历；资源、角色、UDF、多日历不生成。

## 许可

MIT，见 [LICENSE](../LICENSE)。

