import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import * as queueHandlers from '../handlers/queue.js'

const queueRouter = express.Router()

queueRouter.get("/", checkAuth, routeWrapper(queueHandlers.getQueue))
queueRouter.post("/set", checkAuth, routeWrapper(queueHandlers.setQueue))
queueRouter.patch("/change-song", checkAuth, routeWrapper(queueHandlers.changeSong))
queueRouter.delete("/clear", checkAuth, routeWrapper(queueHandlers.clearQueue))

export default queueRouter