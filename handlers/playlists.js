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
        await copyFile(`./data/default-images/playlists/${randomNumber}.jpg`, `./data/playlist-covers/${filename}.jpg`)
      }
    },
    "Error while saving cover"
  )
  
  await safeOperation(
    () => db.query(`insert into Playlists (playlistName, playlistDescription, playlistCoverFileName, fk_UserDataId)
                   values (?,?,?,?)`, [name, description, filename, req.session.user.id]),
    "Error while inserting playlist into database"
  )

  res.status(200).json({success: true, message: "Successfully created playlist"})
}

// edit an existing playlists metadata
export async function editPlaylist(req, res) {
  const {playlistId, name, description} = req.body
  const cover = req.files.cover
  checkReq(!playlistId)

  const [[dbPlaylist]] = await safeOperation(
    () => db.query("select playlistCoverFileName, fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (!dbPlaylist) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  await safeOperation(
    async () => {
      if (name) await db.query("update Playlists set playlistName = ? where playlistId = ?", [name, playlistId])
      if (description || description === "") await db.query("update Playlists set playlistDescription = ? where playlistId = ?", [description, playlistId])
      if (cover) {
        const coverFilepath = `./data/playlist-covers/${dbPlaylist.playlistCoverFileName}.jpg`

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

  const [[dbPlaylist]] = await safeOperation(
    () => db.query("select playlistCoverFileName, fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (!dbPlaylist) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  await safeOperation(
    async () => {
      await db.query("delete from Playlists where playlistId = ?", [playlistId])
      await unlink(`./data/playlist-covers/${dbPlaylist.playlistCoverFileName}.jpg`)
    },
    "Error while deleting playlist"
  )

  res.status(200).json({success: true, message: "Successfully deleted the playlist"})
}

// add songs to the playlist
export async function addToPlaylist(req, res) {
  const {playlistId, songIds} = req.body
  checkReq(!playlistId || !songIds || songIds?.length === 0)

  const [[dbPlaylist]] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (!dbPlaylist) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const conditions = songIds.map(() => "songId = ?").join(" or ")
  const userQuery = "select fk_UserDataId from Songs where " + conditions

  const [dbSongs] = await safeOperation(
    () => db.query(userQuery, songIds),
    "Error while fetching songs from database"
  )

  const songUsers = dbSongs.map(dbSong => dbSong.fk_UserDataId)
  if (songUsers.some(userId => userId !== req.session.user.id)) return res.status(403).json({success: false, message: "Not your song"})
  
  const placeholders = songIds.map(() => "(?,?)").join(",")
  const values = songIds.flatMap(songId => [playlistId, songId])
  const songQuery = "insert into PlaylistSongs (fk_PlaylistId, fk_SongId) values " + placeholders
  
  await safeOperation(
    () => db.query(songQuery, values),
    "Error while inserting the songs into the playlist"
  )

  res.status(200).json({success: true, message: "Successfully added songs to playlist"})
}

// delete a song from the playlist
export async function deleteFromPlaylist(req, res) {
  const {playlistId, songId} = req.body
  checkReq(!playlistId || !songId)

  const [[dbPlaylist]] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistId = ?", [playlistId]),
    "Error while fetching playlist from database"
  )

  if (!dbPlaylist) return res.status(404).json({success: false, message: "Playlist not found"})
  if (dbPlaylist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const [[dbSong]] = await safeOperation(
    () => db.query("select fk_UserDataId from Songs where songId = ?", [songId]),
    "Error while fetching song from database"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  const [[dbPlaylistSong]] = await safeOperation(
    () => db.query("select * from PlayListSongs where fk_PlaylistId = ? and fk_SongId = ?", [playlistId, songId]),
    "Error while getting the playlist song"
  )

  if (!dbPlaylistSong) return res.status(404).json({success: false, message: "Song is not in playlist"})
  
  await safeOperation(
    () => db.query("delete from PlaylistSongs where fk_PlaylistId = ? and fk_SongId = ?", [playlistId, songId]),
    "Error while deleting the song from the playlist"
  )

  res.status(200).json({success: true, message: "Successfully deleted song from playlist"})
}

// get all playlists without songs
export async function allPlaylists(req, res) {
  const [playlists] = await safeOperation(
    () => db.query(`select playlistId, playlistName, playlistDescription, playlistCoverFileName, count(songId) as songCount, sum(duration) as playlistDuration
                    from Playlists
                    left join PlaylistSongs on playlistId = fk_PlaylistId
                    left join Songs on songId = fk_SongId
                    where Playlists.fk_UserDataId = ?
                    group by playlistId, playlistName, playlistDescription, playlistCoverFileName
                    order by playlistName`, [req.session.user.id]),
    "Error while fetching playlists from database"
  )

  const formattedPlaylists = playlists.map(playlist => {
    const coverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist.playlistCoverFileName}.jpg`

    return {
      playlistId: playlist.playlistId,
      name: playlist.playlistName,
      description: playlist.playlistDescription,
      playlistDuration: Number(playlist.playlistDuration) || 0,
      songCount: playlist.songCount,
      cover: coverURL
    }
  })

  res.status(200).json({success: true, message: "Successfully retrieved playlists from database", playlists: formattedPlaylists})
}

// get a single playlist with songs
export async function playlist(req, res) {
  const {playlistId} = req.query
  checkReq(!playlistId)

  const [[playlist]] = await safeOperation(
    () => db.query(`select playlistId, playlistName, playlistDescription, playlistCoverFileName, count(songId) as songCount, sum(duration) as playlistDuration, Playlists.fk_UserDataId
                    from Playlists
                    left join PlaylistSongs on playlistId = fk_PlaylistId
                    left join Songs on songId = fk_SongId
                    where playlistId = ?
                    group by playlistId, playlistName, playlistDescription, playlistCoverFileName
                    order by playlistName`, [playlistId]),
    "Error while fetching playlist from database"
  )

  if (!playlist) return res.status(404).json({success: false, message: "Playlist not found"})
  if (playlist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your playlist"})

  const [songs] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, 
                    json_arrayagg(json_object('artistId', artistId, 'artistName', artistName)) as artists
                    from Songs
                    join SongArtists on SongArtists.fk_SongId = songId
                    join Artists on fk_ArtistId = artistId
                    join PlaylistSongs on PlaylistSongs.fk_SongId = songId
                    where fk_PlaylistId = ?
                    group by songId 
                    order by title`, [playlistId]),
    "Error while fetching playlist songs from the database"
  )

  const playlistCoverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist.playlistCoverFileName}.jpg`

  const formattedSongs = songs.map(song => {
    const coverURL = `${req.protocol}://${req.get('host')}/songs/cover/${song.songFileName}.jpg`

    return {
      songId: song.songId,
      title: song.title,
      genre: song.genre,
      duration: song.duration,
      releaseYear: song.releaseYear,
      isFavorite: Boolean(song.isFavorite),
      cover: coverURL,
      artists: JSON.parse(song.artists)
    }
  })

  const responseObject = {
    playlistId: playlist.playlistId,
    name: playlist.playlistName,
    description: playlist.playlistDescription,
    cover: playlistCoverURL,
    songCount: playlist.songCount,
    playlistDuration: Number(playlist.playlistDuration) || 0,
    songs: formattedSongs
  }

  res.status(200).json({success: true, message: "Successfully retrieved playlist from database", playlist: responseObject})
}

// get cover image
export async function getCover(req, res) {
  const filename = req.params.filename

  const [[dbUser]] = await safeOperation(
    () => db.query("select fk_UserDataId from Playlists where playlistCoverFileName = ?", [filename.slice(0, -4)]),
    "Error while checking the covers owner"
  )

  if (!dbUser) return res.status(404).json({success: false, message: "Cover not found"})
  if (dbUser.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your cover"})
  
  res.status(200).sendFile(`${process.cwd()}/data/playlist-covers/${filename}`)
}