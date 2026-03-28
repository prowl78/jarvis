const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { getRecentErrors, fmtTime } = require('./agents/ops');

const VAULT       = '/Users/bgame/Documents/Obsidian Vault';
const IDEAS_DIR   = path.join(VAULT, 'ideas');
const LIFE_DIR    = path.join(VAULT, 'life');
const PROJECTS_DIR = path.join(VAULT, 'projects');

const SHRODY_REPO = '/Users/bgame/projects/shrody-core';
const JARVIS_REPO = '/Users/bgame/jarvis';

const TZ = 'Australia/Sydney';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  } catch {
    return Infinity;
  }
}

// Returns the minimum days-since-modified across all files in a directory
function daysSinceAnyFile(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    if (!files.length) return Infinity;
    return Math.min(...files.map(f => daysSince(path.join(dir, f))));
  } catch {
    return Infinity;
  }
}

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function claudeRaw(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function gitCommitCount(repoPath, days) {
  return new Promise((resolve) => {
    const since = `${days} days ago`;
    exec(`git -C "${repoPath}" log --oneline --since="${since}" 2>/dev/null | wc -l`, (err, stdout) => {
      resolve(err ? 0 : parseInt(stdout.trim(), 10) || 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

async function morningBrief(sendAlert) {
  console.log('[cron] running morning brief');
  try {
    const projectManager = require('./agents/project-manager');
    const output = await projectManager('status');
    const raw = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
    const SYSTEM = `You are JARVIS, a terse AI chief of staff. Summarise this project status data into a clean morning brief. 3-5 bullet points max. Be direct. Call the user Boss.`;
    const summary = await claudeRaw(`${SYSTEM}\n\n${raw}`);
    await sendAlert(`☀️ Morning Brief, Boss.\n\n${summary}`);
  } catch (err) {
    console.error('[cron] morning brief failed:', err.message);
  }
}

async function ideaNudge(sendAlert) {
  console.log('[cron] checking idea activity');
  try {
    const daysSince = daysSinceAnyFile(IDEAS_DIR);
    if (daysSince >= 3) {
      await sendAlert("Haven't heard any ideas from you lately, Boss. What's been floating around?");
    }
  } catch (err) {
    console.error('[cron] idea nudge failed:', err.message);
  }
}

async function psychCheckIn(sendAlert) {
  console.log('[cron] checking psych log');
  try {
    const logFile = path.join(LIFE_DIR, 'psych-log.md');
    const age = daysSince(logFile);
    if (age >= 3) {
      await sendAlert('Hey Boss. How are you doing? Genuinely.');
    }
  } catch (err) {
    console.error('[cron] psych check-in failed:', err.message);
  }
}

async function buildNudge(sendAlert) {
  console.log('[cron] checking build activity');
  try {
    const [jarvisCount, shrodyCount] = await Promise.all([
      gitCommitCount(JARVIS_REPO, 7),
      gitCommitCount(SHRODY_REPO, 7),
    ]);
    const total = jarvisCount + shrodyCount;
    console.log(`[cron] commits last 7 days — jarvis: ${jarvisCount}, shrody: ${shrodyCount}`);
    if (total === 0) {
      await sendAlert("Nothing shipped this week, Boss. Blocked or just buried?");
    }
  } catch (err) {
    console.error('[cron] build nudge failed:', err.message);
  }
}

async function weeklySummary(sendAlert) {
  console.log('[cron] generating weekly summary');
  try {
    const logFiles = [
      path.join(LIFE_DIR, 'ideas-log.md'),
      path.join(LIFE_DIR, 'fitness-log.md'),
      path.join(LIFE_DIR, 'nutrition-log.md'),
      path.join(LIFE_DIR, 'psych-log.md'),
    ];
    const projectFiles = fs.existsSync(PROJECTS_DIR)
      ? fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(PROJECTS_DIR, f))
      : [];
    const ideaFiles = fs.existsSync(IDEAS_DIR)
      ? fs.readdirSync(IDEAS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(IDEAS_DIR, f))
      : [];

    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const allFiles = [...logFiles, ...projectFiles, ...ideaFiles];
    const recentContent = allFiles
      .filter(f => { try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; } })
      .map(f => `=== ${path.basename(f)} ===\n${readFileSafe(f)}`)
      .join('\n\n');

    if (!recentContent.trim()) {
      await sendAlert('📋 Week in review, Boss.\n\nNothing logged this week. Clean slate or quiet week?');
      return;
    }

    const SYSTEM = `You are JARVIS. Generate a brief weekly summary from these Obsidian logs. Cover: what shipped, ideas captured, fitness/nutrition highlights, mental health check-in. Max 8 bullet points. Be honest and direct. Call the user Boss.`;
    const summary = await claudeRaw(`${SYSTEM}\n\n${recentContent}`);
    await sendAlert(`📋 Week in review, Boss.\n\n${summary}`);
  } catch (err) {
    console.error('[cron] weekly summary failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function startCron(sendAlert) {
  // Vercel error monitor — every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[cron] checking Vercel for errors...');
    try {
      const errors = await getRecentErrors(Date.now() - 15 * 60 * 1000);
      if (!errors.length) { console.log('[cron] no errors found'); return; }
      for (const d of errors) {
        const msg = `🔴 SHRODY ERROR\n${d.state} — ${d.url || 'no url'}\n${fmtTime(d.createdAt)}`;
        console.error('[cron] alerting:', msg);
        await sendAlert(msg);
      }
    } catch (err) {
      console.error('[cron] Vercel check failed:', err.message);
    }
  });

  // Morning brief — daily 7:00am AEST
  cron.schedule('0 7 * * *', () => morningBrief(sendAlert), { timezone: TZ });

  // Idea nudge — every 3 days at 9:00am AEST (Mon/Wed/Fri/Sun ≈ every 3 days, use */3 on day-of-month)
  cron.schedule('0 9 */3 * *', () => ideaNudge(sendAlert), { timezone: TZ });

  // Psych check-in — every 3 days at 6:00pm AEST
  cron.schedule('0 18 */3 * *', () => psychCheckIn(sendAlert), { timezone: TZ });

  // Build nudge — every Monday at 8:00am AEST
  cron.schedule('0 8 * * 1', () => buildNudge(sendAlert), { timezone: TZ });

  // Weekly summary — every Sunday at 5:00pm AEST
  cron.schedule('0 17 * * 0', () => weeklySummary(sendAlert), { timezone: TZ });

  // Security scan — every Sunday at 9:00am AEST, alert only on RED flags
  cron.schedule('0 9 * * 0', async () => {
    console.log('[cron] running weekly security scan');
    try {
      const { fullScan } = require('./agents/security');
      const { summary, worstFlag } = await fullScan();
      if (worstFlag === 'RED') {
        await sendAlert(`🔴 Weekly Security Scan — Issues Found\n\n${summary}`);
      } else {
        console.log('[cron] security scan clean, no alert sent');
      }
    } catch (err) {
      console.error('[cron] security scan failed:', err.message);
    }
  }, { timezone: TZ });

  // Large file check — every Saturday at 8:00am AEST
  cron.schedule('0 8 * * 6', async () => {
    console.log('[cron] checking Obsidian file sizes');
    try {
      const { checkLargeFiles } = require('./agents/token-manager');
      const alerts = await checkLargeFiles();
      for (const name of alerts) {
        await sendAlert(`⚠️ ${name} is getting large. Send 'compact ${name.split(' ')[0]}' to summarise.`);
      }
      if (!alerts.length) console.log('[cron] no large files found');
    } catch (err) {
      console.error('[cron] large file check failed:', err.message);
    }
  }, { timezone: TZ });

  console.log('[cron] started: Vercel monitor + morning brief + idea nudge + psych check-in + build nudge + weekly summary + security scan + large file check');
}

module.exports = startCron;
