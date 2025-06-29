import axios from 'axios'
import { promises as readlinePromises} from 'readline' 
import { queryRootDB } from './root-db.js'
import { randomBytes } from 'crypto'
import { platform } from 'os'
import { createWriteStream } from 'fs'
import { chmod, mkdir, writeFile, readFile } from 'fs/promises'

async function setupWizard() {
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
    console.log("Setting up database ...")

    let setupScript = ""
    try {
      setupScript = await readFile("./db-setup.sql", "utf-8");
    } catch (error) {
      console.error("Error while reading db-setup.sql")
    }
    
    userPass = randomBytes(16).toString("hex")

    await queryRootDB(rootPass, dbHost,
      `drop database if exists SonicWave;
      create database SonicWave;
      use SonicWave;
      ${setupScript}
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

  // yt-dlp and spotDL download
  const os = platform()

  const downloads = ["ytdlp", "spotdl"]
  const paths = {}

  const urls = {
    win32_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", "yt-dlp.exe"],
    linux_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", "yt-dlp_linux"],
    darwin_ytdlp: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", "yt-dlp_macos"],
    win32_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-win32.exe", "spotdl-4.2.11-win32.exe"],
    linux_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-linux", "spotdl-4.2.11-linux"],
    darwin_spotdl: ["https://github.com/spotDL/spotify-downloader/releases/download/v4.2.11/spotdl-4.2.11-darwin", "spotdl-4.2.11-darwin"],
  }

  await mkdir("./bin", { recursive: true })

  for (const download of downloads) {
    const key = `${os}_${download}`

    const [url, filename] = urls[key]

    if (!url) {
      console.warn(`No binary available for ${download} on ${os}. This will break base functionality`)
      continue
    }

    paths[download] = `./bin/${filename}`
    
    console.log(`Downloading ${download} ...`)

    const file = createWriteStream(`./bin/${filename}`)

    const response = await axios.get(url, { responseType: "stream" })
    response.data.pipe(file)

    await new Promise((resolve, reject) => {
      file.on("finish", async () => {
        file.close()
        if (os !== "win32") {
          await chmod(`./bin/${filename}`, 0o755)
        }
        console.log("Successfully downloaded " + download)
        resolve()
      })
      file.on("error", reject)
    })
  }
  
  // asking for additional information
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
  `PORT="${port}"`

  for (const [key, value] of Object.entries(paths)) {
    envContent += `\n${key.toUpperCase()}_PATH="${value}"`
  }

  await writeFile("./.env", envContent, "utf-8")

  console.log("Successfully created .env file")

  input.close()

  console.log("\nSetup complete!")
}

export default setupWizard