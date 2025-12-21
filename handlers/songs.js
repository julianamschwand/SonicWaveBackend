import { promisify } from 'util'
import dotenv from 'dotenv'
import axios from 'axios'
import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { exec as execCb } from 'child_process'
import { parseFile } from 'music-metadata'
import { createReadStream } from 'fs'
import { unlink, copyFile, stat, readdir, rename, rmdir } from 'fs/promises'
import { db } from '../db/db.js'
import { safeOperation, safeOperations, checkReq } from '../error-handling.js'
import { formatSongs, asyncSpawn, sendSSE } from '../general-functions.js'
dotenv.config()

const exec = promisify(execCb)

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
  const {songURL} = req.query
  checkReq(!songURL)

  const filename = randomUUID()
  const songpath = `./data/songs/audio/${filename}.m4a`

  const ytdlpParams = [
    "-x",
    "--audio-format", "m4a",
    "--audio-quality", "0",
    "--ffmpeg-location", process.env.FFMPEG_PATH,
    "--embed-metadata",
    "--embed-thumbnail",
    "--add-metadata",
    "--no-playlist",
    "--convert-thumbnails", "jpg",
    "-o", songpath,
    songURL
  ]

  await safeOperation(
    () => asyncSpawn(process.env.YTDLP_PATH, ytdlpParams, (data) => {
      const match = data.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+[MKG]iB\/s)/)
      if (match) sendSSE(res, "download", { progress: parseFloat(match[1]), speed: match[2] })
    }),
    "Error while downloading the song"
  )

  const metadata = await safeOperation(
    () => parseFile(songpath),
    "Error while reading metadata"
  )

  const common = metadata.common
  const format = metadata.format

  const splitArtists = common.artist?.split("，").map(artist => artist.trim()) || ""

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
          () => copyFile("./data/default-images/artist.avif", `./data/artist-images/${artistImageFileName}.avif`)
        ], "Error while inserting new artist")
        artistIds.push(artistResult.insertId)
      } else {
        artistIds.push(dbArtist[0].artistId)
      }
    }
  }

  sendSSE(res, "action", { desc: "Converting cover ..." })

  if (common.picture && common.picture.length > 0) {
    await sharp(common.picture[0].data).resize({ width: 1000, height: 1000, fi: 'inside', withoutEnlargement: true }).avif({ quality: 60, effort: 6 }).toFile(`./data/songs/cover/${filename}.avif`)
  } else {
    const randomNumber = Math.floor(Math.random() * 6) + 1
    await copyFile(`./data/default-images/songs/${randomNumber}.avif`, `./data/songs/cover/${filename}.avif`)
  }

  sendSSE(res, "action", { desc: "Inserting song into database ..." })

  const [result] = await safeOperation(
    () => db.query(`insert into Songs (songFileName, title, genre, duration, releaseYear, fk_UserDataId)
                    values (?,?,?,?,?,?)`,
                    [filename, common.title, common.genre, format.duration, common.year, req.session.user.id]),
    "Error while saving Songdata to database"
  )

  sendSSE(res, "action", { desc: "Inserting artists into database ..." })
  
  const artistPlaceholders = artistIds.map(() => "(?,?)").join(",")
  const artistData = artistIds.flatMap(artistId => [result.insertId, artistId])
  const artistQuery = `insert into SongArtists (fk_SongId, fk_ArtistId) values ${artistPlaceholders}`

  await safeOperation(
    () => db.query(artistQuery, artistData),
    "Error while inserting Artist references"
  )
  
  sendSSE(res, "done", { success: true, message: "Successfully downloaded the song and added it to account" })
}

// download playlist
export async function downloadPlaylist(req, res) {
  const {playlistURL} = req.query
  checkReq(!playlistURL)
  
  const folderpath = `./data/songs/audio/.temp-${randomUUID()}`
  
  const ytdlpParams = [
    "-x",
    "--audio-format", "m4a",
    "--audio-quality", "0",
    "--ffmpeg-location", process.env.FFMPEG_PATH,
    "--embed-metadata",
    "--embed-thumbnail",
    "--add-metadata",
    "--convert-thumbnails", "jpg",
    "-o", `${folderpath}/%(playlist_index)s.m4a`,
    playlistURL
  ]

  let currentItem = 0
  let maxItems = 0

  await safeOperation(
    () => asyncSpawn(process.env.YTDLP_PATH, ytdlpParams, (data) => {
      const itemMatch = data.match(/\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)/)
      if (itemMatch) {
        currentItem = Number(itemMatch[1])
        maxItems = Number(itemMatch[2])
      }

      const progressMatch = data.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+[MKG]iB\/s)/)
      if (progressMatch) sendSSE(res, "download", { progress: Number(progressMatch[1]), speed: progressMatch[2], currentSong: currentItem, maxSongs: maxItems })
    }),
    "Error while downloading the song"
  )

  const allSongMetadata = []
  const allArtistIds = []
  const files = await readdir(folderpath)

  sendSSE(res, "action", { desc: "Converting covers ..." })

  for (const file of files.filter(file => file.endsWith(".m4a"))) {
    const filename = randomUUID()
    const songpath = `./data/songs/audio/${filename}.m4a`

    await safeOperation(
      () => rename(`${folderpath}/${file}`, songpath),
      "Error while moving the audio file"
    )

    const metadata = await safeOperation(
      () => parseFile(songpath),
      "Error while reading metadata"
    )

    const common = metadata.common
    const format = metadata.format

    const splitArtists = common.artist?.split("，").map(artist => artist.trim()) || ""

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
            () => copyFile("./data/default-images/artist.avif", `./data/artist-images/${artistImageFileName}.avif`)
          ], "Error while inserting new artist")
          artistIds.push(artistResult.insertId)
        } else {
          artistIds.push(dbArtist[0].artistId) 
        }
      }
    }

    if (common.picture && common.picture.length > 0) {
      await sharp(common.picture[0].data).resize({ width: 1000, height: 1000, fi: 'inside', withoutEnlargement: true }).avif({ quality: 60, effort: 6 }).toFile(`./data/songs/cover/${filename}.avif`)
    } else {
      const randomNumber = Math.floor(Math.random() * 6) + 1
      await copyFile(`./data/default-images/songs/${randomNumber}.avif`, `./data/songs/cover/${filename}.avif`)
    }

    allArtistIds.push(artistIds)
    allSongMetadata.push([filename, common.title, common.genre, format.duration, common.year, req.session.user.id])
  }

  await safeOperation(
    () => rmdir(folderpath),
    "Error while deleting the temp folder"
  )

  sendSSE(res, "action", { desc: "Inserting songs into database ..." })

  const songPlaceholders = allSongMetadata.map(() => "(?,?,?,?,?,?)").join(",")
  const flatSongMetadata = allSongMetadata.flat()
  const songQuery = `insert into Songs (songFileName, title, genre, duration, releaseYear, fk_UserDataId) values ${songPlaceholders}`

  const [songResult] = await safeOperation(
    () => db.query(songQuery, flatSongMetadata),
    "Error while saving Songdata to database"
  )

  sendSSE(res, "action", { desc: "Inserting artists into database ..." })

  const artistPlaceholders = allArtistIds.flat().map(() => "(?,?)").join(",")
  let currentId = songResult.insertId
  const artistData = allArtistIds.flatMap(artistIds => {
    const data = artistIds.flatMap(artistId => [currentId, artistId])
    currentId++
    return data
  })
  const artistQuery = `insert into SongArtists (fk_SongId, fk_ArtistId) values ${artistPlaceholders}`

  await safeOperation(
    () => db.query(artistQuery, artistData),
    "Error while inserting Artist references"
  )

  sendSSE(res, "action", { desc: "Creating playlist ..." })

  const {stdout} = await safeOperation(
    () => exec(`"${process.env.YTDLP_PATH}" --dump-json --flat-playlist --playlist-items 1 "${playlistURL}"`),
    "Error while getting playlist data"
  )

  const playlistName = JSON.parse(stdout).playlist || "Downloaded Playlist"
  const playlistFileName = randomUUID()

  await safeOperation(
    () => copyFile(`./data/songs/cover/${allSongMetadata[0][0]}.avif`, `./data/playlist-covers/${playlistFileName}.avif`),
    "Error while saving playlist cover"
  )

  const [playlistResult] = await safeOperation(
    () => db.query(`insert into Playlists (playlistName, playlistDescription, playlistCoverFileName, fk_UserDataId)
                   values (?,?,?,?)`, [playlistName, "", playlistFileName, req.session.user.id]),
    "Error while inserting playlist into database"
  )

  currentId = songResult.insertId
  let playlistIndex = 0

  const playlistSongPlaceholders = allSongMetadata.map(() => "(?,?,?)").join(",")
  const playlistSongData = allSongMetadata.flatMap(() => {
    const data = [playlistIndex, playlistResult.insertId, currentId]
    currentId++
    playlistIndex++
    return data
  })
  const playlistSongQuery = `insert into PlaylistSongs (playlistIndex, fk_PlaylistId, fk_SongId) values ${playlistSongPlaceholders}`

  await safeOperation(
    () => db.query(playlistSongQuery, playlistSongData),
    "Error while inserting songs into the playlist"
  )

  sendSSE(res, "done", { success: true, message: "Successfully downloaded the playlist and added it to account" })
}

// browse songs with soundcloud
export async function browseSongs(req, res) {
  const {query, site} = req.query
  checkReq(!query || !site)

  let searchURL = ""
  let regex = null

  switch (site) {
    case "soundcloud":
      searchURL = `https://soundcloud.com/search?q=${query}`
      regex = /<h2><a href="(\/[^\/]+\/[^\/]+)">/g
      break
    case "newgrounds":
      searchURL = `https://www.newgrounds.com/search/conduct/audio?suitabilities=etma&c=3&terms=${query}`
      regex = /<a href="[^"]+" class="item-audiosubmission\s*" title="[^"]+">.+?<\/a>/gs
      break
  }

  const searchPage = await safeOperation(
    () => axios.get(searchURL),
    "Error while getting search page"
  )
  
  const filtered = [...searchPage.data.matchAll(regex)]

  const structuredSongs = await Promise.all(
    filtered.map(async match => {
      let title = ""
      let artist = ""
      let genre = ""
      let url = ""
      let coverURL = ""

      switch (site) {
        case "soundcloud":
          url = "https://soundcloud.com" + match[1]
  
          const songPage = await safeOperation(
            () => axios.get(url),
            "Error while getting song page"
          )

          const titleAndArtistMatch = /<h1 itemprop="name"><a itemprop="url" href="[^"]+">([^<]+)<\/a>\s*by\s*<a[^>]+>([^<]+)/.exec(songPage.data)
          coverURL = /<img src="([^"]+)"/.exec(songPage.data)
          genre = /"genre" content="([^"]+)"/.exec(songPage.data)?.[1]

          title = titleAndArtistMatch?.[1]
          artist = titleAndArtistMatch?.[2]
          break
        case "newgrounds":
          title = /title="([^"]+)/.exec(match[0])?.[1]
          artist = /<strong>([^<]+)/.exec(match[0])?.[1]
          genre = /<dl>\s*<dd>.*?<\/dd>\s*<dd>(.*?)<\/dd>/.exec(match[0])?.[1]
          url = /href="([^"]+)/.exec(match[0])?.[1]
          coverURL = /src="([^"]+)/.exec(match[0])

          if (!isNaN(Number(genre[0]))) genre = null
          break
      }

      const cleanTitle = title ? (title).replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "") : title
      const cleanArtist = artist ? (artist).replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "") : artist
      const cleanGenre = genre ? (genre).replace(/amp;/g, "").replace(/&#x27;/g, "'").replace(/&[^;]+;/g, "") : genre
      const defaultCoverURL = `${req.protocol}://${req.get('host')}/default-images/songs/${Math.floor(Math.random() * 6) + 1}.avif`
      
      return {
        title: cleanTitle,
        artists: [{name: cleanArtist}],
        genre: cleanGenre,
        url: url,
        cover: coverURL?.[1] || defaultCoverURL,
      }
    })
  )

  res.status(200).json({success: true, message: "Successfully fetched songs", songs: structuredSongs})
}

// get a single song
export async function song(req, res) {
  const {songId} = req.query
  checkReq(!songId)

  const [[song]] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, Songs.fk_UserDataId, lastPlayed, 
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
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, lastPlayed,
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
    () => db.query("select fk_UserDataId from Songs where songFileName = ?", [filename.slice(0, -5)]),
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
            await copyFile("./data/default-images/artist.avif", `./data/artist-images/${artistImageFileName}.avif`)
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
        const coverFilepath = `./data/songs/cover/${dbSong.songFileName}.avif`

        await unlink(coverFilepath)
        await sharp(cover[0].filepath).resize({ width: 1000, height: 1000, fi: 'inside', withoutEnlargement: true }).avif({ quality: 60, effort: 6 }).toFile(coverFilepath)
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
    () => unlink(`./data/songs/cover/${dbSong.songFileName}.avif`)
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
    () => parseFile(`./data/songs/audio/${dbSong.songFileName}.m4a`),
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
        const [artistResult] = await safeOperations([
          () => db.query("insert into Artists (artistName, artistImageFileName, fk_UserDataId) values (?,?,?)", [artist, artistImageFileName, req.session.user.id]),
          () => copyFile("./data/default-images/artist.avif", `./data/artist-images/${artistImageFileName}.avif`)
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
      const coverFilepath = `./data/songs/cover/${dbSong.songFileName}.avif`

			if (common.picture && common.picture.length > 0) {
				await unlink(coverFilepath)
				await sharp(common.picture[0].data).resize({ width: 1000, height: 1000, fi: 'inside', withoutEnlargement: true }).avif({ quality: 60, effort: 6 }).toFile(coverFilepath)
			} else {
				const randomNumber = Math.floor(Math.random() * 6) + 1
				await copyFile(`./data/default-images/songs/${randomNumber}.avif`, coverFilepath)
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

  const [[resetSong]] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, Songs.fk_UserDataId, lastPlayed, 
                    json_arrayagg(json_object('artistId', artistId, 'name', artistName)) as artists
                    from Songs
                    left join SongArtists on fk_SongId = songId
                    left join Artists on fk_ArtistId = artistId
                    where songId = ?
                    group by songId`, [songId]),
    "Error while fetching reset song from database"
  )

  res.status(200).json({success: true, message: "Successfully reset the song metadata", song: formatSongs(req, [resetSong])[0]})
} 