// P6's own import/export CLI. Only export is used: it is the one channel this
// build was observed to complete headlessly. Every invocation logs in, so the
// database gains one USESSION row and PROJSHAR rows for the opened projects.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { sha256File, withDb, all, one } from './p6db.js'

const P6_ROOT = 'C:\\Program Files\\Oracle\\Primavera P6\\P6 Professional'

export function findInstall(config = {}) {
  const explicit = config.p6Dir
  if (explicit) {
    const exe = path.join(explicit, 'Primavera.ImportExport.exe')
    if (!fs.existsSync(exe)) throw new Error(`Primavera.ImportExport.exe not found in ${explicit}`)
    return explicit
  }
  if (!fs.existsSync(P6_ROOT)) throw new Error(`P6 Professional is not installed at ${P6_ROOT}`)
  const versions = fs.readdirSync(P6_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((v) => fs.existsSync(path.join(P6_ROOT, v, 'Primavera.ImportExport.exe')))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  if (versions.length === 0) throw new Error(`no Primavera.ImportExport.exe under ${P6_ROOT}`)
  return path.join(P6_ROOT, versions[0])
}

export function readBootstrapAliases() {
  const base = path.join(process.env.APPDATA || '', 'Oracle', 'Primavera P6', 'P6 Professional')
  if (!fs.existsSync(base)) return []
  const out = []
  for (const version of fs.readdirSync(base)) {
    const file = path.join(base, version, 'prmbootstrapV2.xml')
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const blocks = text.match(/<Alias>[\s\S]*?<\/Alias>/g) ?? []
    for (const block of blocks) {
      const pick = (tag) => {
        const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
        return m ? m[1].trim() : ''
      }
      out.push({
        version,
        file,
        name: pick('Name'),
        database: pick('DataBase'),
        driver: pick('DriverName'),
      })
    }
  }
  return out
}

export function aliasFor(dbPath, config = {}) {
  if (config.alias) return config.alias
  const aliases = readBootstrapAliases()
  const hit = aliases.find((a) => path.resolve(a.database).toLowerCase() === path.resolve(dbPath).toLowerCase())
  return hit?.name || 'New_Connection'
}

export function passwordHash(db, user = 'ADMIN') {
  const row = one(db, 'select PASSWD as passwd, USER_NAME as name from USERS where upper(USER_NAME) = upper(?)', [user])
  if (!row) {
    const names = all(db, 'select USER_NAME as name from USERS').map((r) => r.name).join(', ')
    throw new Error(`P6 user "${user}" not found; users: ${names}`)
  }
  if (!row.passwd) throw new Error(`P6 user "${user}" has an empty password hash`)
  return row.passwd
}

export function backupDb(dbPath, backupDir, keep = 10) {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const dest = path.join(backupDir, `PPMDBSQLite_${stamp}.db`)
  fs.rmSync(dest, { force: true })
  let method = 'copy'
  try {
    // Consistent snapshot even while P6 holds the WAL: VACUUM INTO reads a
    // read-only connection and writes one consolidated file.
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    method = 'vacuum'
  } catch {
    fs.rmSync(dest, { force: true })
    fs.copyFileSync(dbPath, dest)
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, dest + suffix)
    }
  }
  const hash = sha256File(dest)
  const backups = fs.readdirSync(backupDir).filter((f) => /^PPMDBSQLite_.*\.db$/.test(f)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    fs.rmSync(path.join(backupDir, old), { force: true })
    for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(backupDir, old + suffix), { force: true })
  }
  return { path: dest, bytes: fs.statSync(dest).size, sha256: hash, method }
}

function mercuryTail(lines = 12) {
  const file = path.join(os.tmpdir(), 'Mercury.log')
  if (!fs.existsSync(file)) return []
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-lines)
  } catch {
    return []
  }
}

function runProcess(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, elapsedMs: Date.now() - started, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish({ code: null, timedOut: true })
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })
    child.on('error', (err) => finish({ code: null, error: err.message }))
    child.on('close', (code) => finish({ code, timedOut: false }))
  })
}

export async function exportProject({ dbPath, projectId, outPath, config = {} }) {
  const installDir = findInstall(config)
  const exe = path.join(installDir, 'Primavera.ImportExport.exe')
  const alias = aliasFor(dbPath, config)
  const user = config.user || 'ADMIN'
  const hash = withDb(dbPath, (db) => passwordHash(db, user))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.rmSync(outPath, { force: true })
  const args = [
    `/alias=${alias}`,
    '/language=en',
    `/username=${user}`,
    `/password=${hash}`,
    `export.projectid=${projectId}`,
    'importexport.mode=Export',
    `importexport.filepath=${outPath}`,
    'hideui=Y',
  ]
  const result = await runProcess(exe, args, Number(config.exportTimeoutMs) || 180000)
  const exists = fs.existsSync(outPath)
  const size = exists ? fs.statSync(outPath).size : 0
  const head = exists ? fs.readFileSync(outPath, { encoding: 'utf8' }).slice(0, 120) : ''
  const ok = result.code === 0 && size > 0 && head.includes('<')
  return {
    ok,
    ...result,
    outPath,
    bytes: size,
    alias,
    user,
    installDir,
    head: head.replace(/\s+/g, ' ').trim(),
    mercury: ok ? [] : mercuryTail(14),
  }
}
