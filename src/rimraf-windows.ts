// This is the same as rimrafPosix, with the following changes:
//
// 1. EBUSY, ENFILE, EMFILE trigger retries and/or exponential backoff
// 2. All non-directories are removed first and then all directories are
//    removed in a second sweep.
// 3. If we hit ENOTEMPTY in the second sweep, fall back to move-remove on
//    the that folder.
//
// Note: "move then remove" is 2-10 times slower, and just as unreliable.

import { Dirent, Stats } from 'fs'
import { parse, resolve } from 'path'
import { RimrafAsyncOptions, RimrafSyncOptions } from './index.js'
import { fixEPERM, fixEPERMSync } from './fix-eperm.js'
import { lstatSync, promises, rmdirSync, unlinkSync } from './fs.js'
import { ignoreENOENT, ignoreENOENTSync } from './ignore-enoent.js'
import { readdirOrError, readdirOrErrorSync } from './readdir-or-error.js'
import { retryBusy, retryBusySync } from './retry-busy.js'
import { rimrafMoveRemove, rimrafMoveRemoveSync } from './rimraf-move-remove.js'
import { errorCause, errorCode } from './error.js'
const { unlink, rmdir, lstat } = promises

const createFallback =
  (fn: (path: string, opt: RimrafAsyncOptions) => Promise<boolean | void>) =>
  async (path: string, opt: RimrafAsyncOptions) => {
    opt?.signal?.throwIfAborted()
    try {
      return (await fn(path, opt)) ?? true
    } catch (er) {
      if (
        errorCode(er) === 'ENOTEMPTY' ||
        (errorCode(er) === 'EPERM' && !errorCode(errorCause(er)))
      ) {
        /* c8 ignore start */
        if (errorCode(er) === 'EPERM') {
          console.trace('EPERM', er)
        }
        /* c8 ignore stop */
        // already filtered, remove from options so we don't call unnecessarily
        try {
          return rimrafMoveRemove(path, { ...opt, filter: undefined })
          /* c8 ignore start */
        } catch (e2) {
          console.trace(e2)
          throw e2
        }
        /* c8 ignore stop */
      }
      throw er
    }
  }

const createFallbackSync =
  (fn: (path: string, opt: RimrafSyncOptions) => boolean | void) =>
  (path: string, opt: RimrafSyncOptions) => {
    opt?.signal?.throwIfAborted()
    try {
      return fn(path, opt) ?? true
    } catch (er) {
      if (
        errorCode(er) === 'ENOTEMPTY' ||
        (errorCode(er) === 'EPERM' && !errorCode(errorCause(er)))
      ) {
        /* c8 ignore start */
        if (errorCode(er) === 'EPERM') {
          console.trace('EPERM', er)
        }
        /* c8 ignore stop */
        // already filtered, remove from options so we don't call unnecessarily
        try {
          return rimrafMoveRemoveSync(path, { ...opt, filter: undefined })
          /* c8 ignore start */
        } catch (e2) {
          console.trace(e2)
          throw e2
        }
        /* c8 ignore stop */
      }
      throw er
    }
  }

const rimrafWindowsFile = retryBusy(fixEPERM(unlink))
const rimrafWindowsFileSync = retryBusySync(fixEPERMSync(unlinkSync))
const rimrafWindowsDirMoveRemoveFallback = createFallback(
  retryBusy(fixEPERM(rmdir)),
)
const rimrafWindowsDirMoveRemoveFallbackSync = createFallbackSync(
  retryBusySync(fixEPERMSync(rmdirSync)),
)

export const rimrafWindows = createFallback((path, opt) =>
  ignoreENOENT(lstat(path).then(stat => rimrafWindowsDir(path, opt, stat))),
)

export const rimrafWindowsSync = createFallbackSync((path, opt) =>
  ignoreENOENTSync(() => rimrafWindowsDirSync(path, opt, lstatSync(path))),
)

const START = Symbol('start')
const CHILD = Symbol('child')
const FINISH = Symbol('finish')

const rimrafWindowsDir = async (
  path: string,
  opt: RimrafAsyncOptions,
  ent: Dirent | Stats,
  state = START,
): Promise<boolean> => {
  opt?.signal?.throwIfAborted()

  const entries = ent.isDirectory() ? await readdirOrError(path) : null
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
    // is a file
    await ignoreENOENT(rimrafWindowsFile(path, opt))
    return true
  }

  const s = state === START ? CHILD : state
  const removedAll = (
    await Promise.all(
      entries.map(ent =>
        rimrafWindowsDir(resolve(path, ent.name), opt, ent, s),
      ),
    )
  ).every(v => v === true)

  if (state === START) {
    return rimrafWindowsDir(path, opt, ent, FINISH)
  } else if (state === FINISH) {
    if (opt.preserveRoot === false && path === parse(path).root) {
      return false
    }
    if (!removedAll) {
      return false
    }
    if (opt.filter && !(await opt.filter(path, ent))) {
      return false
    }
    await ignoreENOENT(rimrafWindowsDirMoveRemoveFallback(path, opt))
  }
  return true
}

const rimrafWindowsDirSync = (
  path: string,
  opt: RimrafSyncOptions,
  ent: Dirent | Stats,
  state = START,
): boolean => {
  const entries = ent.isDirectory() ? readdirOrErrorSync(path) : null
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
    // is a file
    ignoreENOENTSync(() => rimrafWindowsFileSync(path, opt))
    return true
  }

  let removedAll = true
  for (const ent of entries) {
    const s = state === START ? CHILD : state
    const p = resolve(path, ent.name)
    removedAll = rimrafWindowsDirSync(p, opt, ent, s) && removedAll
  }

  if (state === START) {
    return rimrafWindowsDirSync(path, opt, ent, FINISH)
  } else if (state === FINISH) {
    if (opt.preserveRoot === false && path === parse(path).root) {
      return false
    }
    if (!removedAll) {
      return false
    }
    if (opt.filter && !opt.filter(path, ent)) {
      return false
    }
    ignoreENOENTSync(() => rimrafWindowsDirMoveRemoveFallbackSync(path, opt))
  }
  return true
}
