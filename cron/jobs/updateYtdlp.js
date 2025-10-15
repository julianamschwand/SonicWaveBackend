import axios from "axios"
import { createWriteStream } from "fs"
import { readFile, rename, access, rm, chmod, writeFile } from "fs/promises"
import dotenv from "dotenv"
dotenv.config()

export default async function updateYtdlp() {
  try {
    const localVersion = (await readFile("./bin/yt-dlp-version", "utf-8")).trim()

    try {
      const latestReleaseResponse = await axios.get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
      const latestVersion = latestReleaseResponse.data.tag_name
      
      if (localVersion === latestVersion) return

      try {
        await rename(process.env.YTDLP_PATH, process.env.YTDLP_PATH + "_old")
      } catch (error) {
        return console.error("Error while renaming the old yt-dlp bin")
      }

      let downloadURL = ""
      switch (process.platform) {
        case "win32":
          downloadURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
          break
        case "linux":
          downloadURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
          break
        case "darwin":
          downloadURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
          break
      }

      try {
        const file = createWriteStream(process.env.YTDLP_PATH)
        const downloadResponse = await axios.get(downloadURL, { responseType: "stream" })
        downloadResponse.data.pipe(file)

        await new Promise((resolve, reject) => {
          file.on("finish", () => {
            file.close()
            resolve()
          })
          file.on("error", reject)
        })

        if (process.platform !== "win32") {
          await chmod(process.env.YTDLP_PATH, 0o755).catch((error) => console.error("Error while changing bin permissions", error))
        }

        await rm(process.env.YTDLP_PATH + "_old").catch((error) => console.error("Error while deleting the old yt-dlp version", error))

        await writeFile("./bin/yt-dlp-version", latestVersion, "utf-8").catch((error) => console.error("Error while updating yt-dlp-version file", error))
        console.log("Successfully updated yt-dlp")
      } catch (error) {
        console.error("Error while downloading the latest release of yt-dlp", error)

        try {
          await access(process.env.YTDLP_PATH)
          await rm(process.env.YTDLP_PATH)
          await rename(process.env.YTDLP_PATH + "_old", process.env.YTDLP_PATH)
        } catch (rollbackError) {
          console.error("Error while rolling back update", rollbackError)
        }
      }
    } catch (error) {
      console.error("Error while fetching latest yt-dlp version", error)
    }
  } catch (error) {
    console.error("Error while reading yt-dlp version", error)
  }
}