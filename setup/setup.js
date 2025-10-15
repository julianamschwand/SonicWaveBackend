import axios from 'axios'
import bcrypt from 'bcrypt'
import AdmZip from 'adm-zip'
import { extract } from 'tar'
import { promises as readlinePromises} from 'readline' 
import { queryRootDB } from './root-db.js'
import { randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { chmod, mkdir, writeFile, readFile, rm } from 'fs/promises'

async function setupWizard() {
  // checking os
  const os = process.platform

  if (os !== "linux" && os !== "win32" && os !== "darwin") {
    console.warn("Unsupported os")
    process.exit(0)
  }

  // get root password for mariadb
  const input = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // ask to use the setup wizard
  const useWizard = await input.question("Welcome to SonicWave. The program is not set up yet. Use wizard? (y): ")
  if (useWizard != "y") {
    process.exit(0)
  }

  // creating folders
  await mkdir("./bin", { recursive: true })
  await mkdir("./data/songs/audio", { recursive: true })
  await mkdir("./data/songs/cover", { recursive: true })
  await mkdir("./data/playlist-covers", { recursive: true })
  await mkdir("./data/artist-images", { recursive: true })

  // ask for db credentials
  const rootPass = await input.question("Enter your MariaDB / MySQL root password: ")
  const dbHost = await input.question("Enter your database host: ")

  // check if db exists
  const result = await queryRootDB(rootPass, dbHost, 
    `select SCHEMA_NAME 
    from INFORMATION_SCHEMA.SCHEMATA 
    where SCHEMA_NAME = 'SonicWave';`
  )

  let createDB = false

  if (result.length === 0) {
    createDB = true
  } else {
    let createDBAnswer = ""
    while (createDBAnswer != "y" && createDBAnswer != "n") {
      if (createDBAnswer !== "") {
        console.log("Wrong input")
      }
      
      createDBAnswer = await input.question("Database already exists. Drop it and create a new one? (y/n): ")
    }

    if (createDBAnswer == "y") {
      createDB = true
    } else {
      createDB = false
    }
  }

  // setup database
  let userPass = ""

  if (createDB) {
    // asking for website owner credentials
    const ownerName = await input.question("Enter the name for the website owner: ")
    const ownerEmail = await input.question("Enter the email for the website owner: ")
    const ownerPassword = await input.question("Enter the password for the website owner: ")

    const hashedOwnerPassword = await bcrypt.hash(ownerPassword, 10)

    console.log("Setting up database ...")

    let setupScript = ""
    try {
      setupScript = await readFile("./db/db-setup.sql", "utf-8")
    } catch (error) {
      console.error("Error while reading db-setup.sql")
    }
    
    userPass = randomBytes(16).toString("hex")

    await queryRootDB(rootPass, dbHost,
      `drop database if exists SonicWave;
      create database SonicWave;
      use SonicWave;
      ${setupScript}
      insert into UserData (username, email, passwordHash, userRole, approved) 
      values ('${ownerName}','${ownerEmail}','${hashedOwnerPassword}','owner',true);
      drop user if exists 'SonicWaveUser'@'localhost';
      create user 'SonicWaveUser'@'${dbHost}' identified by '${userPass}';
      grant all privileges on SonicWave.* to 'SonicWaveUser'@'${dbHost}';
      flush privileges;`
    )
    console.log("Successfully set up database")
  } else {
    console.log("Didn't create database")
    userPass = await input.question("Password for database user: ")
  }

  // yt-dlp, spotDL and ffmpeg download
  const downloads = ["ytdlp", "spotdl", "ffmpeg"]
  const paths = {}

  const urls = {
    win32_ytdlp: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    linux_ytdlp: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
    darwin_ytdlp: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    win32_spotdl: "https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-win32.exe",
    linux_spotdl: "https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-linux",
    darwin_spotdl: "https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-darwin",
    win32_ffmpeg: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip",
    linux_ffmpeg: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz",
    darwin_ffmpeg: "https://evermeet.cx/ffmpeg/get/zip"
  }

  for (const download of downloads) {
    const key = `${os}_${download}`

    const url = urls[key]
    const downloadname = url.split("/").pop()
    const downloadpath = `./bin/${downloadname}`

    if (!url) {
      console.warn(`No binary available for ${download} on ${os}. This will break base functionality`)
      continue
    }

    paths[download] = `./bin/${downloadname}`
    
    console.log(`Downloading ${download} ...`)

    const file = createWriteStream(downloadpath)
    const response = await axios.get(url, { responseType: "stream" })
    response.data.pipe(file)

    await new Promise((resolve, reject) => {
      file.on("finish", async () => {
        file.close()
        if (os !== "win32") {
          await chmod(downloadpath, 0o755)
        }
        console.log("Successfully downloaded " + download)
        resolve()
      })
      file.on("error", reject)
    })

    const filenameSplit = downloadname.split(".")
    if (filenameSplit.length > 1) {
      const fileSuffix = filenameSplit[filenameSplit.length - 1]
      if (fileSuffix === "zip") {
        console.log("extract")
        const zip = new AdmZip(downloadpath)
        zip.extractAllTo("./bin/", true)
        await rm(downloadpath)
      } else if (fileSuffix === "xz") {
        await extract({
          file: downloadpath,
          C: "./bin/"
        })
        await rm(downloadpath)
      }
    }
  }

  // saving yt-dlp version as a file so it can be automatically updated
  const ytdlpVersionResponse = await axios.get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
  const ytdlpVersion = ytdlpVersionResponse.data.tag_name

  await writeFile("./bin/yt-dlp-version", ytdlpVersion, "utf-8")
  
  // asking for additional ENV information
  let nodeEnvAnswer = ""
  let nodeEnv = ""

  while (nodeEnvAnswer != "p" && nodeEnvAnswer != "d" && nodeEnvAnswer != "production" && nodeEnvAnswer != "development") {
    if (nodeEnvAnswer !== "") {
      console.log("Wrong input")
    }
    nodeEnvAnswer = await input.question("Production or development? (p/d): ")
  }

  if (nodeEnvAnswer == "p" || nodeEnvAnswer == "production") {
    nodeEnv = "production"
  } else {
    nodeEnv = "development"
  }

  const originURL = await input.question("Enter your origin URL (URL of frontend): ")
  const proxyNumber = await input.question("Enter your number of proxies: ")
  const port = await input.question("Enter the port this program will be using: ")

  // asking for smtp info
  const smtpHost = await input.question("Enter your SMTP host: ")
  const smtpPort = await input.question("Enter your SMTP port: ")
  const smtpUser = await input.question("Enter your SMTP user: ")
  const smtpPass = await input.question("Enter your SMTP password: ")

  // // asking for spotify app credentials for spotDL
  // const spotifyClientId = input.question("Enter your spotify app client id: ")
  // const spotifyClientSecret = input.question("Enter your spotify app client secret: ")

  // writing .env file
  console.log("Creating .env file ...")

  let envContent = `DB_NAME="SonicWave"\n` + 
  `DB_USER="SonicWaveUser"\n` +
  `DB_HOST="${dbHost}"\n` +
  `DB_PASS="${userPass}"\n\n` +
  `SESSION_SECRET="${randomBytes(16).toString("hex")}"\n\n` +
  `NODE_ENV="${nodeEnv}"\n` +
  `ORIGIN_URL="${originURL}"\n` + 
  `PROXY_NUMBER="${proxyNumber}"\n` +
  `PORT="${port}"\n\n` + 
  `SMTP_HOST="${smtpHost}"\n` +
  `SMTP_PORT="${smtpPort}"\n` +
  `SMTP_USER="${smtpUser}"\n` +
  `SMTP_PASS="${smtpPass}"\n`/* +
  `SPOTIFY_CLIENT_ID="${spotifyClientId}"\n` +
  `SPOTIFY_CLIENT_SECRET="${spotifyClientSecret}"\n`*/

  for (const [key, value] of Object.entries(paths)) {
    envContent += `\n${key.toUpperCase()}_PATH="${key === "ffmpeg" ? value.slice(0, -4) + "/bin" : value}"`
  }

  await writeFile("./.env", envContent, "utf-8")

  console.log("Successfully created .env file")
  input.close()
  console.log("\nSetup complete! Restart the program")
  process.exit(0)
}

export default setupWizard