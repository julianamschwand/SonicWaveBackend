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
      cover: coverURL,
      artists: parsedArtists[0].artistId ? parsedArtists : []
    }
  })
}