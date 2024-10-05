import t from 'tap'
import { mkdirSync, readdirSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { rimraf } from '../../src/index.js'

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments. I'm not sure
// how much of the test structure is relevant to the error but I've copied it as closely as possible.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('does not throw EPERM - async', async t => {
  const iterations = 200
  const depth = 7

  const dir = t.testdir()
  const nested = join(
    ...new Array(depth).fill(0).map((_, i) => (10 + i).toString(36)),
  )
  const expected = nested
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])

  let count = 0
  while (count !== iterations) {
    mkdirSync(join(dir, nested), { recursive: true })
    const del = globSync('**/*', { cwd: dir, dot: true }).sort(
      () => 0.5 - Math.random(),
    )
    await Promise.all(del.map(d => rimraf(join(dir, d), { glob: false })))
    t.strictSame(
      del.sort((a, b) => a.localeCompare(b, 'en')),
      expected,
    )
    count += 1
  }

  t.strictSame(readdirSync(dir), [])
  t.equal(count, iterations)
})
