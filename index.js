// DeepSeek Harness host plugin: Primavera P6 Professional data plane.
// Registers two tools (p6 read-only, p6_write prepare/verify) and one skill.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_DB, withDb, projectRows, resolveProject, projectSummary, taskQuery,
  relationQuery, dbStatus, guardedSql, statusLabel, predLabel,
} from './lib/p6db.js'
import { exportProject, backupDb } from './lib/p6cli.js'
import { snapshotProject, saveSnapshot, loadSnapshot, diffSnapshots } from './lib/p6snap.js'
import { stageXml, summarizeXml, STAGE_FIELDS } from './lib/p6stage.js'
import { writeXer } from './lib/p6xer.js'
import { unlockProject, reparentProject } from './lib/p6admin.js'

export const name = 'dsh-plugin-p6'
export const inject = ['tools', 'skills']

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const SKILL_FILE = path.join(PKG_ROOT, 'data', 'p6-skill.md')
const DICT_FILE = path.join(PKG_ROOT, 'data', 'p6_data_dictionary.json')

function settings(config = {}) {
  return {
    dbPath: config.dbPath || process.env.P6_DB || DEFAULT_DB,
    workDir: config.workDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.dsh'), 'dsh-p6'),
    p6Dir: config.p6Dir,
    alias: config.alias,
    user: config.user || 'ADMIN',
    maxRows: Number(config.maxRows) || 10,
    backupKeep: Number(config.backupKeep) || 10,
    exportTimeoutMs: Number(config.exportTimeoutMs) || 180000,
  }
}

function dirs(cfg) {
  return {
    backups: path.join(cfg.workDir, 'backups'),
    exports: path.join(cfg.workDir, 'exports'),
    snapshots: path.join(cfg.workDir, 'snapshots'),
    staged: path.join(cfg.workDir, 'staged'),
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
  const s = String(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

function table(columns, rows) {
  const head = '| ' + columns.join(' | ') + ' |'
  const sep = '|' + columns.map(() => '---').join('|') + '|'
  const body = rows.map((r) => '| ' + r.map(fmt).join(' | ') + ' |')
  return [head, sep, ...body].join('\n')
}

function clampLimit(cfg, value, max = 200) {
  const n = Number(value)
  return Math.max(1, Math.min(max, Number.isFinite(n) && n > 0 ? n : cfg.maxRows))
}

function textOutput(text) {
  return { text }
}

function makeReadTool(cfg) {
  return {
  name: 'p6',
  description: [
    'Read Primavera P6 Professional data from a read-only copy of its SQLite database. Compact results only: aggregates plus at most `limit` rows.',
    'Actions: status (db/project/activity counts, integrity) | projects (codes, names, counts) | tasks (filtered activities + aggregates) | relations (predecessor/successor, type, lag) | sql (guarded SELECT, auto LIMIT) | dictionary (field catalog: category, writable, XER presence).',
    'Use `projects` first to learn project codes; `tasks`/`relations` need `project` (code or numeric id). Never claim P6 computed values without reading them from the DB.',
  ].join(' '),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'projects', 'tasks', 'relations', 'sql', 'dictionary'],
        description: 'Which read to run.',
      },
      project: { type: 'string', description: 'Project code (e.g. DEMO-04) or numeric proj_id. Required for tasks/relations.' },
      status: { type: 'string', description: 'tasks only: TK_NotStart | TK_Active | TK_Complete.' },
      code: { type: 'string', description: 'tasks only: activity code contains.' },
      text: { type: 'string', description: 'tasks only: activity name contains.' },
      incomplete: { type: 'boolean', description: 'tasks only: exclude completed activities.' },
      negativeFloat: { type: 'boolean', description: 'tasks only: total_float_hr_cnt < 0.' },
      floatBelow: { type: 'number', description: 'tasks only: total_float_hr_cnt < N hours.' },
      targetBefore: { type: 'string', description: 'tasks only: target_end_date < YYYY-MM-DD.' },
      activity: { type: 'string', description: 'relations only: match predecessor or successor activity code.' },
      type: { type: 'string', description: 'relations only: PR_FS | PR_SS | PR_FF | PR_SF.' },
      sql: { type: 'string', description: 'sql action: one SELECT/WITH statement. LIMIT is enforced.' },
      table: { type: 'string', description: 'dictionary action: table name filter (e.g. TASK).' },
      field: { type: 'string', description: 'dictionary action: field name filter (e.g. act_start_date).' },
      category: { type: 'string', enum: ['key', 'system', 'computed', 'input', 'ref', 'unknown'], description: 'dictionary action: category filter.' },
      limit: { type: 'integer', description: 'Max rows to return (default 10, max 200).' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args) {
    return textOutput(runRead(cfg, args))
  },
  }
}

function runRead(cfg, args) {
  return withDb(cfg.dbPath, (db) => {
    const action = args.action
    if (action === 'status') {
      const s = dbStatus(db, cfg.dbPath)
      const rows = projectRows(db)
      const withTasks = rows.filter((r) => r.tasks > 0)
      const status = db.prepare("select status_code as s, count(*) as n from TASK where delete_date is null group by status_code").all()
      const byStatus = status.map((r) => `${statusLabel(r.s)} ${r.n}`).join(' / ')
      const del = Object.entries(s.deleted).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' / ')
      return [
        `P6 数据库: ${s.dbPath}`,
        `大小 ${(s.dbBytes / 1024 / 1024).toFixed(2)} MB | 修改 ${s.dbMtime.slice(0, 19).replace('T', ' ')} | 完整性 ${s.integrity}`,
        `${s.tables} 张表 / ${s.columns} 个字段 | 项目 ${s.projects}（有活动 ${withTasks.length}）| 活动 ${s.tasks} | 关系 ${s.relations} | WBS ${s.wbs} | 资源 ${s.resources} | 分配 ${s.assignments} | 日历 ${s.calendars} | UDF 值 ${s.udfValues}`,
        `活动状态: ${byStatus}`,
        del ? `已排除软删除行（delete_date 非空）: ${del}` : '无软删除行。',
        `提示: 库内无独立数据日期列；PROJECT.LAST_RECALC_DATE 只是重算时间。写操作前用 p6_write action=backup。`,
      ].join('\n')
    }
    if (action === 'projects') {
      const rows = projectRows(db)
      if (rows.length === 0) return '没有项目。'
      const limit = clampLimit(cfg, args.limit, 100)
      const shown = rows.slice(0, limit)
      const lines = [
        `项目 ${rows.length} 个（有活动 ${rows.filter((r) => r.tasks > 0).length} 个）；默认显示 ${shown.length} 个。`,
        table(
          ['代码', 'id', '名称', '活动', '关系', '分配', '最后重算'],
          shown.map((r) => [r.code, r.proj_id, r.name, r.tasks, r.relations, r.assignments, r.last_recalc_date?.slice(0, 10)]),
        ),
      ]
      if (rows.length > shown.length) lines.push(`…还有 ${rows.length - shown.length} 个（提高 limit 查看）。`)
      return lines.join('\n')
    }
    if (action === 'tasks') {
      if (!args.project) throw new Error('tasks needs project (code or id)')
      const project = resolveProject(db, args.project)
      const limit = clampLimit(cfg, args.limit)
      const res = taskQuery(db, project, args, limit)
      const a = res.aggregates ?? {}
      const lines = [
        `项目 ${project.code}（${project.name}）：匹配 ${res.total} 条 | 未完成 ${a.open ?? '-'} | 负浮时 ${a.negativeFloat ?? 0} | 目标区间 ${fmt(a.firstTargetStart?.slice(0, 10))} → ${fmt(a.lastTargetEnd?.slice(0, 10))} | 剩余 ${fmt(a.remainHours)} h`,
      ]
      if (res.rows.length === 0) {
        lines.push('没有匹配的活动。')
      } else {
        lines.push(table(
          ['代码', '名称', '状态', '目标开始', '目标完成', '完成%', '剩余h', '总浮时h', 'WBS'],
          res.rows.map((r) => [r.code, r.name, statusLabel(r.status), r.target_start_date?.slice(0, 10), r.target_end_date?.slice(0, 10), r.physicalPct, r.remainHours, r.totalFloatHours, r.wbs]),
        ))
        if (res.total > res.rows.length) lines.push(`…只显示前 ${res.rows.length} 条（limit=${limit}）。`)
      }
      return lines.join('\n')
    }
    if (action === 'relations') {
      if (!args.project) throw new Error('relations needs project (code or id)')
      const project = resolveProject(db, args.project)
      const limit = clampLimit(cfg, args.limit, 200)
      const res = relationQuery(db, project, args, limit)
      const lines = [`项目 ${project.code}：关系 ${res.total} 条`]
      if (res.rows.length === 0) lines.push('没有匹配的关系。')
      else {
        lines.push(table(
          ['前驱', '类型', '延时h', '后继', '前驱名称', '后继名称'],
          res.rows.map((r) => [r.predecessor, predLabel(r.type), r.lagHours, r.successor, r.predName, r.succName]),
        ))
        if (res.total > res.rows.length) lines.push(`…只显示前 ${res.rows.length} 条。`)
      }
      return lines.join('\n')
    }
    if (action === 'sql') {
      if (!args.sql) throw new Error('sql action needs sql')
      const limit = clampLimit(cfg, args.limit, 200)
      const res = guardedSql(db, args.sql, limit)
      if (res.rows.length === 0) return `0 行（列: ${res.columns.join(', ') || '无'}）。`
      const lines = [
        `返回 ${res.rowCount} 行${res.truncated ? '（已截断）' : ''}；列: ${res.columns.join(', ')}`,
        table(res.columns.slice(0, 20), res.rows.map((r) => res.columns.slice(0, 20).map((c) => r[c]))),
        '提示: 原始 SQL 不会自动过滤软删除；需要时加 `delete_date is null`。',
      ]
      if (res.truncated) lines.push('…结果超过 limit，只显示前 N 行。')
      return lines.join('\n')
    }
    if (action === 'dictionary') {
      const dict = loadDictionary()
      const tableFilter = String(args.table ?? '').trim().toUpperCase()
      const fieldFilter = String(args.field ?? '').trim().toLowerCase()
      const limit = clampLimit(cfg, args.limit, 200)
      let entries = dict.fields
      if (tableFilter) entries = entries.filter((f) => f.table.toUpperCase() === tableFilter)
      if (fieldFilter) entries = entries.filter((f) => f.field.toLowerCase().includes(fieldFilter))
      if (args.category) entries = entries.filter((f) => f.category === args.category)
      const lines = []
      if (tableFilter && dict.tables[tableFilter]) {
        const meta = dict.tables[tableFilter]
        lines.push(`表 ${tableFilter}: ${meta.rows} 行 / ${meta.columns} 列 | 业务域 ${meta.domain} | 有数据 ${meta.hasData ? '是' : '否(空表)'} | 出现在 XER 样本 ${meta.inProjectXer || meta.inResourceXer ? '是' : '否'}${meta.deletedRows ? ` | 另有软删除 ${meta.deletedRows} 行（不计入）` : ''}`)
      }
      const cats = {}
      for (const e of entries) cats[e.category] = (cats[e.category] ?? 0) + 1
      lines.push(`字段 ${entries.length} 条：${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}`)
      if (entries.length > 0) {
        lines.push(table(
          ['表', '字段', '类型', '类别', '可写', '可暂存', 'XER', '证据'],
          entries.slice(0, limit).map((e) => [e.table, e.field, e.type, e.category, e.writable ? 'Y' : '', e.stageable ? 'Y' : '', e.inXer ? 'Y' : '', e.evidence]),
        ))
        if (entries.length > limit) lines.push(`…只显示前 ${limit} 条。`)
      }
      const labels = udfLabels(db)
      if (labels.length > 0 && (!tableFilter || tableFilter === 'TASK' || tableFilter === 'PROJWBS' || tableFilter === 'RSRC')) {
        lines.push('UDF 标签: ' + labels.map((l) => `${l.table}.${l.field}=${l.label}`).join('；'))
      }
      return lines.join('\n')
    }
    throw new Error(`unknown action "${action}"`)
  })
}

function udfLabels(db) {
  try {
    return db.prepare('select table_name as tbl, udf_type_name as field, udf_type_label as label from UDFTYPE where udf_type_label is not null').all()
      .map((r) => ({ table: r.tbl, field: r.field, label: r.label }))
  } catch {
    return []
  }
}

let dictionaryCache = null
function loadDictionary() {
  if (dictionaryCache) return dictionaryCache
  if (!fs.existsSync(DICT_FILE)) throw new Error(`dictionary missing: ${DICT_FILE} (run tools/build-dictionary.mjs)`)
  dictionaryCache = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'))
  return dictionaryCache
}

function makeWriteTool(cfg) {
  return {
  name: 'p6_write',
  description: [
    'Prepare and verify P6 writes. Never writes SQLite directly except the two explicit maintenance actions (unlock/reparent), which auto-backup first and need yes=true.',
    'Actions: backup (copy DB + SHA256) | snapshot (project baseline) | export (P6 CLI -> P6 XML, auto-backup) | xer (CSV -> importable XER, GBK, validated on P6 25.12) | stage (apply whitelisted edits to the XML, generate an import file, read-back verify) | compare (diff two snapshots or a snapshot vs the current DB) | unlock (clear stale "opened by another user" shares) | reparent (move project node under an EPS, e.g. DEMO-EPS=3689).',
    'Importing XML/XER is a P6 GUI step in this build (CLI import is broken); after importing, run compare and report only observed changes. Stage fields: name, code, act_start, act_finish, physical_percent (0-100, written as a fraction), remaining_duration, target_start, target_finish.',
  ].join(' '),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['backup', 'snapshot', 'export', 'stage', 'compare', 'xer', 'unlock', 'reparent'],
        description: 'Which write-preparation step to run.',
      },
      project: { type: 'string', description: 'Project code or id. Required for snapshot/export/compare(with latest).' },
      file: { type: 'string', description: 'stage: path of the exported P6 XML.' },
      edits: {
        type: 'array',
        description: 'stage: edits to apply, each {activity, field, value}. value is a string; numbers/dates are validated per field.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['activity', 'field', 'value'],
          properties: {
            activity: { type: 'string', description: 'Activity code (e.g. A1010).' },
            field: { type: 'string', description: 'One of: name, code, act_start, act_finish, physical_percent, remaining_duration, target_start, target_finish.' },
            value: { type: 'string', description: 'New value. Datetime: YYYY-MM-DDTHH:MM:SS. Empty string clears.' },
          },
        },
      },
      before: { type: 'string', description: 'compare: snapshot file path, or "latest" for the newest snapshot of project.' },
      after: { type: 'string', description: 'compare: snapshot file path; omit to compare against the current DB.' },
      limit: { type: 'integer', description: 'Max diff rows to show (default 20).' },
      csv: { type: 'string', description: 'xer: path of the schedule CSV (wbs_path,task_code,task_name,task_type,duration_days,predecessor_code,rel_type,lag_days,constraint_type,constraint_date).' },
      out: { type: 'string', description: 'xer: output .xer path (default: workDir/exports).' },
      projectCode: { type: 'string', description: 'xer: project code (must be ASCII, e.g. DEMO-03).' },
      projectName: { type: 'string', description: 'xer: project name shown in P6 (Chinese ok).' },
      start: { type: 'string', description: 'xer: planned start YYYY-MM-DD.' },
      eps: { type: 'integer', description: 'reparent: target EPS wbs_id (DEMO-EPS = 3689).' },
      yes: { type: 'boolean', description: 'unlock/reparent: must be true. These are the only actions that write SQLite; both auto-backup first.' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args) {
    return textOutput(await runWrite(cfg, args))
  },
  }
}

function latestSnapshot(dir, projectCode) {
  if (!fs.existsSync(dir)) return null
  const prefix = projectCode.replace(/[^\w.-]+/g, '_') + '_'
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort()
  return files.length === 0 ? null : path.join(dir, files[files.length - 1])
}

async function runWrite(cfg, args, exec) {
  const d = dirs(cfg)
  const action = args.action
  if (action === 'backup') {
    const res = backupDb(cfg.dbPath, d.backups, cfg.backupKeep)
    return [
      `已备份: ${res.path}`,
      `大小 ${(res.bytes / 1024 / 1024).toFixed(2)} MB | SHA256 ${res.sha256} | 方式 ${res.method === 'vacuum' ? 'VACUUM INTO（一致快照）' : '文件复制'}`,
      `保留最近 ${cfg.backupKeep} 份。还原 = 关闭 P6 后用该文件覆盖 ${cfg.dbPath}。`,
    ].join('\n')
  }
  if (action === 'snapshot') {
    if (!args.project) throw new Error('snapshot needs project')
    const res = withDb(cfg.dbPath, (db) => {
      const project = resolveProject(db, args.project)
      const snap = snapshotProject(db, project)
      return { project, snap }
    })
    const file = saveSnapshot(d.snapshots, res.snap)
    const c = res.snap.counts
    return [
      `快照: ${file}`,
      `项目 ${res.snap.project}（${res.snap.projectId}）${res.snap.projectName ?? ''}`,
      `活动 ${c.tasks} | 关系 ${c.relations} | 分配 ${c.assignments} | WBS ${c.wbs} | UDF ${c.udf} | 最后重算 ${res.snap.lastRecalc ?? '-'}`,
      `改完后用 p6_write action=compare before="${file}" project=${res.snap.project} 对比。`,
    ].join('\n')
  }
  if (action === 'export') {
    if (!args.project) throw new Error('export needs project')
    const info = withDb(cfg.dbPath, (db) => {
      const project = resolveProject(db, args.project)
      const snap = snapshotProject(db, project)
      return { project, snap }
    })
    const backup = backupDb(cfg.dbPath, d.backups, cfg.backupKeep)
    const snapFile = saveSnapshot(d.snapshots, info.snap)
    const out = path.join(d.exports, `${info.project.code.replace(/[^\w.-]+/g, '_')}_${stamp()}.xml`)
    const res = await exportProject({
      dbPath: cfg.dbPath,
      projectId: info.project.proj_id,
      outPath: out,
      config: cfg,
    })
    if (!res.ok) {
      return [
        `导出失败（exit=${res.code ?? 'timeout'} ${res.timedOut ? '超时' : ''} ${res.elapsedMs}ms）`,
        `输出: ${res.outPath}（${res.bytes} 字节）`,
        res.error ? `错误: ${res.error}` : '',
        res.stderr ? `stderr: ${res.stderr.slice(-600)}` : '',
        res.mercury?.length ? 'Mercury.log 末尾:\n' + res.mercury.join('\n') : '',
        '排查: 关闭 P6 界面；确认 alias/密码；看 %TEMP%\\Mercury.log。',
      ].filter(Boolean).join('\n')
    }
    const xml = summarizeXml(res.outPath)
    const c = info.snap.counts
    const mismatch = xml.activities !== c.tasks || xml.relationships !== c.relations || xml.assignments !== c.assignments
    return [
      `导出成功: ${res.outPath}`,
      `${(res.bytes / 1024).toFixed(0)} KB | ${res.elapsedMs}ms | alias ${res.alias} | 用户 ${res.user}`,
      `XML: 项目 ${xml.projectName ?? info.project.name} (id ${xml.projectId}) | 活动 ${xml.activities} | 关系 ${xml.relationships} | 分配 ${xml.assignments} | WBS ${xml.wbs}`,
      `库内(已排除软删除): 活动 ${c.tasks} | 关系 ${c.relations} | 分配 ${c.assignments} | WBS ${c.wbs}（含项目根节点）`,
      mismatch ? '⚠️ XML 与库内计数不一致：XML 会省略软删除行，也可能省略部分分配；导入前必须核对（尤其分配）。' : '',
      `改前快照: ${snapFile}`,
      `备份: ${backup.path}`,
      `注意: 每次 CLI 登录会给库里加 1 条 USESSION 和项目 PROJSHAR 行（业务数据不变）。`,
      `下一步: p6_write action=stage file="${res.outPath}" edits=[…] 生成待导入文件。`,
    ].filter(Boolean).join('\n')
  }
  if (action === 'stage') {
    if (!args.file) throw new Error('stage needs file (exported XML path)')
    if (!Array.isArray(args.edits) || args.edits.length === 0) throw new Error('stage needs edits')
    const file = path.resolve(args.file)
    fs.mkdirSync(d.staged, { recursive: true })
    const base = path.basename(file).replace(/\.xml$/i, '')
    const outFile = path.join(d.staged, `${base}_staged_${stamp()}.xml`)
    const res = stageXml({ file, edits: args.edits, outFile })
    const limit = clampLimit(cfg, args.limit, 200)
    const lines = [
      `已生成待导入文件: ${res.outFile}`,
      `来源 ${path.basename(file)} | 活动总数 ${res.summary.activities} | 改动 ${res.applied.length} 处 | 回读校验 ${res.verified ? '通过' : '失败'}`,
      table(
        ['活动', '字段', '改前', '改后'],
        res.applied.slice(0, limit).map((a) => [a.activity, a.label, a.beforeLabel === '' ? '(空)' : (a.beforeLabel ?? a.before), a.afterLabel === '' ? '(空)' : (a.afterLabel ?? a.after)]),
      ),
      res.applied.length > limit ? `…还有 ${res.applied.length - limit} 处。` : '',
      '导入方式（本机 CLI 导入不可用）: 打开 P6 → 文件 → 导入 → 选择该 XML → 导入后必要时 F9。',
      '导入后必须 p6_write action=compare before=<改前快照> project=<代码> 确认。',
    ]
    return lines.filter(Boolean).join('\n')
  }
  if (action === 'compare') {
    if (!args.before) throw new Error('compare needs before (snapshot path or "latest")')
    let beforeFile = args.before
    if (!args.project) throw new Error('compare needs project (to resolve latest / current)')
    const current = withDb(cfg.dbPath, (db) => {
      const project = resolveProject(db, args.project)
      return { project, snap: snapshotProject(db, project) }
    })
    if (beforeFile === 'latest') {
      beforeFile = latestSnapshot(d.snapshots, current.project.code)
      if (!beforeFile) throw new Error(`no snapshot for ${current.project.code} in ${d.snapshots}`)
    }
    const before = loadSnapshot(path.resolve(beforeFile))
    let after
    let afterLabel
    if (args.after) {
      after = loadSnapshot(path.resolve(args.after))
      afterLabel = path.basename(args.after)
    } else {
      after = current.snap
      afterLabel = '当前库'
    }
    const diff = diffSnapshots(before, after)
    const limit = clampLimit(cfg, args.limit, 200)
    const lines = [
      `对比: 改前 ${before.takenAt.slice(0, 19).replace('T', ' ')} → ${afterLabel} ${after.takenAt?.slice(0, 19).replace('T', ' ') ?? ''}`,
      `活动 ${before.counts?.tasks ?? '-'} → ${after.counts?.tasks ?? '-'} | 关系 ${before.counts?.relations ?? '-'} → ${after.counts?.relations ?? '-'} | 分配 ${before.counts?.assignments ?? '-'} → ${after.counts?.assignments ?? '-'}`,
      `负浮时 ${before.counts?.negativeFloat ?? '-'} → ${after.counts?.negativeFloat ?? '-'} | 剩余 ${before.counts?.remainHours ?? '-'} → ${after.counts?.remainHours ?? '-'} h`,
      `输入字段变化 ${diff.inputChanges.length} | 计算字段变化 ${diff.computedChanges.length} | 浮时变化 ${diff.floatDeltaCount} | 新增 ${diff.added.length} | 删除 ${diff.removed.length}`,
    ]
    if (diff.inputChanges.length) {
      lines.push('输入字段变化:')
      lines.push(table(['活动', '字段', '改前', '改后'], diff.inputChanges.slice(0, limit).map((c) => [c.code, c.label, c.before, c.after])))
    }
    if (diff.computedChanges.length) {
      lines.push('P6 侧变化（计算/状态）:')
      lines.push(table(['活动', '字段', '改前', '改后'], diff.computedChanges.slice(0, limit).map((c) => [c.code, c.label, c.before, c.after])))
    }
    if (diff.floatDeltaCount) {
      lines.push(`浮时: ${diff.floatDeltaCount} 条变化，Δ范围 ${fmt(diff.floatMin)}…${fmt(diff.floatMax)} h`)
    }
    if (diff.added.length || diff.removed.length) {
      lines.push(`新增: ${diff.added.slice(0, 10).join(', ') || '-'} | 删除: ${diff.removed.slice(0, 10).join(', ') || '-'}`)
    }
    if (Object.keys(diff.countDelta).length) {
      lines.push('数量/汇总变化: ' + Object.entries(diff.countDelta)
        .map(([k, v]) => `${k} ${v.before}→${v.after}${typeof v.delta === 'number' ? `(${v.delta > 0 ? '+' : ''}${v.delta})` : ''}`)
        .join(' | '))
      const abnormal = Object.entries(diff.countDelta).filter(([k]) => k === 'tasks' || k === 'relations' || k === 'wbs')
      if (abnormal.length) lines.push('⚠️ 活动/关系/WBS 数量发生跳变：先核对是否导入了整项目，异常就还原备份。')
    }
    if (diff.identical) lines.push('结论: 两份快照完全一致（业务数据未变化）。')
    return lines.join('\n')
  }
  if (action === 'xer') {
    if (!args.csv) throw new Error('xer needs csv (path to the schedule CSV)')
    if (!args.projectCode) throw new Error('xer needs projectCode (ASCII, e.g. DEMO-03)')
    if (!args.projectName) throw new Error('xer needs projectName')
    if (!args.start) throw new Error('xer needs start (YYYY-MM-DD)')
    const csv = path.resolve(args.csv)
    if (!fs.existsSync(csv)) throw new Error(`csv not found: ${csv}`)
    const out = args.out
      ? path.resolve(args.out)
      : path.join(d.exports, `${args.projectCode.replace(/[^\w.-]+/g, '_')}_${stamp()}.xer`)
    const res = writeXer({
      csvPath: csv,
      outPath: out,
      projectCode: args.projectCode,
      projectName: args.projectName,
      projectStart: args.start,
    })
    return [
      `已生成 XER: ${res.outPath}`,
      `${(res.bytes / 1024).toFixed(1)} KB（GBK）| 活动 ${res.tasks} | 关系 ${res.relations} | WBS ${res.wbs}`,
      `项目代码 ${args.projectCode} | 项目名称 ${args.projectName} | 计划开始 ${args.start}`,
      '导入：P6 → 文件 → 导入 → Primavera PM-(XER) → 选该文件 → 下一步×3 → 完成；导入后 F9。',
      '导入只落在根 EPS：随后用 p6_write action=reparent project=<代码> eps=3689 yes=true 挂到 DEMO-EPS。',
      '校验：p6 action=tasks project=<代码> 看日期/工期；p6_write action=compare 需要先拍快照。',
    ].join('\n')
  }
  if (action === 'unlock') {
    if (!args.project) throw new Error('unlock needs project')
    if (args.yes !== true) throw new Error('unlock rewrites SQLite; pass yes=true to confirm')
    const backup = backupDb(cfg.dbPath, d.backups, cfg.backupKeep)
    const res = unlockProject(cfg.dbPath, args.project)
    return [
      `已解锁项目 ${res.project}（${res.projId}）`,
      `清掉 PROJSHAR ${res.sharesDeleted} 行 | PROJECT 签出标记更新 ${res.projectRowsUpdated} 行 | 剩余共享 ${res.sharesLeft}`,
      `备份: ${backup.path}`,
      'P6 里按 F5 刷新后再删除项目；若仍提示被占用，说明还有活动会话，先关闭其它 P6 实例。',
    ].join('\n')
  }
  if (action === 'reparent') {
    if (!args.project) throw new Error('reparent needs project')
    if (args.yes !== true) throw new Error('reparent rewrites SQLite; pass yes=true to confirm')
    const backup = backupDb(cfg.dbPath, d.backups, cfg.backupKeep)
    const res = reparentProject(cfg.dbPath, args.project, args.eps)
    return [
      `已把 ${res.project}（${res.projId}）的项目节点 ${res.wbsId} 挂到 EPS ${res.epsName}（${res.after}）`,
      `原父节点: ${res.before ?? '(根)'}`,
      `备份: ${backup.path}`,
      'P6 里按 F5 刷新。导入向导的“导入到 EPS”列是只读的，XER 里的 parent_wbs_id 会被忽略，所以归属只能导入后调整。',
    ].join('\n')
  }
  throw new Error(`unknown action "${action}"`)
}

function skillContent() {
  if (!fs.existsSync(SKILL_FILE)) throw new Error(`skill file missing: ${SKILL_FILE}`)
  return fs.readFileSync(SKILL_FILE, 'utf8')
}

export function apply(ctx, config = {}) {
  const cfg = settings(config)
  ctx.tools.register(makeReadTool(cfg))
  ctx.tools.register(makeWriteTool(cfg))
  ctx.skills.register({
    name: 'p6',
    description: 'Primavera P6 Professional 计划数据：只读查询、字段字典、导出 XML、批量暂存改动、快照对比。涉及 P6 进度/活动/关系/资源/回填时加载。',
    whenToUse: '用户提到 P6、Primavera、进度计划、活动、WBS、浮时、逻辑关系，或要查询/核对/回填 P6 数据时。',
    content: skillContent(),
    invocation: { modelInvocable: true, userInvocable: true },
  })
}
