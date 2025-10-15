import cron from 'node-cron'

import refreshNewgrounds from './jobs/refreshNewgrounds.js'
import updateYtdlp from './jobs/updateYtdlp.js'

export default async function initCronJobs() {
  await refreshNewgrounds()
  await updateYtdlp()
  cron.schedule('0 0 */24 * * *', refreshNewgrounds)
  cron.schedule('0 0 */1 * * *', updateYtdlp)
}