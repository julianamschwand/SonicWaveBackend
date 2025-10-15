import cron from 'node-cron'
import refreshNewgrounds from './jobs/refreshNewgrounds.js'

export default async function initCronJobs() {
  await refreshNewgrounds()
  cron.schedule('0 */24 * * *', refreshNewgrounds)
}