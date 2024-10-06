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
  let count = 0
  const cwd = t.testdir()

  const letters = (length: number) =>
    Array.from({ length }).map((_, i) => (10 + i).toString(36))

  const deepestDir = join(...letters(depth))
  const files = letters(fileCount).map(f => `file_${f}`)

  const dirs = deepestDir
    .split(sep)
    .reduce<string[]>((acc, d) => acc.concat(join(acc.at(-1) ?? '', d)), [])

  const expected = dirs.flatMap(d => [d, ...files.map(f => join(d, f))])

  return {
    next: () => {
      if (count === iterations) {
        return false
      }
      count += 1
      return true
    },
    cwd,
    expected,
    writeFixtures: () => {
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
      return globSync('**/*', { cwd }).sort(() => 0.5 - Math.random())
    },
  }
}

// Copied from sindresorhus/del since it was reported in https://github.com/isaacs/rimraf/pull/314
// that this test would throw EPERM errors consistently in Windows CI environments.
// https://github.com/sindresorhus/del/blob/chore/update-deps/test.js#L116
t.test('windows does not throw EPERM', async t => {
  const { next, cwd, expected, writeFixtures } = setup(
    t,
    process.env.CI ?
      {
        iterations: 1000,
        depth: 10,
        files: 10,
        fileKb: 10,
      }
    : {
        iterations: 200,
        depth: 7,
        files: 1,
        fileKb: 0,
      },
  )

  while (next()) {
    const toDelete = writeFixtures()

    // throw instead of using tap assertions to cut down on output
    // when running many iterations
    assert(
      arrSame(toDelete, expected),
      new Error(`glob result is not expected`, {
        cause: {
          found: toDelete,
          wanted: expected,
        },
      }),
    )

    const notDeleted = (
      await Promise.all(
        toDelete.map(d =>
          windows(join(cwd, d), { glob: false }).then(r => [d, r] as const),
        ),
      )
    ).filter(([, v]) => v !== true)
    assert(
      !notDeleted.length,
      new Error(`some entries were not deleted`, {
        cause: {
          found: notDeleted,
        },
      }),
    )

    assert(!readdirSync(cwd).length, new Error(`dir is not empty`))
  }
})
