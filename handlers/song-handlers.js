import util from 'util'
import dotenv from 'dotenv'
import axios from 'axios'
import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { exec as execCb } from 'child_process'
import { parseFile } from 'music-metadata'
import { unlink, writeFile, access } from 'fs/promises'
import { db } from '../db/db.js'
import { safeOperation, safeOperations, HttpError, checkReq } from '../error-handling.js'
dotenv.config()

const exec = util.promisify(execCb)

// play a downloaded song
export async function playSong(req, res) {

}

// download a song by URL
export async function downloadSong(req, res) {
  const {songURL} = req.body
  checkReq(!songURL)

  const filename = randomUUID()
  const songpath = `./songs/audio/${filename}.m4a`

  const {stderr} = await safeOperation(
    () => exec(`"${process.env.YTDLP_PATH}"` +
              ` -x` +
              ` --audio-format m4a` +
              ` --audio-quality 0` +
              ` --ffmpeg-location ${process.env.FFMPEG_PATH}` +
              ` --embed-metadata` +
              ` --embed-thumbnail` +
              ` --add-metadata` +
              ` -o "${songpath}"` +
              ` "${songURL}"`),
    "Error while downloading the song"
  )

  if (stderr) console.warn('yt-dlp stderr:', stderr)

  const metadata = await safeOperation(
    () => parseFile(songpath),
    "Error while reading metadata"
  )

  const common = metadata.common
  const format = metadata.format

  let artistId = 0
  if (common.artist) {
    const [dbArtist] = await safeOperation(
      () => db.query("select artistId from Artists where lower(artistName) = lower(?)", [common.artist]),
      "Error while selecting artist from the database"
    )

    if (dbArtist.length === 0) {
      const [artistResult] = await safeOperation(
        () => db.query("insert into Artists (artistName) values (?)", [common.artist]),
        "Error while inserting new artist"
      )
      artistId = artistResult.insertId
    } else {
      artistId = dbArtist[0].artistId
    }
  } else {
    artistId = 1
  }

  if (metadata.common.picture && metadata.common.picture.length > 0) {
    const cover = common.picture[0]
    const convertedCover = await sharp(cover.data).jpeg().toBuffer()
    await writeFile(`./songs/cover/${filename}.jpg`, convertedCover)
  }

  await safeOperation(
    () => db.query(`insert into Songs (songFileName, title, genre, duration, releaseYear, fk_UserDataId, fk_ArtistId)
                    values (?,?,?,?,?,?,?)`,
                    [filename, common.title, common.genre, format.duration, common.year, req.session.user.id, artistId]),
    "Error while saving Songdata to database"
  )
  
  res.status(200).json({success: true, message: "Successfully downloaded the song and added it to account"})
}

// browse songs with soundcloud
export async function browseSongs(req, res) {
  const {query} = req.query
  checkReq(!query)

  const searchPage = await safeOperation(
    () => axios.get(`https://soundcloud.com/search?q=${query}`),
    "Error while getting search page"
  )

  const regex = /<h2><a href="(\/[^\/]+\/[^\/]+)">/g
  const filtered = [...searchPage.data.matchAll(regex)]

  const structured = await Promise.all(
    filtered.map(async match => {
      const url = "https://soundcloud.com" + match[1]
  
      const songPage = await safeOperation(
        () => axios.get(url),
        "Error while getting song page"
      )
  
      const image_url = /<img src="([^"]+)"/.exec(songPage.data)
      
      const splitMatch = match[1].split("/")
      return {
        name: splitMatch[2][0].toUpperCase() + splitMatch[2].slice(1),
        artist: splitMatch[1][0].toUpperCase() + splitMatch[1].slice(1),
        url,
        image_url: image_url[1]
      }
    })
  )

  res.status(200).json({success: true, message: "Successfully fetched songs", songs: structured})
}

// get all songs
export async function songs(req, res) {
  const [songs] = await safeOperation(
    () => db.query(`select songId, title, artistName, genre, duration, releaseYear, isFavorite, lastPlayed, songFileName from Songs
                    join Artists on fk_ArtistId = artistId`, [req.session.user.id]),
    "Error while fetching songs from database"
  )

  const formattedSongs = songs.map(song => {
    const coverUrl = `${req.protocol}://${req.get('host')}/songs/cover/${song.songFileName}.jpg`

    return {
      songId: song.songId,
      title: song.title,
      artist: song.artistName,
      genre: song.genre,
      duration: song.duration,
      releaseYear: song.releaseYear,
      isFavorite: Boolean(song.isFavorite),
      lastPlayed: song.lastPlayed,
      cover: coverUrl
    }
  })

  res.status(200).json({success: true, message: "Successfully retrieved songs from database", songs: formattedSongs})
}

// get cover image
export async function getCover(req, res) {
  const filename = req.params.filename

  const [dbUser] = await safeOperation(
    () => db.query("select fk_UserDataId from Songs where songFileName = ?", [filename.slice(0, -4)]),
    "Error while checking the covers owner"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "Cover not found"})
  if (dbUser[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your cover"})
  
  res.status(200).sendFile(`${process.cwd()}/songs/cover/${filename}`)
}

// edit an existing songs metadata
export async function editSong(req, res) {
  const {songId, title, artist, genre, releaseYear} = req.body
  const cover = req.files.cover
  checkReq(!songId)

  const [dbSong] = await safeOperation(
    () => db.query("select songFileName, fk_UserDataId from Songs where songId = ?", [songId]),
    "Error while fetching song from database"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  await safeOperation(
    async () => {
      if (title) await db.query("update Songs set title = ? where songId = ?", [title, songId])
      if (genre) await db.query("update Songs set genre = ? where songId = ?", [genre, songId])
      if (releaseYear) await db.query("update Songs set releaseYear = ? where songId = ?", [releaseYear, songId])
      if (artist) {
        let artistId = 0
        const [dbArtist] = await db.query("select artistId from Artists where lower(artistName) = lower(?)", [artist])
        if (dbArtist.length === 0) {
          const [artistResult] = await db.query("insert into Artists (artistName) values (?)", [artist])
          artistId = artistResult.insertId
        } else {
          artistId = dbArtist[0].artistId
        }
        await db.query("update Songs set fk_ArtistId = ? where songId = ?", [artistId, songId])
      }
      if (cover) {
        const coverFilepath = `./songs/cover/${dbSong[0].songFileName}.jpg`

        await unlink(coverFilepath)
        await sharp(cover[0].filepath).jpeg().toFile(coverFilepath)
      }
    },
    "Error while updating song metadata"
  )

  res.status(200).json({success: true, message: "Successfully edited the song"})
}

// delete a song
export async function deleteSong(req, res) {
  const {songId} = req.body
  checkReq(!songId)

  const [dbSong] = await safeOperation(
    () => db.query("select fk_UserDataId, songFileName from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})
  
  await safeOperations([
    () => unlink(`./songs/audio/${dbSong[0].songFileName}.m4a`),
    () => unlink(`./songs/cover/${dbSong[0].songFileName}.jpg`)
  ], "Error while deleting song files")

  await safeOperation(
    () => db.query("delete from Songs where songId = ?", [songId]),
    "Error while deleting song database entry"
  )

  res.status(200).json({success: true, message: "Successfully deleted the song"})
}

// toggle favorite for a song
export async function toggleFavorite(req, res) {
  const {songId} = req.body
  checkReq(!songId)

  const [dbSong] = await safeOperation(
    () => db.query("select fk_UserDataId, isFavorite from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  const setValue = !Boolean(dbSong[0].isFavorite)
  await safeOperation(
    () => db.query("update Songs set isFavorite = ? where songId = ?", [setValue, songId]),
    "Error while toggling favorite on song"
  )

  res.status(200).json({success: true, message: "Successfully toggled favorite on the song"})
}

// reset metadata of a song
export async function resetSong(req, res) {
  const {songId} = req.body
  checkReq(!songId)

  const [dbSong] = await safeOperation(
    () => db.query("select fk_UserDataId, songFileName from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (dbSong.length === 0) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong[0].fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})
  
  const metadata = await safeOperation(
    () => parseFile(`./songs/audio/${dbSong[0].songFileName}.m4a`),
    "Error while reading metadata"
  )

  const common = metadata.common

  let artistId = 0
  if (common.artist) {
    const [dbArtist] = await safeOperation(
      () => db.query("select artistId from Artists where lower(artistName) = lower(?)", [common.artist]),
      "Error while selecting artist from the database"
    )

    if (dbArtist.length === 0) {
      const [artistResult] = await safeOperation(
        () => db.query("insert into Artists (artistName) values (?)", [common.artist]),
        "Error while inserting new artist"
      )
      artistId = artistResult.insertId
    } else {
      artistId = dbArtist[0].artistId
    }
  } else {
    artistId = 1
  }

  if (metadata.common.picture && metadata.common.picture.length > 0) {
    await safeOperation(
      async () => {
        const cover = common.picture[0]
        const convertedCover = await sharp(cover.data).jpeg().toBuffer()
        const coverFilepath = `./songs/cover/${dbSong[0].songFileName}.jpg`

        await unlink(coverFilepath)
        await writeFile(coverFilepath, convertedCover)
      },
      "Error while resetting the cover"
    )
  }

  await safeOperation(
    () => db.query("update Songs set title = ?, genre = ?, releaseYear = ?, fk_ArtistId = ? where songId = ?",
                   [common.title, common.genre, common.year, artistId, songId]
    ),
    "Error while updating the song metadata"
  )

  res.status(200).json({success: true, message: "Successfully reset the song metadata"})
} 