import t, { Test } from 'tap'
import { readdirSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'
import assert from 'assert'
import { create } from '../fixtures/create-files.js'

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
  const iterations =
    process.env?.RIMRAF_TEST_EPERM_ITERATIONS ?
      +process.env.RIMRAF_TEST_EPERM_ITERATIONS
    : isWinCI ? 1000
    : 100

  const dir = t.testdir()
  const readdir = () => readdirSync(dir)

  let iteration = 0
  const start = Date.now()
  let previous = start

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
      const entries = create(dir)
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
          found: matches.length,
          wanted: entries.length,
        }),
      )

      iteration += 1
      yield {
        matches,
        error: (error: unknown, path: string) =>
          new RunError('rimraf error', { path, error }),
        assertResult: (result: [string, boolean][]) => {
          assert(
            result.length === entries.length,
            new RunError(`result is missing entries`, {
              found: result.length,
              wanted: entries.length,
            }),
          )
          const notDeleted = result.filter(v => v[1] !== true)
          assert(
            !notDeleted.length,
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
