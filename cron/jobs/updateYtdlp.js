import { exec as execCb } from 'child_process'
import { promisify } from 'util'
import dotenv from "dotenv"
dotenv.config()

const exec = promisify(execCb)

export default async function updateYtdlp() {
  try {
    await exec(`${process.env.YTDLP_PATH} --update`)
  } catch (error) {
    console.error("Error while updating yt-dlp", error)
  }
}