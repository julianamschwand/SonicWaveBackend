import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import upload from '../middleware/upload.js'
import * as songHandlers from '../handlers/songs.js'

const songRouter = express.Router()

songRouter.get("/play", checkAuth, routeWrapper(songHandlers.playSong))
songRouter.post("/download", checkAuth, routeWrapper(songHandlers.downloadSong))
songRouter.get("/browse", checkAuth, routeWrapper(songHandlers.browseSongs))
songRouter.get("/", checkAuth, routeWrapper(songHandlers.songs))
songRouter.get("/cover/:filename", checkAuth, routeWrapper(songHandlers.getCover))
songRouter.patch("/edit", checkAuth, upload("./songs/cover"), routeWrapper(songHandlers.editSong))
songRouter.delete("/delete", checkAuth, routeWrapper(songHandlers.deleteSong))
songRouter.post("/toggle-favorite", checkAuth, routeWrapper(songHandlers.toggleFavorite))
songRouter.put("/reset", checkAuth, routeWrapper(songHandlers.resetSong))

export default songRouter