import { db } from '../db.js'

// get the userdata from a single user
export async function userdata(req, res) {

}

// register a new user
export async function register(req, res) {

}

// login a user
export async function login(req, res) {

}

// logout a user
export async function logout(req, res) {

}

// get information whether the user is logged in or not
export async function loginState(req, res) {

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

}

// deny a register request. Only accessible to admin and owner
export async function denyRegister(req, res) {

}

// get all register requests. Only accessible by admin and owner
export async function registerRequests(req, res) {

}