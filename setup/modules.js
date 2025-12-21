import { readFile } from 'fs/promises'

export async function readDBSetup() {
	try {
		return (await readFile("./db/db-setup.sql", "utf-8"))
	} catch (error) {
		console.error("Error while reading db-setup.sql")
		process.exit(1)
	}
}