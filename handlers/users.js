import bcrypt from 'bcrypt'
import { db } from '../db/db.js'
import { mailer } from '../mailer.js'
import { safeOperation, safeOperations, HttpError, checkReq } from '../error-handling.js'

// get the userdata from a single user
export async function userdata(req, res) { 
  const [user] = await safeOperation( 
    () => db.query("select username, email, userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving userdata from the database"
  )
  
  res.status(200).json({success: true, message: "Successfully retrieved userdata from database", user: user[0]})
}

// register a new user
export async function register(req, res) {
  const {username, email, password} = req.body
  checkReq(!username || !email || !password)

  const [[dbUsername], [dbEmail]] = await safeOperations([
    () => db.query("select * from UserData where username = ?", [username]),
    () => db.query("select * from UserData where email = ?", [email])
  ], "Error while fetching username")

  if (dbUsername.length !== 0) return res.status(400).json({success: false, message: "Username is taken"})
  if (dbEmail.length !== 0) return res.status(400).json({success: false, message: "E-Mail is taken"})

  const hashedpassword = await bcrypt.hash(password, 10)

  await safeOperation(
    () => db.query("insert into UserData (username, email, passwordHash, approved, userRole) values (?,?,?,false,'user')", [username, email, hashedpassword]),
    "Error while registering"
  )

  res.status(200).json({success: true, message: "Register request sent successfully"})
}

// login a user
export async function login(req, res) {
  const {username, email, password} = req.body
  checkReq((!username && !email) || !password)

  const [dbUser] = await safeOperation(
    async () => {
      if (username) {
        return await db.query("select * from UserData where username = ?", [username])
      } else {
        return await db.query("select * from UserData where email = ?", [email])
      }
    }, 
    "Error while fetching user from the database"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "User not found"})

  const isPasswordValid = await bcrypt.compare(password, dbUser[0].passwordHash)
  if (!isPasswordValid) return res.status(401).json({success: false, message: "Wrong password"})

  if (!dbUser[0].approved) return res.status(403).json({success: false, message: "Register request hasn't been approved yet"})

  req.session.user = { id: dbUser[0].userDataId }
  res.status(200).json({success: true, message: "User successfully logged in"})
}

// logout a user
export async function logout(req, res) {
  req.session.destroy()
  res.clearCookie('SessionId')
  res.status(200).json({success: true, message: 'Logged out successfully'})
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
  let userDataId = undefined
  if (req.session.user.id) userDataId = req.session.user.id
  checkReq((!userDataId && !email) || (!passwordOld && !otp) || !passwordNew)
  
  if (!userDataId) {
    const [dbUser] = await safeOperation(
      () => db.query("select userDataId from UserData where email = ?", [email]),
      "Error while fetching userdata from the database"
    )
    userDataId = dbUser[0].userDataId;
  }

  if (passwordOld) {
    const [dbUser] = await safeOperation(
      () => db.query("select passwordHash from UserData where userDataId = ?", [userDataId]),
      "Error while verifying old password"
    )
    const isPasswordValid = await bcrypt.compare(passwordOld, dbUser[0].passwordHash)
    if (!isPasswordValid) return res.status(401).json({success: false, message: "Wrong password"})

  } else {
    await safeOperation(
      async () => {
        const [dbOTP] = await db.query("select otp from OneTimePasswords where fk_UserDataId = ?", [userDataId])

        if (dbOTP.length === 0) throw new HttpError("No valid OTP found for this account", 404)


        if (dbOTP[0].otp !== otp) {
          await db.query("update OneTimePasswords set attemptsRemaining = attemptsRemaining - 1 where fk_UserDataId = ?", [userDataId])
          const [otpAtt] = await db.query("select attemptsRemaining from OneTimePasswords where fk_UserDataId = ?", [userDataId])
          if (otpAtt[0].attemptsRemaining === 0) await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [userDataId])
          
          throw new HttpError("Wrong Password", 401, {attemptsRemaining: otpAtt[0].attemptsRemaining})
        }

        await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [userDataId])
      },
      "Error while verifying OTP"
    )
  }

  const hashedpassword = await bcrypt.hash(passwordNew, 10)
  await safeOperation(
    () => db.query("update UserData set passwordHash = ? where userDataId = ?", [hashedpassword, userDataId]),
    "Error while updating password"
  )
  res.status(200).json({success: true, message: "Successfully changed password"})
}

// send a code to reset the password (or maybe login later on)
export async function sendOTP(req, res) {
  const {email} = req.body
  checkReq(!email)

  const [dbUser] = await safeOperation(
    () => db.query("select userDataId from UserData where email = ?", [email]),
    "Error while fetching userdata from the database"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "No user with this E-Mail"})
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }

  const result = await safeOperation(
    async () => {
      await db.query("delete from OneTimePasswords where fk_UserDataId = ?", [dbUser[0].userDataId])
      const [result] = await db.query("insert into OneTimePasswords (otp,fk_UserDataId) values (?,?)", [code, dbUser[0].userDataId])
      return result
    },
    "Error while saving the code to the database"
  )

  await safeOperation(
    () => mailer(email, "One Time Password", `Use this code: ${code}`),
    "Error while sending the OTP",
    () => db.query("delete from OneTimePasswords where otpId = ?", [result.insertId])
  )

  res.status(200).json({success: true, message: "Successfully sent a OTP to your E-Mail"})

  setTimeout(async () => {
    await db.query("delete from OneTimePasswords where otpId = ?", [result.insertId])
  }, 1000 * 60 * 3)
}

// delete a user. Only accessible to admin, owner or the user to be deleted
export async function deleteUser(req, res) {
  const {userDataId} = req.body
  checkReq(!userDataId)
  
  const [[reqUser], [dbUser]] = await safeOperations([
    () => db.query("select * from UserData where userDataId = ?", [req.session.user.id]),
    () => db.query("select * from UserData where userDataId = ?", [userDataId])
  ], "Error while retrieving userdata from the database")

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "User not found"})
  if (reqUser[0].userRole === "user") return res.status(403).json({success: false, message: "Only admins and the owner can delete users"})
  if (dbUser[0].userRole === "owner") return res.status(403).json({success: false, message: "Can't delete owner"})
  if (dbUser[0].userRole === "admin" && reqUser[0].userRole !== "owner") return res.status(403).json({success: false, message: "Can only delete admins as owner"})
  
  await safeOperation(
    () => db.query("delete from UserData where userDataId = ?", [userDataId]),
    "Error while deleting user"
  )

  res.status(200).json({success: true, message: `Successfully deleted '${dbUser[0].username}'`})
}

// promote a user to admin. Only accessible to owner
export async function makeAdmin(req, res) {
  const {userDataId} = req.body
  checkReq(!userDataId)
  
  const [reqUser] = await safeOperation(
    () => db.query("select userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving the requesting users userdata from the database"
  )

  if (reqUser[0].userRole !== "owner") return res.status(403).json({success: false, message: "Only the owner can manage user roles"})

  const [dbUser] = await safeOperation(
    () => db.query("select username, userRole from UserData where userDataId = ?", [userDataId]),
    "Error while retrieving the requested users userdata from the database"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "User not found"})
  if (dbUser[0].userRole === "admin") return res.status(409).json({success: false, message: "User is already admin"})
  if (dbUser[0].userRole === "owner") return res.status(403).json({success: false, message: "Can't change the owners role"})
  
  await safeOperation(
    () => db.query("update UserData set userRole = 'admin' where userDataId = ?", [userDataId]),
    "Error while promoting user"
  )

  res.status(200).json({success: true, message: `Successfully promoted '${dbUser[0].username}' to admin`})
}

// demote an admin to user. Only accessible by owner
export async function removeAdmin(req, res) {
  const {userDataId} = req.body
  checkReq(!userDataId)
  
  const [reqUser] = await safeOperation(
    () => db.query("select userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving the requesting users userdata from the database"
  )
  

  if (reqUser[0].userRole !== "owner") return res.status(403).json({success: false, message: "Only the owner can manage user roles"})

  const [dbUser] = await safeOperation(
    () => db.query("select username, userRole from UserData where userDataId = ?", [userDataId]),
    "Error while retrieving the requested users userdata from the database"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "User not found"})
  if (dbUser[0].userRole === "owner") return res.status(403).json({success: false, message: "Can't change the owners role"})
  if (dbUser[0].userRole !== "admin") return res.status(409).json({success: false, message: "User is not an admin"})
  
  await safeOperation(
    () => db.query("update UserData set userRole = 'user' where userDataId = ?", [userDataId]),
    "Error while demoting user"
  )
  
  res.status(200).json({success: true, message: `Successfully demoted '${dbUser[0].username}' to user`})
}

// approve a register request. Only accessible to admin and owner
export async function approveRegister(req, res) {
  const {userDataId} = req.body
  checkReq(!userDataId)

  const [reqUser] = await safeOperation(
    () =>  db.query("select userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving userdata from the database"
  )

  if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") return res.status(403).json({success: false, message: "Only admins and the owner can approve register requests"})

  const [dbUser] = await safeOperation(
    () => db.query("select username, approved from UserData where userDataId = ?", [userDataId]),
    "Error while retrieving register requests from the database"
  )
  
  if (dbUser.length === 0) return res.status(404).json({success: false, message: "Register request not found"})
  if (dbUser[0].approved) return res.status(409).json({success: false, message: "User is already registered"})
  
  await safeOperation(
    () => db.query("update UserData set approved = true where userDataId = ?", [userDataId]),
    "Error while accepting register request"
  )

  res.status(200).json({success: true, message: `Successfully approved the register request of user '${dbUser[0].username}'`})
}

// deny a register request. Only accessible to admin and owner
export async function denyRegister(req, res) {
  const {userDataId} = req.body
  checkReq(!userDataId)
  
  const [reqUser] = await safeOperation(
    () => db.query("select userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving userdata from the database"
  )

  if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") return res.status(403).json({success: false, message: "Only admins and the owner can deny register requests"}) 

  const [dbUser] = await safeOperation(
    () => db.query("select username, approved from UserData where userDataId = ?", [userDataId]),
    "Error while retrieving register requests from the database"
  )

  if (dbUser.length === 0) return res.status(404).json({success: false, message: "Register request not found"})
  if (dbUser[0].approved) return res.status(409).json({success: false, message: "User is already registered"})
  
  await safeOperation(
    () => db.query("delete from UserData where userDataId = ?", [userDataId]),
    "Error while denying register request"
  )
  
  res.status(200).json({success: true, message: `Successfully denied and deleted the register request of user '${dbUser[0].username}'`})
}

// get all register requests. Only accessible by admin and owner
export async function registerRequests(req, res) {
  const [reqUser] = await safeOperation(
    () => db.query("select userRole from UserData where userDataId = ?", [req.session.user.id]),
    "Error while retrieving userdata from the database"
  )

  if (reqUser[0].userRole !== "owner" && reqUser[0].userRole !== "admin") return res.status(403).json({success: false, message: "Only admins and the owner can see register requests"}) 

  const [regRequests] = await safeOperation(
    () => db.query("select userDataId, username, email from UserData where approved = false"),
    "Error while retrieving register requests from the database"
  )

  res.status(200).json({success: true, message: "Successfully retrieved register requests from database", requests: regRequests})
}