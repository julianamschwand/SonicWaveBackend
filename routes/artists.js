import express from 'express'
import { routeWrapper } from '../error-handling.js'
import checkAuth from '../middleware/check-auth.js'
import upload from '../middleware/upload.js'
import * as artistHandlers from '../handlers/artists.js'

const artistRouter = express.Router()

artistRouter.get("/", checkAuth, routeWrapper(artistHandlers.allArtists))
artistRouter.get("/single", checkAuth, routeWrapper(artistHandlers.singleArtist))
artistRouter.patch("/edit", checkAuth, upload("./data/artist-images"), routeWrapper(artistHandlers.editArtist))
artistRouter.get("/image/:filename", checkAuth, routeWrapper(artistHandlers.getImage))

export default artistRouter