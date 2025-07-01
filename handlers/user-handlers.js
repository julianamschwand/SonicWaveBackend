import { db } from '../db.js'
import bcrypt from 'bcrypt'

// get the userdata from a single user
export async function userdata(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})
  
  try {
    const [user] = await db.query("select username, email, userRole from UserData where userDataId = ?", [req.session.user.id])

    res.status(200).json({success: true, user: user[0]})
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({success: false, error: "Error while retrieving userdata from the database"})
  }
}

// register a new user
export async function register(req, res) {
  const {username, email, password} = req.body
  if (!username || !email || !password ) return res.status(400).json({success: false, error: "Missing data"})  

  try {
    const [dbUsername] = await db.query("select * from UserData where username = ?", [username])
    const [dbEmail] = await db.query("select * from UserData where email = ?", [email])

    if (dbUsername.length !== 0) return res.status(400).json({success: false, error: "Username is taken"})
    if (dbEmail.length !== 0) return res.status(400).json({success: false, error: "E-Mail is taken"})

    try {
      const hashedpassword = await bcrypt.hash(password, 10)
      await db.query("insert into UserData (username, email, passwordHash, approved, userRole) values (?,?,?,false,'user')", [username, email, hashedpassword])

      res.status(200).json({success: true, message: "Register request sent successfully"})
    } catch (error) {
      console.error("Error:", error)
      res.status(500).json({success: false, error: "Error while registering"})
    }
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({success: false, error: "Error while fetching userdata from the database"})
  }
}

// login a user
export async function login(req, res) {
  const {username, email, password} = req.body
  if ((!username && !email) || !password) return res.status(400).json({success: false, error: "Missing data"})

  try {
    let dbUser = []
    
    if (username) {
      [dbUser] = await db.query("select * from UserData where username = ?", [username])
    } else {
      [dbUser] = await db.query("select * from UserData where email = ?", [email])
    }

    if (dbUser.length === 0) return res.status(404).json({success: false, error: "User not found"})

    const isPasswordValid = await bcrypt.compare(password, dbUser[0].passwordHash)
    if (!isPasswordValid) return res.status(401).json({success: false, error: "Wrong password"})

    if (!dbUser[0].approved) return res.status(403).json({success: false, error: "Register request hasn't been approved yet"})

    req.session.user = { id: dbUser[0].userDataId }
    res.status(200).json({success: true, message: "User successfully logged in"})
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({success: false, error: "Error while logging in"})
  }
}

// logout a user
export async function logout(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

  try {
    req.session.destroy()
    res.clearCookie('SessionId')
    res.status(200).json({success: true, message: 'Logged out successfully'})
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({success: false, error: "Error while logging out"})
  }
}

// get information whether the user is logged in or not
export async function loginState(req, res) {
  if (req.session.user) {
    res.status(200).json({success: true, loggedin: true, message: "Logged in"})
  } else {
    res.status(200).json({success: true, loggedin: false, message: "Not logged in"})
  }
}

// reset the password of a user by old password or email 2FA
export async function resetPassword(req, res) {

}

// delete a user. Only accessible to admin, owner or the user to be deleted
export async function deleteUser(req, res) {

}

// promote a user to admin. Only accessible to owner
export async function makeAdmin(req, res) {

}

// demote an admin to user. Only accessible by owner
export async function removeAdmin(req, res) {

}

// approve a register request. Only accessible to admin and owner
export async function approveRegister(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

}

// deny a register request. Only accessible to admin and owner
export async function denyRegister(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

}

// get all register requests. Only accessible by admin and owner
export async function registerRequests(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

  try {
    const [user] = await db.query("select userRole from UserData where userDataId = ?", [req.session.user.id])

    if (user[0].userRole !== "owner" && user[0].userRole !== "admin") {
      return res.status(403).json({success: false, error: "Only admins and the owner can see register requests"})
    } 

    try {
      const [regRequests] = await db.query("select userDataId, username, email from UserData where approved = false")

      res.status(200).json({success: true, requests: regRequests})
    } catch (error) {
      console.error("Error:", error)
      res.status(500).json({success: false, error: "Error while retrieving register requests from the database"})
    }
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({success: false, error: "Error while retrieving userdata from the database"})
  }
}