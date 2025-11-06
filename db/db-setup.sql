create table UserData (
  userDataId int unsigned primary key auto_increment,
  username varchar(50) unique,
  email varchar(254) unique,
  passwordHash varchar(255),
  userRole enum('user','admin','owner'),
  approved boolean,
  queueIndex int unsigned
);

create table Playlists (
  playlistId int unsigned primary key auto_increment,
  playlistName varchar(100),
  playlistDescription text,
  playlistCoverFileName char(36),
  fk_UserDataId int unsigned,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table Artists (
  artistId int unsigned primary key auto_increment,
  artistName varchar(100) unique,
  artistDescription text,
  artistImageFileName char(36),
  fk_UserDataId int unsigned,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table Songs (
  songId int unsigned primary key auto_increment,
  songFileName char(36) unique,
  title varchar(100),
  genre varchar(100),
  duration int,
  releaseYear year,
  isFavorite boolean default false,
  lastPlayed timestamp,
  fk_UserDataId int unsigned,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table SongArtists(
  songArtistId int unsigned primary key auto_increment,
  fk_SongId int unsigned,
  fk_ArtistId int unsigned,
  foreign key (fk_SongId) references Songs(songId) on delete cascade,
  foreign key (fk_ArtistId) references Artists(artistId) on delete cascade
);

create table PlaylistSongs (
  playlistSongId int unsigned primary key auto_increment,
  playlistIndex int unsigned,
  fk_PlaylistId int unsigned,
  fk_SongId int unsigned,
  foreign key (fk_PlaylistId) references Playlists(playlistId) on delete cascade,
  foreign key (fk_SongId) references Songs(songId) on delete cascade
);

create table OneTimePasswords (
  otpId int unsigned primary key auto_increment,
  otp char(6),
  attemptsRemaining tinyint default 3,
  fk_UserDataId int unsigned,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table QueuedSongs (
  queuedSongId int unsigned primary key auto_increment,
  fk_UserDataId int unsigned,
  fk_SongId int unsigned,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade,
  foreign key (fk_SongId) references Songs(songId) on delete cascade
);