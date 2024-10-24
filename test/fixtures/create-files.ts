import { randomBytes } from 'crypto'
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

// run with RIMRAF_TEST_START_CHAR/_END_CHAR/_DEPTH environs to
// make this more or less aggressive.
function getEnv(name: string, def: string): string
function getEnv(name: string, def: number): number
function getEnv(name: string, def: string | number): string | number {
  const value = process.env[`RIMRAF_TEST_${name}`] ?? def.toString()
  return typeof def === 'number' ? +value : value
}
const START = getEnv('START_CHAR', 'a').charCodeAt(0)
const END = getEnv('END_CHAR', 'f').charCodeAt(0)
const DEPTH = getEnv('DEPTH', 4)
const BYTES = randomBytes(1024 * getEnv('KB_SIZE', 0))

export const create = (path: string, depth = 0, created: string[] = []) => {
  mkdirSync(path, { recursive: true })
  for (let i = START; i <= END; i++) {
    const c = String.fromCharCode(i)
    if (depth < DEPTH && i - START >= depth) {
      const dir = resolve(path, c)
      created.push(dir)
      create(dir, depth + 1, created)
    } else {
      const f = resolve(path, `_file_${c}`)
      created.push(f)
      writeFileSync(f, BYTES)
    }
  }
  return created.sort()
}

export const readdirRecursiveSync = (dir: string, entries: string[] = []) => {
  for (const file of readdirSync(dir)) {
    const path = join(dir, file)
    if (statSync(path).isDirectory()) {
      readdirRecursiveSync(path, entries)
    }
    entries.push(path)
  }
  return entries
}
