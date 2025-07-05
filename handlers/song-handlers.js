import util from 'util'
import dotenv from 'dotenv'
import axios from 'axios'
import { randomBytes } from 'crypto'
import { exec as execCb } from 'child_process'
import { unlink } from 'fs/promises'
import { db } from '../db/db.js'
dotenv.config()

const exec = util.promisify(execCb)

// play a downloaded song
export async function playSong(req, res) {

}

// download a song by URL
export async function downloadSong(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

  const {songURL} = req.body
  if (!songURL) return res.status(400).json({success: false, message: "Missing data"})

  try {
    const filename = randomBytes(4).toString('hex') + ".mp3"

    const {stderr} = await exec(process.env.YTDLP_PATH +
                                        ` -x` +
                                        ` --audio-format mp3` +
                                        ` --audio-quality 0` +
                                        ` --embed-metadata` +
                                        ` --embed-thumbnail` +
                                        ` --add-metadata` +
                                        ` -o "./songs/${filename}"` +
                                        ` "${songURL}"`)
  
    res.status(200).json({success: true, message: "Successfully downloaded the song and added it to account"})
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while downloading the song"})
  }
}

// browse songs with soundcloud
export async function browseSongs(req, res) {
  const {query} = req.query
  if (!query) return res.status(400).json({success: false, message: "Missing data"})

  try {
    const response = await axios.get(`https://soundcloud.com/search?q=${query}`);

    const regex = /<h2><a href="(\/[^\/]+\/[^\/]+)">/g
    const filtered = [...response.data.matchAll(regex)]

    const structured = filtered.map(match => {
      const splitMatch = match[1].split("/")
      
      return {
        name: splitMatch[2][0].toUpperCase() + splitMatch[2].slice(1),
        artist: splitMatch[1][0].toUpperCase() + splitMatch[1].slice(1),
        url: "https://soundcloud.com" + match[1]
      }
    })

    res.status(200).json({success: true, message: "Successfully fetched songs", songs: structured})
  } catch (error) {
    console.error(error);
    res.status(500).json({success: false, message: "Error while browsing songs"})
  }
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