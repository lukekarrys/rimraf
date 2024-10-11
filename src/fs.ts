// promisify ourselves, because older nodes don't have fs.promises

import fs, { Dirent } from 'fs'

// sync ones just take the sync version from node
export {
  chmodSync,
  mkdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
} from 'fs'

export const statSync = (path: fs.PathLike) => fs.statSync(path)
export const lstatSync = (path: fs.PathLike) => fs.lstatSync(path)
export const readdirSync = (path: fs.PathLike) =>
  fs.readdirSync(path, { withFileTypes: true })

// unrolled for better inlining, this seems to get better performance
// than something like:
// const makeCb = (res, rej) => (er, ...d) => er ? rej(er) : res(...d)
// which would be a bit cleaner.

const createStack = () => {
  const obj: { stack?: string } = {}
  Error?.captureStackTrace(obj, createStack)
  const { stack } = obj
  return (er: NodeJS.ErrnoException) => {
    /* c8 ignore start */
    if (stack) {
      const prefix =
        er.stack ? er.stack.substring(0, er.stack.indexOf('\n')) : undefined
      er.stack =
        prefix ?
          prefix + '\n' + stack.substring(stack.indexOf('\n') + 1)
        : stack
    }
    /* c8 ignore stop */
    return er
  }
}

const chmod = (path: fs.PathLike, mode: fs.Mode): Promise<void> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.chmod(path, mode, er => (er ? rej(stack(er)) : res())),
  )
}

const mkdir = (
  path: fs.PathLike,
  options?:
    | fs.Mode
    | (fs.MakeDirectoryOptions & { recursive?: boolean | null })
    | null,
): Promise<string | undefined> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.mkdir(path, options, (er, made) => (er ? rej(stack(er)) : res(made))),
  )
}

const readdir = async (path: fs.PathLike): Promise<Dirent[]> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.readdir(path, { withFileTypes: true }, (er, data) =>
      er ? rej(stack(er)) : res(data),
    ),
  )
}

const rename = (oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.rename(oldPath, newPath, er => (er ? rej(stack(er)) : res())),
  )
}

const rm = (path: fs.PathLike, options: fs.RmOptions): Promise<void> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.rm(path, options, er => (er ? rej(stack(er)) : res())),
  )
}

const rmdir = (path: fs.PathLike): Promise<void> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.rmdir(path, er => (er ? rej(stack(er)) : res())),
  )
}

const stat = (path: fs.PathLike): Promise<fs.Stats> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.stat(path, (er, data) => (er ? rej(stack(er)) : res(data))),
  )
}

const lstat = (path: fs.PathLike): Promise<fs.Stats> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.lstat(path, (er, data) => (er ? rej(stack(er)) : res(data))),
  )
}

const unlink = (path: fs.PathLike): Promise<void> => {
  const stack = createStack()
  return new Promise((res, rej) =>
    fs.unlink(path, er => (er ? rej(stack(er)) : res())),
  )
}

export const promises = {
  chmod,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  lstat,
  unlink,
}

// import fs, { Dirent } from 'fs'

// const readdir = (path: fs.PathLike): Promise<Dirent[]> =>
//   fsPromises.readdir(path, { withFileTypes: true })

// export const promises = {
//   chmod: fsPromises.chmod,
//   mkdir: fsPromises.mkdir,
//   readdir,
//   rename: fsPromises.rename,
//   rm: fsPromises.rm,
//   rmdir: fsPromises.rmdir,
//   stat: fsPromises.stat,
//   lstat: fsPromises.lstat,
//   unlink: fsPromises.unlink,
// }
