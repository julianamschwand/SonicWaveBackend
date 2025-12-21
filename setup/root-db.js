import mysql from 'mysql2/promise'
import os from 'os'

export async function queryRootDB(rootPass, dbHost, query) {
  try {
    const connection = process.platform === 'linux' ? 
      await mysql.createConnection({
        host: dbHost,
        user: os.userInfo().username,
        socketPath: '/var/run/mysqld/mysqld.sock',
        multipleStatements: true,
      }) :
      await mysql.createConnection({
        host: dbHost,
        user: 'root',
        password: rootPass,
        multipleStatements: true,
      })

    try {
      const [result] = await connection.query(query)
      connection.end()
      return result
    } catch (error) {
      connection.end()
      console.error("Error while querying rootdb:", error)
      process.exit(1)
    }
  } catch (error) {
    console.error("Error while making connection to rootdb:", error)
    if (process.platform === 'linux') console.warn("User must have access to mysql socket")
  }
}
