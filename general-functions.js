import { spawn } from 'child_process'

export function formatSongs(req, songs) {
  return songs.map(song => {
    const coverURL = `${req.protocol}://${req.get('host')}/songs/cover/${song.songFileName}.avif`
    const parsedArtists = JSON.parse(song.artists)

    return {
      songId: song.songId,
      title: song.title,
      genre: song.genre,
      duration: song.duration,
      releaseYear: song.releaseYear,
      isFavorite: Boolean(song.isFavorite),
      lastPlayed: song.lastPlayed,
      cover: coverURL,
      artists: parsedArtists[0].artistId ? parsedArtists : []
    }
  })
}

export function formatPlaylists(req, playlists, songs) {
  return playlists.map(playlist => {
    const coverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist.playlistCoverFileName}.avif`

    let parsedSongs = []
    if (!songs) parsedSongs = JSON.parse(playlist.songs)

    return {
      ...{
        playlistId: playlist.playlistId,
        name: playlist.playlistName,
        description: playlist.playlistDescription,
        duration: Number(playlist.duration) || 0,
        songCount: playlist.songCount,
        cover: coverURL,
      },
      songs: !songs ? (parsedSongs[0] ? parsedSongs : []) : formatSongs(req, songs)
    }
  })
}

export function asyncSpawn(command, args, onData) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const str = data.toString()
      stdout += str
      try {
        onData(str)
      } catch (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })

    child.stderr.on('data', (data) => {
      const str = data.toString()
      stderr += str
    })

    child.on('error', reject)

    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else {
        const error = new Error(`Exited with code ${code}`)
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })
  })
}

export function sendSSE(res, event, data) {
  return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}