const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const LIFE_DIR = '/Users/bgame/Documents/Obsidian Vault/life';

// ---------------------------------------------------------------------------
// In-memory onboarding state: `${chatId}:${agentName}` → { answers: [] }
// Each invocation processes exactly one question-answer exchange.
// ---------------------------------------------------------------------------
const onboardingStates = new Map();

function obKey(chatId, agentName) {
  return `${chatId}:${agentName}`;
}

// Call once per agent invocation during onboarding.
// Returns { done: false } if still collecting answers (question already sent).
// Returns { done: true, answers: [...] } when all answers are in.
async function stepOnboarding(agentName, chatId, userMessage, questions, buildProfile, sendToTelegram) {
  const key = obKey(chatId, agentName);
  const state = onboardingStates.get(key);

  if (!state) {
    // First hit — ask Q0, store empty answers
    await sendToTelegram(questions[0]);
    onboardingStates.set(key, { answers: [] });
    return { done: false };
  }

  // Subsequent hit — userMessage is the answer to questions[state.answers.length]
  const answers = [...state.answers, userMessage];

  if (answers.length < questions.length) {
    // More questions — ask next, save progress
    await sendToTelegram(questions[answers.length]);
    onboardingStates.set(key, { answers });
    return { done: false };
  }

  // All answers collected — save profile, clear state
  onboardingStates.delete(key);
  const content = buildProfile(answers);
  saveProfile(agentName, content);
  return { done: true, answers };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
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
    return null;
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

module.exports = { readProfile, saveProfile, appendLog, claudeRun, stepOnboarding };
