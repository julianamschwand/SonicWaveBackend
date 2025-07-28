create table UserData (
  userDataId int primary key auto_increment,
  username varchar(50) unique,
  email varchar(254) unique,
  passwordHash varchar(255),
  userRole enum('user','admin','owner'),
  approved boolean
);

create table Playlists (
  playlistId int primary key auto_increment,
  playlistName varchar(30),
  playlistDescription text,
  playlistCoverFileName char(36),
  fk_UserDataId int,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table Artists (
  artistId int primary key auto_increment,
  artistName varchar(100) unique,
  artistDescription text
);

create table Songs (
  songId int primary key auto_increment,
  songFileName char(36) unique,
  title varchar(100),
  genre varchar(20),
  duration int,
  releaseYear int,
  isFavorite boolean default false,
  lastPlayed timestamp,
  fk_UserDataId int,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);

create table SongArtists(
  songArtistId int primary key auto_increment,
  fk_SongId int,
  fk_ArtistId int,
  foreign key (fk_SongId) references Songs(songId) on delete cascade,
  foreign key (fk_ArtistId) references Artists(artistId) on delete cascade
);

create table PlaylistSongs (
  playlistSongId int primary key auto_increment,
  fk_PlaylistId int,
  fk_SongId int,
  foreign key (fk_PlaylistId) references Playlists(playlistId) on delete cascade,
  foreign key (fk_SongId) references Songs(songId) on delete cascade
);

create table OneTimePasswords (
  otpId int primary key auto_increment,
  otp char(6),
  attemptsRemaining int default 3,
  fk_UserDataId int,
  foreign key (fk_UserDataId) references UserData(userDataId) on delete cascade
);