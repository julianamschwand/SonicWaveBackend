export function formatSongs(req, songs) {
  return songs.map(song => {
    const coverURL = `${req.protocol}://${req.get('host')}/songs/cover/${song.songFileName}.jpg`
    const parsedArtists = JSON.parse(song.artists)

    return {
      songId: song.songId,
      title: song.title,
      genre: song.genre,
      duration: song.duration,
      releaseYear: song.releaseYear,
      isFavorite: Boolean(song.isFavorite),
      lastPlayed: new Date(song.lastPlayed),
      cover: coverURL,
      artists: parsedArtists[0].artistId ? parsedArtists : []
    }
  })
}

export function formatPlaylists(req, playlists, songs) {
  return playlists.map(playlist => {
    const coverURL = `${req.protocol}://${req.get('host')}/playlists/cover/${playlist.playlistCoverFileName}.jpg`

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