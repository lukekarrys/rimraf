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
import { lstatSync, promises, renameSync, rmdirSync, unlinkSync } from './fs.js'
import { Dirent, Stats } from 'fs'
import { RimrafAsyncOptions, RimrafSyncOptions } from './index.js'
import { readdirOrError, readdirOrErrorSync } from './readdir-or-error.js'
import { fixEPERM, fixEPERMSync } from './fix-eperm.js'
import { errorCode } from './error.js'
import * as retry from './retry-busy.js'
const { lstat, rename, unlink, rmdir } = promises

type RimrafAsyncOptionsTmp = RimrafAsyncOptions & { tmp: string }
type RimrafSyncOptionsTmp = RimrafSyncOptions & { tmp: string }

// crypto.randomBytes is much slower, and Math.random() is enough here
const uniqueFilename = (path: string) => `.${basename(path)}.${Math.random()}`

// always retry EPERM errors on windows
/* c8 ignore next */
const retryCodes = process.platform === 'win32' ? new Set(['EPERM']) : undefined
const retryBusy = <T, U extends RimrafAsyncOptions>(
  fn: (path: string, opt: U) => Promise<T>,
) => retry.retryBusy(fn, retryCodes)
const retryBusySync = <T, U extends RimrafSyncOptions>(
  fn: (path: string, opt: U) => T,
) => retry.retryBusySync(fn, retryCodes)

const unlinkFixEPERM = retryBusy(fixEPERM(unlink))
const unlinkFixEPERMSync = retryBusySync(fixEPERMSync(unlinkSync))
const rmdirFixEPERM = retryBusy(fixEPERM(rmdir))
const rmdirFixEPERMSync = retryBusySync(fixEPERMSync(rmdirSync))
const retryReaddirOrError = retryBusy(readdirOrError)
const retryReaddirOrErrorSync = retryBusySync(readdirOrErrorSync)
const retryRename = retryBusy(async (path, opt: RimrafAsyncOptionsTmp) => {
  const tmpFile = resolve(opt.tmp, uniqueFilename(path))
  await rename(path, tmpFile)
  return tmpFile
})
const retryRenameSync = retryBusySync((path, opt: RimrafSyncOptionsTmp) => {
  const tmpFile = resolve(opt.tmp, uniqueFilename(path))
  renameSync(path, tmpFile)
  return tmpFile
})

const tmpUnlink = async (
  path: string,
  opt: RimrafAsyncOptionsTmp,
  rm: (p: string, opt: RimrafAsyncOptionsTmp) => Promise<void>,
) => {
  await rm(await retryRename(path, opt), opt)
}

const tmpUnlinkSync = (
  path: string,
  opt: RimrafSyncOptionsTmp,
  rmSync: (p: string, opt: RimrafSyncOptionsTmp) => void,
) => {
  rmSync(retryRenameSync(path, opt), opt)
}

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
      lstat(path).then(stat =>
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
      rimrafMoveRemoveDirSync(path, { ...opt, tmp }, lstatSync(path)),
    ) ?? true
  )
}

const rimrafMoveRemoveDir = async (
  path: string,
  opt: RimrafAsyncOptionsTmp,
  ent: Dirent | Stats,
): Promise<boolean> => {
  opt?.signal?.throwIfAborted()

  const entries =
    ent.isDirectory() ? await retryReaddirOrError(path, opt) : null
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
    await ignoreENOENT(tmpUnlink(path, opt, unlinkFixEPERM))
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
  await ignoreENOENT(tmpUnlink(path, opt, rmdirFixEPERM))
  return true
}

const rimrafMoveRemoveDirSync = (
  path: string,
  opt: RimrafSyncOptionsTmp,
  ent: Dirent | Stats,
): boolean => {
  opt?.signal?.throwIfAborted()

  const entries = ent.isDirectory() ? retryReaddirOrErrorSync(path, opt) : null
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
    ignoreENOENTSync(() => tmpUnlinkSync(path, opt, unlinkFixEPERMSync))
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
  ignoreENOENTSync(() => tmpUnlinkSync(path, opt, rmdirFixEPERMSync))
  return true
}
