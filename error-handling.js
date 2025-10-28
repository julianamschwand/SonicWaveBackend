export class HttpError extends Error {
  constructor(message, status, json) {
    super(message)
    this.status = status
    this.json = json
  }
}

export function routeWrapper(handler, sse = false) {
  return async function (req, res, next) {

    try {
      if (sse) {
        res.setHeader("Content-Type", "text/event-stream")
        res.setHeader("Cache-Control", "no-cache")
        res.setHeader("Connection", "keep-alive")
        res.setHeader("X-Accel-Buffering", "no")
      }

      await handler(req, res, next)
    } catch (error) {
      const sendError = (data, errorStatus) => {
        if (sse) {
          res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`)
          res.end()
        } 
        else res.status(errorStatus).json(data)
      }

      if (error instanceof HttpError) {
        if (error.json) sendError({success: false, message: error.message, ...error.json}, error.status || 500)
        else sendError({success: false, message: error.message}, error.status || 500)
      } else {
        if (/'req.body' as it is undefined/.test(error.message)) {
          sendError({success: false, message: "Body is missing"}, 400)
        } else {
          console.error("Error", error)
          sendError({success: false, message: "Unhandled error"}, 500)
        }
      }
    }

    if (sse) res.end()
  }
}

export async function safeOperation(operation, message, failOperation) {
  try {
    return await operation()
  } catch (error) {
    if (failOperation) await failOperation()
    if (!(error instanceof HttpError)) {
      console.error(error)
      throw new HttpError(message, 500)
    }
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
      if (!(error instanceof HttpError)) {
        console.error(error)
        throw new HttpError(message, 500)
      }
      else throw error
    }
  }
  return results
}

export function checkReq(condition) {
  if (condition) throw new HttpError("Missing data", 400)
}