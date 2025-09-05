import util from 'util'
import dotenv from 'dotenv'
import axios from 'axios'
import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { exec as execCb } from 'child_process'
import { parseFile } from 'music-metadata'
import { createReadStream } from 'fs'
import { unlink, writeFile, copyFile, stat } from 'fs/promises'
import { db } from '../db/db.js'
import { safeOperation, safeOperations, checkReq } from '../error-handling.js'
import { formatSongs } from '../functions.js'
dotenv.config()

const exec = util.promisify(execCb)

// stream a song to a client
export async function playSong(req, res) {
  const {songId} = req.query
  checkReq(!songId)

  const [[dbSong]] = await safeOperation(
    () => db.query("select fk_UserDataId, songFileName from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  await safeOperation(
    () => db.query("update Songs set lastPlayed = ? where songId = ?", [new Date(), songId]),
    "Error while updating last played timestamp"
  )

	const songPath = `./data/songs/audio/${dbSong.songFileName}.m4a`
	const songStat = await safeOperation(
    () => stat(songPath),
    "Error while fetching song stats"
  )
  const songSize = songStat.size

	const range = req.headers.range
	if (!range) {
      res.writeHead(200, {
        'Content-Length': songSize,
        'Content-Type': 'audio/mp4',
      })
      const fileStream = createReadStream(songPath)
      fileStream.pipe(res)
	} else {
		const bytesPrefix = "bytes="
		if (!range.startsWith(bytesPrefix)) {
			return res.status(400).send("Malformed Range header")
		}
		const bytesRange = range.substring(bytesPrefix.length).split("-")
		const start = parseInt(bytesRange[0])
		const end = bytesRange[1] ? parseInt(bytesRange[1]) : songSize - 1

		if (start >= songSize || end >= songSize) {
			return res.status(416).header('Content-Range', `bytes */${songSize}`).end()
		}

		const chunkSize = (end - start) + 1
		const fileStream = createReadStream(songPath, { start, end })
		
		res.writeHead(206, {
			'Content-Range': `bytes ${start}-${end}/${songSize}`,
			'Accept-Ranges': 'bytes',
			'Content-Length': chunkSize,
			'Content-Type': 'audio/mp4'
		})
		fileStream.pipe(res)
	}
}

// download a song by URL
export async function downloadSong(req, res) {
  const {songURL} = req.body
  checkReq(!songURL)

  const filename = randomUUID()
  const songpath = `./data/songs/audio/${filename}.m4a`

  const cropFilter = process.platform === "win32" ?
    "if(gt(ih\\\\,iw)\\\\,iw\\\\,ih):if(gt(iw\\\\,ih)\\\\,ih\\\\,iw)" :
    "if(gt(ih\\,iw)\\,iw\\,ih):if(gt(iw\\,ih)\\,ih\\,iw)"

  const {stderr} = await safeOperation(
    () => exec(`"${process.env.YTDLP_PATH}"` +
              ` -x` +
              ` --audio-format m4a` +
              ` --audio-quality 0` +
              ` --ffmpeg-location ${process.env.FFMPEG_PATH}` +
              ` --embed-metadata` +
              ` --embed-thumbnail` +
              ` --add-metadata` +
              ` --no-playlist` +
              ` --convert-thumbnails jpg` +
              ` --ppa "ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg -vf crop=${cropFilter}"` +
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

  const splitArtists = common.artist.split("，").map(artist => artist.trim())

  const artistIds = []
  if (splitArtists.length > 0) {
    for (const artist of splitArtists) {
      const [dbArtist] = await safeOperation(
        () => db.query("select artistId from Artists where lower(artistName) = lower(?) and fk_UserDataId = ?", [artist, req.session.user.id]),
        "Error while selecting artist from the database"
      )

      if (dbArtist.length === 0) {
        const artistImageFileName = randomUUID()
        const [[artistResult]] = await safeOperations([
          () => db.query("insert into Artists (artistName, artistImageFileName, fk_UserDataId) values (?,?,?)", [artist, artistImageFileName, req.session.user.id]),
          () => copyFile("./data/default-images/artist.jpg", `./data/artist-images/${artistImageFileName}.jpg`)
        ], "Error while inserting new artist")
        artistIds.push(artistResult.insertId)
      } else {
        artistIds.push(dbArtist[0].artistId) 
      }
    }
  }

  if (common.picture && common.picture.length > 0) {
    await writeFile(`./data/songs/cover/${filename}.jpg`, common.picture[0].data)
  } else {
    const randomNumber = Math.floor(Math.random() * 6) + 1
    await copyFile(`./data/default-images/songs/${randomNumber}.jpg`, `./data/songs/cover/${filename}.jpg`)
  }

  const [result] = await safeOperation(
    () => db.query(`insert into Songs (songFileName, title, genre, duration, releaseYear, fk_UserDataId)
                    values (?,?,?,?,?,?)`,
                    [filename, common.title, common.genre, format.duration, common.year, req.session.user.id]),
    "Error while saving Songdata to database"
  )
  
  await safeOperation(
    async () => {
      for (const artistId of artistIds) {
        await db.query("insert into SongArtists (fk_SongId, fk_ArtistId) values (?,?)", [result.insertId, artistId])
      }
    },
    "Error while inserting Artist references"
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

      const coverURL = /<img src="([^"]+)"/.exec(songPage.data)
      const titleAndArtist = /<h1 itemprop="name"><a itemprop="url" href="[^"]+">([^<]+)<\/a>\s*by\s*<a[^>]+>([^<]+)/.exec(songPage.data)
      const genre = /"genre" content="([^"]+)"/.exec(songPage.data)

      const cleanTitle = (titleAndArtist?.[1] || "Unknown Title").replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "")
      const cleanArtist = (titleAndArtist?.[2] || "Unknown Artist").replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "")
      const cleanGenre = (genre?.[1] || "(None)").replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "")

      const randomNumber = Math.floor(Math.random() * 6) + 1
      const defaultCoverURL = `${req.protocol}://${req.get('host')}/default-images/songs/${randomNumber}.jpg`
      
      return {
        title: cleanTitle,
        artist: cleanArtist,
        genre: cleanGenre,
        url,
        cover: coverURL?.[1] || defaultCoverURL,
      }
    })
  )

  res.status(200).json({success: true, message: "Successfully fetched songs", songs: structured})
}

// get a single song
export async function song(req, res) {
  const {songId} = req.query
  checkReq(!songId)

  const [[song]] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, Songs.fk_UserDataId, 
                    json_arrayagg(json_object('artistId', artistId, 'name', artistName)) as artists
                    from Songs
                    left join SongArtists on fk_SongId = songId
                    left join Artists on fk_ArtistId = artistId
                    where songId = ?
                    group by songId`, [songId]),
    "Error while fetching song from database"
  )

  if (!song) return res.status(404).json({success: false, message: "Song not found"})
  if (song.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})
  
  res.status(200).json({success: true, message: "Successfully retrieved song from database", song: formatSongs(req, [song])[0]})
}

// get all songs
export async function allSongs(req, res) {
  const [songs] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, 
                    json_arrayagg(json_object('artistId', artistId, 'name', artistName)) as artists
                    from Songs
                    left join SongArtists on fk_SongId = songId
                    left join Artists on fk_ArtistId = artistId
                    where Songs.fk_UserDataId = ?
                    group by songId 
                    order by title`, [req.session.user.id]),
    "Error while fetching songs from database"
  )

  res.status(200).json({success: true, message: "Successfully retrieved songs from database", songs: formatSongs(req, songs)})
}

// get cover image
export async function getCover(req, res) {
  const filename = req.params.filename

  const [[dbUser]] = await safeOperation(
    () => db.query("select fk_UserDataId from Songs where songFileName = ?", [filename.slice(0, -4)]),
    "Error while checking the covers owner"
  )

  if (!dbUser) return res.status(404).json({success: false, message: "Cover not found"})
  if (dbUser.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your cover"})
  
  res.status(200).sendFile(`${process.cwd()}/data/songs/cover/${filename}`)
}

// edit an existing songs metadata
export async function editSong(req, res) {
  const {songId, title, artistAdd, artistDelete, genre, releaseYear} = req.body
  const cover = req.files.cover
  checkReq(!songId)

  const [[dbSong]] = await safeOperation(
    () => db.query("select songFileName, fk_UserDataId from Songs where songId = ?", [songId]),
    "Error while fetching song from database"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  const newArtists = []

  await safeOperation(
    async () => {
      if (artistDelete) {
        for (const artist of JSON.parse(artistDelete)) {
          const [[dbArtist]] = await db.query("select artistId from Artists where lower(artistName) = lower(?) and fk_UserDataId = ?", [artist, req.session.user.id])
          if (!dbArtist) return res.status(404).json({success: false, message: "Artist to delete not found"})
          await db.query("delete from SongArtists where fk_SongId = ? and fk_ArtistId = ?", [songId, dbArtist.artistId])
        }
      }
      if (artistAdd) {
        for (const artist of JSON.parse(artistAdd)) {
          let artistId = 0
          const [[dbArtist]] = await db.query("select artistId, artistName from Artists where lower(artistName) = lower(?) and fk_UserDataId = ?", [artist, req.session.user.id])
          if (!dbArtist) {
            const artistImageFileName = randomUUID()
            const [artistResult] = await db.query("insert into Artists (artistName, artistImageFileName, fk_UserDataId) values (?,?,?)", [artist, artistImageFileName, req.session.user.id])
            await copyFile("./data/default-images/artist.jpg", `./data/artist-images/${artistImageFileName}.jpg`)
            artistId = artistResult.insertId
          } else {
            artistId = dbArtist.artistId
          }
          newArtists.push({artistId: artistId, name: dbArtist ? dbArtist.artistName : artist})
          await db.query("insert into SongArtists (fk_SongId, fk_ArtistId) values (?,?)", [songId, artistId])
        }
      } 
      if (title) await db.query("update Songs set title = ? where songId = ?", [title, songId])
      if (genre || genre === "") await db.query("update Songs set genre = ? where songId = ?", [genre, songId])
      if (releaseYear) await db.query("update Songs set releaseYear = ? where songId = ?", [releaseYear, songId])
      if (cover) {
        const coverFilepath = `./data/songs/cover/${dbSong.songFileName}.jpg`

        await unlink(coverFilepath)
        await sharp(cover[0].filepath).jpeg().toFile(coverFilepath)
      }
    },
    "Error while updating song metadata"
  )

  res.status(200).json({success: true, message: "Successfully edited the song", ...(artistAdd ? {newArtists: newArtists} : {})})
}

// delete a song
export async function deleteSong(req, res) {
  const {songId} = req.body
  checkReq(!songId)

  const [[dbSong]] = await safeOperation(
    () => db.query("select fk_UserDataId, songFileName from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})
  
  await safeOperations([
    () => unlink(`./data/songs/audio/${dbSong.songFileName}.m4a`),
    () => unlink(`./data/songs/cover/${dbSong.songFileName}.jpg`)
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

  const [[dbSong]] = await safeOperation(
    () => db.query("select fk_UserDataId, isFavorite from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})

  const setValue = !Boolean(dbSong.isFavorite)
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

  const [[dbSong]] = await safeOperation(
    () => db.query("select fk_UserDataId, songFileName from Songs where songId = ?", [songId]),
    "Error while fetching song owner"
  )

  if (!dbSong) return res.status(404).json({success: false, message: "Song not found"})
  if (dbSong.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your song"})
  
  const metadata = await safeOperation(
    () => parseFile(`./songs/audio/${dbSong.songFileName}.m4a`),
    "Error while reading metadata"
  )

  const common = metadata.common

  const splitArtists = common.artist.split("，").map(artist => artist.trim())

  const artistIds = []
  if (splitArtists.length > 0) {
    for (const artist of splitArtists) {
      const [[dbArtist]] = await safeOperation(
        () => db.query("select artistId from Artists where lower(artistName) = lower(?) and fk_UserDataId = ?", [artist, req.session.user.id]),
        "Error while selecting artist from the database"
      )

      if (!dbArtist) {
        const artistImageFileName = randomUUID()
        const [artistResult] = await safeOperation([
          () => db.query("insert into Artists (artistName, artistImageFileName, fk_UserDataId) values (?,?,?)", [artist, artistImageFileName, req.session.user.id]),
          () => copyFile("./data/default-images/artist.jpg", `./data/artist-images/${artistImageFileName}.jpg`)
        ], "Error while inserting new artist")
        artistIds.push(artistResult.insertId)
      } else {
        artistIds.push(dbArtist.artistId) 
      }
    }
  }

  await safeOperation(
    async () => {
      await db.query("delete from SongArtists where fk_SongId = ?", [songId])

      for (const artistId of artistIds) {
        await db.query("insert into SongArtists (fk_SongId, fk_ArtistId) values (?,?)", [songId, artistId])
      }
    },
    "Error while resetting Artist references"
  )
  
	await safeOperation(
		async () => {
			if (common.picture && common.picture.length > 0) {
				const coverFilepath = `./data/songs/cover/${dbSong.songFileName}.jpg`

				await unlink(coverFilepath)
				await writeFile(coverFilepath, common.picture[0].data)
			} else {
				const randomNumber = Math.floor(Math.random() * 6) + 1
				await copyFile(`./data/default-images/songs/${randomNumber}.jpg`, `./data/songs/cover/${filename}.jpg`)
			}
		},
		"Error while resetting the cover"
	)

  await safeOperation(
    () => db.query("update Songs set title = ?, genre = ?, releaseYear = ? where songId = ?",
                   [common.title, common.genre, common.year, songId]
    ),
    "Error while updating the song metadata"
  )

  res.status(200).json({success: true, message: "Successfully reset the song metadata"})
} 

// get the 20 most recently played songs
export async function recentlyPlayed(req, res) {
  const [songs] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, 
                    json_arrayagg(json_object('artistId', artistId, 'name', artistName)) as artists
                    from Songs
                    left join SongArtists on fk_SongId = songId
                    left join Artists on fk_ArtistId = artistId
                    where Songs.fk_UserDataId = ? and lastPlayed != "null"
                    group by songId 
                    order by lastPlayed desc
                    limit 20`, [req.session.user.id]),
    "Error while fetching songs from database"
  )

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

  res.status(200).json({success: true, message: "Successfully got the most recently played songs", songs: formattedSongs})
}