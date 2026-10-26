// Read-only access to Primavera P6 Professional's SQLite database.
// Every call copies the database (plus WAL/SHM) to a temp file and opens it
// readOnly, so a running P6 can never be disturbed and nothing can be written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

// P6 Professional keeps its local SQLite database in Documents on Windows.
// Override with P6_DB or the plugin's `dbPath` config.
export const DEFAULT_DB = process.env.P6_DB || path.join(os.homedir(), 'Documents', 'PPMDBSQLite.db')

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
}

export function withDb(dbPath, fn) {
  if (!fs.existsSync(dbPath)) throw new Error(`P6 database not found: ${dbPath}`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p6-'))
  const copy = path.join(dir, 'p6.db')
  try {
    fs.copyFileSync(dbPath, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, copy + suffix)
    }
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

function plainRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    // node:sqlite reports bare schema columns in their declared (upper) case.
    const key = /^[A-Z0-9_]+$/.test(k) ? k.toLowerCase() : k
    if (typeof v === 'bigint') out[key] = Number(v)
    else if (v instanceof Uint8Array) out[key] = `0x${Buffer.from(v).toString('hex').slice(0, 64)}`
    else out[key] = v
  }
  return out
}

export function all(db, sql, params = []) {
  return db.prepare(sql).all(...params).map(plainRow)
}

export function one(db, sql, params = []) {
  const row = db.prepare(sql).get(...params)
  return row === undefined ? null : plainRow(row)
}

export function projectRows(db) {
  return all(db, `
    select p.proj_id, p.proj_short_name as code,
           (select w.wbs_name from PROJWBS w
             where w.proj_id = p.proj_id and w.proj_node_flag = 'Y'
             order by w.seq_num limit 1) as name,
           p.last_recalc_date, p.plan_start_date, p.plan_end_date,
           (select count(*) from TASK t where t.proj_id = p.proj_id and t.delete_date is null) as tasks,
           (select count(*) from TASKPRED r where r.proj_id = p.proj_id and r.delete_date is null) as relations,
           (select count(*) from TASKRSRC x where x.proj_id = p.proj_id and x.delete_date is null) as assignments
      from PROJECT p
     order by code`)
}

export function resolveProject(db, ref) {
  if (ref === undefined || ref === null || String(ref).trim() === '') throw new Error('project is required (project code or numeric id)')
  const text = String(ref).trim()
  const rows = projectRows(db)
  let hit = rows.find((r) => String(r.code).toLowerCase() === text.toLowerCase())
  if (!hit && /^\d+$/.test(text)) hit = rows.find((r) => Number(r.proj_id) === Number(text))
  if (!hit) {
    const list = rows.filter((r) => r.tasks > 0).map((r) => `${r.code}(${r.proj_id})`).join(', ')
    throw new Error(`unknown project "${text}". Projects with activities: ${list}`)
  }
  return hit
}

const STATUS_LABEL = { TK_NotStart: '未开始', TK_Active: '进行中', TK_Complete: '已完成' }
export function statusLabel(code) { return STATUS_LABEL[code] ?? code }

const PRED_TYPE = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' }
export function predLabel(code) { return PRED_TYPE[code] ?? code }

export function projectSummary(db, project, opts = {}) {
  const pid = Number(project.proj_id)
  const agg = one(db, `
    select count(*) as tasks,
           sum(case when status_code = 'TK_NotStart' then 1 else 0 end) as notStarted,
           sum(case when status_code = 'TK_Active' then 1 else 0 end) as active,
           sum(case when status_code = 'TK_Complete' then 1 else 0 end) as completed,
           sum(case when total_float_hr_cnt < 0 then 1 else 0 end) as negativeFloat,
           sum(case when total_float_hr_cnt = 0 then 1 else 0 end) as zeroFloat,
           min(target_start_date) as firstTargetStart,
           max(target_end_date) as lastTargetEnd,
           sum(remain_drtn_hr_cnt) as remainHours,
           round(avg(phys_complete_pct), 2) as avgPhysicalPct
      from TASK where proj_id = ? and delete_date is null`, [pid])
  return {
    project: project.code,
    projectId: pid,
    name: project.name,
    lastRecalc: project.last_recalc_date,
    plannedStart: project.plan_start_date,
    plannedEnd: project.plan_end_date,
    ...agg,
    relations: one(db, 'select count(*) as n from TASKPRED where proj_id = ? and delete_date is null', [pid]).n,
    assignments: one(db, 'select count(*) as n from TASKRSRC where proj_id = ? and delete_date is null', [pid]).n,
    wbsNodes: one(db, 'select count(*) as n from PROJWBS where proj_id = ? and delete_date is null', [pid]).n,
    ...opts.extra,
  }
}

export function taskQuery(db, project, filters = {}, limit = 10) {
  const pid = Number(project.proj_id)
  const where = ['t.proj_id = ?', 't.delete_date is null']
  const params = [pid]
  if (filters.status) {
    const map = { '未开始': 'TK_NotStart', '进行中': 'TK_Active', '已完成': 'TK_Complete' }
    where.push('t.status_code = ?')
    params.push(map[filters.status] ?? filters.status)
  }
  if (filters.code) { where.push('t.task_code like ?'); params.push(`%${filters.code}%`) }
  if (filters.text) { where.push('t.task_name like ?'); params.push(`%${filters.text}%`) }
  if (filters.incomplete) where.push("t.status_code <> 'TK_Complete'")
  if (filters.negativeFloat) where.push('t.total_float_hr_cnt < 0')
  if (filters.floatBelow !== undefined) { where.push('t.total_float_hr_cnt < ?'); params.push(Number(filters.floatBelow)) }
  if (filters.targetBefore) { where.push('t.target_end_date < ?'); params.push(filters.targetBefore) }
  const clause = where.join(' and ')
  const total = one(db, `select count(*) as n from TASK t where ${clause}`, params).n
  const rows = all(db, `
    select t.task_id, t.task_code as code, t.task_name as name, t.status_code as status,
           t.act_start_date, t.act_end_date, t.target_start_date, t.target_end_date,
           t.phys_complete_pct as physicalPct, t.remain_drtn_hr_cnt as remainHours,
           t.total_float_hr_cnt as totalFloatHours, t.wbs_id, t.clndr_id,
           (select w.wbs_short_name from PROJWBS w where w.wbs_id = t.wbs_id) as wbs
      from TASK t where ${clause}
     order by t.task_code
     limit ?`, [...params, Math.max(1, Math.min(200, limit))])
  const aggregates = one(db, `
    select count(*) as n,
           sum(case when status_code <> 'TK_Complete' then 1 else 0 end) as open,
           sum(case when total_float_hr_cnt < 0 then 1 else 0 end) as negativeFloat,
           min(target_start_date) as firstTargetStart,
           max(target_end_date) as lastTargetEnd,
           sum(remain_drtn_hr_cnt) as remainHours
      from TASK t where ${clause}`, params)
  return { total, aggregates, rows }
}

export function relationQuery(db, project, opts = {}, limit = 20) {
  const pid = Number(project.proj_id)
  const where = ['r.proj_id = ?', 'r.delete_date is null']
  const params = [pid]
  if (opts.activity) {
    where.push('(p.task_code like ? or s.task_code like ?)')
    params.push(`%${opts.activity}%`, `%${opts.activity}%`)
  }
  if (opts.type) { where.push('r.pred_type = ?'); params.push(opts.type) }
  const clause = where.join(' and ')
  const total = one(db, `select count(*) as n from TASKPRED r where ${clause}`, params).n
  const rows = all(db, `
    select p.task_code as predecessor, s.task_code as successor,
           r.pred_type as type, r.lag_hr_cnt as lagHours,
           p.task_name as predName, s.task_name as succName
      from TASKPRED r
      join TASK p on p.task_id = r.pred_task_id
      join TASK s on s.task_id = r.task_id
     where ${clause}
     order by s.task_code, p.task_code
     limit ?`, [...params, Math.max(1, Math.min(200, limit))])
  return { total, rows }
}

export function dbStatus(db, dbPath) {
  const integrity = one(db, 'pragma integrity_check')
  const live = (table) => one(db, `select count(*) as n from "${table}" where delete_date is null`).n
  const total = (table) => one(db, `select count(*) as n from "${table}"`).n
  const counts = {
    projects: live('PROJECT'),
    tasks: live('TASK'),
    relations: live('TASKPRED'),
    wbs: live('PROJWBS'),
    resources: live('RSRC'),
    assignments: live('TASKRSRC'),
    calendars: live('CALENDAR'),
    udfValues: live('UDFVALUE'),
  }
  const deleted = {
    tasks: total('TASK') - counts.tasks,
    relations: total('TASKPRED') - counts.relations,
    assignments: total('TASKRSRC') - counts.assignments,
    udfValues: total('UDFVALUE') - counts.udfValues,
  }
  const tables = one(db, "select count(*) as n from sqlite_master where type='table'").n
  let columns = 0
  for (const t of all(db, "select name from sqlite_master where type='table'")) {
    columns += all(db, `pragma table_info("${t.name}")`).length
  }
  const stat = fs.statSync(dbPath)
  return {
    dbPath,
    dbBytes: stat.size,
    dbMtime: stat.mtime.toISOString(),
    integrity: Object.values(integrity ?? {})[0] ?? 'unknown',
    tables,
    columns,
    ...counts,
    deleted,
  }
}

const SQL_BLOCK = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|replace|truncate|reindex|analyze|begin|commit|rollback|savepoint)\b/i

export function guardedSql(db, sql, limit = 20) {
  const text = String(sql ?? '').trim().replace(/;+\s*$/, '')
  if (!text) throw new Error('sql is required')
  if (!/^(select|with)\b/i.test(text)) throw new Error('only SELECT / WITH read-only queries are allowed')
  if (text.includes(';')) throw new Error('only one statement is allowed (remove interior semicolons)')
  const masked = text.replace(/'(?:[^']|'')*'/g, "''")
  if (SQL_BLOCK.test(masked)) throw new Error('write/DDL/PRAGMA keywords are not allowed')
  const cap = Math.max(1, Math.min(200, Number(limit) || 20))
  const rows = all(db, `select * from (${text}) limit ${cap + 1}`)
  const truncated = rows.length > cap
  const shown = rows.slice(0, cap)
  const columns = shown.length > 0 ? Object.keys(shown[0]) : []
  return { columns, rows: shown, truncated, rowCount: shown.length }
}
