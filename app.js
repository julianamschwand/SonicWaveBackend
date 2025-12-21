import express from 'express'
import session from 'express-session'
import cors from 'cors'
import dotenv from "dotenv"
import { existsSync } from 'fs'

import setupWizard from './setup/setup.js'
import { createSessionStore } from "./db/db.js"
import { smtpVerifier } from './mailer.js'
import initCronJobs from './cron/index.js'

import userRouter from './routes/users.js'
import songRouter from './routes/songs.js'
import playlistRouter from './routes/playlists.js'
import queueRouter from './routes/queue.js'
import artistRouter from './routes/artists.js'

import cleanup from './middleware/cleanup.js'

dotenv.config()

if (!existsSync("./.env") && !process.env.DOCKER) {
  await setupWizard()
} else if (process.env.DOCKER && !existsSync("./docker-env.json")) {
  await dockerInit()
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

// initialize cron jobs
await initCronJobs()

// upload cleanup
app.use(cleanup)

// checking smtp credentials
await smtpVerifier()

// routes
app.use("/users", userRouter)
app.use("/songs", songRouter)
app.use("/playlists", playlistRouter)
app.use("/queue", queueRouter)
app.use("/artists", artistRouter)

// serve default covers
app.use("/default-images", express.static("./data/default-images"))

// serve on port
const port = process.env.PORT
app.listen(port, () => console.log(`Server running on port ${port}`))