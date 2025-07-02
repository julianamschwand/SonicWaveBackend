import bcrypt from 'bcrypt'
import { db } from '../db.js'
import { mailer } from '../mailer.js'

// get the userdata from a single user
export async function userdata(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})
  
  try {
    const [user] = await db.query("select username, email, userRole from UserData where userDataId = ?", [req.session.user.id])

    res.status(200).json({success: true, message: "Successfully retrieved userdata from database", user: user[0]})
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
  }
}

// register a new user
export async function register(req, res) {
  const {username, email, password} = req.body
  if (!username || !email || !password ) return res.status(400).json({success: false, error: "Missing data"})  

  try {
    const [dbUsername] = await db.query("select * from UserData where username = ?", [username])
    const [dbEmail] = await db.query("select * from UserData where email = ?", [email])

    if (dbUsername.length !== 0) return res.status(400).json({success: false, message: "Username is taken"})
    if (dbEmail.length !== 0) return res.status(400).json({success: false, message: "E-Mail is taken"})

    try {
      const hashedpassword = await bcrypt.hash(password, 10)
      await db.query("insert into UserData (username, email, passwordHash, approved, userRole) values (?,?,?,false,'user')", [username, email, hashedpassword])

      res.status(200).json({success: true, message: "Register request sent successfully"})
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while registering"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while fetching userdata from the database"})
  }
}

// login a user
export async function login(req, res) {
  const {username, email, password} = req.body
  if ((!username && !email) || !password) return res.status(400).json({success: false, message: "Missing data"})

  try {
    let dbUser = []
    
    if (username) {
      [dbUser] = await db.query("select * from UserData where username = ?", [username])
    } else {
      [dbUser] = await db.query("select * from UserData where email = ?", [email])
    }

    if (dbUser.length === 0) return res.status(404).json({success: false, message: "User not found"})

    const isPasswordValid = await bcrypt.compare(password, dbUser[0].passwordHash)
    if (!isPasswordValid) return res.status(401).json({success: false, message: "Wrong password"})

    if (!dbUser[0].approved) return res.status(403).json({success: false, message: "Register request hasn't been approved yet"})

    req.session.user = { id: dbUser[0].userDataId }
    res.status(200).json({success: true, message: "User successfully logged in"})
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while logging in"})
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
    console.error(error)
    res.status(500).json({success: false, message: "Error while logging out"})
  }
}

// get information whether the user is logged in or not
export async function loginState(req, res) {
  if (req.session.user) {
    res.status(200).json({success: true, message: "Logged in", loggedIn: true})
  } else {
    res.status(200).json({success: true, message: "Not logged in", loggedIn: false})
  }
}

// change the password of a user by old password or email 2FA
export async function changePassword(req, res) {
  const {email, passwordOld, passwordNew, otp} = req.body
  let userDataId = undefined;
  if (req.session.user.id) userDataId = req.session.user.id
  if ((!userDataId && !email) || (!passwordOld && !otp) || !passwordNew) return res.status(400).json({success: false, message: "Missing data"})
  
  try {
    if (!userDataId) {
      const [dbUser] = db.query("select userDataId from UserData where email = ?", [email])
      userDataId = dbUser[0].userDataId;
    }

    try {
      if (passwordOld) {
        const [dbUser] = await db.query("select passwordHash from UserData where userDataId = ?", [userDataId])
        const isPasswordValid = await bcrypt.compare(passwordOld, dbUser[0].passwordHash)
        if (!isPasswordValid) return res.status(401).json({success: false, message: "Wrong password"})

      } else {
        const [dbOTP] = await db.query("select otp from OneTimePasswords where fk_UserDataId = ?", [userDataId])
        if (dbOTP.length === 0) return res.status(404).json({success: false, message: "No valid OTP found for this account"})

        if (dbOTP[0].otp !== otp) {
          await db.query("update OneTimePasswords set attemptsRemaining = attemptsRemaining - 1 where fk_UserDataId = ?", [userDataId])
          const [otpAtt] = await db.query("select attemptsRemaining from OneTimePasswords where fk_UserDataId = ?", [userDataId])
          if (otpAtt[0].attemptsRemaining === 0) await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [userDataId])

          return res.status(401).json({success: false, message: "Wrong Password", attemptsRemaining: otpAtt[0].attemptsRemaining})
        }

        await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [userDataId])
      }

      try {
        const hashedpassword = await bcrypt.hash(passwordNew, 10)
        await db.query("update UserData set passwordHash = ? where userDataId = ?", [hashedpassword, userDataId])

        res.status(200).json({success: true, message: "Successfully changed password"})
      } catch (error) {
        console.error(error)
        res.status(500).json({success: false, message: "Error while verifying request"})
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while verifying request"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while fetching userdata from the database"})
  }
}

// send a code to reset the password (or maybe login later on)
export async function sendOTP(req, res) {
  const {email} = req.body

  try {
    const [dbUser] = await db.query("select userDataId from UserData where email = ?", [email])

    if (dbUser.length === 0) return res.status(404).json({success: false, message: "No user with this E-Mail"})
    
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }

    try {
      await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [dbUser[0].userDataId])
      const [result] = await db.query("insert into OneTimePasswords (otp,fk_UserDataId) values (?,?)", [code, dbUser[0].userDataId])

      try {
        await mailer(email, "One Time Password", `Use this code: ${code}`)

        res.status(200).json({success: true, message: "Successfully sent a OTP to your E-Mail"})

        setTimeout(async () => {
          await db.query("delete from OneTimePasswords where otpId = ?", [result.insertId])
        }, 1000 * 60 * 3)
      } catch (error) {
        console.error(error)
        res.status(500).json({success: false, message: "Error while sending the OTP"})
        await db.query("delete from OneTimePasswords where otpId = ?", [result.insertId])
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while saving the code to the database"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while fetching userdata from the database"})
  }
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

  const {userDataId} = req.body
  if (!userDataId) return res.status(400).json({success: false, message: "Missing data"})
  
  try {
    const [reqUser] = await db.query("select userRole from UserData where userDataId = ?", [req.session.user.id])

    if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") {
      return res.status(403).json({success: false, message: "Only admins and the owner can approve register requests"})
    } 

    try {
      const [dbUser] = await db.query("select username, approved from UserData where userDataId = ?", [userDataId])

      if (dbUser.length === 0) return res.status(404).json({success: false, message: "Register request not found"})
      if (dbUser[0].approved) return res.status(409).json({success: false, message: "User is already registered"})
      
      try {
        await db.query("update UserData set approved = true where userDataId = ?", [userDataId])

        res.status(200).json({success: true, message: `Successfully approved the register request of user '${dbUser[0].username}'`})
      } catch (error) {
        console.error(error)
        res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while retrieving register requests from the database"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
  }
}

// deny a register request. Only accessible to admin and owner
export async function denyRegister(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

  const {userDataId} = req.body
  if (!userDataId) return res.status(400).json({success: false, message: "Missing data"})
  
  try {
    const [reqUser] = await db.query("select userRole from UserData where userDataId = ?", [req.session.user.id])

    if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") {
      return res.status(403).json({success: false, message: "Only admins and the owner can deny register requests"})
    } 

    try {
      const [dbUser] = await db.query("select username, approved from UserData where userDataId = ?", [userDataId])

      if (dbUser.length === 0) return res.status(404).json({success: false, message: "Register request not found"})
      if (dbUser[0].approved) return res.status(409).json({success: false, message: "User is already registered"})
      
      try {
        await db.query("delete from UserData where userDataId = ?", [userDataId])

        res.status(200).json({success: true, message: `Successfully denied and deleted the register request of user '${dbUser[0].username}'`})
      } catch (error) {
        console.error(error)
        res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while retrieving register requests from the database"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
  }
}

// get all register requests. Only accessible by admin and owner
export async function registerRequests(req, res) {
  if (!req.session.user) return res.status(401).json({success: false, message: 'Unauthorized'})

  try {
    const [reqUser] = await db.query("select userRole from UserData where userDataId = ?", [req.session.user.id])

    if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") {
      return res.status(403).json({success: false, message: "Only admins and the owner can see register requests"})
    } 

    try {
      const [regRequests] = await db.query("select userDataId, username, email from UserData where approved = false")

      res.status(200).json({success: true, message: "Successfully retrieved register requests from database", requests: regRequests})
    } catch (error) {
      console.error(error)
      res.status(500).json({success: false, message: "Error while retrieving register requests from the database"})
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({success: false, message: "Error while retrieving userdata from the database"})
  }
}