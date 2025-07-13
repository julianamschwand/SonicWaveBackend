import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { unlink, copyFile } from 'fs/promises'
import { db } from '../db/db.js'
import { safeOperation, checkReq } from '../error-handling.js'

// make a new playlist
export async function createPlaylist(req, res) {
  const {name, description} = req.body
  const cover = req.files.cover
  checkReq(!name)

  const filename = randomUUID()
  await safeOperation(
    async () => {
      if (cover) {
        await sharp(cover[0].filepath).jpeg().toFile(`./playlist-covers/${filename}.jpg`)
      } else {
        const randomNumber = Math.floor(Math.random() * 6) + 1
        await copyFile(`./default-images/playlists/${randomNumber}.jpg`, `./playlist-covers/${filename}.jpg`)
      }
    },
    "Error while saving cover"
  )
  
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
    async () => {
      await db.query("delete from Playlists where playlistId = ?", [playlistId])
      await unlink(`./playlist-covers/${dbPlaylist[0].playlistCoverFileName}`)
    },
    "Error while deleting playlist"
  )

  res.status(200).json({success: true, message: "Successfully deleted the playlist"})
}

// add a song to the playlist
export async function addToPlaylist(req, res) {
  const {playlistId, songId} = req.body
  checkReq(!playlistId || !songId)

  const [dbPlaylist] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (dbPlaylist.length === 0) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const [dbSong] = await safeOperation(
    () => db.query("select fk_UserDataId from Songs where songId = ?", [songId]),
    "Error while fetching song from database"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  await safeOperation(
    () => db.query("insert into PlaylistSongs (fk_PlaylistId, fk_SongId) values (?,?)", [playlistId, songId]),
    "Error while inserting the song into the playlist"
  )

  res.status(200).json({success: true, message: "Successfully added song to playlist"})
}

// delete a song from the playlist
export async function deleteFromPlaylist(req, res) {
  const {playlistId, songId} = req.body
  checkReq(!playlistId || !songId)

  const [dbPlaylist] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (dbPlaylist.length === 0) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const [dbSong] = await safeOperation(
    () => db.query("select fk_UserDataId from Songs where songId = ?", [songId]),
    "Error while fetching song from database"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  const [dbPlaylistSong] = await safeOperation(
    () => db.query("select * from PlayListSongs where fk_PlaylistId = ? and fk_SongId = ?", [playlistId, songId]),
    "Error while getting the playlist song"
  )

  if (dbPlaylistSong.length === 0) return res.status(404).json({success: false, message: "Song is not in playlist"})
  
  await safeOperation(
    () => db.query("delete from PlaylistSongs where fk_PlaylistId = ? and fk_SongId = ?", [playlistId, songId]),
    "Error while deleting the song from the playlist"
  )

  res.status(200).json({success: true, message: "Successfully deleted song from playlist"})
}

// get all playlists without songs
export async function allPlaylists(req, res) {
  const [playlists] = await safeOperation(
    () => db.query(`select playlistId, playlistName, playlistDescription, playlistCoverFileName from Playlists 
                    where fk_UserDataId = ?`, [req.session.user.id]),
    "Error while fetching playlists from database"
  )

  const formattedPlaylists = playlists.map(playlist => {
    const coverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist.playlistCoverFileName}.jpg`

    return {
      playlistId: playlist.playlistId,
      name: playlist.playlistName,
      description: playlist.playlistDescription,
      cover: coverURL
    }
  })

  res.status(200).json({success: true, message: "Successfully retrieved playlists from database", playlists: formattedPlaylists})
}

// get a single playlist with songs
export async function playlist(req, res) {
  const {playlistId} = req.query
  checkReq(!playlistId)

  const [playlist] = await safeOperation(
    () => db.query(`select * from Playlists where playlistId = ?`, [playlistId]),
    "Error while fetching playlist from database"
  )

  if (playlist.length === 0) return res.status(404).json({success: false, message: "Playlist not found"})
  if (playlist[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const [songs] = await safeOperation(
    () => db.query(`select songId, title, artistName, genre, duration, releaseYear, isFavorite, lastPlayed, songFileName
                    from PlaylistSongs join Songs on songId = fk_SongId join Artists on artistId = fk_ArtistId
                    where fk_PlaylistId = ?`, [playlistId]),
    "Error while fetching playlist songs from the database"
  )

  const playlistCoverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist[0].playlistCoverFileName}.jpg`

  const formattedSongs = songs.map(song => {
    const coverURL = `${req.protocol}://${req.get('host')}/songs/cover/${song.songFileName}.jpg`

    return {
      songId: song.songId,
      title: song.title,
      artist: song.artistName,
      genre: song.genre,
      duration: song.duration,
      releaseYear: song.releaseYear,
      isFavorite: Boolean(song.isFavorite),
      lastPlayed: song.lastPlayed,
      cover: coverURL
    }
  })

  const responseObject = {
    playlistId: playlist[0].playlistId,
    name: playlist[0].playlistName,
    description: playlist[0].playlistDescription,
    cover: playlistCoverURL,
    songs: formattedSongs
  }

  res.status(200).json({success: true, message: "Successfully retrieved playlist from database", playlist: responseObject})
}

// get cover image
export async function getCover(req, res) {
  const filename = req.params.filename

  const [dbUser] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistCoverFileName = ?", [filename.slice(0, -4)]),
    "Error while checking the covers owner"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "Cover not found"})
  if (dbUser[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your cover"})
  
  res.status(200).sendFile(`${process.cwd()}/playlist-covers/${filename}`)
}