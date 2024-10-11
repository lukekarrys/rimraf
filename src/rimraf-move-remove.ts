// https://youtu.be/uhRWMGBjlO8?t=537
//
// 1. readdir
// 2. for each entry
//   a. if a non-empty directory, recurse
//   b. if an empty directory, move to random hidden file name in $TEMP
//   c. unlink/rmdir $TEMP
//
// This works around the fact that unlink/rmdir is non-atomic and takes
// a non-deterministic amount of time to complete.
//
// However, it is HELLA SLOW, like 2-10x slower than a naive recursive rm.

import { basename, parse, resolve } from 'path'
import { defaultTmp, defaultTmpSync } from './default-tmp.js'
import { ignoreENOENT, ignoreENOENTSync } from './ignore-enoent.js'
import * as FS from './fs.js'
import { Dirent, Stats } from 'fs'
import { RimrafAsyncOptions, RimrafSyncOptions } from './index.js'
import { readdirOrError, readdirOrErrorSync } from './readdir-or-error.js'
import { fixEPERM, fixEPERMSync } from './fix-eperm.js'
import { errorCode } from './error.js'
import * as retry from './retry-busy.js'

type Tmp<T extends RimrafAsyncOptions | RimrafSyncOptions> = T & {
  tmp: string
}

// crypto.randomBytes is much slower, and Math.random() is enough here
const uniqueName = (path: string, tmp: string) =>
  resolve(tmp, `.${basename(path)}.${Math.random()}`)

// On windows use a version of the retry that treats EPERM as a busy code
/* c8 ignore start */
const isWin = process.platform === 'win32'
const fsCodes = isWin ? new Set(['EPERM']) : undefined
const codes = fsCodes ? new Set([...retry.codes, ...fsCodes]) : retry.codes
const retryEPERM: retry.RetryBusy = fn =>
  fsCodes ? retry.retryBusy(fn, fsCodes) : fn
const retryEPERMSync: retry.RetryBusySync = fn =>
  fsCodes ? retry.retryBusySync(fn, fsCodes) : fn
/* c8 ignore stop */

const retryBusy: retry.RetryBusy = fn => retry.retryBusy(fn, codes)
const retryBusySync: retry.RetryBusySync = fn => retry.retryBusySync(fn, codes)

// unlink and rmdir and always retryable regardless of platform
const unlink = retryBusy(fixEPERM(FS.promises.unlink))
const unlinkSync = retryBusySync(fixEPERMSync(FS.unlinkSync))
const rmdir = retryBusy(fixEPERM(FS.promises.rmdir))
const rmdirSync = retryBusySync(fixEPERMSync(FS.rmdirSync))

// other fs functions are only retried for EPERM and only on windows
const rename = retryEPERM(
  async (path: string, opt: Tmp<RimrafAsyncOptions>) => {
    const newPath = uniqueName(path, opt.tmp)
    await FS.promises.rename(path, newPath)
    return newPath
  },
)
const renameSync = retryEPERMSync(
  (path: string, opt: Tmp<RimrafSyncOptions>) => {
    const newPath = uniqueName(path, opt.tmp)
    FS.renameSync(path, newPath)
    return newPath
  },
)
const readdir = retryEPERM(readdirOrError)
const readdirSync = retryEPERMSync(readdirOrErrorSync)
const lstat = retryEPERM(FS.promises.lstat)
const lstatSync = retryEPERMSync(FS.lstatSync)

export const rimrafMoveRemove = async (
  path: string,
  { tmp, ...opt }: RimrafAsyncOptions,
) => {
  opt?.signal?.throwIfAborted()

  tmp ??= await defaultTmp(path)
  if (path === tmp && parse(path).root !== path) {
    throw new Error('cannot delete temp directory used for deletion')
  }

  return (
    (await ignoreENOENT(
      lstat(path, opt).then(stat =>
        rimrafMoveRemoveDir(path, { ...opt, tmp }, stat),
      ),
    )) ?? true
  )
}

export const rimrafMoveRemoveSync = (
  path: string,
  { tmp, ...opt }: RimrafSyncOptions,
) => {
  opt?.signal?.throwIfAborted()

  tmp ??= defaultTmpSync(path)
  if (path === tmp && parse(path).root !== path) {
    throw new Error('cannot delete temp directory used for deletion')
  }

  return (
    ignoreENOENTSync(() =>
      rimrafMoveRemoveDirSync(path, { ...opt, tmp }, lstatSync(path, opt)),
    ) ?? true
  )
}

const rimrafMoveRemoveDir = async (
  path: string,
  opt: Tmp<RimrafAsyncOptions>,
  ent: Dirent | Stats,
): Promise<boolean> => {
  opt?.signal?.throwIfAborted()

  const entries = ent.isDirectory() ? await readdir(path, opt) : null
  if (!Array.isArray(entries)) {
    // this can only happen if lstat/readdir lied, or if the dir was
    // swapped out with a file at just the right moment.
    /* c8 ignore start */
    if (entries) {
      if (errorCode(entries) === 'ENOENT') {
        return true
      }
      if (errorCode(entries) !== 'ENOTDIR') {
        throw entries
      }
    }
    /* c8 ignore stop */
    if (opt.filter && !(await opt.filter(path, ent))) {
      return false
    }
    await ignoreENOENT(rename(path, opt).then(p => unlink(p, opt)))
    return true
  }

  const removedAll = (
    await Promise.all(
      entries.map(ent =>
        rimrafMoveRemoveDir(resolve(path, ent.name), opt, ent),
      ),
    )
  ).every(v => v === true)
  if (!removedAll) {
    return false
  }

  // we don't ever ACTUALLY try to unlink /, because that can never work
  // but when preserveRoot is false, we could be operating on it.
  // No need to check if preserveRoot is not false.
  if (opt.preserveRoot === false && path === parse(path).root) {
    return false
  }
  if (opt.filter && !(await opt.filter(path, ent))) {
    return false
  }
  await ignoreENOENT(rename(path, opt).then(p => rmdir(p, opt)))
  return true
}

const rimrafMoveRemoveDirSync = (
  path: string,
  opt: Tmp<RimrafSyncOptions>,
  ent: Dirent | Stats,
): boolean => {
  opt?.signal?.throwIfAborted()

  const entries = ent.isDirectory() ? readdirSync(path, opt) : null
  if (!Array.isArray(entries)) {
    // this can only happen if lstat/readdir lied, or if the dir was
    // swapped out with a file at just the right moment.
    /* c8 ignore start */
    if (entries) {
      if (errorCode(entries) === 'ENOENT') {
        return true
      }
      if (errorCode(entries) !== 'ENOTDIR') {
        throw entries
      }
    }
    /* c8 ignore stop */
    if (opt.filter && !opt.filter(path, ent)) {
      return false
    }
    ignoreENOENTSync(() => unlinkSync(renameSync(path, opt), opt))
    return true
  }

  let removedAll = true
  for (const ent of entries) {
    const p = resolve(path, ent.name)
    removedAll = rimrafMoveRemoveDirSync(p, opt, ent) && removedAll
  }
  if (!removedAll) {
    return false
  }
  if (opt.preserveRoot === false && path === parse(path).root) {
    return false
  }
  if (opt.filter && !opt.filter(path, ent)) {
    return false
  }
  ignoreENOENTSync(() => rmdirSync(renameSync(path, opt), opt))
  return true
}
