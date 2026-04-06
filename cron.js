const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const VAULT        = '/Users/bgame/Documents/Obsidian Vault';
const IDEAS_DIR    = path.join(VAULT, 'ideas');
const LIFE_DIR     = path.join(VAULT, 'life');
const PROJECTS_DIR = path.join(VAULT, 'projects');
const SHRODY_REPO  = '/Users/bgame/projects/shrody-core';
const JARVIS_REPO  = '/Users/bgame/jarvis';
const TZ = 'Australia/Sydney';

function daysSince(filePath) {
  try { return (Date.now() - fs.statSync(filePath).mtimeMs) / (1000*60*60*24); } catch { return Infinity; }
}
function daysSinceAnyFile(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    if (!files.length) return Infinity;
    return Math.min(...files.map(f => daysSince(path.join(dir, f))));
  } catch { return Infinity; }
}
function readFileSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function claudeRaw(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5*1024*1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message)); else resolve(stdout.trim());
    });
  });
}
function gitCommitCount(repoPath, days) {
  return new Promise((resolve) => {
    exec(`git -C "${repoPath}" log --oneline --since="${days} days ago" 2>/dev/null | wc -l`, (err, stdout) => {
      resolve(err ? 0 : parseInt(stdout.trim(), 10) || 0);
    });
  });
}

async function morningBrief(sendAlert) {
  try {
    const projectManager = require('./agents/project-manager');
    const output = await projectManager('status');
    const raw = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
    const summary = await claudeRaw(`You are JARVIS, a terse AI chief of staff. Summarise this project status into a clean morning brief. 3-5 bullet points max. Be direct. Call the user Boss.\n\n${raw}`);
    await sendAlert(`☀️ Morning Brief, Boss.\n\n${summary}`);
  } catch (err) { console.error('[cron] morning brief failed:', err.message); }
}

async function ideaNudge(sendAlert) {
  try {
    if (daysSinceAnyFile(IDEAS_DIR) >= 3) await sendAlert("Haven't heard any ideas from you lately, Boss. What's been floating around?");
  } catch (err) { console.error('[cron] idea nudge failed:', err.message); }
}

async function psychCheckIn(sendAlert) {
  try {
    if (daysSince(path.join(LIFE_DIR, 'psych-log.md')) >= 3) await sendAlert('Hey Boss. How are you doing? Genuinely.');
  } catch (err) { console.error('[cron] psych check-in failed:', err.message); }
}

async function buildNudge(sendAlert) {
  try {
    const [j, s] = await Promise.all([gitCommitCount(JARVIS_REPO, 7), gitCommitCount(SHRODY_REPO, 7)]);
    if (j + s === 0) await sendAlert("Nothing shipped this week, Boss. Blocked or just buried?");
  } catch (err) { console.error('[cron] build nudge failed:', err.message); }
}

async function weeklySummary(sendAlert) {
  try {
    const logFiles = ['ideas-log.md','fitness-log.md','nutrition-log.md','psych-log.md'].map(f => path.join(LIFE_DIR, f));
    const projectFiles = fs.existsSync(PROJECTS_DIR) ? fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(PROJECTS_DIR, f)) : [];
    const ideaFiles = fs.existsSync(IDEAS_DIR) ? fs.readdirSync(IDEAS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(IDEAS_DIR, f)) : [];
    const cutoff = Date.now() - 7*24*60*60*1000;
    const recentContent = [...logFiles, ...projectFiles, ...ideaFiles]
      .filter(f => { try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; } })
      .map(f => `=== ${path.basename(f)} ===\n${readFileSafe(f)}`).join('\n\n');
    if (!recentContent.trim()) { await sendAlert('📋 Week in review, Boss.\n\nNothing logged this week.'); return; }
    const summary = await claudeRaw(`You are JARVIS. Generate a brief weekly summary from these Obsidian logs. Cover: what shipped, ideas captured, fitness highlights, mental health check-in. Max 8 bullet points. Be honest and direct. Call the user Boss.\n\n${recentContent}`);
    await sendAlert(`📋 Week in review, Boss.\n\n${summary}`);
  } catch (err) { console.error('[cron] weekly summary failed:', err.message); }
}

function startCron(sendAlert) {
  cron.schedule('0 7 * * *',   () => morningBrief(sendAlert),  { timezone: TZ });
  cron.schedule('0 9 */3 * *', () => ideaNudge(sendAlert),     { timezone: TZ });
  cron.schedule('0 18 */3 * *',() => psychCheckIn(sendAlert),  { timezone: TZ });
  cron.schedule('0 8 * * 1',   () => buildNudge(sendAlert),    { timezone: TZ });
  cron.schedule('0 17 * * 0',  () => weeklySummary(sendAlert), { timezone: TZ });
  console.log('[cron] started');
}

module.exports = startCron;
