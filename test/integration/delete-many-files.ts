// this isn't for coverage.  it's basically a smoke test, to ensure that
// we can delete a lot of files on CI in multiple platforms and node versions.
import t, { Test } from 'tap'
import { readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { rimraf } from '../../src/index.js'
import { create, readdirRecursiveSync } from '../fixtures/create-files.js'

const cases = ['manual', 'moveRemove', 'posix', 'windows', 'native'] as const

const setup = (t: Test, name: (typeof cases)[number]) => {
  const path = join(t.testdir({}), 'test')
  const created = create(path)
  t.equal(statSync(path).isDirectory(), true, `dir created`)
  t.equal(created.length, readdirRecursiveSync(path).length)
  return {
    path,
    fnAsync: () => rimraf[name](path),
    fnSync: () => rimraf[name].sync(path),
    isEmpty: () => {
      t.throws(() => statSync(path), { code: 'ENOENT' }, 'fully removed')
      t.same(readdirSync(dirname(path)), [], 'no temp entries left behind')
    },
  }
}

for (const name of cases) {
  t.test(name, t => {
    t.test('async', async t => {
      const { fnAsync, isEmpty } = setup(t, name)
      await fnAsync()
      isEmpty()
    })

    t.test('sync', t => {
      const { fnSync, isEmpty } = setup(t, name)
      fnSync()
      isEmpty()
      t.end()
    })

    t.end()
  })
}
