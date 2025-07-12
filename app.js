import express from 'express'
import session from 'express-session'
import cors from 'cors'
import dotenv from "dotenv"
import formidable from 'formidable'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'

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

// express session config
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

// upload middleware
function upload(uploadDir) {
  return async function handleUpload(req, res, next) {
    const form = formidable({
      uploadDir: uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024
    })

    try {
      const [fields, files] = await form.parse(req)

      req.body = fields
      req.files = files
      next()
    } catch (error) {
      next(error)
    }
  } 
}

// upload cleanup
app.use(async (req, res, next) => {
  res.on("finish", () => {
    if (req.files) {
      for (const files of Object.values(req.files)) {
        for (const file of files) {
          unlink(file.filepath).catch(error => {
            console.error("Failed to delete file:", error)
          })
        }
      }
    }
  })

  next()
})

// auth middleware
function checkAuth(req, res, next) {
 if (!req.session.user) {
    return res.status(401).json({success: false, message: "Not logged in"})
  }
  next()
}

await smtpVerifier()

// user routes

const userRouter = express.Router()

userRouter.get("/userdata", checkAuth, routeWrapper(userHandlers.userdata))
userRouter.post("/register", routeWrapper(userHandlers.register))
userRouter.post("/login", routeWrapper(userHandlers.login))
userRouter.post("/logout", checkAuth, routeWrapper(userHandlers.logout))
userRouter.get("/login-state", routeWrapper(userHandlers.loginState))
userRouter.patch("/change-password", routeWrapper(userHandlers.changePassword))
userRouter.get("/send-otp", routeWrapper(userHandlers.sendOTP))
userRouter.delete("/delete-user", checkAuth, routeWrapper(userHandlers.deleteUser))
userRouter.patch("/make-admin", checkAuth, routeWrapper(userHandlers.makeAdmin))
userRouter.patch("/remove-admin", checkAuth, routeWrapper(userHandlers.removeAdmin))
userRouter.patch("/approve-register", checkAuth, routeWrapper(userHandlers.approveRegister))
userRouter.patch("/deny-register", checkAuth, routeWrapper(userHandlers.denyRegister))
userRouter.get("/register-requests", checkAuth, routeWrapper(userHandlers.registerRequests))

app.use("/users", userRouter)

// song routes

const songRouter = express.Router()

songRouter.get("/play-song", checkAuth, routeWrapper(songHandlers.playSong))
songRouter.post("/download-song", checkAuth, routeWrapper(songHandlers.downloadSong))
songRouter.get("/browse-songs", checkAuth, routeWrapper(songHandlers.browseSongs))
songRouter.get("/songs", checkAuth, routeWrapper(songHandlers.songs))
songRouter.get("/cover/:filename", checkAuth, routeWrapper(songHandlers.getCover))
songRouter.patch("/edit-song", checkAuth, upload('./songs/cover'), routeWrapper(songHandlers.editSong))
songRouter.delete("/delete-song", checkAuth, routeWrapper(songHandlers.deleteSong))
songRouter.post("/toggle-favorite", checkAuth, routeWrapper(songHandlers.toggleFavorite))
songRouter.put("/reset-song", checkAuth, routeWrapper(songHandlers.resetSong))

app.use("/songs", songRouter)

// playlists

const playlistRouter = express.Router()

playlistRouter.post("/create-playlist", checkAuth, routeWrapper(playlistHandlers.createPlaylist))
playlistRouter.patch("/edit-playlist", checkAuth, routeWrapper(playlistHandlers.editPlaylist))
playlistRouter.delete("/delete-playlist", checkAuth, routeWrapper(playlistHandlers.deletePlaylist))
playlistRouter.post("/add-to-playlist", checkAuth, routeWrapper(playlistHandlers.addToPlaylist))
playlistRouter.delete("/all-playlists", checkAuth, routeWrapper(playlistHandlers.allPlaylists))
playlistRouter.get("/playlist", checkAuth, routeWrapper(playlistHandlers.playlist))

app.use("/playlists", playlistRouter)

const port = process.env.PORT
app.listen(port, () => console.log(`Server running on port ${port}`))