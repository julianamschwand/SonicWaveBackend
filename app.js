import express from 'express'
import session from 'express-session'
import cors from 'cors'
import dotenv from "dotenv"
import { existsSync } from 'fs'

import { createSessionStore } from "./db.js"
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

// routes here

const port = process.env.PORT

app.listen(port, () => console.log(`Server running on port ${port}`))