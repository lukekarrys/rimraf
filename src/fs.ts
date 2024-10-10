// promisify ourselves, because older nodes don't have fs.promises

import fs, { Dirent } from 'fs'

// sync ones just take the sync version from node
export { chmodSync, renameSync, rmdirSync, rmSync, unlinkSync } from 'fs'

export const statSync = (path: fs.PathLike) => fs.statSync(path)
export const lstatSync = (path: fs.PathLike) => fs.lstatSync(path)
export const readdirSync = (path: fs.PathLike) =>
  fs.readdirSync(path, { withFileTypes: true })

// unrolled for better inlining, this seems to get better performance
// than something like:
// const makeCb = (res, rej) => (er, ...d) => er ? rej(er) : res(...d)
// which would be a bit cleaner.

const chmod = (path: fs.PathLike, mode: fs.Mode): Promise<void> =>
  new Promise((res, rej) => fs.chmod(path, mode, er => (er ? rej(er) : res())))

const readdir = async (path: fs.PathLike): Promise<Dirent[]> =>
  new Promise((res, rej) =>
    fs.readdir(path, { withFileTypes: true }, (er, data) =>
      er ? rej(er) : res(data),
    ),
  )

const rename = (oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> =>
  new Promise((res, rej) =>
    fs.rename(oldPath, newPath, er => (er ? rej(er) : res())),
  )

const rm = (path: fs.PathLike, options: fs.RmOptions): Promise<void> =>
  new Promise((res, rej) => fs.rm(path, options, er => (er ? rej(er) : res())))

const rmdir = (path: fs.PathLike): Promise<void> =>
  new Promise((res, rej) => fs.rmdir(path, er => (er ? rej(er) : res())))

const stat = (path: fs.PathLike): Promise<fs.Stats> =>
  new Promise((res, rej) =>
    fs.stat(path, (er, data) => (er ? rej(er) : res(data))),
  )

const lstat = (path: fs.PathLike): Promise<fs.Stats> =>
  new Promise((res, rej) =>
    fs.lstat(path, (er, data) => (er ? rej(er) : res(data))),
  )

const unlink = (path: fs.PathLike): Promise<void> =>
  new Promise((res, rej) => fs.unlink(path, er => (er ? rej(er) : res())))

export const promises = {
  chmod,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  lstat,
  unlink,
}
