import { mkdirSync, readdirSync, realpathSync } from 'fs'
import { sep, join } from 'path'
import { glob } from 'glob'
import t from 'tap'
import os from 'node:os'
import { rimraf } from '../../src/index.js'
import { randomBytes } from 'crypto'

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments. I'm not sure
// how much of the test structure is relevant to the error but I've copied it as closely as possible.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('does not throw EPERM - async', async t => {
  const dir = join(
    realpathSync(os.tmpdir()),
    `_${randomBytes(6).toString('hex')}`,
  )
  const nested = join('a/b/c/d/e/f/g')
  const expected = nested
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])
  const totalAttempts = 200

  let count = 0
  while (count !== totalAttempts) {
    mkdirSync(join(dir, nested), { recursive: true })
    const entries = await glob('**/*', { cwd: dir, dot: true })
    await Promise.all(entries.map(e => rimraf(join(dir, e), { glob: false })))
    t.strictSame(entries, expected)
    count += 1
  }

  t.strictSame(readdirSync(dir), [])
  t.equal(count, totalAttempts)
})
