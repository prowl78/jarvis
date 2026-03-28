const https = require('https');

function vercelRequest(path) {
  return new Promise((resolve, reject) => {
    const token = process.env.VERCEL_TOKEN;
    const options = {
      hostname: 'api.vercel.com',
      path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
}

function stateEmoji(state) {
  switch ((state || '').toUpperCase()) {
    case 'READY':      return '🟢';
    case 'ERROR':
    case 'FAILED':     return '🔴';
    case 'BUILDING':
    case 'INITIALIZING': return '🟡';
    case 'CANCELED':   return '⚫';
    default:           return '⚪';
  }
}

function parseQuery(message) {
  const lower = message.toLowerCase();
  if (/error|exception|crash|fail/i.test(lower))                      return 'errors';
  if (/list|last \d|recent deploy|deployments/i.test(lower))          return 'deployments';
  return 'status'; // default
}

// ---------------------------------------------------------------------------
// Vercel actions
// ---------------------------------------------------------------------------
async function getLatestDeployment() {
  const projectId = process.env.VERCEL_PROJECT_ID;
  const data = await vercelRequest(`/v6/deployments?projectId=${projectId}&limit=1`);
  return data.deployments?.[0] || null;
}

async function listDeployments(limit = 5) {
  const projectId = process.env.VERCEL_PROJECT_ID;
  const data = await vercelRequest(`/v6/deployments?projectId=${projectId}&limit=${limit}`);
  return data.deployments || [];
}

async function getRecentErrors(sinceMs) {
  const projectId = process.env.VERCEL_PROJECT_ID;
  const since = sinceMs || Date.now() - 15 * 60 * 1000;
  // Fetch recent deployments and flag any ERROR/FAILED ones in the window
  const data = await vercelRequest(`/v6/deployments?projectId=${projectId}&limit=20`);
  const deployments = data.deployments || [];
  return deployments.filter((d) => {
    const inWindow = d.createdAt >= since;
    const isBad = ['ERROR', 'FAILED'].includes((d.state || '').toUpperCase());
    return inWindow && isBad;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function ops(userMessage, sendToTelegram) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    await sendToTelegram('VERCEL_TOKEN not set.');
    return;
  }

  const query = parseQuery(userMessage);

  try {
    if (query === 'status') {
      const d = await getLatestDeployment();
      if (!d) { await sendToTelegram('No deployments found.'); return; }
      const emoji = stateEmoji(d.state);
      await sendToTelegram(
        `${emoji} Latest deployment: ${d.state}\n` +
        `Branch: ${d.meta?.githubCommitRef || 'unknown'}\n` +
        `Deployed: ${fmtTime(d.createdAt)}`
      );
      return;
    }

    if (query === 'deployments') {
      const deployments = await listDeployments(5);
      if (!deployments.length) { await sendToTelegram('No deployments found.'); return; }
      const lines = deployments.map((d) =>
        `${stateEmoji(d.state)} ${d.state} — ${fmtTime(d.createdAt)} (${d.meta?.githubCommitRef || 'unknown'})`
      );
      await sendToTelegram(`Last ${deployments.length} deployments:\n\n${lines.join('\n')}`);
      return;
    }

    if (query === 'errors') {
      const errors = await getRecentErrors();
      if (!errors.length) {
        await sendToTelegram('🟢 No errors in the last 15 minutes.');
        return;
      }
      const lines = errors.map((d) =>
        `🔴 ${d.state} — ${fmtTime(d.createdAt)}\nURL: ${d.url || 'n/a'}`
      );
      await sendToTelegram(`Errors found:\n\n${lines.join('\n\n')}`);
      return;
    }
  } catch (err) {
    console.error('[ops] Vercel error:', err.message);
    await sendToTelegram(`Vercel API error: ${err.message}`);
  }
}

module.exports = ops;
module.exports.getRecentErrors = getRecentErrors;
module.exports.stateEmoji = stateEmoji;
module.exports.fmtTime = fmtTime;
