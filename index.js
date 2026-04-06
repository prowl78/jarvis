require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// ─── Supabase (optional — disabled if credentials missing) ───────────────────
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log('[jarvis-pt] Supabase connected');
} else {
  console.log('[jarvis-pt] Supabase not configured — Obsidian only');
}

// ─── Telegram ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('[jarvis-pt] listening');

// ─── Paths ───────────────────────────────────────────────────────────────────
const VAULT         = '/Users/bgame/Documents/Obsidian Vault/life';
const FITNESS_LOG   = path.join(VAULT, 'fitness-log.md');
const NUTRITION_LOG = path.join(VAULT, 'nutrition-log.md');
const PT_IMAGES     = path.join(VAULT, 'pt-images');
const SESSION_FILE  = path.join(VAULT, 'current-session.json');
const SESSION_TYPE  = path.join(VAULT, 'last-session-type.txt');
const TMP_DIR       = path.join(__dirname, 'tmp');

fs.mkdirSync(VAULT,     { recursive: true });
fs.mkdirSync(PT_IMAGES, { recursive: true });
fs.mkdirSync(TMP_DIR,   { recursive: true });

// ─── Time helpers ────────────────────────────────────────────────────────────
const TZ = 'Australia/Sydney';

function sydneyDate()      { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
function sydneyTimestamp() { return new Date().toLocaleString('en-AU', { timeZone: TZ }); }
function sydneyDay()       { return new Date().toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'long' }); }

// ─── Session persistence ─────────────────────────────────────────────────────
function readSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

function writeSession(s) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

function getOrCreateSession() {
  const s   = readSession();
  const today = sydneyDate();
  if (s && s.date === today) return s;
  return { date: today, exercises: [] };
}

// ─── Workout parsing ─────────────────────────────────────────────────────────
function capitalise(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

function parseExercise(text) {
  const t = text.trim();

  if (/active commute|commute walk|walk.*(peakhurst|padstow)|peakhurst.*padstow/i.test(t)) {
    return { name: 'Active commute', sets: 2, reps: 1, weight: null, duration: '50min' };
  }
  if (/^(walk|walking)\s+(\d+)\s*min/i.test(t)) {
    const m = t.match(/(\d+)\s*min/i);
    return { name: 'Walk', sets: 1, reps: 1, weight: null, duration: `${m[1]}min` };
  }

  const weightMatch = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const weight      = weightMatch ? parseFloat(weightMatch[1]) : null;

  const sxrMatch = t.match(/(\d+)\s*[xX×]\s*(\d+)/);
  let sets = null, reps = null;

  if (sxrMatch) { sets = parseInt(sxrMatch[1]); reps = parseInt(sxrMatch[2]); }
  if (!sets) { const m = t.match(/\b(\d+)\s*sets?\b/i); if (m) sets = parseInt(m[1]); }
  if (!sets) { if (/\bset\s+\d+\b/i.test(t)) sets = 1; }
  if (!reps) { const m = t.match(/\b(\d+)\s*reps?\b/i); if (m) reps = parseInt(m[1]); }

  if (!sets) sets = 3;
  if (!reps) reps = 8;

  let name = t
    .replace(/\d+(?:\.\d+)?\s*kg/gi, '')
    .replace(/\d+\s*[xX×]\s*\d+/g, '')
    .replace(/\b\d+\s*sets?\b/gi, '')
    .replace(/\bset\s+\d+\b/gi, '')
    .replace(/\b\d+\s*reps?\b/gi, '')
    .replace(/^(log\s+|logged?\s+)/i, '')
    .replace(/[^a-zA-Z\s\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = 'Exercise';
  return { name: capitalise(name), sets, reps, weight, duration: null };
}

function formatLogLine(ex) {
  if (ex.duration) return `✓ ${ex.name} ${ex.duration}${ex.sets > 1 ? ` x${ex.sets}` : ''}`;
  const w = ex.weight ? `${ex.weight}kg x${ex.reps}` : `x${ex.reps}`;
  return `✓ ${ex.name} ${w}`;
}

// ─── Message type detection ──────────────────────────────────────────────────
function detectType(text) {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Session end
  if (/^(done|finished|that'?s?\s*(it|all)|end\s+session|session\s*(done|over|complete|finished))\.?$/i.test(t)) return 'session_end';

  // Workout commands
  if (/^plan\s+(a\s+|my\s+)?(session|workout|today|legs?|chest|back|push|pull|full)/i.test(lower)) return 'cmd_plan';
  if (/how am i (doing|going|progressing)|workout (analysis|progress|check)|analyse my (workouts?|training)/i.test(lower)) return 'cmd_analysis';
  if (/^what'?s?\s+next\b|next exercise/i.test(lower)) return 'cmd_next';
  if (/^(advice on|form (for|on)|tips? (for|on)|how (do i|to))\s+/i.test(lower)) return 'cmd_advice';

  // Nutrition commands
  if (/what should i eat|what to eat/i.test(lower)) return 'cmd_food_plan';
  if (/how are my macros|macro (check|summary|today)|today'?s? (macros|nutrition|intake)/i.test(lower)) return 'cmd_macros';
  if (/am i eating enough|am i under.?eat|nutrition (check|review)/i.test(lower)) return 'cmd_nutrition_check';

  // Walk / commute
  if (/active commute|commute walk|walk.*(peakhurst|padstow)/i.test(lower)) return 'workout_log';
  if (/^walk(ing)?\s+\d+\s*min/i.test(lower)) return 'workout_log';

  // Strong workout signals
  const hasWeight   = /\d+(\.\d+)?\s*kg/i.test(lower);
  const hasSetsReps = /\d+\s*[xX×]\s*\d+/.test(lower) || /\d+\s*(sets?|reps?)/i.test(lower);
  const hasExercise = /(press|row|curl|raise|extension|pulldown|pull.?down|dip|squat|deadlift|fly|lunge|plank|push.?up|pull.?up|bench|incline|cable|lat\s|tricep|bicep|calf|hamstring|shoulder|leg\s+(press|curl|ext))/i.test(lower);

  if ((hasWeight && hasSetsReps) || (hasExercise && (hasWeight || hasSetsReps))) return 'workout_log';
  if (hasWeight && hasExercise) return 'workout_log';
  if (hasExercise && lower.split(/\s+/).length <= 5) return 'workout_log';

  // Strong food signals
  const foodVerb = /\b(had|ate|eaten|eating|having|just\s+had|just\s+ate|grabbed|cooked|made|ordered)\b/i.test(lower);
  const mealWord = /\b(breakfast|lunch|dinner|snack|meal|shake|smoothie|coffee|espresso|protein\s+shake|whey|pre.?workout)\b/i.test(lower);
  const foodItem = /\b(chicken|beef|fish|salmon|tuna|steak|rice|pasta|bread|egg|oat|banana|apple|salad|pizza|burger|sandwich|wrap|yogurt|milk|cheese|nut|avocado|broccoli|potato|sweet\s+potato|quest|clif|creatine|bcaa)\b/i.test(lower);

  if (foodVerb || mealWord || foodItem) return 'food_log';

  return 'general';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function appendFitnessLog(entry) {
  fs.mkdirSync(VAULT, { recursive: true });
  fs.appendFileSync(FITNESS_LOG, entry, 'utf8');
}

function appendNutritionLog(entry) {
  fs.mkdirSync(VAULT, { recursive: true });
  fs.appendFileSync(NUTRITION_LOG, entry, 'utf8');
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

function estimateMacros(food) {
  return new Promise((resolve) => {
    const prompt = `Nutritionist macro estimator. Reply with ONLY valid JSON, no other text: {"calories":N,"protein_g":N,"carbs_g":N,"fat_g":N}. Best guess, no asking. Food: ${food}`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }); return; }
      try {
        const m = stdout.trim().match(/\{[\s\S]*\}/);
        resolve(m ? JSON.parse(m[0]) : { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      } catch {
        resolve({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      }
    });
  });
}

// ─── Supabase writes ─────────────────────────────────────────────────────────
async function dbLogWorkout(ex, date) {
  if (!supabase) return;
  try {
    await supabase.from('workouts').insert({
      date,
      exercise: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      weight_kg: ex.weight,
      notes: ex.duration ? `duration: ${ex.duration}` : null,
    });
  } catch (e) { console.error('[db] workout:', e.message); }
}

async function dbLogNutrition(food, macros, date) {
  if (!supabase) return;
  try {
    await supabase.from('nutrition_logs').insert({
      date, food_description: food,
      calories: macros.calories, protein_g: macros.protein_g,
      carbs_g: macros.carbs_g, fat_g: macros.fat_g,
    });
  } catch (e) { console.error('[db] nutrition:', e.message); }
}

async function dbLogSession(session) {
  if (!supabase) return;
  try {
    const totalVol = session.exercises.reduce((sum, ex) => {
      return ex.weight && !ex.duration ? sum + (ex.sets * ex.reps * ex.weight) : sum;
    }, 0);
    await supabase.from('sessions').insert({
      date: session.date,
      total_volume_kg: totalVol,
      exercises_logged: session.exercises.length,
    });
  } catch (e) { console.error('[db] session:', e.message); }
}

// ─── Session summary ─────────────────────────────────────────────────────────
function sessionSummaryText(session) {
  const lines = [];
  let totalVol = 0;
  for (const ex of session.exercises) {
    if (ex.duration) {
      lines.push(`- ${ex.name}: ${ex.duration}${ex.sets > 1 ? ` x${ex.sets}` : ''}`);
    } else {
      const vol = ex.weight ? ex.sets * ex.reps * ex.weight : 0;
      totalVol += vol;
      const wStr  = ex.weight ? ` @ ${ex.weight}kg` : '';
      const vStr  = vol > 0 ? ` | ${vol}kg vol` : '';
      lines.push(`- ${ex.name}: ${ex.sets}x${ex.reps}${wStr}${vStr}`);
    }
  }
  if (totalVol > 0) lines.push(`Total volume: ${totalVol}kg`);
  return lines.join('\n');
}

// ─── History helpers ─────────────────────────────────────────────────────────
function parseHistory(raw) {
  const sessions = [];
  const blocks   = raw.split(/\n## (\d{4}-\d{2}-\d{2})/);
  for (let i = 1; i < blocks.length; i += 2) {
    const exercises = [];
    for (const line of (blocks[i + 1] || '').split('\n')) {
      const m = line.match(/^- (.+?):\s+(\d+)x(\d+)(?:\s+@\s+(\d+(?:\.\d+)?)kg)?/);
      if (m) exercises.push({ name: m[1].trim(), sets: parseInt(m[2]), reps: parseInt(m[3]), weight: m[4] ? parseFloat(m[4]) : null });
    }
    if (exercises.length) sessions.push({ date: blocks[i], exercises });
  }
  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

function lastSeen(sessions, exName) {
  for (const s of sessions) {
    const m = s.exercises.find(e => e.name.toLowerCase().includes(exName.toLowerCase()));
    if (m) return m;
  }
  return null;
}

function progressiveTarget(last) {
  if (!last) return { sets: 3, reps: 8, weight: null };
  let { sets, reps, weight } = last;
  if (reps < 12) reps += 1;
  else { reps = 8; weight = weight ? Math.round((weight * 1.05) / 2.5) * 2.5 : null; }
  return { sets, reps, weight };
}

// ─── Workout log handler ─────────────────────────────────────────────────────
async function handleWorkoutLog(text, send) {
  const date    = sydneyDate();
  const ts      = sydneyTimestamp();
  const session = getOrCreateSession();
  const ex      = parseExercise(text.replace(/^(log\s+|logged?\s+)/i, '').trim());

  const existing = session.exercises.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
  if (existing && ex.sets === 1) {
    existing.sets = (existing.sets || 1) + 1;
  } else {
    session.exercises.push({ ...ex, loggedAt: new Date().toISOString() });
  }
  writeSession(session);

  const logLine = ex.duration
    ? `\n- ${ts} | ${ex.name} ${ex.duration}\n`
    : `\n- ${ts} | ${ex.name} ${ex.sets}x${ex.reps}${ex.weight ? ` @ ${ex.weight}kg` : ''}\n`;
  appendFitnessLog(logLine);
  await dbLogWorkout(ex, date);

  await send(formatLogLine(ex));
}

// ─── Session end handler ─────────────────────────────────────────────────────
async function handleSessionEnd(send) {
  const session = readSession();
  if (!session || session.exercises.length === 0) { await send('No active session.'); return; }

  const summary = sessionSummaryText(session);
  const ts      = sydneyTimestamp();

  appendFitnessLog(`\n## ${session.date} — Session closed ${ts}\n${summary}\n`);
  await dbLogSession(session);
  clearSession();

  await send(`Session saved ✓\n\n${session.date}\n\n${summary}`);
}

// ─── Food log handler ────────────────────────────────────────────────────────
async function handleFoodLog(text, send) {
  const date = sydneyDate();
  const ts   = sydneyTimestamp();
  const food = text
    .replace(/^(log\s+|logged?\s+|had\s+|ate\s+|just\s+had\s+|just\s+ate\s+|eating\s+)/i, '')
    .trim();

  const macros = await estimateMacros(food);

  appendNutritionLog(`\n- ${ts} | ${food} | ~${macros.calories}kcal | P:${macros.protein_g}g C:${macros.carbs_g}g F:${macros.fat_g}g\n`);
  await dbLogNutrition(food, macros, date);

  await send(`✓ ${food} ~${macros.calories}kcal | P:${macros.protein_g}g C:${macros.carbs_g}g F:${macros.fat_g}g`);
}

// ─── Plan handler ────────────────────────────────────────────────────────────
async function handlePlan(send) {
  const raw  = readSafe(FITNESS_LOG) || '';
  const date = sydneyDate();
  const day  = sydneyDay();

  // Alternate between Session 1 (Push/Legs) and Session 2 (Pull/Legs)
  const lastType  = readSafe(SESSION_TYPE)?.trim() || '2';
  const nextType  = lastType === '1' ? '2' : '1';
  const S1 = ['Chest Press', 'Tricep Dip', 'Shoulder Press', 'Leg Press'];
  const S2 = ['Lat Pulldown', 'Seated Cable Row', 'Leg Curl', 'Calf Raise', 'Bicep Curl'];
  const exercises = nextType === '1' ? S1 : S2;
  const label     = nextType === '1' ? 'Push + Legs' : 'Pull + Legs';

  const sessions = parseHistory(raw);
  const lines    = [`# ${label} — ${date} (${day})`, '', '**Warmup:** 5 min light cardio\n'];

  for (const exName of exercises) {
    const last   = lastSeen(sessions, exName);
    const target = progressiveTarget(last);
    const wStr   = target.weight ? ` @ ${target.weight}kg` : ' (find working weight)';
    const note   = !last ? ' (baseline)' : target.reps !== last.reps ? ' +1 rep' : target.weight !== last.weight ? ` ↑ from ${last.weight}kg` : '';
    lines.push(`- ${exName}: ${target.sets}x${target.reps}${wStr}${note}`);
  }
  lines.push('\n**Cooldown:** stretch 5 min');

  fs.writeFileSync(SESSION_TYPE, nextType, 'utf8');
  await send(lines.join('\n'));
}

// ─── Analysis handler ────────────────────────────────────────────────────────
async function handleAnalysis(send) {
  const raw = readSafe(FITNESS_LOG);
  if (!raw || raw.trim().length < 50) { await send('Not enough data yet. Keep logging.'); return; }

  const cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent    = raw.split('\n').filter(l => { const m = l.match(/^## (\d{4}-\d{2}-\d{2})/); return !m || m[1] >= cutoffStr; }).join('\n');

  const result = await claudeRun(
    `You are a personal trainer reviewing Brian's last 30 days of training. Goal: energy and longevity, not bodybuilding. New to structured training. Walks 50min each way daily. Two sessions/week — Session 1 (Push/Legs): chest press, tricep dip, shoulder press, leg press. Session 2 (Pull/Legs): lat pulldown, seated cable row, leg curl, calf raise, bicep curl.\n\nLogs:\n${recent}\n\nDirect PT assessment: consistency, progression trends, gaps, one specific recommendation for next 2 weeks. Max 12 lines. No fluff.`
  );
  await send(result);
}

// ─── Next exercise handler ───────────────────────────────────────────────────
async function handleNext(send) {
  const session = readSession();
  if (!session || session.exercises.length === 0) {
    await send("No session in progress. Say 'plan a session' to start.");
    return;
  }
  const done = session.exercises.map(e => e.name.toLowerCase());
  const S1   = ['Chest Press', 'Tricep Dip', 'Shoulder Press', 'Leg Press'];
  const S2   = ['Lat Pulldown', 'Seated Cable Row', 'Leg Curl', 'Calf Raise', 'Bicep Curl'];
  const inS1 = S1.some(e => done.includes(e.toLowerCase()));
  const plan = inS1 ? S1 : S2;
  const rem  = plan.filter(e => !done.includes(e.toLowerCase()));
  await send(rem.length ? `Next: ${rem[0]}` : "All exercises done. Say 'done' to close the session.");
}

// ─── Advice handler ──────────────────────────────────────────────────────────
async function handleAdvice(topic, send) {
  const result = await claudeRun(
    `Personal trainer. Advice on: ${topic}. Context: male, new to structured training, goal energy and longevity. Cover: 2-3 form cues, 2 common mistakes, how to progress. Max 10 lines. Specific.`
  );
  await send(result);
}

// ─── Food plan handler ───────────────────────────────────────────────────────
async function handleFoodPlan(send) {
  const session    = readSession();
  const trainingDay = session && session.exercises.length > 0;
  const raw        = readSafe(NUTRITION_LOG) || '';
  const todayDate  = sydneyDate();
  const todayLines = raw.split('\n').filter(l => l.includes(todayDate) && l.trim().startsWith('-'));

  const result = await claudeRun(
    `Practical nutritionist for Brian — solo founder in Sydney, new to structured training, goal energy and longevity, walks 50min each way daily.\n${trainingDay ? 'TODAY IS A TRAINING DAY — higher carbs, hit protein.' : 'TODAY IS A REST DAY — slightly lower cals, still hit protein.'}\n${todayLines.length > 0 ? `Already logged today:\n${todayLines.join('\n')}\nRecommend what he still needs.` : 'Full day recommendations.'}\nDirect, practical, no diet-culture language. Max 8 lines.`
  );
  await send(result);
}

// ─── Macro check handler ─────────────────────────────────────────────────────
async function handleMacroCheck(send) {
  const raw        = readSafe(NUTRITION_LOG) || '';
  const todayDate  = sydneyDate();
  const todayLines = raw.split('\n').filter(l => l.includes(todayDate) && l.trim().startsWith('-'));

  if (todayLines.length === 0) { await send('Nothing logged today yet.'); return; }

  let totals = { cal: 0, p: 0, c: 0, f: 0 };
  for (const line of todayLines) {
    const m = line.match(/~(\d+)kcal.*P:(\d+)g.*C:(\d+)g.*F:(\d+)g/);
    if (m) { totals.cal += parseInt(m[1]); totals.p += parseInt(m[2]); totals.c += parseInt(m[3]); totals.f += parseInt(m[4]); }
  }
  await send(`Today (${todayLines.length} entries):\n~${totals.cal}kcal | P:${totals.p}g C:${totals.c}g F:${totals.f}g`);
}

// ─── Nutrition check handler ─────────────────────────────────────────────────
async function handleNutritionCheck(send) {
  const cutoff    = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filterRecent = (raw) => (raw || '').split('\n').filter(l => { const m = l.match(/(\d{4}-\d{2}-\d{2})/); return m && m[1] >= cutoffStr; }).join('\n');

  const result = await claudeRun(
    `Nutritionist reviewing Brian's last 7 days vs training. Goal: energy and longevity. Walks 50min each way.\n\nNutrition:\n${filterRecent(readSafe(NUTRITION_LOG)) || '(empty)'}\n\nFitness:\n${filterRecent(readSafe(FITNESS_LOG)) || '(empty)'}\n\nAre they eating enough relative to training volume? Flag if under-fuelled. No diet-culture language. Max 8 lines.`
  );
  await send(result);
}

// ─── General handler ─────────────────────────────────────────────────────────
async function handleGeneral(text, send) {
  const result = await claudeRun(
    `You are a personal trainer and nutritionist for Brian Game — solo founder in Sydney, goal energy and longevity, new to structured training, 50min walk each way daily. Two sessions/week: Session 1 (Push/Legs): chest press, tricep dip, shoulder press, leg press. Session 2 (Pull/Legs): lat pulldown, seated cable row, leg curl, calf raise, bicep curl. Answer directly and concisely. Max 8 lines.\n\n${text}`
  );
  await send(result);
}

// ─── Image handler ───────────────────────────────────────────────────────────
async function handleImage(imagePath, caption, chatId, send) {
  const prompt = `Analyse this image for a PT and nutrition tracking app. Identify which type it is and respond accordingly.

CLASSIFY AS ONE OF:
1. fitness_screenshot — Apple Fitness activity rings, workout summary, heart rate, calorie burn, move/exercise/stand goals, steps, any Apple Health stat screen
2. food — food, meal, ingredients, drink
3. progress — person's body (progress photo) or someone performing an exercise (form check)
4. other

FORMAT your response as:
TYPE:<type>
<content>

For fitness_screenshot: extract ALL visible data — ring percentages, calorie burns, steps, heart rate, workout name, duration, everything
For food: estimate macros per item and total (calories, protein, carbs, fat)
For progress: one line acknowledgement
For other: brief description

Caption: ${caption || 'none'}`;

  return new Promise((resolve) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}" --image "${imagePath}"`, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout, stderr) => {
      const raw       = err ? 'TYPE:other\nCould not analyse image.' : stdout.trim();
      const typeMatch = raw.match(/^TYPE:(\w+)/m);
      const imgType   = typeMatch ? typeMatch[1] : 'other';
      const body      = raw.replace(/^TYPE:\w+\n?/m, '').trim();
      const ts        = sydneyTimestamp();
      const date      = sydneyDate();

      console.log(`[image] type=${imgType}`);

      if (imgType === 'fitness_screenshot') {
        appendFitnessLog(`\n## ${date} — Apple Fitness (${ts})\n${body}\n`);
        await send(body);
      } else if (imgType === 'food') {
        appendNutritionLog(`\n- ${ts} | [photo] ${caption || 'food photo'} | ${body}\n`);
        await send(body);
      } else if (imgType === 'progress') {
        try {
          fs.mkdirSync(PT_IMAGES, { recursive: true });
          const dest = path.join(PT_IMAGES, `${date}-${Date.now()}.jpg`);
          fs.copyFileSync(imagePath, dest);
        } catch (e) { console.error('[image] save error:', e.message); }
        await send('✓ Saved');
      } else {
        await send(body || 'Got it.');
      }
      resolve();
    });
  });
}

// ─── Telegram handlers ───────────────────────────────────────────────────────
bot.on('photo', async (msg) => {
  const chatId  = msg.chat.id;
  const caption = msg.caption || '';
  const send    = (t) => bot.sendMessage(chatId, t);

  try {
    const fileId   = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);
    const tmpPath  = path.join(TMP_DIR, `img-${Date.now()}.jpg`);

    const resp = await axios.get(fileLink, { responseType: 'arraybuffer' });
    fs.writeFileSync(tmpPath, Buffer.from(resp.data));

    await handleImage(tmpPath, caption, chatId, send);
    try { fs.unlinkSync(tmpPath); } catch {}
  } catch (err) {
    console.error('[photo]', err.message);
    await send('Had trouble with that image.');
  }
});

bot.on('message', async (msg) => {
  if (!msg.text) return;
  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const send   = (t) => bot.sendMessage(chatId, t);

  console.log(`[msg] "${text}"`);

  try {
    const type = detectType(text);
    console.log(`[type] ${type}`);

    switch (type) {
      case 'workout_log':         return await handleWorkoutLog(text, send);
      case 'session_end':         return await handleSessionEnd(send);
      case 'food_log':            return await handleFoodLog(text, send);
      case 'cmd_plan':            return await handlePlan(send);
      case 'cmd_analysis':        return await handleAnalysis(send);
      case 'cmd_next':            return await handleNext(send);
      case 'cmd_advice': {
        const topic = text.replace(/^(advice on|form (for|on)|tips? (for|on)|how (do i|to))\s+/i, '').trim();
        return await handleAdvice(topic, send);
      }
      case 'cmd_food_plan':       return await handleFoodPlan(send);
      case 'cmd_macros':          return await handleMacroCheck(send);
      case 'cmd_nutrition_check': return await handleNutritionCheck(send);
      default:                    return await handleGeneral(text, send);
    }
  } catch (err) {
    console.error('[error]', err.message);
    await send(`Error: ${err.message}`);
  }
});
