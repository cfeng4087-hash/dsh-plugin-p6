// Project snapshots and diffs used to prove what actually changed in P6.
import fs from 'node:fs'
import path from 'node:path'
import { all, one } from './p6db.js'

const INPUT_FIELDS = [
  ['code', '活动代码'],
  ['name', '活动名称'],
  ['act_start', '实际开始'],
  ['act_end', '实际完成'],
  ['target_start', '目标开始'],
  ['target_end', '目标完成'],
  ['phys', '物理完成%'],
  ['remain', '剩余工期(h)'],
]
const COMPUTED_FIELDS = [
  ['float', '总浮时(h)'],
  ['status', '状态'],
]

export function snapshotProject(db, project) {
  const pid = Number(project.proj_id)
  const projectRow = one(db, 'select proj_id, proj_short_name, last_recalc_date, plan_start_date, plan_end_date from PROJECT where proj_id = ?', [pid])
  const tasks = all(db, `
    select t.task_id as id, t.task_code as code, t.task_name as name, t.status_code as status,
           t.act_start_date, t.act_end_date, t.target_start_date, t.target_end_date,
           t.phys_complete_pct as phys, t.remain_drtn_hr_cnt as remain,
           t.total_float_hr_cnt as float, t.wbs_id, t.clndr_id
      from TASK t where t.proj_id = ? and t.delete_date is null order by t.task_code`, [pid])
  const map = {}
  for (const t of tasks) map[String(t.id)] = t
  const counts = {
    tasks: tasks.length,
    relations: one(db, 'select count(*) as n from TASKPRED where proj_id = ? and delete_date is null', [pid]).n,
    assignments: one(db, 'select count(*) as n from TASKRSRC where proj_id = ? and delete_date is null', [pid]).n,
    wbs: one(db, 'select count(*) as n from PROJWBS where proj_id = ? and delete_date is null', [pid]).n,
    udf: one(db, `select count(*) as n from UDFVALUE where delete_date is null and fk_id in (select task_id from TASK where proj_id = ? and delete_date is null)`, [pid]).n,
    negativeFloat: tasks.filter((t) => Number(t.float) < 0).length,
    remainHours: Math.round(tasks.reduce((s, t) => s + (Number(t.remain) || 0), 0) * 1000) / 1000,
    projectFinish: tasks.reduce((m, t) => (t.target_end_date && t.target_end_date > m ? t.target_end_date : m), ''),
  }
  return {
    version: 1,
    project: project.code,
    projectId: pid,
    projectName: project.name,
    takenAt: new Date().toISOString(),
    lastRecalc: projectRow?.last_recalc_date ?? null,
    counts,
    tasks: map,
  }
}

export function saveSnapshot(dir, snapshot) {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(dir, `${snapshot.project.replace(/[^\w.-]+/g, '_')}_${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(snapshot))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  for (const old of files.slice(0, Math.max(0, files.length - 20))) fs.rmSync(path.join(dir, old), { force: true })
  return file
}

export function loadSnapshot(file) {
  if (!fs.existsSync(file)) throw new Error(`snapshot not found: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function normalize(v) {
  if (v === null || v === undefined) return ''
  return String(v)
}

export function diffSnapshots(before, after) {
  const ids = new Set([...Object.keys(before.tasks ?? {}), ...Object.keys(after.tasks ?? {})])
  const added = []
  const removed = []
  const inputChanges = []
  const computedChanges = []
  let floatDeltaCount = 0
  let floatMin = 0
  let floatMax = 0
  for (const id of ids) {
    const a = before.tasks?.[id]
    const b = after.tasks?.[id]
    if (!a) { added.push(b.code ?? id); continue }
    if (!b) { removed.push(a.code ?? id); continue }
    for (const [field, label] of INPUT_FIELDS) {
      if (normalize(a[field]) !== normalize(b[field])) {
        inputChanges.push({ code: a.code, id, field, label, before: a[field], after: b[field] })
      }
    }
    for (const [field, label] of COMPUTED_FIELDS) {
      if (normalize(a[field]) !== normalize(b[field])) {
        computedChanges.push({ code: a.code, id, field, label, before: a[field], after: b[field] })
      }
    }
    const fa = Number(a.float ?? 0)
    const fb = Number(b.float ?? 0)
    if (Math.abs(fa - fb) > 1e-9) {
      floatDeltaCount++
      const d = fb - fa
      if (d < floatMin) floatMin = d
      if (d > floatMax) floatMax = d
    }
  }
  const countDelta = {}
  for (const key of ['tasks', 'relations', 'assignments', 'wbs', 'udf', 'negativeFloat', 'remainHours', 'projectFinish']) {
    const a = before.counts?.[key] ?? 0
    const b = after.counts?.[key] ?? 0
    if (String(a) !== String(b)) countDelta[key] = { before: a, after: b, delta: typeof a === 'number' && typeof b === 'number' ? b - a : null }
  }
  return {
    beforeAt: before.takenAt,
    afterAt: after.takenAt,
    added,
    removed,
    inputChanges,
    computedChanges,
    floatDeltaCount,
    floatMin,
    floatMax,
    countDelta,
    identical: added.length === 0 && removed.length === 0 && inputChanges.length === 0 && computedChanges.length === 0 && Object.keys(countDelta).length === 0,
  }
}
