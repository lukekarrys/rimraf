import t from 'tap'
import { mkdirSync, readdirSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { rimraf } from '../../src/index.js'

const rando = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random())
const sortAlpha = (arr: string[]) =>
  [...arr].sort((a, b) => a.localeCompare(b, 'en'))

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('does not throw EPERM', async t => {
  const iterations = 200
  const depth = 7
  const cwd = t.testdir()
  const nested = join(
    ...new Array(depth).fill(0).map((_, i) => (10 + i).toString(36)),
  )
  const expected = nested
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])

  let count = 0
  while (count !== iterations) {
    mkdirSync(join(cwd, nested), { recursive: true })
    const del = rando(globSync('**/*', { cwd }))
    try {
      await Promise.all(del.map(d => rimraf(join(cwd, d), { glob: false })))
    } catch (e) {
      console.error(e)
      throw e
    }
    t.strictSame(sortAlpha(del), expected)
    count += 1
  }
  t.strictSame(readdirSync(cwd), [])
  t.equal(count, iterations)
})
