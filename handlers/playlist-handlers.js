import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
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
  const {playlistId, name, description} = req.body
  const cover = req.files.cover
  checkReq(!playlistId)

  const [dbPlaylist] = await safeOperation(
    () => db.query("select playlistCoverFileName, fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (dbPlaylist.length === 0) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  await safeOperation(
    async () => {
      if (name) await db.query("update Playlists set playlistName = ? where playlistId = ?", [name, playlistId])
      if (description) await db.query("update Playlists set playlistDescription = ? where playlistId = ?", [description, playlistId])
      if (cover) {
        const coverFilepath = `./playlist-covers/${dbPlaylist[0].playlistCoverFileName}.jpg`

        await unlink(coverFilepath)
        await sharp(cover[0].filepath).jpeg().toFile(coverFilepath)
      }
    },
    "Error while updating playlist metadata"
  )

  res.status(200).json({success: true, message: "Successfully edited the playlist"})
}

// delete a playlist
export async function deletePlaylist(req, res) {
  const {playlistId} = req.body
  checkReq(!playlistId)

  const [dbPlaylist] = await safeOperation(
    () => db.query("select playlistCoverFileName, fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (dbPlaylist.length === 0) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  await safeOperation(
    () => db.query("delete from Playlists where playlistId = ?", [playlistId]),
    "Error while deleting playlist"
  )

  res.status(200).json({success: true, message: "Successfully deleted the playlist"})
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