import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import * as userHandlers from '../handlers/users.js'

const userRouter = express.Router()

userRouter.get("/", checkAuth, routeWrapper(userHandlers.allUsers))
userRouter.get("/userdata", checkAuth, routeWrapper(userHandlers.userdata))
userRouter.post("/register", routeWrapper(userHandlers.register))
userRouter.post("/login", routeWrapper(userHandlers.login))
userRouter.post("/logout", checkAuth, routeWrapper(userHandlers.logout))
userRouter.get("/login-state", routeWrapper(userHandlers.loginState))
userRouter.patch("/change-password", routeWrapper(userHandlers.changePassword))
userRouter.get("/send-otp", routeWrapper(userHandlers.sendOTP))
userRouter.delete("/delete", checkAuth, routeWrapper(userHandlers.deleteUser))
userRouter.patch("/make-admin", checkAuth, routeWrapper(userHandlers.makeAdmin))
userRouter.patch("/remove-admin", checkAuth, routeWrapper(userHandlers.removeAdmin))
userRouter.patch("/approve-register", checkAuth, routeWrapper(userHandlers.approveRegister))
userRouter.patch("/deny-register", checkAuth, routeWrapper(userHandlers.denyRegister))
userRouter.get("/register-requests", checkAuth, routeWrapper(userHandlers.registerRequests))

export default userRouter