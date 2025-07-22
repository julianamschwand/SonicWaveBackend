export default function checkAuth(req, res, next) {
 if (!req.session.user) {
    return res.status(401).json({success: false, message: "Not logged in"})
  }
  next()
}