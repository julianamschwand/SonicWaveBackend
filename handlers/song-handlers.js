import util from 'util'
import dotenv from 'dotenv'
import axios from 'axios'
import { randomBytes } from 'crypto'
import { exec as execCb } from 'child_process'
import { unlink } from 'fs/promises'
import { db } from '../db/db.js'
import { safeOperation, safeOperations, loggedIn, HttpError, checkReq } from '../error-handling.js'
dotenv.config()

const exec = util.promisify(execCb)

// play a downloaded song
export async function playSong(req, res) {

}

// download a song by URL
export async function downloadSong(req, res) {
  loggedIn(req)

  const {songURL} = req.body
  checkReq(!songURL)

  const filename = randomBytes(4).toString('hex') + ".mp3"

  const {stderr} = await safeOperation(
    () => exec(process.env.YTDLP_PATH +
              ` -x` +
              ` --audio-format mp3` +
              ` --audio-quality 0` +
              ` --embed-metadata` +
              ` --embed-thumbnail` +
              ` --add-metadata` +
              ` -o "./songs/${filename}"` +
              ` "${songURL}"`),
    "Error while downloading the song"
  )
  
  res.status(200).json({success: true, message: "Successfully downloaded the song and added it to account"})
}

// browse songs with soundcloud
export async function browseSongs(req, res) {
  loggedIn(req)

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

// get all songs with optional filters
export async function songs(req, res) {

}

// edit an existing songs metadata
export async function editSong(req, res) {

}

// delete a song
export async function deleteSong(req, res) {

}

// add a song to favorites
export async function favoriteSong(req, res) {

}

// remove a song from favorites
export async function unfavoriteSong(req, res) {

}