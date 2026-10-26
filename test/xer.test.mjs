import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildXer, encodeGbk, writeXer } from '../lib/p6xer.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CSV = path.join(ROOT, 'examples', 'demo.csv')

test('GBK encoder handles Chinese and ASCII', () => {
  const buf = encodeGbk('项目')
  assert.equal(buf.length, 4)
  assert.notDeepEqual(buf, Buffer.from('项目', 'utf8'))
  assert.equal(encodeGbk('ABC').toString('hex'), '414243')
})

test('demo CSV produces the seven XER tables', () => {
  const res = buildXer({
    csvText: fs.readFileSync(CSV, 'utf8'),
    projectCode: 'DEMO-01',
    projectName: '演示项目',
    projectStart: '2027-01-10',
  })
  const tables = [...res.text.matchAll(/^%T\t(\w+)$/gm)].map((m) => m[1])
  assert.deepEqual(tables, ['OBS', 'PROJECT', 'CALENDAR', 'SCHEDOPTIONS', 'PROJWBS', 'TASK', 'TASKPRED'])
  assert.ok(res.text.startsWith('ERMHDR\t7.0\t'))
  assert.equal(res.tasks, 11)
  assert.equal(res.relations, 10)
  assert.ok(res.text.includes('%F\ttask_id\tproj_id\twbs_id'))
  assert.ok(res.text.includes('PR_SS'))
})

test('written XER is GBK, not UTF-8', () => {
  const out = path.join(ROOT, 'examples', '.demo.test.xer')
  const res = writeXer({
    csvPath: CSV,
    outPath: out,
    projectCode: 'DEMO-01',
    projectName: '演示项目',
    projectStart: '2027-01-10',
  })
  const raw = fs.readFileSync(out)
  fs.rmSync(out, { force: true })
  const text = raw.toString('latin1')
  assert.ok(!text.includes('演示项目')) // UTF-8 bytes would appear here as latin1
  assert.equal(raw.length, res.bytes)
  assert.ok(raw.length > 1000)
})
