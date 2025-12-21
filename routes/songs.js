import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import upload from '../middleware/upload.js'
import * as songHandlers from '../handlers/songs.js'

const songRouter = express.Router()

songRouter.get("/play", checkAuth, routeWrapper(songHandlers.playSong))
songRouter.get("/download-song", checkAuth, routeWrapper(songHandlers.downloadSong, true))
songRouter.get("/download-playlist", checkAuth, routeWrapper(songHandlers.downloadPlaylist, true))
songRouter.get("/browse", checkAuth, routeWrapper(songHandlers.browseSongs))
songRouter.get("/", checkAuth, routeWrapper(songHandlers.allSongs))
songRouter.get("/single", checkAuth, routeWrapper(songHandlers.song))
songRouter.get("/cover/:filename", checkAuth, routeWrapper(songHandlers.getCover))
songRouter.patch("/edit", checkAuth, upload("./data/songs/cover"), routeWrapper(songHandlers.editSong))
songRouter.delete("/delete", checkAuth, routeWrapper(songHandlers.deleteSong))
songRouter.post("/toggle-favorite", checkAuth, routeWrapper(songHandlers.toggleFavorite))
songRouter.put("/reset", checkAuth, routeWrapper(songHandlers.resetSong))
songRouter.get("/recently-played", checkAuth, routeWrapper(songHandlers.recentlyPlayed))

export default songRouter