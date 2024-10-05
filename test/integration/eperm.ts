import t from 'tap'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { windows } from '../../src/index.js'
import { randomBytes } from 'crypto'

const sort = (arr: string[]) =>
  [...arr].sort((a, b) => a.localeCompare(b, 'en'))
const letters = (d: number) =>
  new Array(d).fill(0).map((_, i) => (10 + i).toString(36))

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('windows does not throw EPERM', async t => {
  const iterations = 200
  const dirDepth = 7
  const fileCount = 10
  const fileSizeMb = 0.1

  const cwd = t.testdir()
  const nested = join(...letters(dirDepth))
  const files = letters(fileCount).map(f => `file_${f}`)
  const dirs = nested
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])
  const expected = sort(dirs.flatMap(d => [d, ...files.map(f => join(d, f))]))

  let count = 0
  while (count !== iterations) {
    mkdirSync(join(cwd, nested), { recursive: true })
    for (const dir of dirs) {
      for (const f of files) {
        writeFileSync(join(cwd, dir, f), randomBytes(1024 * 1024 * fileSizeMb))
      }
    }

    const del = globSync('**/*', { cwd }).sort(() => 0.5 - Math.random())
    t.strictSame(sort(del), expected)
    t.strictSame(
      await Promise.all(del.map(d => windows(join(cwd, d), { glob: false }))),
      new Array(del.length).fill(true),
    )

    t.strictSame(readdirSync(cwd), [])
    count += 1
  }
  t.equal(count, iterations)
})
