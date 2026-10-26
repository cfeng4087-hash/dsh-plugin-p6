// Build the P6 data dictionary from a live database copy plus real XER samples.
// Read-only: the database is copied to a temp file and opened readOnly.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.argv[2] || process.env.P6_DB || path.join(os.homedir(), 'Documents', 'PPMDBSQLite.db')
const projectXer = process.argv[3] || ''
const resourceXer = process.argv[4] || ''
const outPath = process.argv[5] || path.join(process.cwd(), 'data', 'p6_data_dictionary.json')

const AUDIT = new Set([
  'create_date', 'create_user', 'update_date', 'update_user', 'delete_date', 'delete_session_id',
  'guid', 'last_checksum', 'add_by_name', 'last_recalc_date', 'last_schedule_date',
])
const COMPUTED_RE = /(^|_)(early|late)(_|$)|float|driving|critical|remain_late|remain_early|at_completion|this_period|act_ot|act_reg_cost|act_ot_cost|remain_cost|target_cost|cost_per_qty|(^|_)ev_/i
const INPUT_RE = /(^|_)(target|act|remain|planned)_|_name$|_code$|_pct$|_qty$|_hr$|_date$|^user_field_/i

const DOMAIN = {
  PROJECT: '项目/EPS', PROJWBS: 'WBS', PROJCOST: '项目费用', PROJPROP: '项目属性', PROJSHAR: '项目共享',
  TASK: '活动', TASKPRED: '逻辑关系', TASKRSRC: '资源分配', TASKACTV: '活动代码', TASKMEMO: '活动备注',
  TASKNOTE: '活动备注', TASKDOC: '活动文档', TASKFIN: '活动财务', TASKFDBK: '活动反馈', TASKPROC: '活动流程',
  TASKRISK: '活动风险', TASKUSER: '活动用户字段', TASKSTEP: '活动步骤',
  RSRC: '资源', RSRCRATE: '资源单价', RSRCCURV: '资源曲线', RSRCHOUR: '资源工时', RSRCROLE: '资源角色',
  ROLES: '角色', ROLERATE: '角色单价', ROLELIMIT: '角色限额',
  CALENDAR: '日历', NONWORK: '非工作时间', SHIFT: '班次', SHIFTPER: '班次时段',
  UDFTYPE: '自定义字段定义', UDFVALUE: '自定义字段值', UDFCODE: '自定义字段代码',
  USERS: '用户', PROFILE: '权限配置文件', PROFPRIV: '权限明细', USERSET: '用户设置', USESSION: '登录会话',
  VIEWPROP: '视图属性', RPT: '报表', TRAKVIEW: '跟踪视图', USERCOL: '用户列', FILTPROP: '过滤器',
  CURRTYPE: '币种', COSTTYPE: '费用类型', PHASE: '阶段', RISKTYPE: '风险类型', DOCCATG: '文档分类',
  OBS: '责任分解', POBS: '项目责任分解', ROBS: '资源责任分解',
  NEXTKEY: '主键序列', SETTINGS: '系统设置', PREFER: '偏好', ADMIN_CONFIG: '管理配置',
  REFRDEL: '引用登记', GCHANGE: '全局变更', BASETYPE: '基准类型', ACTVTYPE: '活动类型',
  ACCOUNT: '科目', FUNDSRC: '资金来源', LOCATION: '地点', MEMOTYPE: '备忘录类型', DOCUMENT: '文档',
  PROJISSU: '项目问题', PROJRISK: '项目风险', PROJEST: '项目估算', PROJFUND: '项目资金',
  WBSBUDG: 'WBS 预算', WBSMEMO: 'WBS 备注', WBSRSRC: 'WBS 资源', WBSRSRC_QTY: 'WBS 资源数量',
  WBSSTEP: 'WBS 步骤', SUMTASK: '汇总活动', SUMTASKSPREAD: '汇总活动分布', SUMTRSRC: '汇总资源分配',
}

// Handover §5 whitelist: input fields that may ever be staged. Nothing here is
// verified for direct write; staging writes an XML file for the user to import.
const STAGEABLE = {
  TASK: {
    task_code: { xml: 'Id', kind: 'text', label: '活动代码' },
    task_name: { xml: 'Name', kind: 'text', label: '活动名称' },
    act_start_date: { xml: 'ActualStartDate', kind: 'datetime', label: '实际开始' },
    act_end_date: { xml: 'ActualFinishDate', kind: 'datetime', label: '实际完成' },
    target_start_date: { xml: 'PlannedStartDate', kind: 'datetime', label: '计划（目标）开始', unverified: true },
    target_end_date: { xml: 'PlannedFinishDate', kind: 'datetime', label: '计划（目标）完成', unverified: true },
    phys_complete_pct: { xml: 'PhysicalPercentComplete', kind: 'number', label: '物理完成百分比' },
    remain_drtn_hr_cnt: { xml: 'RemainingDuration', kind: 'number', label: '剩余工期（小时）' },
  },
  TASKRSRC: {
    remain_qty: { xml: 'RemainingUnits', kind: 'number', label: '剩余数量', unverified: true },
    target_qty_per_hr: { xml: 'PlannedUnitsPerTime', kind: 'number', label: '计划单位/小时', unverified: true },
  },
  PROJWBS: { user_field_179: { xml: null, kind: 'text', label: 'WBS 自定义字段 179' } },
  RSRC: { user_field_180: { xml: null, kind: 'text', label: '资源自定义字段 180' } },
}

// Fields whose write mapping was proven by a real P6 GUI import (2026-10-23).
const VERIFIED = {
  TASK: {
    task_name: '2026-10-23 GUI 导入 XXXX-1：名称原样落地',
    phys_complete_pct: '2026-10-23 GUI 导入 XXXX-2：35% 落地（XML 写 0.35）',
    remain_drtn_hr_cnt: '2026-10-23 GUI 导入 XXXX-1：999 落地；F9 后 P6 重置为 120',
  },
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
}

function parseXer(file) {
  const tables = {}
  if (!file || !fs.existsSync(file)) return tables
  const text = fs.readFileSync(file, 'utf8')
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('%T\t')) {
      current = line.slice(3).trim().toUpperCase()
      if (!tables[current]) tables[current] = new Set()
    } else if (line.startsWith('%F\t') && current) {
      for (const f of line.slice(3).split('\t')) if (f) tables[current].add(f.toLowerCase())
    } else if (line.startsWith('%E')) {
      current = null
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(tables)) out[k] = [...v].sort()
  return out
}

function categoryOf(table, field, isPk) {
  const f = field.toLowerCase()
  if (isPk) return 'key'
  if (AUDIT.has(f)) return 'system'
  if (/^guid$|_guid$/.test(f)) return 'system'
  if (COMPUTED_RE.test(f)) return 'computed'
  if (f.endsWith('_id')) return 'ref'
  if (STAGEABLE[table] && STAGEABLE[table][f]) return 'input'
  if (INPUT_RE.test(f)) return 'input'
  return 'unknown'
}

const tmp = path.join(os.tmpdir(), `p6_dict_${Date.now()}.db`)
fs.copyFileSync(dbPath, tmp)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, tmp + suffix)
}
const db = new DatabaseSync(tmp, { readOnly: true })
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name)
const xerProject = parseXer(projectXer)
const xerResource = parseXer(resourceXer)
const xerAll = {}
for (const src of [xerProject, xerResource]) {
  for (const [t, fields] of Object.entries(src)) {
    if (!xerAll[t]) xerAll[t] = new Set()
    for (const f of fields) xerAll[t].add(f)
  }
}

const fields = []
const tableMeta = {}
let columnCount = 0
let nonEmpty = 0
for (const table of tables) {
  const cols = db.prepare(`pragma table_info("${table}")`).all()
  const rawRows = db.prepare(`select count(*) as n from "${table}"`).get().n
  const hasDelete = cols.some((c) => String(c.name).toLowerCase() === 'delete_date')
  const rows = hasDelete ? db.prepare(`select count(*) as n from "${table}" where delete_date is null`).get().n : rawRows
  const deletedRows = rawRows - rows
  if (rows > 0) nonEmpty++
  const pkCols = new Set(cols.filter((c) => c.pk > 0).map((c) => c.name.toLowerCase()))
  const xerFields = xerAll[table] || new Set()
  tableMeta[table] = {
    rows,
    rawRows,
    deletedRows,
    columns: cols.length,
    hasData: rows > 0,
    domain: DOMAIN[table] || '未分类',
    inProjectXer: Boolean(xerProject[table]),
    inResourceXer: Boolean(xerResource[table]),
    unmapped: rows === 0,
  }
  for (const c of cols) {
    columnCount++
    const name = c.name
    const lower = name.toLowerCase()
    const isPk = pkCols.has(lower) && cols.filter((x) => x.pk > 0).length === 1
    const stage = STAGEABLE[table]?.[lower]
    const category = categoryOf(table, name, isPk)
    const inXer = xerFields.has(lower)
    let evidence = 'schema-only'
    const verifiedNote = VERIFIED[table]?.[lower]
    if (verifiedNote) evidence = verifiedNote
    else if (stage) evidence = 'handover-allowlist'
    else if (inXer) evidence = 'xer-sample-present'
    else if (category === 'computed' || category === 'audit' || category === 'system') evidence = 'naming-rule'
    else if (category === 'input') evidence = 'naming-rule'
    fields.push({
      table,
      field: name,
      type: c.type || '',
      pk: c.pk,
      notnull: c.notnull,
      category,
      writable: Boolean(stage),
      stageable: Boolean(stage && stage.xml),
      verified: Boolean(verifiedNote),
      inXer,
      evidence,
    })
  }
}
db.close()
fs.rmSync(tmp, { force: true })
for (const suffix of ['-wal', '-shm']) fs.rmSync(tmp + suffix, { force: true })

const dict = {
  generatedAt: new Date().toISOString(),
  p6: '25.12.0.54843',
  source: {
    dbPath,
    dbSha256: sha256(dbPath),
    dbBytes: fs.statSync(dbPath).size,
    tables: tables.length,
    fields: columnCount,
    nonEmptyTables: nonEmpty,
    emptyTables: tables.length - nonEmpty,
  },
  xer: {
    projectFile: projectXer ? path.basename(projectXer) : null,
    projectTables: Object.keys(xerProject).length,
    resourceFile: resourceXer ? path.basename(resourceXer) : null,
    resourceTables: Object.keys(xerResource).length,
    dbTablesInXer: tables.filter((t) => xerAll[t]).length,
  },
  tables: tableMeta,
  fields,
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(dict))
console.log(JSON.stringify({
  out: outPath,
  bytes: fs.statSync(outPath).size,
  tables: tables.length,
  fields: columnCount,
  nonEmpty,
  xerTables: Object.keys(xerProject).length + Object.keys(xerResource).length,
  dbTablesSeenInXer: dict.xer.dbTablesInXer,
  stageable: fields.filter((f) => f.stageable).length,
}))
