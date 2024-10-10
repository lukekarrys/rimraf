import { errorCode } from './error.js'

const pickError = (er: unknown, er2?: unknown) => {
  if (!er2) {
    return er
  }
  if (er2 instanceof Error) {
    er2.cause = er
  }
  return er2
}

export const ignoreENOENT = async <T>(p: Promise<T>, er2?: unknown) =>
  p.catch(er => {
    if (errorCode(er) === 'ENOENT') {
      return
    }
    throw pickError(er, er2)
  })

export const ignoreENOENTSync = <T>(fn: () => T, er2?: unknown) => {
  try {
    return fn()
  } catch (er) {
    if (errorCode(er) === 'ENOENT') {
      return
    }
    throw pickError(er, er2)
  }
}
