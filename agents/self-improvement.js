const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const VAULT = '/Users/bgame/Documents/Obsidian Vault';
const LIFE_DIR = path.join(VAULT, 'life');
const PROJECTS_DIR = path.join(VAULT, 'projects');
const FITNESS_LOG = path.join(LIFE_DIR, 'fitness-log.md');
const PSYCH_LOG = path.join(LIFE_DIR, 'psych-log.md');
const IMPROVEMENT_LOG = path.join(LIFE_DIR, 'improvement-log.md');

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function readProjects() {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const content = readSafe(path.join(PROJECTS_DIR, f));
      return content ? `## ${path.basename(f, '.md')}\n${content}` : null;
    }).filter(Boolean).join('\n\n---\n\n');
  } catch {
    return null;
  }
}

function claudeRun(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function appendToLog(content) {
  fs.mkdirSync(LIFE_DIR, { recursive: true });
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  fs.appendFileSync(IMPROVEMENT_LOG, `\n## ${ts}\n${content}\n`, 'utf8');
}

async function selfImprovement(userMessage, sendToTelegram) {
  await sendToTelegram('Reading your logs and projects...');

  const fitnessLog = readSafe(FITNESS_LOG);
  const psychLog = readSafe(PSYCH_LOG);
  const projectsData = readProjects();

  const context = [];
  if (fitnessLog) context.push(`## Fitness Log (recent)\n${fitnessLog.slice(-3000)}`);
  if (psychLog) context.push(`## Psych Log (recent)\n${psychLog.slice(-3000)}`);
  if (projectsData) context.push(`## Projects\n${projectsData.slice(-3000)}`);

  if (context.length === 0) {
    await sendToTelegram('No logs found yet Boss. Start logging workouts and journal entries and I can give you better recommendations.');
    return;
  }

  const prompt = `You are a personal growth advisor reviewing data for Brian Game — a solo founder in Sydney. He juggles multiple projects (Shrody, OnlyHuman, Caligulas, Wombo, StoryBytes) alongside a day job and personal health.

Your task: based on the data below, make 3-5 specific, actionable self-improvement recommendations. Focus on habits, energy management, priorities, and balance. Do NOT suggest building anything or executing code. Recommendations only — practical and direct.

${context.join('\n\n---\n\n')}

User request: ${userMessage}

Format your response as a numbered list. Each recommendation should be one clear action Boss can take this week. Max 10 lines total.`;

  let recommendations;
  try {
    recommendations = await claudeRun(prompt);
  } catch (err) {
    console.error('[self-improvement] error:', err.message);
    await sendToTelegram(`Self-improvement agent error: ${err.message}`);
    return;
  }

  appendToLog(recommendations);
  await sendToTelegram(recommendations);
}

module.exports = selfImprovement;
