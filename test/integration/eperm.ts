import { mkdirSync, readdirSync } from 'fs'
import { resolve, sep } from 'path'
import { glob } from 'glob'
import t from 'tap'
import { rimraf } from '../../src/index.js'

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments. I'm not sure
// how much of the test structure is relevant to the error but I've copied it as closely as possible.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('does not throw EPERM - async', async t => {
  const dir = t.testdir()
  const nested = resolve(dir, 'a/b/c/nested.js')
  const totalAttempts = 200

  let count = 0
  while (count !== totalAttempts) {
    mkdirSync(nested, { recursive: true })
    const entries = []
    for (const entry of await glob('**/*', { cwd: dir, dot: true }).then(r =>
      r.sort((a, b) => b.localeCompare(a)),
    )) {
      await rimraf(resolve(dir, entry), { glob: false })
      entries.push(entry)
    }
    t.strictSame(
      entries,
      ['a/b/c/nested.js', 'a/b/c', 'a/b', 'a'].map(p => p.replaceAll('/', sep)),
    )

    count += 1
  }

  t.strictSame(readdirSync(dir), [])
  t.equal(count, totalAttempts)
})
