// Targeted P6 maintenance operations that the normal read/stage path cannot do.
// These write SQLite directly and are therefore explicit, narrow, and reversible:
// callers must take a backup first (index.js does) and pass an explicit flag.
import { DatabaseSync } from 'node:sqlite'

function open(dbPath) {
  return new DatabaseSync(dbPath, { timeout: 15000 })
}

function resolveProject(db, project) {
  const text = String(project ?? '').trim()
  if (!text) throw new Error('project is required')
  const sql = /^\d+$/.test(text)
    ? 'select proj_id as id, proj_short_name as code from PROJECT where proj_id = ? and delete_date is null'
    : 'select proj_id as id, proj_short_name as code from PROJECT where proj_short_name = ? and delete_date is null'
  const row = db.prepare(sql).get(/^\d+$/.test(text) ? Number(text) : text)
  if (!row) throw new Error(`project not found: ${text}`)
  return row
}

/** Clear stale "opened by another user" state: PROJSHAR rows + checkout flags. */
export function unlockProject(dbPath, project) {
  const db = open(dbPath)
  try {
    const row = resolveProject(db, project)
    const shares = db.prepare('delete from PROJSHAR where proj_id = ?').run(row.id)
    const proj = db.prepare(
      "update PROJECT set checkout_flag = 'N', checkout_user_id = null, checkout_date = null where proj_id = ?"
    ).run(row.id)
    const left = db.prepare('select count(*) as n from PROJSHAR where proj_id = ?').get(row.id)
    return {
      project: row.code,
      projId: row.id,
      sharesDeleted: Number(shares.changes ?? 0),
      projectRowsUpdated: Number(proj.changes ?? 0),
      sharesLeft: left.n,
    }
  } finally {
    db.close()
  }
}

/** Move a project node under an existing EPS node (what dragging in the EPS view does). */
export function reparentProject(dbPath, project, epsWbsId) {
  const eps = Number(epsWbsId)
  if (!Number.isFinite(eps) || eps <= 0) throw new Error('eps (EPS wbs_id) is required, e.g. 3689 for DEMO-EPS')
  const db = open(dbPath)
  try {
    const row = resolveProject(db, project)
    const target = db.prepare(
      "select wbs_id as id, wbs_name as name from PROJWBS where wbs_id = ? and proj_node_flag = 'Y' and delete_date is null"
    ).get(eps)
    if (!target) throw new Error(`EPS node not found: wbs_id=${eps}`)
    const node = db.prepare(
      "select wbs_id as id, parent_wbs_id as parent from PROJWBS where proj_id = ? and proj_node_flag = 'Y' and delete_date is null"
    ).get(row.id)
    if (!node) throw new Error(`project node missing for ${row.code}`)
    db.prepare('update PROJWBS set parent_wbs_id = ? where wbs_id = ?').run(eps, node.id)
    return {
      project: row.code,
      projId: row.id,
      wbsId: node.id,
      before: node.parent,
      after: eps,
      epsName: target.name,
    }
  } finally {
    db.close()
  }
}
