const { readProfile, saveProfile, appendLog, stepOnboarding, claudeRun } = require('../lib/life-agent');

const AGENT = 'trainer';
const LOG   = 'fitness';

const ONBOARDING_QUESTIONS = [
  "Hey Boss — quick setup so I can build around your actual life.\n\nBesides the daily walk (50min each way, Peakhurst to Padstow), any other movement happening right now?",
  "Any injuries or physical limitations I should know about?",
  "What's the goal — energy, weight, strength, or just not falling apart?",
];

const SYSTEM_BASE = `You are a practical personal trainer for Brian Game — a solo founder in Sydney. He has a day job and builds products at night.

Known facts:
- Walks ~50 minutes each way between Peakhurst and Padstow daily (significant baseline activity)
- Desk worker — sitting is a real problem
- Time-poor, inconsistent schedule
- No gym membership assumed unless told otherwise

Your philosophy:
- Work with the walk, not around it — it's already solid cardio
- Prioritise mobility and posture for a desk worker
- No equipment required unless specified
- Short, effective sessions over perfect long ones that never happen
- Consistency trumps intensity for someone building a company

Keep responses practical. Give specific exercises with reps/sets when relevant. No fluff.`;

function buildSystem(profile) {
  if (!profile) return SYSTEM_BASE;
  return `${SYSTEM_BASE}\n\nUser profile:\n${profile}`;
}

async function trainer(userMessage, sendToTelegram, context = {}) {
  const { chatId, pendingConfirmations } = context;

  // Onboarding
  let profile = readProfile(AGENT);
  if (!profile) {
    const result = await stepOnboarding(AGENT, chatId, userMessage, ONBOARDING_QUESTIONS, (answers) => {
      return `# Trainer Profile\n\n**Current movement (beyond walk):** ${answers[0]}\n**Injuries/limitations:** ${answers[1]}\n**Goal:** ${answers[2]}\n`;
    }, sendToTelegram);
    if (!result.done) return;
    await sendToTelegram("Noted. Profile saved. What do you need?");
    profile = readProfile(AGENT);
  }

  const system = buildSystem(profile);

  // Log activity
  if (/^log\s+/i.test(userMessage.trim())) {
    const activity = userMessage.replace(/^log\s+/i, '').trim();
    appendLog(LOG, `**Logged:** ${activity}`);
    await sendToTelegram(`Logged: ${activity}`);
    return;
  }

  // How am I going
  if (/how am i (going|doing)|fitness check|progress check/i.test(userMessage)) {
    const prompt = `${system}\n\nReview the user's fitness progress based on their profile. Be honest and brief — 4-6 sentences. Acknowledge the daily walk as real work. Flag anything worth adjusting.`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const { exec } = require('child_process');
    const result = await new Promise((res, rej) => {
      exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) rej(new Error(stderr || err.message));
        else res(stdout.trim());
      });
    });
    appendLog(LOG, `**Check-in:** ${result}`);
    await sendToTelegram(result);
    return;
  }

  // General fitness advice / workout request
  let response;
  try {
    response = await claudeRun(system, userMessage);
  } catch (err) {
    console.error('[trainer] error:', err.message);
    await sendToTelegram(`Trainer error: ${err.message}`);
    return;
  }

  appendLog(LOG, `**Q:** ${userMessage}\n**A:** ${response}`);
  await sendToTelegram(response);
}

module.exports = trainer;
