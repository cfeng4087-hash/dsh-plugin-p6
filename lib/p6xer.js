// CSV -> XER for Primavera P6 Professional (validated against P6 25.12).
//
// P6 on a Chinese Windows reads XER with the system ANSI codepage (GBK), not
// UTF-8: a UTF-8 file imports with mojibake names. This module encodes with a
// bundled GBK table so the plugin stays dependency-free.
//
// CSV columns: wbs_path,task_code,task_name,task_type,duration_days,
//              predecessor_code,rel_type,lag_days,constraint_type,constraint_date
// task_type: Task | Milestone.  constraint_type: CS_MSO (Must Start On) or empty.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HPD = 8
const ID = { calendar: 9001, project: 9900, wbs: 91001, task: 920001, taskpred: 9300001 }
const OBS_ID = 565

let gbkMap = null
function loadGbk() {
  if (gbkMap) return gbkMap
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gbk-map.json')
  gbkMap = JSON.parse(fs.readFileSync(file, 'utf8'))
  return gbkMap
}

export function encodeGbk(text) {
  const map = loadGbk()
  const out = []
  const bad = new Set()
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp < 0x80) { out.push(cp); continue }
    const hex = map[ch]
    if (!hex) { bad.add(ch); continue }
    out.push(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16))
  }
  if (bad.size) throw new Error(`GBK 无法编码这些字符: ${[...bad].join('')}`)
  return Buffer.from(out)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c === '\r') { /* skip */ }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''))
  return rows.slice(1).filter((r) => r.some((v) => v.trim() !== '')).map((r) => {
    const obj = {}
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
    return obj
  })
}

function buildSchedule(rows) {
  const tasks = new Map()
  const rels = []
  let line = 1
  for (const r of rows) {
    line++
    const code = r.task_code
    if (!code) continue
    if (!tasks.has(code)) {
      tasks.set(code, {
        code,
        name: r.task_name || code,
        type: (r.task_type || 'Task').trim(),
        days: Number(r.duration_days || 0),
        wbs: (r.wbs_path || '1').trim(),
        constraintType: (r.constraint_type || '').trim(),
        constraintDate: (r.constraint_date || '').trim(),
      })
    }
    if (r.predecessor_code) {
      rels.push({
        succ: code,
        pred: r.predecessor_code,
        type: (r.rel_type || 'FS').trim().toUpperCase(),
        lagDays: Number(r.lag_days || 0),
      })
    }
  }
  for (const [code, t] of tasks) {
    if (!Number.isFinite(t.days) || t.days < 0) throw new Error(`活动 ${code} 的 duration_days 非法`)
    if (t.type === 'Milestone') t.days = 0
  }
  for (const r of rels) {
    if (!tasks.has(r.pred)) throw new Error(`关系 ${r.succ}<-${r.pred}：前驱 ${r.pred} 不存在`)
    if (!tasks.has(r.succ)) throw new Error(`关系 ${r.pred}->${r.succ}：后继 ${r.succ} 不存在`)
    if (!['FS', 'SS', 'FF', 'SF'].includes(r.type)) throw new Error(`关系类型 ${r.type} 非法`)
  }
  return { tasks, rels }
}

function buildWbs(tasks, projId, projectName) {
  const paths = []
  const seen = new Set()
  for (const t of tasks.values()) {
    const parts = t.wbs.replace(/^\.+|\.+$/g, '').split('.')
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('.')
      if (!seen.has(p)) { seen.add(p); paths.push(p) }
    }
  }
  let id = ID.wbs
  const map = new Map()
  const rows = []
  for (const p of paths) {
    const parts = p.split('.')
    const name = parts[parts.length - 1]
    const root = parts.length === 1
    const parent = parts.length > 1 ? parts.slice(0, -1).join('.') : ''
    map.set(p, id)
    rows.push({
      id, seq: rows.length + 1, root,
      short: root ? '1' : p,
      name: root ? projectName : name,
      parent: parent ? map.get(parent) : '',
    })
    id++
  }
  const taskWbs = new Map()
  for (const t of tasks.values()) {
    const key = t.wbs.replace(/^\.+|\.+$/g, '')
    taskWbs.set(t.code, map.get(key) ?? rows[0]?.id)
  }
  return { rows, taskWbs }
}

function clampDate(d, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback
}

export function buildXer({ csvText, projectCode, projectName, projectStart = '2026-01-01' }) {
  const rows = parseCsv(csvText)
  const { tasks, rels } = buildSchedule(rows)
  if (!tasks.size) throw new Error('CSV 没有有效活动（task_code 为空）')
  const start = clampDate(projectStart, '2026-01-01')
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const today = new Date().toISOString().slice(0, 10)
  const projectId = ID.project
  const calId = ID.calendar
  const lines = []
  const R = (vals) => '%R\t' + vals.map((v) => (v === null || v === undefined ? '' : String(v))).join('\t')

  const clndrData = '(0||CalendarData()(    (0||DaysOfWeek()(' +
    [1, 2, 3, 4, 5, 6, 7].map((d) => `      (0||${d}()(        (0||0(s|08:00|f|12:00)())        (0||1(s|13:00|f|17:00)())))`).join('') +
    '))    (0||Exceptions()())))'

  lines.push(`ERMHDR\t7.0\t${today}\tProject\tadmin\tadmin\t\tProject Management\tUSD`)

  lines.push('%T\tOBS')
  lines.push('%F\tobs_id\tparent_obs_id\tguid\tseq_num\tobs_name\tobs_descr')
  lines.push(R([OBS_ID, null, null, 0, 'Enterprise', '<HTML><BODY></BODY></HTML>']))

  lines.push('%T\tPROJECT')
  lines.push('%F\tproj_id\tfy_start_month_num\trsrc_self_add_flag\tallow_complete_flag\trsrc_multi_assign_flag\tcheckout_flag\tproject_flag\tstep_complete_flag\tcost_qty_recalc_flag\tbatch_sum_flag\tname_sep_char\tdef_complete_pct_type\tproj_short_name\tacct_id\torig_proj_id\tsource_proj_id\tbase_type_id\tclndr_id\tsum_base_proj_id\ttask_code_base\ttask_code_step\tpriority_num\twbs_max_sum_level\tstrgy_priority_num\tlast_checksum\tcritical_drtn_hr_cnt\tdef_cost_per_qty\tlast_recalc_date\tplan_start_date\tplan_end_date\tscd_end_date\tadd_date\tlast_tasksum_date\tfcst_start_date\tdef_duration_type\ttask_code_prefix\tguid\tdef_qty_type\tadd_by_name\tweb_local_root_path\tproj_url\tdef_rate_type\tadd_act_remain_flag\tact_this_per_link_flag\tdef_task_type\tact_pct_link_flag\tcritical_path_type\ttask_code_prefix_flag\tdef_rollup_dates_flag\tuse_project_baseline_flag\trem_target_link_flag\treset_planned_flag\tallow_neg_act_flag\tsum_assign_level\tlast_fin_dates_id\tlast_baseline_update_date\tcr_external_key\tapply_actuals_date\tlocation_id\tloaded_scope_level\texport_flag\tnew_fin_dates_id\tbaselines_to_export\tbaseline_names_to_export\tnext_data_date\tclose_period_flag\tsum_refresh_date\ttrsrcsum_loaded')
  lines.push(R([
    projectId, 1, 'Y', 'Y', 'Y', 'N', 'Y', 'N', 'N', 'Y',
    '.', 'CP_Drtn', projectCode || projectName, null, null, null, null,
    calId, null, 1000, 10, 10, 2, 500,
    null, 0, 0.0, now, `${start} 08:00`, null,
    null, now, null, null,
    'DT_FixedDUR2', 'A', null, 'QT_Hour', 'admin',
    null, null, 'COST_PER_QTY', 'N', 'Y',
    'TT_Task', 'Y', 'CT_TotFloat', 'Y', 'Y', 'Y', 'Y',
    'N', 'N', 'SL_Taskrsrc',
    null, null, null, null, null,
    7, 'Y',
    null, null, null, null, null, null, null,
  ]))

  lines.push('%T\tCALENDAR')
  lines.push('%F\tclndr_id\tdefault_flag\tclndr_name\tproj_id\tbase_clndr_id\tlast_chng_date\tclndr_type\tday_hr_cnt\tweek_hr_cnt\tmonth_hr_cnt\tyear_hr_cnt\trsrc_private\tclndr_data')
  lines.push(R([calId, 'Y', '7Day-8h', null, null, now, 'CA_Base', HPD, HPD * 7, HPD * 30, HPD * 365, 'N', clndrData]))

  lines.push('%T\tSCHEDOPTIONS')
  lines.push('%F\tschedoptions_id\tproj_id\tsched_outer_depend_type\tsched_open_critical_flag\tsched_lag_early_start_flag\tsched_retained_logic\tsched_setplantoforecast\tsched_float_type\tsched_calendar_on_relationship_lag\tsched_use_expect_end_flag\tsched_progress_override\tlevel_float_thrs_cnt\tlevel_outer_assign_flag\tlevel_outer_assign_priority\tlevel_over_alloc_pct\tlevel_within_float_flag\tlevel_keep_sched_date_flag\tlevel_all_rsrc_flag\tsched_use_project_end_date_for_float\tenable_multiple_longest_path_calc\tlimit_multiple_longest_path_calc\tmax_multiple_longest_path\tuse_total_float_multiple_longest_paths\tkey_activity_for_multiple_longest_paths\tLevelPriorityList')
  lines.push(R([1, projectId, 'SD_Both', 'N', 'Y', 'Y', 'N', 'FT_FF', 'rcal_Predecessor', 'Y', 'N', 0, 'N', 5, 25, 'N', 'Y', 'Y', 'Y', 'N', 'Y', 10, 'Y', null, 'priority_type,ASC']))

  const wbs = buildWbs(tasks, projectId, projectName)
  lines.push('%T\tPROJWBS')
  lines.push('%F\twbs_id\tproj_id\tobs_id\tseq_num\test_wt\tproj_node_flag\tsum_data_flag\tstatus_code\twbs_short_name\twbs_name\tphase_id\tparent_wbs_id\tev_user_pct\tev_etc_user_value\torig_cost\tindep_remain_total_cost\tann_dscnt_rate_pct\tdscnt_period_type\tindep_remain_work_qty\tanticip_start_date\tanticip_end_date\tev_compute_type\tev_etc_compute_type\tguid\ttmpl_guid\tplan_open_state')
  for (const w of wbs.rows) {
    lines.push(R([w.id, projectId, OBS_ID, w.seq, 1, w.root ? 'Y' : 'N', 'N', 'WS_Open', w.short, w.name, null, w.parent, 6, 0.88, 0.0, 0.0, null, null, null, null, null, 'EC_Cmp_pct', 'EE_Rem_hr', null, null, null]))
  }

  const code2id = new Map()
  let tid = ID.task
  lines.push('%T\tTASK')
  lines.push('%F\ttask_id\tproj_id\twbs_id\tclndr_id\tphys_complete_pct\trev_fdbk_flag\test_wt\tlock_plan_flag\tauto_compute_act_flag\tcomplete_pct_type\ttask_type\tduration_type\tstatus_code\ttask_code\ttask_name\trsrc_id\ttotal_float_hr_cnt\tfree_float_hr_cnt\tremain_drtn_hr_cnt\tact_work_qty\tremain_work_qty\ttarget_work_qty\ttarget_drtn_hr_cnt\ttarget_equip_qty\tact_equip_qty\tremain_equip_qty\tcstr_date\tact_start_date\tact_end_date\tlate_start_date\tlate_end_date\texpect_end_date\tearly_start_date\tearly_end_date\trestart_date\treend_date\ttarget_start_date\ttarget_end_date\trem_late_start_date\trem_late_end_date\tcstr_type\tpriority_type\tsuspend_date\tresume_date\tfloat_path\tfloat_path_order\tguid\ttmpl_guid\tcstr_date2\tcstr_type2\tdriving_path_flag\tact_this_per_work_qty\tact_this_per_equip_qty\texternal_early_start_date\texternal_late_end_date\tcreate_date\tupdate_date\tcreate_user\tupdate_user\tlocation_id')
  for (const t of tasks.values()) {
    const isMs = t.type === 'Milestone'
    const drtn = isMs ? 0 : t.days * HPD
    const cstrDate = t.constraintDate && /^\d{4}-\d{2}-\d{2}$/.test(t.constraintDate) ? `${t.constraintDate} 08:00` : null
    lines.push(R([
      tid, projectId, wbs.taskWbs.get(t.code), calId,
      0, 'N', 1, 'N', 'N', 'CP_Drtn',
      isMs ? 'TT_FinMile' : 'TT_Task', 'DT_FixedDUR2', 'TK_NotStart',
      t.code, t.name, null,
      0, 0, drtn,
      0, 0, 0, drtn,
      0, 0, 0,
      cstrDate, null, null, null, null, null,
      null, null, null, null, null, null,
      null, null,
      t.constraintType || null, 'PT_Normal', null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      now, now, 'admin', 'admin', null,
    ]))
    code2id.set(t.code, tid)
    tid++
  }

  let pid = ID.taskpred
  lines.push('%T\tTASKPRED')
  lines.push('%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt\tfloat_path\taref\tarls')
  for (const r of rels) {
    lines.push(R([pid, code2id.get(r.succ), code2id.get(r.pred), projectId, projectId, `PR_${r.type}`, r.lagDays * HPD, null, null, null]))
    pid++
  }

  lines.push('')
  return { text: lines.join('\r\n'), tasks: tasks.size, relations: rels.length, wbs: wbs.rows.length }
}

export function writeXer({ csvPath, outPath, projectCode, projectName, projectStart }) {
  const csvText = fs.readFileSync(csvPath, 'utf8')
  const res = buildXer({ csvText, projectCode, projectName, projectStart })
  const buf = encodeGbk(res.text)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, buf)
  return { ...res, bytes: buf.length, outPath }
}
