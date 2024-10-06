import { chmodSync, promises } from './fs.js'
const { chmod } = promises

export const fixEPERM =
  (fn: (path: string) => Promise<any>) => async (path: string) => {
    try {
      return await fn(path)
    } catch (er) {
      const fer = er as NodeJS.ErrnoException
      if (fer?.code === 'ENOENT') {
        return
      }
      if (fer?.code === 'EPERM') {
        console.log('fixEPERM error', er)
        try {
          await chmod(path, 0o666)
        } catch (er2) {
          console.log('fixEPERM chmod error', er2)
          const fer2 = er2 as NodeJS.ErrnoException
          if (fer2?.code === 'ENOENT') {
            return
          }
          throw er
        }
        try {
          return await fn(path)
        } catch (er3) {
          console.log('fixEPERM after chmox', er3)
          throw er3
        }
      }
      throw er
    }
  }

export const fixEPERMSync = (fn: (path: string) => any) => (path: string) => {
  try {
    return fn(path)
  } catch (er) {
    const fer = er as NodeJS.ErrnoException
    if (fer?.code === 'ENOENT') {
      return
    }
    if (fer?.code === 'EPERM') {
      try {
        chmodSync(path, 0o666)
      } catch (er2) {
        const fer2 = er2 as NodeJS.ErrnoException
        if (fer2?.code === 'ENOENT') {
          return
        }
        throw er
      }
      return fn(path)
    }
    throw er
  }
}
