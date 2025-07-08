export class HttpError extends Error {
  constructor(message, status, json) {
    super(message)
    this.status = status
    this.json = json
  }
}

export function routeWrapper(handler) {
  return async function (req, res, next) {
    try {
      await handler(req, res, next)
    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error("Error", error)
        res.status(500).json({success: false, message: "Unhandled error"})
      } else {
        if (error.json) res.status(error.status || 500).json({success: false, message: error.message, ...error.json})
        else res.status(error.status || 500).json({success: false, message: error.message})
      }
    }
  }
}

export async function safeOperation(operation, message, failOperation) {
  try {
    return await operation()
  } catch (error) {
    if (failOperation) await failOperation()
    if (!(error instanceof HttpError)) throw new HttpError(message, 500)
    else throw error
  }
}

export async function safeOperations(operations, message, failOperation) {
  const results = []
  for (const operation of operations) {
    try {
      const result = await operation()
      results.push(result)
    } catch (error) {
      if (failOperation) await failOperation()
      if (!(error instanceof HttpError)) throw new HttpError(message, 500)
      else throw error
    }
  }
  return results
}

export function checkReq(condition) {
  if (condition) throw new HttpError("Missing data", 400)
}