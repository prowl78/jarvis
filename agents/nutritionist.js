const { readProfile, saveProfile, appendLog, runOnboarding, claudeRun } = require('../lib/life-agent');

const AGENT = 'nutritionist';
const LOG   = 'nutrition';

const ONBOARDING_QUESTIONS = [
  "Hey Boss — quick setup so I can actually help you.\n\nAny dietary restrictions or things you don't eat?",
  "How many meals do you roughly eat a day, and do you cook or grab food on the run?",
  "What's your energy like during the day — morning person, afternoon crash, evening builder?",
];

const SYSTEM_BASE = `You are a practical, no-nonsense nutritionist for Brian Game — a solo founder in Sydney. He has a day job and builds products at night. He walks ~50 minutes each way between Peakhurst and Padstow daily.

Your philosophy:
- Energy and brain function over aesthetics
- No calorie obsession, no diet culture
- Practical for someone time-poor with an inconsistent schedule
- Sustainability matters more than perfection
- Coffee and late nights are real — work with them, not against them

Keep responses concise. Lead with the practical recommendation. No lecture mode.`;

function buildSystem(profile) {
  if (!profile) return SYSTEM_BASE;
  return `${SYSTEM_BASE}\n\nUser profile:\n${profile}`;
}

function detectLogEntry(message) {
  return /^log\s+/i.test(message.trim());
}

function detectHowAmIDoing(message) {
  return /how am i (eating|doing|going)|nutrition check|eating review/i.test(message);
}

async function nutritionist(userMessage, sendToTelegram, context = {}) {
  const { chatId, pendingConfirmations } = context;

  // Onboarding
  let profile = readProfile(AGENT);
  if (!profile && chatId && pendingConfirmations) {
    const answers = await runOnboarding(ONBOARDING_QUESTIONS, chatId, pendingConfirmations, sendToTelegram);
    const content = `# Nutritionist Profile\n\n**Dietary restrictions:** ${answers[0]}\n**Meal habits:** ${answers[1]}\n**Energy pattern:** ${answers[2]}\n`;
    saveProfile(AGENT, content);
    profile = content;
    await sendToTelegram("Got it. Profile saved. What do you need?");
    return;
  }

  const system = buildSystem(profile);

  // Log food entry
  if (detectLogEntry(userMessage)) {
    const food = userMessage.replace(/^log\s+/i, '').trim();
    appendLog(LOG, `**Logged:** ${food}`);
    await sendToTelegram(`Logged: ${food}`);
    return;
  }

  // How am I eating
  if (detectHowAmIDoing(userMessage)) {
    const prompt = `${system}\n\nReview the user's eating patterns based on their profile and give a brief honest assessment. Focus on: energy consistency, protein, timing relative to their walk and work schedule. Keep it to 4-6 sentences.`;
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

  // General nutrition advice
  let response;
  try {
    response = await claudeRun(system, userMessage);
  } catch (err) {
    console.error('[nutritionist] error:', err.message);
    await sendToTelegram(`Nutritionist error: ${err.message}`);
    return;
  }

  appendLog(LOG, `**Q:** ${userMessage}\n**A:** ${response}`);
  await sendToTelegram(response);
}

module.exports = nutritionist;
