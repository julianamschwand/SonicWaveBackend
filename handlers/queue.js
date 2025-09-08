import { db } from '../db/db.js'
import { safeOperation, safeOperations, checkReq } from '../error-handling.js'

// get the current queue of songs
export async function getQueue(req, res) {
  const [queue] = await safeOperation(
    () => db.query(`select fk_SongId from QueuedSongs where fk_UserDataId = ?`, [req.session.user.id]),
    "Error while fetching queue from database"
  )

  const formattedQueue = queue.map(queuedSong => queuedSong.fk_SongId)

  if (queue.length === 0) return res.status(200).json({success: true, message: "The queue is empty", queue: queue})

  const [[queueIndex]] = await safeOperation(
    () => db.query("select queueIndex from UserData where userDataId = ?", [req.session.user.id]),
    "Error while fetching queue index from database"
  )

  res.status(200).json({success: true, message: "Successfully retrieved queue from database", queueIndex: queueIndex.queueIndex, queue: formattedQueue})
}

// set a queue of songs
export async function setQueue(req, res) {
  const {queue} = req.body
  checkReq(!queue || queue.length === 0)

  const placeholders = queue.map(() => "(?,?)").join(",")
  const values = queue.flatMap(songId => [req.session.user.id, songId])
  const query = `insert into QueuedSongs (fk_UserDataId, fk_SongId) values ${placeholders}`
  
  await safeOperations([
    () => db.query("delete from QueuedSongs where fk_UserDataId = ?", [req.session.user.id]),
    () => db.query(query, values),
    () => db.query("update UserData set queueIndex = 0 where userDataId = ?", [req.session.user.id])
  ], "Error while setting queue")

  res.status(200).json({success: true, message: "Successfully set queue"})
}

// change the selected song of a queue
export async function changeSong(req, res) {
  const {action} = req.body
  checkReq(!action)

  let incrementValue = 0
  if (action == "forward") {
    incrementValue = 1
  } else if (action == "backward") {
    incrementValue = -1
  } else {
    return res.status(400).json({success: false, message: "Action must either be forward or backward"})
  }

  await safeOperation(
    () => db.query("update UserData set queueIndex = queueIndex + ? where userDataId = ?", [incrementValue, req.session.user.id]),
    "Error while updating queue index"
  )

  res.status(200).json({success: true, message: "Successfully changed the selected song of the queue"})
}

// clear the queue
export async function clearQueue(req, res) {
  await safeOperation(
    () => db.query("delete from QueuedSongs where fk_UserDataId = ?", [req.session.user.id]),
    "Error while clearing queue"
  )

  res.status(200).json({success: true, message: "Successfully cleared queue"})
}