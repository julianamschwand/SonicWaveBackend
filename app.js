import express from 'express'
import session from 'express-session'
import cors from 'cors'
import dotenv from "dotenv"
import { existsSync } from 'fs'

import { createSessionStore } from "./db/db.js"
import { smtpVerifier } from './mailer.js'
import setupWizard from './setup/setup.js'
import * as userHandlers from './handlers/user-handlers.js'
import * as songHandlers from './handlers/song-handlers.js'
import * as playlistHandlers from './handlers/playlist-handlers.js'

dotenv.config()

if (!existsSync("./.env")) {
  await setupWizard()
}

const app = express()
app.use(express.json())
app.use(cors({
  origin: process.env.ORIGIN_URL,
  credentials: true
}))
app.set('trust proxy', Number(process.env.PROXY_NUMBER))

const sessionStore = createSessionStore()

const isProd = process.env.NODE_ENV == "production"

app.use(session({
  key: "SessionId",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    sameSite: isProd ? "strict" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}))

await smtpVerifier()

// user routes

const userRouter = express.Router()

userRouter.get("/userdata", userHandlers.userdata)
userRouter.post("/register", userHandlers.register)
userRouter.post("/login", userHandlers.login)
userRouter.post("/logout", userHandlers.logout)
userRouter.get("/login-state", userHandlers.loginState)
userRouter.patch("/change-password", userHandlers.changePassword)
userRouter.get("/send-otp", userHandlers.sendOTP)
userRouter.delete("/delete-user", userHandlers.deleteUser)
userRouter.patch("/make-admin", userHandlers.makeAdmin)
userRouter.patch("/remove-admin", userHandlers.removeAdmin)
userRouter.patch("/approve-register", userHandlers.approveRegister)
userRouter.patch("/deny-register", userHandlers.denyRegister)
userRouter.get("/register-requests", userHandlers.registerRequests)

app.use("/users", userRouter)

// song routes

const songRouter = express.Router()

songRouter.get("/play-song", songHandlers.playSong)
songRouter.post("/download-song", songHandlers.downloadSong)
songRouter.get("/browse-songs", songHandlers.browseSongs)
songRouter.get("/songs", songHandlers.songs)
songRouter.patch("/edit-song", songHandlers.editSong)
songRouter.delete("/delete-song", songHandlers.deleteSong)
songRouter.post("/favorite-song", songHandlers.favoriteSong)
songRouter.post("/unfavorite-song", songHandlers.unfavoriteSong)

app.use("/songs", songRouter)

// playlists

const playlistRouter = express.Router()

playlistRouter.post("/create-playlist", playlistHandlers.createPlaylist)
playlistRouter.patch("/edit-playlist", playlistHandlers.editPlaylist)
playlistRouter.delete("/delete-playlist", playlistHandlers.deletePlaylist)
playlistRouter.post("/add-to-playlist", playlistHandlers.addToPlaylist)
playlistRouter.delete("/all-playlists", playlistHandlers.allPlaylists)
playlistRouter.get("/playlist", playlistHandlers.playlist)

app.use("/playlists", playlistRouter)

const port = process.env.PORT

app.listen(port, () => console.log(`Server running on port ${port}`))