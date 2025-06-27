import mysql from 'mysql2/promise'

export async function queryRootDB(rootPass, dbHost, query) {
  try {
    const connection = await mysql.createConnection({
      host: dbHost,
      user: 'root',
      password: rootPass,
      multipleStatements: true,
    });

    try {
      const [result] = await connection.query(query)
      connection.end()
      return result
      
    } catch (error) {
      console.error("Error while querying rootdb:", error)
    }
  } catch (error) {
    console.error("Error while making connection to rootdb:", error)
  }
}
