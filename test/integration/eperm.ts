import t, { Test } from 'tap'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { windows, windowsSync } from '../../src/index.js'
import { randomBytes } from 'crypto'
import assert from 'assert'

const setup = (t: Test) => {
  const [iterations, depth, fileCount, fileKb] =
    process.env.CI && process.platform === 'win32' ?
      [1000, 15, 7, 100]
    : [200, 8, 3, 10]

  t.plan(10)
  const dir = t.testdir()
  const readdir = () => readdirSync(dir)

  const letters = (length: number) =>
    Array.from({ length }).map((_, i) => (10 + i).toString(36))
  const files = letters(fileCount).map(f => `_file_${f}`)
  const dirs = join(...letters(depth))
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])
  const entries = dirs
    .flatMap(d => [d, ...files.map(f => join(d, f))])
    .map(d => join(dir, d))

  let iteration = 0
  let previous = Date.now()
  const start = Date.now()

  return function* () {
    while (iteration !== iterations) {
      // use custom error to throw instead of using tap assertions to cut down
      // on output when running many iterations
      class RunError extends Error {
        constructor(message: string, c?: Record<string, unknown>) {
          super(message, {
            cause: {
              testName: t.name,
              iteration,
              ...c,
            },
          })
        }
      }

      const assertContents = (expected: boolean = false) => {
        const found = readdir()
        assert(
          Boolean(found.length) === expected,
          new RunError(`invalid dir contents`, { found, expected }),
        )
      }

      assertContents()
      mkdirSync(join(dir, dirs.at(-1)!), { recursive: true })
      for (const d of dirs) {
        for (const f of files) {
          writeFileSync(join(dir, d, f), randomBytes(1024 * fileKb))
        }
      }
      assertContents(true)

      // randomize results from glob so that when running Promise.all(rimraf)
      // on the result it will potentially delete parent directories before
      // child directories and their files. This seems to make EPERM errors
      // more likely on Windows.
      const matches = globSync('**/*', { cwd: dir })
        .sort(() => 0.5 - Math.random())
        .map(m => join(dir, m))

      assert(
        [...matches].sort().join() === [...entries].sort().join(),
        new RunError(`glob result does not match expected`, {
          found: matches,
          wanted: entries,
        }),
      )

      iteration += 1
      yield {
        matches,
        error: (error: unknown, path: string) =>
          new RunError('rimraf error', { path, error }),
        assertResult: (result: [string, boolean][]) => {
          assert(
            result.length === dirs.length * (files.length + 1),
            new RunError(`result is missing entries`, {
              found: result,
            }),
          )
          const notDeleted = result.filter(v => v[1] !== true)
          assert(
            notDeleted.length === 0,
            new RunError(`some entries were not deleted`, {
              found: notDeleted,
            }),
          )
          assertContents()
          if (iteration % (iterations / 10) === 0) {
            const now = Date.now()
            t.ok(true, `${iteration} (${now - previous}ms / ${now - start}ms)`)
            previous = now
          }
        },
      }
    }

    t.end()
  }
}

// Copied from sindresorhus/del since it was reported in
// https://github.com/isaacs/rimraf/pull/314 that this test would throw EPERM
// errors consistently in Windows CI environments.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('windows does not throw EPERM', t => {
  t.test('sync', t => {
    for (const { matches, error, assertResult } of setup(t)()) {
      assertResult(
        matches.map(path => {
          try {
            return [path, windowsSync(path)]
          } catch (er) {
            throw error(er, path)
          }
        }),
      )
    }
  })

  t.test('async', async t => {
    for (const { matches, error, assertResult } of setup(t)()) {
      assertResult(
        await Promise.all(
          matches.map(async path => {
            try {
              return [path, await windows(path)]
            } catch (er) {
              throw error(er, path)
            }
          }),
        ),
      )
    }
  })

  t.end()
})
