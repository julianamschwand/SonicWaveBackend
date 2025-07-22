import mysql from "mysql2/promise"
import session from "express-session"
import connectMySQL from "express-mysql-session"
import dotenv from "dotenv"
dotenv.config()

const MySQLStore = connectMySQL(session)

const dbOptions = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionLimit: 20,
  enableKeepAlive: true,
}

export const db = mysql.createPool(dbOptions)

export function createSessionStore() { return new MySQLStore({}, db) }