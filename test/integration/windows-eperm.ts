import t, { Test } from 'tap'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { randomBytes } from 'crypto'
import assert from 'assert'

const isWinCI = process.env.CI && process.platform === 'win32'

const mockWindows = async (t: Test) => {
  const { rimrafWindows, rimrafWindowsSync } = (await t.mockImport(
    '../../src/rimraf-windows.js',
  )) as typeof import('../../src/rimraf-windows.js')
  return {
    rimraf: (path: string) => rimrafWindows(path, {}),
    rimrafSync: (path: string) => rimrafWindowsSync(path, {}),
  }
}
const setup = (t: Test) => {
  const depth = 10
  const fileCount = 7
  const fileKb = 100
  const iterations =
    process.env?.RIMRAF_TEST_EPERM_ITERATIONS ?
      +process.env.RIMRAF_TEST_EPERM_ITERATIONS
    : isWinCI ? 1000
    : 100

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
  t.test('sync', async t => {
    t.plan(10)
    const { rimrafSync } = await mockWindows(t)
    for (const { matches, error, assertResult } of setup(t)()) {
      assertResult(
        matches.map(path => {
          try {
            return [path, rimrafSync(path)]
          } catch (er) {
            throw error(er, path)
          }
        }),
      )
    }
  })

  t.test('async', async t => {
    t.plan(10)
    const { rimraf } = await mockWindows(t)
    for (const { matches, error, assertResult } of setup(t)()) {
      assertResult(
        await Promise.all(
          matches.map(async path => {
            try {
              return [path, await rimraf(path)]
            } catch (er) {
              throw error(er, path)
            }
          }),
        ),
      )
    }
  })

  if (isWinCI) {
    t.test('async error', async t => {
      t.intercept(process, 'platform', { value: 'posix' })
      const { rimraf } = await mockWindows(t)
      let error = null
      try {
        for (const { matches, error, assertResult } of setup(t)()) {
          assertResult(
            await Promise.all(
              matches.map(async path => {
                try {
                  return [path, await rimraf(path)]
                } catch (er) {
                  throw error(er, path)
                }
              }),
            ),
          )
        }
      } catch (e) {
        error = e
      }
      t.comment(error)
    })
  }

  t.end()
})
