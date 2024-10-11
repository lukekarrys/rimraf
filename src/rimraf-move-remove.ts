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
import { retryBusy, retryBusySync } from './retry-busy.js'
const { lstat, rename, unlink, rmdir } = promises

// crypto.randomBytes is much slower, and Math.random() is enough here
const uniqueFilename = (path: string) => `.${basename(path)}.${Math.random()}`

const retryCodes = new Set(['EPERM'])
const unlinkFixEPERM = retryBusy(fixEPERM(unlink), retryCodes)
const unlinkFixEPERMSync = retryBusySync(fixEPERMSync(unlinkSync), retryCodes)
const rmdirFixEPERM = retryBusy(fixEPERM(rmdir), retryCodes)
const rmdirFixEPERMSync = retryBusySync(fixEPERMSync(rmdirSync), retryCodes)

const retryReaddirOrError = retryBusy(readdirOrError)
const retryReaddirOrErrorSync = retryBusySync(readdirOrErrorSync)

type RimrafAsyncOptionsNoTmp = Omit<RimrafAsyncOptions, 'tmp'>
type RimrafSyncOptionsNoTmp = Omit<RimrafSyncOptions, 'tmp'>

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
      lstat(path).then(stat => rimrafMoveRemoveDir(path, tmp, opt, stat)),
    )) ?? true
  )
}

const rimrafMoveRemoveDir = async (
  path: string,
  tmp: string,
  opt: RimrafAsyncOptionsNoTmp,
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
      if (errorCode(entries) === 'EPERM') {
        // TODO: what to do here??
        console.trace('EPERM', entries)
        throw entries
      }
      if (errorCode(entries) !== 'ENOTDIR') {
        throw entries
      }
    }
    /* c8 ignore stop */
    if (opt.filter && !(await opt.filter(path, ent))) {
      return false
    }
    await ignoreENOENT(tmpUnlink(path, tmp, opt, unlinkFixEPERM))
    return true
  }

  const removedAll = (
    await Promise.all(
      entries.map(ent =>
        rimrafMoveRemoveDir(resolve(path, ent.name), tmp, opt, ent),
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
  await ignoreENOENT(tmpUnlink(path, tmp, opt, rmdirFixEPERM))
  return true
}

const tmpUnlink = async (
  path: string,
  tmp: string,
  opt: RimrafAsyncOptionsNoTmp,
  rm: (p: string, opt: RimrafAsyncOptionsNoTmp) => Promise<void>,
) => {
  const tmpFile = resolve(tmp, uniqueFilename(path))
  await rename(path, tmpFile)
  return await rm(tmpFile, opt)
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
      rimrafMoveRemoveDirSync(path, tmp, opt, lstatSync(path)),
    ) ?? true
  )
}

const rimrafMoveRemoveDirSync = (
  path: string,
  tmp: string,
  opt: RimrafSyncOptionsNoTmp,
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
      if (errorCode(entries) === 'EPERM') {
        // TODO: what to do here??
        console.trace('EPERM', entries)
        throw entries
      }
      if (errorCode(entries) !== 'ENOTDIR') {
        throw entries
      }
    }
    /* c8 ignore stop */
    if (opt.filter && !opt.filter(path, ent)) {
      return false
    }
    ignoreENOENTSync(() => tmpUnlinkSync(path, tmp, opt, unlinkFixEPERMSync))
    return true
  }

  let removedAll = true
  for (const ent of entries) {
    const p = resolve(path, ent.name)
    removedAll = rimrafMoveRemoveDirSync(p, tmp, opt, ent) && removedAll
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
  ignoreENOENTSync(() => tmpUnlinkSync(path, tmp, opt, rmdirFixEPERMSync))
  return true
}

const tmpUnlinkSync = (
  path: string,
  tmp: string,
  opt: RimrafSyncOptionsNoTmp,
  rmSync: (p: string, opt: RimrafSyncOptionsNoTmp) => void,
) => {
  const tmpFile = resolve(tmp, uniqueFilename(path))
  renameSync(path, tmpFile)
  return rmSync(tmpFile, opt)
}
