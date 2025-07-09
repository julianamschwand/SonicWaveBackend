import axios from 'axios'
import bcrypt from 'bcrypt'
import AdmZip from 'adm-zip'
import { extract } from 'tar'
import { promises as readlinePromises} from 'readline' 
import { queryRootDB } from './root-db.js'
import { randomBytes } from 'crypto'
import { platform } from 'os'
import { createWriteStream, existsSync } from 'fs'
import { chmod, mkdir, writeFile, readFile, rename, rm, access } from 'fs/promises'

async function setupWizard() {
  // checking os
  const os = platform()

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
  await mkdir("./songs/audio", { recursive: true })
  await mkdir("./songs/cover", { recursive: true })

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
      setupScript = await readFile("./db/db-setup.sql", "utf-8");
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
      insert into Artists (artistName, artistDescription) values ('Unknown','Unknown artist');
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
    win32_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", "yt-dlp_win32.exe"],
    linux_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", "yt-dlp_linux"],
    darwin_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", "yt-dlp_macos"],
    win32_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-win32.exe", "spotdl_win32.exe"],
    linux_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-linux", "spotdl_linux"],
    darwin_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-darwin", "spotdl_darwin"],
    win32_ffmpeg: ["https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip", "ffmpeg_win32"],
    linux_ffmpeg: ["https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz", "ffmpeg_linux"],
    darwin_ffmpeg: ["https://evermeet.cx/ffmpeg/get/zip", "ffmpeg_macos"]
  }

  for (const download of downloads) {
    const key = `${os}_${download}`

    const [url, filename] = urls[key]
    const downloadname = url.split("/").pop()
    const downloadpath = `./bin/${downloadname}`
    console.log(downloadname)

    if (!url) {
      console.warn(`No binary available for ${download} on ${os}. This will break base functionality`)
      continue
    }

    paths[download] = `./bin/${filename}`
    
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
        await rename(downloadpath.slice(0, -4), `./bin/${filename}`)
      } else if (fileSuffix === "xz") {
        await extract({
          file: downloadpath,
          C: "./bin/"
        })
        await rm(downloadpath)
        await rename(downloadpath.slice(0, -7), `./bin/${filename}`)
      }
    }

    try {
      await access(downloadpath)
      await rename(downloadpath, `./bin/${filename}`)
    } catch (error) {
      continue
    }
  }
  
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
    envContent += `\n${key.toUpperCase()}_PATH="${value}${key === "ffmpeg" ? "/bin" : ""}"`
  }

  await writeFile("./.env", envContent, "utf-8")

  console.log("Successfully created .env file")
  input.close()
  console.log("\nSetup complete! Restart the program")
  process.exit(0)
}

export default setupWizard