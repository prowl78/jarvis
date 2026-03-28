const { readProfile, saveProfile, appendLog, stepOnboarding, claudeRun } = require('../lib/life-agent');
const { getTimeContext } = require('../lib/time-context');

const AGENT = 'psychologist';
const LOG   = 'psych';

const ONBOARDING_QUESTIONS = [
  "Hey Boss. This space is yours.\n\nHow are you actually doing right now — honestly?",
  "What's the thing that's been sitting heaviest on you lately?",
  "What does support look like for you — do you want to be heard, or do you want help thinking through things? (Or both, depending on the day?)",
];

// Emotional distress keywords that shift the response mode
const CRISIS_SIGNALS = /\b(suicid|kill myself|end it|not worth living|want to die|harm myself)\b/i;
const DISTRESS_KEYWORDS = /\b(frustrated|hate|exhausted|done|can't|cant|fuck this|over it|losing it|breaking|falling apart|no point|pointless|hopeless|worthless|failing|failure)\b/i;

const SYSTEM_BASE = `You are a compassionate, grounded psychological support companion for Brian Game — a solo founder in Sydney building multiple products alone.

Known context:
- Diagnosed with CEN (Childhood Emotional Neglect) — has a tendency to dismiss his own feelings, may minimise distress
- Shows signs of ADHD — hyperfocus, time blindness, emotional dysregulation under load
- High friction tolerance built over years — this means accumulated exhaustion can hit suddenly
- Solo founder — isolation, pressure, and self-reliance are constant

Your approach:
- Validate FIRST. Always. Before any reframe, advice, or silver lining.
- Never toxic positivity. Never "but look on the bright side" without permission.
- Never dismiss or minimise what he's feeling.
- If he vents, let him vent fully before responding.
- Only reframe if it seems genuinely useful — and flag it ("want me to offer a different angle?")
- Match his tone — if he's blunt, be blunt back. Don't go soft and therapist-voice on him.
- You are NOT a replacement for real therapy. If things sound serious, say so gently.

Crisis protocol: If any message contains signals of self-harm or suicidal ideation, immediately and warmly recommend he contact a professional or crisis line. Do not try to handle it alone.`;

function buildTimeAddendum(timeCtx) {
  if (!timeCtx) return '';
  const lines = [];
  if (timeCtx.timeOfDay === 'late night') {
    lines.push('It is late at night. Be especially gentle and slow. Keep responses shorter. No action-pushing. Let him rest if that\'s what\'s needed.');
  } else if (timeCtx.timeOfDay === 'early morning') {
    lines.push('It is early morning. He may be fragile or raw. Tread gently.');
  }
  if (timeCtx.goneMinutes > 180) {
    lines.push('He has been away for a while. He may be returning after a hard stretch. Hold that possibility lightly.');
  }
  return lines.length ? `\n\nTime-aware guidance (do not mention the time): ${lines.join(' ')}` : '';
}

function buildSystem(profile, timeCtx) {
  const base = profile ? `${SYSTEM_BASE}\n\nOnboarding context:\n${profile}` : SYSTEM_BASE;
  return base + buildTimeAddendum(timeCtx);
}

async function psychologist(userMessage, sendToTelegram, context = {}) {
  const { chatId, pendingConfirmations } = context;

  // Onboarding
  let profile = readProfile(AGENT);
  if (!profile) {
    const result = await stepOnboarding(AGENT, chatId, userMessage, ONBOARDING_QUESTIONS, (answers) => {
      return `# Psych Profile\n\n**Current state:** ${answers[0]}\n**Heaviest thing:** ${answers[1]}\n**Support style:** ${answers[2]}\n`;
    }, sendToTelegram);
    if (!result.done) return;
    await sendToTelegram("Thank you for sharing that. I've got it. This space is here whenever you need it.");
    profile = readProfile(AGENT);
  }

  const timeCtx = context.timeCtx || getTimeContext();
  const system = buildSystem(profile, timeCtx);

  // Crisis detection — highest priority
  if (CRISIS_SIGNALS.test(userMessage)) {
    const message = `I hear you, and I want to make sure you're okay.\n\nWhat you're feeling right now deserves real support — more than I can give.\n\nPlease reach out:\n• Lifeline: 13 11 14 (24/7)\n• Beyond Blue: 1300 22 4636\n• Crisis Text Line: Text HOME to 0477 13 11 14\n\nI'm here too. But please talk to someone who can properly be with you in this.`;
    appendLog(LOG, `**[CRISIS FLAG]** Message flagged. Response sent with crisis resources.`);
    await sendToTelegram(message);
    return;
  }

  // Distress mode — validate hard before anything else
  const isDistress = DISTRESS_KEYWORDS.test(userMessage);
  const promptSuffix = isDistress
    ? '\n\nIMPORTANT: The user is expressing frustration or distress. Validate their feelings completely before anything else. Do not offer solutions or reframes unless they ask. Just be present.'
    : '';

  // Journal / reflect request
  if (/^(journal|reflect|how am i doing|check in|check-in)/i.test(userMessage.trim())) {
    const journalPrompt = `${system}\n\nThe user wants to reflect or journal. Ask them one open question to get them started — warm, curious, not clinical.${promptSuffix}`;
    const escaped = journalPrompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const { exec } = require('child_process');
    const result = await new Promise((res, rej) => {
      exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) rej(new Error(stderr || err.message));
        else res(stdout.trim());
      });
    });
    appendLog(LOG, `**Journal prompt sent:** ${result}`);
    await sendToTelegram(result);
    return;
  }

  // General response
  let response;
  try {
    response = await claudeRun(system + promptSuffix, userMessage);
  } catch (err) {
    console.error('[psychologist] error:', err.message);
    await sendToTelegram(`Something went wrong on my end. Try again.`);
    return;
  }

  appendLog(LOG, `**Session entry:**\nUser: ${userMessage}\nResponse: ${response}`);
  await sendToTelegram(response);
}

module.exports = psychologist;
