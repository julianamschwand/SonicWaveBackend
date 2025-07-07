import express from 'express'
import session from 'express-session'
import cors from 'cors'
import dotenv from "dotenv"
import { existsSync } from 'fs'

import setupWizard from './setup/setup.js'
import { createSessionStore } from "./db/db.js"
import { smtpVerifier } from './mailer.js'
import { routeWrapper } from './error-handling.js'
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

userRouter.get("/userdata", routeWrapper(userHandlers.userdata))
userRouter.post("/register", routeWrapper(userHandlers.register))
userRouter.post("/login", routeWrapper(userHandlers.login))
userRouter.post("/logout", routeWrapper(userHandlers.logout))
userRouter.get("/login-state", routeWrapper(userHandlers.loginState))
userRouter.patch("/change-password", routeWrapper(userHandlers.changePassword))
userRouter.get("/send-otp", routeWrapper(userHandlers.sendOTP))
userRouter.delete("/delete-user", routeWrapper(userHandlers.deleteUser))
userRouter.patch("/make-admin", routeWrapper(userHandlers.makeAdmin))
userRouter.patch("/remove-admin", routeWrapper(userHandlers.removeAdmin))
userRouter.patch("/approve-register", routeWrapper(userHandlers.approveRegister))
userRouter.patch("/deny-register", routeWrapper(userHandlers.denyRegister))
userRouter.get("/register-requests", routeWrapper(userHandlers.registerRequests))

app.use("/users", userRouter)

// song routes

const songRouter = express.Router()

songRouter.get("/play-song", routeWrapper(songHandlers.playSong))
songRouter.post("/download-song", routeWrapper(songHandlers.downloadSong))
songRouter.get("/browse-songs", routeWrapper(songHandlers.browseSongs))
songRouter.get("/songs", routeWrapper(songHandlers.songs))
songRouter.patch("/edit-song", routeWrapper(songHandlers.editSong))
songRouter.delete("/delete-song", routeWrapper(songHandlers.deleteSong))
songRouter.post("/favorite-song", routeWrapper(songHandlers.favoriteSong))
songRouter.post("/unfavorite-song", routeWrapper(songHandlers.unfavoriteSong))

app.use("/songs", songRouter)

// playlists

const playlistRouter = express.Router()

playlistRouter.post("/create-playlist", routeWrapper(playlistHandlers.createPlaylist))
playlistRouter.patch("/edit-playlist", routeWrapper(playlistHandlers.editPlaylist))
playlistRouter.delete("/delete-playlist", routeWrapper(playlistHandlers.deletePlaylist))
playlistRouter.post("/add-to-playlist", routeWrapper(playlistHandlers.addToPlaylist))
playlistRouter.delete("/all-playlists", routeWrapper(playlistHandlers.allPlaylists))
playlistRouter.get("/playlist", routeWrapper(playlistHandlers.playlist))

app.use("/playlists", playlistRouter)

const port = process.env.PORT

app.listen(port, () => console.log(`Server running on port ${port}`))