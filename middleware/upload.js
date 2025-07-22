import formidable from 'formidable'

export default function upload(uploadDir) {
  return async function handleUpload(req, res, next) {
    const form = formidable({
      uploadDir: uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024
    })

    try {
      const [fields, files] = await form.parse(req)

      req.body = fields
      req.files = files
      next()
    } catch (error) {
      next(error)
    }
  } 
}