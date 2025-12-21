import mysql from 'mysql2/promise'
import bcrypt from 'bcrypt'
import { readDBSetup } from './modules.js'

async function dockerInit() {
  // checking env vars
  if (!process.env.DB_PASS || !process.env.OWNER_NAME || !process.env.OWNER_EMAIL || !process.env.OWNER_PASS) {
    console.error("Not all needed env variables set (need: DB_PASS, OWNER_NAME, OWNER_EMAIL, OWNER_PASS)")
    process.exit(1)
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`SMTP credential env variables not fully set (need: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)\n
                  Password reset by OTP and E-Mail notifications will not work`)
  }

  // DB setup
  const hashedOwnerPassword = await bcrypt.hash(ownerPassword, 10)
  const setupScript = await readDBSetup()

  console.log("Setting up database ...")

  try {
    const connection = await mysql.createConnection({
      host: 'sonicwave-db',
      user: 'SonicWaveUser',
      password: process.env.DB_PASS,
      multipleStatements: true,
    });

    try {
      const [result] = await connection.query(`
        use SonicWave;
        ${setupScript}
        insert into UserData (username, email, passwordHash, userRole, approved) 
        values ('${process.env.OWNER_NAME}','${process.env.OWNER_EMAIL}','${hashedOwnerPassword}','owner',true);
      `)
      connection.end()
      return result
      
    } catch (error) {
      console.error("Error while creating database:", error)
    }
  } catch (error) {
    console.error("Error while making connection to database:", error)
  }
}

export default dockerInit