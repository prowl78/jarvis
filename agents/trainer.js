const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const LIFE_DIR       = '/Users/bgame/Documents/Obsidian Vault/life';
const FITNESS_LOG    = path.join(LIFE_DIR, 'fitness-log.md');
const SESSION_FILE   = path.join(LIFE_DIR, 'current-session.json');
const PLANS_DIR      = path.join(LIFE_DIR, 'workout-plans');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sydneyDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
}

function sydneyDay() {
  return new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long' });
}

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function claudeRun(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function ensureDirs() {
  fs.mkdirSync(LIFE_DIR, { recursive: true });
  fs.mkdirSync(PLANS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Session file
// ---------------------------------------------------------------------------

function readSession() {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSession(session) {
  ensureDirs();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
}

function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

function getOrCreateSession() {
  const existing = readSession();
  const today = sydneyDate();
  if (existing && existing.date === today) return existing;
  // New day — new session (don't auto-close old one, just start fresh)
  return { date: today, day: sydneyDay(), exercises: [] };
}

// ---------------------------------------------------------------------------
// Exercise parser
// Handles formats like:
//   chest press 3x6 25kg
//   bench 80kg 3x8
//   seated dips set 1 50kg 8 reps
//   walk 50min
//   active commute
// ---------------------------------------------------------------------------

function capitalise(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function parseExercise(text) {
  const t = text.trim();

  // Walk / commute shorthand
  if (/active commute|commute walk|walk (each way|x2|both ways)/i.test(t)) {
    return { name: 'Active commute', sets: 2, reps: 1, weight: null, duration: '50min', raw: t };
  }
  if (/^(walk|walking)\s+(\d+)\s*min/i.test(t)) {
    const m = t.match(/(\d+)\s*min/i);
    return { name: 'Walk', sets: 1, reps: 1, weight: null, duration: `${m[1]}min`, raw: t };
  }

  // Extract weight — various positions, various formats
  const weightMatch = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const weight = weightMatch ? parseFloat(weightMatch[1]) : null;

  // SxR pattern e.g. 3x6, 3X8
  const sxrMatch = t.match(/(\d+)\s*[xX×]\s*(\d+)/);
  let sets = null, reps = null;

  if (sxrMatch) {
    sets = parseInt(sxrMatch[1]);
    reps = parseInt(sxrMatch[2]);
  }

  // "set 1" / "sets 3" standalone
  if (!sets) {
    const setsMatch = t.match(/\b(\d+)\s*sets?\b/i);
    if (setsMatch) sets = parseInt(setsMatch[1]);
  }
  if (!sets) {
    const setMatch = t.match(/\bset\s+(\d+)\b/i);
    if (setMatch) sets = 1; // single set
  }

  // reps
  if (!reps) {
    const repsMatch = t.match(/\b(\d+)\s*reps?\b/i);
    if (repsMatch) reps = parseInt(repsMatch[1]);
  }

  // Defaults
  if (!sets) sets = 3;
  if (!reps) reps = 8;

  // Name: strip all the numbers/units/keywords to get exercise name
  let name = t
    .replace(/\d+(?:\.\d+)?\s*kg/gi, '')
    .replace(/\d+\s*[xX×]\s*\d+/g, '')
    .replace(/\b(\d+)\s*sets?\b/gi, '')
    .replace(/\bset\s+\d+\b/gi, '')
    .replace(/\b(\d+)\s*reps?\b/gi, '')
    .replace(/\blog\s+/i, '')
    .replace(/[^a-zA-Z\s\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = 'Exercise';

  return { name: capitalise(name), sets, reps, weight, duration: null, raw: t };
}

function formatExerciseLine(ex) {
  if (ex.duration) {
    return `✓ ${ex.name} ${ex.duration}${ex.sets > 1 ? ` x${ex.sets}` : ''}`;
  }
  const weightStr = ex.weight ? ` @ ${ex.weight}kg` : '';
  return `✓ ${ex.name} ${ex.sets}x${ex.reps}${weightStr}`;
}

function volume(ex) {
  if (!ex.weight || ex.duration) return 0;
  return ex.sets * ex.reps * ex.weight;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function addExerciseToSession(session, ex) {
  // If same exercise already logged this session, append as additional set
  const existing = session.exercises.find(
    e => e.name.toLowerCase() === ex.name.toLowerCase()
  );
  if (existing && ex.sets === 1) {
    // Single set addition — accumulate
    existing.totalSets = (existing.totalSets || existing.sets) + 1;
    existing.sets = existing.totalSets;
  } else {
    session.exercises.push({ ...ex, loggedAt: new Date().toISOString() });
  }
  return session;
}

function sessionSummary(session) {
  const lines = [];
  let totalVol = 0;
  for (const ex of session.exercises) {
    const vol = volume(ex);
    totalVol += vol;
    if (ex.duration) {
      lines.push(`- ${ex.name}: ${ex.duration}${ex.sets > 1 ? ` x${ex.sets}` : ''}`);
    } else {
      const volStr = vol > 0 ? ` | Volume: ${vol}kg` : '';
      const weightStr = ex.weight ? ` @ ${ex.weight}kg` : '';
      lines.push(`- ${ex.name}: ${ex.sets}x${ex.reps}${weightStr}${volStr}`);
    }
  }
  if (totalVol > 0) lines.push(`Total session volume: ${totalVol}kg`);
  return lines.join('\n');
}

function writeSessionToLog(session) {
  ensureDirs();
  const header = `\n## ${session.date} ${session.day}\n### Session\n`;
  const body = sessionSummary(session) + '\n';
  fs.appendFileSync(FITNESS_LOG, header + body, 'utf8');
}

// ---------------------------------------------------------------------------
// Logging handler
// ---------------------------------------------------------------------------

async function handleLog(rawText, sendToTelegram) {
  const session = getOrCreateSession();
  const ex = parseExercise(rawText);
  addExerciseToSession(session, ex);
  writeSession(session);
  await sendToTelegram(formatExerciseLine(ex));
}

// ---------------------------------------------------------------------------
// End session
// ---------------------------------------------------------------------------

async function handleEndSession(sendToTelegram) {
  const session = readSession();
  if (!session || session.exercises.length === 0) {
    await sendToTelegram('No active session to close.');
    return;
  }
  writeSessionToLog(session);
  clearSession();
  const summary = sessionSummary(session);
  await sendToTelegram(`Session saved ✓\n\n${session.date} — ${session.day}\n\n${summary}`);
}

// ---------------------------------------------------------------------------
// Workout planning
// ---------------------------------------------------------------------------

const MUSCLE_GROUPS = {
  legs:  ['Leg press', 'Leg curl', 'Leg extension', 'Calf raise', 'Squat'],
  chest: ['Chest press', 'Incline press', 'Cable fly', 'Chest dip'],
  back:  ['Lat pulldown', 'Seated row', 'Cable row', 'Back extension'],
  push:  ['Chest press', 'Shoulder press', 'Tricep pushdown', 'Lateral raise'],
  pull:  ['Lat pulldown', 'Seated row', 'Bicep curl', 'Face pull'],
  full:  ['Chest press', 'Lat pulldown', 'Leg press', 'Shoulder press', 'Bicep curl', 'Tricep pushdown'],
};

function parseHistory() {
  const raw = readSafe(FITNESS_LOG);
  if (!raw) return [];
  const sessions = [];
  const sessionBlocks = raw.split(/\n## (\d{4}-\d{2}-\d{2})/);
  for (let i = 1; i < sessionBlocks.length; i += 2) {
    const date = sessionBlocks[i];
    const body = sessionBlocks[i + 1] || '';
    const exercises = [];
    for (const line of body.split('\n')) {
      const m = line.match(/^- (.+?):\s+(\d+)x(\d+)(?:\s+@\s+(\d+(?:\.\d+)?)kg)?/);
      if (m) {
        exercises.push({
          name: m[1].trim(),
          sets: parseInt(m[2]),
          reps: parseInt(m[3]),
          weight: m[4] ? parseFloat(m[4]) : null,
        });
      }
    }
    if (exercises.length) sessions.push({ date, exercises });
  }
  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

function lastSeen(sessions, exerciseName) {
  for (const s of sessions) {
    const match = s.exercises.find(e =>
      e.name.toLowerCase().includes(exerciseName.toLowerCase())
    );
    if (match) return match;
  }
  return null;
}

function progressiveTarget(last, isNew = false) {
  if (!last || isNew) return { sets: 3, reps: 8, weight: null };
  let { sets, reps, weight } = last;
  // Simple progressive overload: add a rep first, then add weight
  if (reps < 12) {
    reps += 1;
  } else {
    reps = 8;
    weight = weight ? Math.round((weight * 1.05) / 2.5) * 2.5 : null; // +5%, round to 2.5kg
  }
  return { sets, reps, weight };
}

async function handlePlan(muscleGroup, sendToTelegram) {
  const key = muscleGroup.toLowerCase().replace(/\s+/g, '');
  const exercises = MUSCLE_GROUPS[key] || MUSCLE_GROUPS.full;
  const sessions = parseHistory();
  const date = sydneyDate();
  const day = sydneyDay();

  const lines = [`# Workout Plan — ${date} (${day})`, ''];
  lines.push('**Warmup:** 5 min light cardio, arm circles, hip rotations\n');

  const planExercises = [];
  for (const exName of exercises) {
    const last = lastSeen(sessions, exName);
    const target = progressiveTarget(last, !last);
    const weightStr = target.weight ? ` @ ${target.weight}kg` : ' (find working weight)';
    const progression = last && target.weight !== last.weight ? ` ↑ from ${last.weight}kg` : (last && target.reps !== last.reps ? ` ↑ from ${last.reps} reps` : ' (baseline)');
    lines.push(`- ${exName}: ${target.sets}x${target.reps}${weightStr}${progression}`);
    planExercises.push({ exName, target, last });
  }

  lines.push('\n**Cooldown:** stretch quads, hamstrings, chest, 5 min');
  const planContent = lines.join('\n');

  ensureDirs();
  const planFile = path.join(PLANS_DIR, `${date}.md`);
  fs.writeFileSync(planFile, planContent, 'utf8');

  await sendToTelegram(planContent);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function handleAnalysis(sendToTelegram) {
  const raw = readSafe(FITNESS_LOG);
  if (!raw || raw.trim().length < 50) {
    await sendToTelegram('Not enough logged sessions yet. Keep going — data builds up fast.');
    return;
  }

  // Last 30 days only
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentLines = raw.split('\n').filter(line => {
    const m = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    return !m || m[1] >= cutoffStr;
  });
  const recentContent = recentLines.join('\n');

  const prompt =
    `You are a practical personal trainer reviewing a client's last 30 days of training logs.\n\n` +
    `Context: Brian Game. Goal: energy and longevity (not bodybuilding). New to structured training, finding baseline. ` +
    `Does a 50min walk each way daily as commute.\n\n` +
    `Logs:\n${recentContent}\n\n` +
    `Give an honest PT-style assessment. Cover:\n` +
    `1. Consistency (sessions per week)\n` +
    `2. Progression trends (weights/reps going up, down, or flat?)\n` +
    `3. Strongest exercises vs weakest areas\n` +
    `4. Gaps (muscle groups not being hit)\n` +
    `5. One specific recommendation for next 2 weeks\n\n` +
    `Be direct. Max 15 lines. No fluff.`;

  const result = await claudeRun(prompt);
  await sendToTelegram(result);
}

async function handleCompare(sendToTelegram) {
  const sessions = parseHistory();
  if (sessions.length < 2) {
    await sendToTelegram('Need at least 2 logged sessions to compare.');
    return;
  }
  const [s1, s2] = sessions; // most recent first
  const lines = [`Comparing ${s2.date} vs ${s1.date}:\n`];

  const allNames = [...new Set([...s2.exercises.map(e => e.name), ...s1.exercises.map(e => e.name)])];
  for (const name of allNames) {
    const prev = s2.exercises.find(e => e.name === name);
    const curr = s1.exercises.find(e => e.name === name);
    if (prev && curr) {
      const volPrev = volume(prev);
      const volCurr = volume(curr);
      const diff = volCurr - volPrev;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      lines.push(`${name}: ${prev.sets}x${prev.reps}${prev.weight ? `@${prev.weight}kg` : ''} → ${curr.sets}x${curr.reps}${curr.weight ? `@${curr.weight}kg` : ''} ${arrow}${Math.abs(diff) > 0 ? ` ${Math.abs(diff)}kg vol` : ''}`);
    } else if (curr) {
      lines.push(`${name}: new this session`);
    } else {
      lines.push(`${name}: skipped this session`);
    }
  }
  await sendToTelegram(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Coaching
// ---------------------------------------------------------------------------

async function handleCoaching(topic, sendToTelegram) {
  const prompt =
    `You are a practical personal trainer. Give concise advice on: ${topic}\n\n` +
    `Context: male, new to structured training, goal is energy and longevity, has gym access. ` +
    `Cover: correct form cues, 2 most common mistakes, how to progress. Max 10 lines. Be specific.`;
  const result = await claudeRun(prompt);
  await sendToTelegram(result);
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

function detectIntent(msg) {
  const m = msg.toLowerCase().trim();

  if (/^(done|finished|end session|session done|that'?s? (it|all))\.?$/i.test(msg.trim())) return 'end';
  if (/how am i (doing|going)|analyse my workouts?|workout analysis|progress check/i.test(m)) return 'analyse';
  if (/compare (last )?two sessions?|session comparison/i.test(m)) return 'compare';
  if (/^plan (a |my )?(legs?|chest|back|push|pull|full|session|workout|today'?s? workout)/i.test(m) ||
      /what'?s? my workout today|whats? my workout/i.test(m)) {
    const groupMatch = m.match(/plan\s+(legs?|chest|back|push|pull|full)/i);
    return { type: 'plan', group: groupMatch ? groupMatch[1].toLowerCase() : 'full' };
  }
  if (/^(advice on|how do i|how to|form (for|on)|tips? (for|on))\s+(.+)/i.test(m)) {
    const topicMatch = msg.match(/^(?:advice on|how do i|how to|form (?:for|on)|tips? (?:for|on))\s+(.+)/i);
    return { type: 'coach', topic: topicMatch ? topicMatch[1] : msg };
  }

  // Logging patterns — anything with exercise-like content
  if (
    /\d+\s*[xX×]\s*\d+/.test(m) ||          // 3x8
    /\d+\s*kg/.test(m) ||                     // 25kg
    /\d+\s*reps?/i.test(m) ||                 // 8 reps
    /\d+\s*sets?/i.test(m) ||                 // 3 sets
    /active commute|commute walk/i.test(m) ||  // walk logging
    /^(log\s+|logged?\s+)/i.test(m)           // explicit log prefix
  ) return 'log';

  return 'general';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function trainer(userMessage, sendToTelegram) {
  const intent = detectIntent(userMessage);

  try {
    if (intent === 'end') {
      await handleEndSession(sendToTelegram);
      return;
    }

    if (intent === 'analyse') {
      await handleAnalysis(sendToTelegram);
      return;
    }

    if (intent === 'compare') {
      await handleCompare(sendToTelegram);
      return;
    }

    if (typeof intent === 'object' && intent.type === 'plan') {
      await handlePlan(intent.group, sendToTelegram);
      return;
    }

    if (typeof intent === 'object' && intent.type === 'coach') {
      await handleCoaching(intent.topic, sendToTelegram);
      return;
    }

    if (intent === 'log') {
      const cleanText = userMessage.replace(/^(log\s+|logged?\s+)/i, '').trim();
      await handleLog(cleanText, sendToTelegram);
      return;
    }

    // General — PT conversation
    const session = readSession();
    const sessionCtx = session
      ? `\n\nCurrent session in progress (${session.date}):\n${sessionSummary(session)}`
      : '';
    const prompt =
      `You are a practical, no-nonsense personal trainer for Brian Game — solo founder in Sydney. ` +
      `Goal: energy and longevity. New to structured training. Has gym access. Walks 50min each way daily.` +
      `${sessionCtx}\n\nUser: ${userMessage}\n\nBe direct. Max 8 lines.`;
    const response = await claudeRun(prompt);
    await sendToTelegram(response);

  } catch (err) {
    console.error('[trainer] error:', err.message);
    await sendToTelegram(`Trainer error: ${err.message}`);
  }
}

module.exports = trainer;
