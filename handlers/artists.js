import { db } from '../db/db.js'
import { unlink } from 'fs/promises'
import sharp from 'sharp'
import { safeOperation, safeOperations, checkReq } from '../error-handling.js'


export async function allArtists(req, res) {
  const [artists] = await safeOperation(
    () => db.query(`select artistId, artistName, artistDescription, artistImageFileName, count(songArtistId) as songCount
                    from Artists
                    join SongArtists on artistId = fk_ArtistId 
                    where fk_UserDataId = ?
                    group by artistId, artistName, artistDescription, artistImageFileName
                    order by count(songArtistId) desc, artistName`, [req.session.user.id]),
    "Error while fetching artists from database"
  )

  const formattedArtists = artists.map(artist => {
    const imageURL = `${req.protocol}://${req.get('host')}/artists/image/${artist.artistImageFileName}.jpg`

    return {
      artistId: artist.artistId,
      name: artist.artistName,
      description: artist.artistDescription,
      songCount: artist.songCount,
      image: imageURL
    }
  })

  res.status(200).json({success: true, message: "Successfully retrieved artists from database", artists: formattedArtists})
}

export async function singleArtist(req, res) {
  const {artistId} = req.query
  checkReq(!artistId)

  const [[artist]] = await safeOperation(
    () => db.query(`select artistId, artistName, artistDescription, artistImageFileName, count(songArtistId) as songCount, fk_UserDataId
                    from Artists
                    left join SongArtists on artistId = fk_ArtistId 
                    where artistId = ?
                    group by artistId, artistName, artistDescription, artistImageFileName
                    order by count(songArtistId) desc, artistName`, [artistId]),
    "Error while fetching artist from database"
  )

  if (!artist) return res.status(404).json({success: false, message: "Artist not found"})
  if (artist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your artist"})

  const [songs] = await safeOperation(
    () => db.query(`select songId, title, genre, duration, releaseYear, isFavorite, songFileName, 
                    json_arrayagg(json_object('artistId', artistId, 'artistName', artistName)) as artists
                    from Songs
                    left join SongArtists on fk_SongId = songId
                    left join Artists on fk_ArtistId = artistId
                    where artistId = ?
                    group by songId 
                    order by title`, [artistId]),
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

  const imageURL = `${req.protocol}://${req.get('host')}/artists/image/${artist.artistImageFileName}.jpg`
  const formattedArtist = {
    artistId: artist.artistId,
    name: artist.artistName,
    description: artist.artistDescription,
    songCount: artist.songCount,
    image: imageURL,
    songs: formattedSongs
  }

  res.status(200).json({success: true, message: "Successfully retrieved artist from database", artist: formattedArtist})
}

export async function editArtist(req, res) {
  const {artistId, name, description} = req.body
  const image = req.files.image
  checkReq(!artistId)

  const [[dbArtist]] = await safeOperation(
    () => db.query("select artistImageFileName, fk_UserDataId from Artists where artistId = ?", [artistId]),
    "Error while fetching artist from database"
  )

  if (!dbArtist) return res.status(404).json({success: false, message: "Artist not found"})
  if (dbArtist.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your artist"})

  await safeOperation(
    async () => {
      if (name) await db.query("update Artists set artistName = ? where artistId = ?", [name, artistId])
      if (description || description === "") await db.query("update Artists set artistDescription = ? where artistId = ?", [description, artistId])
      if (image) {
        const imageFilePath = `./data/artist-images/${dbArtist.artistImageFileName}.jpg`
        
        await unlink(imageFilePath)
        await sharp(image[0].filepath).jpeg().toFile(imageFilePath)
      }
    },
    "Error while editing artist"
  )

  res.status(200).json({success: true, message: "Successfully edited the artist"})
}

export async function getImage(req, res) {
  const filename = req.params.filename

  const [[dbUser]] = await safeOperation(
    () => db.query("select fk_UserDataId from Artists where artistImageFileName = ?", [filename.slice(0, -4)]),
    "Error while checking the covers owner"
  )

  if (!dbUser) return res.status(404).json({success: false, message: "Cover not found"})
  if (dbUser.fk_UserDataId !== req.session.user.id) return res.status(403).json({success: false, message: "Not your cover"})
  
  res.status(200).sendFile(`${process.cwd()}/data/artist-images/${filename}`)
}