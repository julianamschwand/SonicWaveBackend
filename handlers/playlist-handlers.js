import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { db } from '../db/db.js'
import { safeOperation, checkReq } from '../error-handling.js'

// make a new playlist
export async function createPlaylist(req, res) {
  const {name, description} = req.body
  const cover = req.files.cover
  checkReq(!name)

  let filename = randomUUID()
  if (cover) {
    await safeOperation(
      () => sharp(cover[0].filepath).jpeg().toFile(`./playlist-covers/${filename}.jpg`),
      "Error while saving cover"
    )
  }

  await safeOperation(
    () => db.query(`insert into Playlists (playlistName, playlistDescription, playlistCoverFileName, fk_UserDataId)
                   values (?,?,?,?)`, [name, description, filename, req.session.user.id]),
    "Error while inserting playlist into database"
  )

  res.status(200).json({success: true, message: "Successfully made playlists"})
}

// edit an existing playlists metadata
export async function editPlaylist(req, res) {

}

// delete a playlist
export async function deletePlaylist(req, res) {

}

// add a song to the playlist
export async function addToPlaylist(req, res) {

}

// delete a song from the playlist
export async function deleteFromPlaylist(req, res) {

}

// get all playlists without songs
export async function allPlaylists(req, res) {

}

// get a single playlist with songs
export async function playlist(req, res) {

}