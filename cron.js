const cron = require('node-cron');
const { getRecentErrors, fmtTime } = require('./agents/ops');

function startCron(sendAlert) {
  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[cron] checking Vercel for errors...');
    try {
      const errors = await getRecentErrors(Date.now() - 15 * 60 * 1000);
      if (!errors.length) {
        console.log('[cron] no errors found');
        return;
      }
      for (const d of errors) {
        const msg =
          `🔴 SHRODY ERROR\n` +
          `${d.state} — ${d.url || 'no url'}\n` +
          `${fmtTime(d.createdAt)}`;
        console.error('[cron] alerting:', msg);
        await sendAlert(msg);
      }
    } catch (err) {
      console.error('[cron] check failed:', err.message);
    }
  });
  console.log('[cron] Vercel error monitor started (every 15 min)');
}

module.exports = startCron;
