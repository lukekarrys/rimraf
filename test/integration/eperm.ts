import t, { Test } from 'tap'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { sep, join } from 'path'
import { globSync } from 'glob'
import { windows } from '../../src/index.js'
import { randomBytes } from 'crypto'
import assert from 'assert'

const arrSame = (arr1: string[], arr2: string[]) => {
  const s = (a: string[]) => [...a].sort().join(',')
  return s(arr1) === s(arr2)
}

const setup = (
  t: Test,
  {
    iterations,
    depth,
    files: fileCount,
    fileKb,
  }: {
    iterations: number
    depth: number
    files: number
    fileKb: number
  },
) => {
  const letters = (length: number) =>
    Array.from({ length }).map((_, i) => (10 + i).toString(36))
  const files = letters(fileCount).map(f => `file_${f}`)
  const dirs = join(...letters(depth))
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])
  const entries = dirs.flatMap(d => [d, ...files.map(f => join(d, f))])

  const cwd = t.testdir()
  let iteration = 0

  return [
    cwd,
    function* () {
      while (iteration !== iterations) {
        iteration += 1

        // use custom error to throw instead of using tap assertions to cut down on output
        // when running many iterations
        class RunError extends Error {
          constructor(message: string, c?: Record<string, unknown>) {
            super(message, {
              cause: {
                iteration,
                ...c,
              },
            })
          }
        }

        mkdirSync(join(cwd, dirs.at(-1)!), { recursive: true })
        for (const dir of dirs) {
          for (const f of files) {
            writeFileSync(join(cwd, dir, f), randomBytes(1024 * fileKb))
          }
        }

        // randomize results from glob so that when running Promise.all(rimraf)
        // on the result it will potentially delete parent directories before
        // child directories and their files. This seems to make EPERM errors
        // more likely on Windows.
        const matches = globSync('**/*', { cwd }).sort(
          () => 0.5 - Math.random(),
        )

        assert(
          arrSame(matches, entries),
          new RunError(`glob result does not match expected`, {
            found: matches,
            wanted: entries,
          }),
        )

        yield [matches.map(m => join(cwd, m)), RunError] as const
      }

      return [iteration, iterations] as const
    },
  ] as const
}

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('windows does not throw EPERM', async t => {
  const [cwd, run] = setup(
    t,
    process.env.CI ?
      {
        iterations: 1000,
        depth: 15,
        files: 7,
        fileKb: 100,
      }
    : {
        iterations: 200,
        depth: 8,
        files: 3,
        fileKb: 10,
      },
  )

  let i
  const r = run()
  while ((i = r.next())) {
    if (i.done) {
      i = i.value
      break
    }

    const [matches, RunError] = i.value

    const notDeleted = (
      await Promise.all(
        matches.map(path =>
          windows(path)
            .then(deleted => ({ path, deleted }))
            .catch(error => {
              throw new RunError(`rimraf.windows error`, { error, path })
            }),
        ),
      )
    ).filter(({ deleted }) => deleted !== true)
    assert(
      !notDeleted.length,
      new RunError(`some entries were not deleted`, {
        found: notDeleted,
      }),
    )

    const actual = readdirSync(cwd)
    assert(
      !actual.length,
      new RunError(`dir is not empty`, {
        actual,
      }),
    )
  }

  t.equal(i[0], i[1], `ran all ${i[1]} iterations`)
})
