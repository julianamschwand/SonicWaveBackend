import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import upload from '../middleware/upload.js'
import * as playlistHandlers from '../handlers/playlists.js'

const playlistRouter = express.Router()

playlistRouter.post("/create", checkAuth, upload("./data/playlist-covers"), routeWrapper(playlistHandlers.createPlaylist))
playlistRouter.patch("/edit", checkAuth, upload("./data/playlist-covers"), routeWrapper(playlistHandlers.editPlaylist))
playlistRouter.delete("/delete", checkAuth, routeWrapper(playlistHandlers.deletePlaylist))
playlistRouter.post("/add-song", checkAuth, routeWrapper(playlistHandlers.addToPlaylist))
playlistRouter.delete("/delete-song", checkAuth, routeWrapper(playlistHandlers.deleteFromPlaylist))
playlistRouter.get("/", checkAuth, routeWrapper(playlistHandlers.allPlaylists))
playlistRouter.get("/single", checkAuth, routeWrapper(playlistHandlers.playlist))
playlistRouter.get("/cover/:filename", checkAuth, routeWrapper(playlistHandlers.getCover))

export default playlistRouter