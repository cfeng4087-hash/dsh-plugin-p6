// Stage edits into an exported P6 XML file. This is a surgical string edit:
// only the named <Activity> blocks and their target elements change, everything
// else stays byte-identical. Producing the file is all this module does — the
// import itself is a P6 GUI step in this P6 build.
import fs from 'node:fs'
import path from 'node:path'

export const STAGE_FIELDS = {
  name: { tag: 'Name', kind: 'text', label: '活动名称' },
  code: { tag: 'Id', kind: 'text', label: '活动代码' },
  act_start: { tag: 'ActualStartDate', kind: 'datetime', label: '实际开始' },
  act_finish: { tag: 'ActualFinishDate', kind: 'datetime', label: '实际完成' },
  target_start: { tag: 'PlannedStartDate', kind: 'datetime', label: '计划（目标）开始', unverified: true },
  target_finish: { tag: 'PlannedFinishDate', kind: 'datetime', label: '计划（目标）完成', unverified: true },
  physical_percent: { tag: 'PhysicalPercentComplete', kind: 'percent', label: '物理完成百分比' },
  remaining_duration: { tag: 'RemainingDuration', kind: 'number', label: '剩余工期（小时）' },
}

const BLOCK_RE = /<Activity\b[^>]*>[\s\S]*?<\/Activity>/g
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function readTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  if (m) return m[1]
  if (new RegExp(`<${tag}\\s*/>`).test(block)) return ''
  return null
}

function writeTag(block, tag, text, insertIndent) {
  const encoded = text === '' ? '' : escapeXml(text)
  const replacement = encoded === '' ? `<${tag} />` : `<${tag}>${encoded}</${tag}>`
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`)
  if (re.test(block)) return block.replace(re, replacement)
  if (new RegExp(`<${tag}\\s*/>`).test(block)) return block.replace(new RegExp(`<${tag}\\s*/>`), replacement)
  return block.replace(/<\/Activity>\s*$/, `${insertIndent}${replacement}\n${insertIndent.replace(/\t$/, '')}</Activity>`)
}

function validateValue(field, value) {
  const spec = STAGE_FIELDS[field]
  if (!spec) {
    throw new Error(`field "${field}" is not stageable. Allowed: ${Object.keys(STAGE_FIELDS).join(', ')}`)
  }
  if (value === null || value === undefined) throw new Error(`a value is required for "${field}" (use "" to clear)`)
  if (spec.kind === 'text') {
    const text = String(value)
    if (text.length > 2000) throw new Error(`value for "${field}" is too long`)
    return text
  }
  if (spec.kind === 'datetime') {
    const text = String(value).trim()
    if (text === '') return ''
    if (!DATETIME_RE.test(text)) {
      throw new Error(`"${field}" needs P6 datetime format YYYY-MM-DDTHH:MM:SS (got "${text}")`)
    }
    return text
  }
  if (spec.kind === 'percent') {
    const pct = Number(value)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error(`"${field}" needs a percentage between 0 and 100 (got "${value}")`)
    }
    // P6 XML stores PhysicalPercentComplete as a fraction: 0.35 == 35%.
    return String(pct / 100)
  }
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) throw new Error(`"${field}" needs a non-negative number (got "${value}")`)
  return String(num)
}

export function summarizeXml(file) {
  if (!fs.existsSync(file)) throw new Error(`XML not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8')
  const head = text.slice(0, 400)
  if (!head.includes('APIBusinessObjects') && !head.includes('<Project')) {
    throw new Error(`${path.basename(file)} does not look like a P6 XML export`)
  }
  const count = (re) => (text.match(re) ?? []).length
  const projectBlock = text.match(/<Project>[\s\S]*?<\/Project>/)
  const objectId = projectBlock?.[0].match(/<ObjectId>(\d+)<\/ObjectId>/)?.[1] ?? null
  const rawName = projectBlock?.[0].match(/<Name>([\s\S]*?)<\/Name>/)?.[1] ?? null
  const cleanText = (s) => s
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim()
  return {
    file,
    bytes: Buffer.byteLength(text, 'utf8'),
    projectId: objectId ? Number(objectId) : null,
    projectName: rawName ? cleanText(rawName) : null,
    activities: count(/<Activity\b/g),
    relationships: count(/<Relationship\b/g),
    assignments: count(/<ResourceAssignment\b/g),
    wbs: count(/<WBS\b/g),
  }
}

export function stageXml({ file, edits, outFile }) {
  const summary = summarizeXml(file)
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('edits must be a non-empty array of {activity, field, value}')
  let text = fs.readFileSync(file, 'utf8')
  const blocks = []
  for (const m of text.matchAll(BLOCK_RE)) blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  const byCode = new Map()
  for (const block of blocks) {
    const id = readTag(block.text, 'Id')
    if (id !== null) byCode.set(id, block)
  }
  const applied = []
  const touched = new Map()
  for (const edit of edits) {
    const code = String(edit.activity ?? '').trim()
    const field = String(edit.field ?? '').trim()
    if (!code) throw new Error('every edit needs an activity code')
    const block = byCode.get(code)
    if (!block) throw new Error(`activity "${code}" not found in ${path.basename(file)} (${byCode.size} activities)`)
    const value = validateValue(field, edit.value)
    const spec = STAGE_FIELDS[field]
    const before = readTag(block.text, spec.tag)
    if (before === null) throw new Error(`activity "${code}" has no <${spec.tag}> element to edit`)
    const afterBlock = writeTag(block.text, spec.tag, value, '        ')
    if (afterBlock === block.text) continue
    block.text = afterBlock
    const toPct = (v) => (v === '' || v === null ? '' : `${Math.round(Number(v) * 100000) / 1000}%`)
    applied.push({
      activity: code,
      field,
      label: spec.label,
      tag: spec.tag,
      before,
      after: value,
      beforeLabel: spec.kind === 'percent' ? toPct(before) : before,
      afterLabel: spec.kind === 'percent' ? `${Number(edit.value)}%` : value,
    })
    touched.set(code, block)
  }
  if (applied.length === 0) throw new Error('no edit produced a change')
  for (const block of [...touched.values()].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, block.start) + block.text + text.slice(block.end)
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, text, 'utf8')
  // read-back verification: every applied value must be present in its activity
  const check = fs.readFileSync(outFile, 'utf8')
  const afterBlocks = new Map()
  for (const m of check.matchAll(BLOCK_RE)) {
    const id = readTag(m[0], 'Id')
    if (id !== null) afterBlocks.set(id, m[0])
  }
  for (const change of applied) {
    const target = afterBlocks.get(change.activity)
    const actual = target === undefined ? null : readTag(target, change.tag)
    if (target === undefined || (actual ?? '') !== change.after) {
      throw new Error(`read-back check failed for ${change.activity}.${change.field}`)
    }
  }
  return { summary, outFile, bytes: fs.statSync(outFile).size, applied, verified: true }
}
