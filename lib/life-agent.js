const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const LIFE_DIR = '/Users/bgame/Documents/Obsidian Vault/life';

function profilePath(agentName) {
  return path.join(LIFE_DIR, `${agentName}-profile.md`);
}

function logPath(logName) {
  return path.join(LIFE_DIR, `${logName}-log.md`);
}

function readProfile(agentName) {
  try {
    return fs.readFileSync(profilePath(agentName), 'utf8');
  } catch {
    return null; // null = not yet created
  }
}

function saveProfile(agentName, content) {
  fs.mkdirSync(LIFE_DIR, { recursive: true });
  fs.writeFileSync(profilePath(agentName), content, 'utf8');
}

function appendLog(logName, entry) {
  fs.mkdirSync(LIFE_DIR, { recursive: true });
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  fs.appendFileSync(logPath(logName), `\n## ${ts}\n${entry}\n`, 'utf8');
}

// Ask one question at a time, collect answers, return array
async function runOnboarding(questions, chatId, pendingConfirmations, sendToTelegram) {
  const answers = [];
  for (const question of questions) {
    await sendToTelegram(question);
    const answer = await new Promise(resolve => {
      pendingConfirmations.set(chatId, reply => resolve(reply.trim()));
    });
    answers.push(answer);
  }
  return answers;
}

function claudeRun(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const full = `${systemPrompt}\n\nUser: ${userMessage}`;
    const escaped = full.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

module.exports = { readProfile, saveProfile, appendLog, runOnboarding, claudeRun, profilePath };
