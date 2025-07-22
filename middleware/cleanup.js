import { unlink } from 'fs/promises'

export default async function cleanup(req, res, next) {
  res.on("finish", () => {
    if (req.files) {
      for (const files of Object.values(req.files)) {
        for (const file of files) {
          unlink(file.filepath).catch(error => {
            console.error("Failed to delete file:", error)
          })
        }
      }
    }
  })

  next()
}