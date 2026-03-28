const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const VAULT = '/Users/bgame/Documents/Obsidian Vault';
const MARKETING_DIR = path.join(VAULT, 'marketing');
const PROJECTS_DIR  = path.join(VAULT, 'projects');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function claudeRun(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function saveToVault(filename, content) {
  fs.mkdirSync(MARKETING_DIR, { recursive: true });
  const filepath = path.join(MARKETING_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

function readProject(name) {
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, `${name}.md`), 'utf8');
  } catch {
    return '';
  }
}

function waitForReply(chatId, pendingConfirmations) {
  return new Promise(resolve => {
    pendingConfirmations.set(chatId, reply => resolve(reply.trim()));
  });
}

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------
function parseCommand(message) {
  const lower = message.toLowerCase();

  if (/find\s+influencers?\s+for\s+shrody|shrody.*influencers?|influencers?.*shrody/i.test(message))
    return { action: 'influencers' };

  if (/outreach\s+(?:for\s+)?@?([\w.]+)/i.test(message)) {
    const m = message.match(/outreach\s+(?:for\s+)?@?([\w.]+)/i);
    return { action: 'outreach', handle: m[1] };
  }

  if (/ndis\s+director(?:ies|y)|director(?:ies|y).*ndis|onlyhuman.*director(?:ies|y)/i.test(message))
    return { action: 'ndis_directories' };

  if (/submit\s+to\s+(.+)/i.test(message)) {
    const m = message.match(/submit\s+to\s+(.+)/i);
    return { action: 'submit', directory: m[1].trim() };
  }

  if (/tiktok\s+strategy|strategy.*tiktok|tiktok.*shrody|shrody.*tiktok/i.test(message))
    return { action: 'tiktok_strategy' };

  return { action: 'unknown' };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function findInfluencers(sendToTelegram) {
  await sendToTelegram('Researching Shrody creator targets...');

  const prompt = `Generate a list of 10 TikTok creator profiles to target for Shrody, a what-if simulation engine app.

Target criteria:
- Content niches: personality psychology, decision making, self improvement, life choices, what-if scenarios, alternate reality
- Audience: AU-first but global OK
- Size: 5k-50k followers (micro-influencers)
- Engagement: 3%+ engagement rate
- Tone fit: curious, thoughtful, analytical or playful

For each creator, provide:
1. Suggested handle style (describe the type, e.g. @decisions.daily)
2. Their content angle
3. Why they fit Shrody
4. Suggested collaboration hook

Format as a numbered list. Be specific and creative. These are target profile types, not real accounts.`;

  const result = await claudeRun(prompt);
  const content = `# Shrody Influencer Targets\n_${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}_\n\n${result}\n`;
  const filepath = saveToVault(`shrody-influencers-${timestamp()}.md`, content);

  await sendToTelegram(`${result}\n\n——\nSaved to ${filepath}`);
}

async function writeOutreach(handle, sendToTelegram) {
  await sendToTelegram(`Drafting outreach DM for @${handle}...`);

  const prompt = `Write a personalised TikTok DM to a creator with handle @${handle} to introduce Shrody, a what-if simulation engine.

Rules:
- Peer to peer tone. Not a brand voice. Sound like a real person.
- Keep it short: 4-6 sentences max.
- Open by referencing something specific to their likely content niche (decision making, self improvement, what-if thinking).
- Do NOT lead with Shrody. Lead with them.
- Include a what-if hook that's relevant to their niche.
- Soft ask at the end: offer to let them try Shrody for free, no strings.
- No hashtags. No emojis unless natural. No corporate language.

Output only the DM text.`;

  const result = await claudeRun(prompt);
  const content = `# Outreach DM — @${handle}\n_${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}_\n\n${result}\n`;
  const filepath = saveToVault(`outreach-${handle}-${timestamp()}.md`, content);

  await sendToTelegram(`DM for @${handle}:\n\n${result}\n\n——\nSaved to ${filepath}`);
}

async function findNdisDirs(sendToTelegram) {
  await sendToTelegram('Generating NDIS directory list...');

  const prompt = `List 10 Australian NDIS provider directories where OnlyHuman (an NDIS companionship and social support service) should be listed.

For each directory provide:
1. Directory name
2. URL
3. Submission type: Free / Paid / Both
4. Priority: High / Medium
5. One-line note on why it matters

Focus on: NDIS-specific directories, disability support directories, Australian health/care directories, and community service finders.

Format as a numbered list.`;

  const result = await claudeRun(prompt);
  const content = `# NDIS Directory Targets — OnlyHuman\n_${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}_\n\n${result}\n`;
  const filepath = saveToVault(`ndis-directories-${timestamp()}.md`, content);

  await sendToTelegram(`${result}\n\n——\nSaved to ${filepath}`);
}

async function submitToDirectory(directory, sendToTelegram, context) {
  const { chatId, pendingConfirmations } = context;
  const profileData = readProject('onlyhuman');

  await sendToTelegram(`Preparing OnlyHuman submission for: ${directory}\n\nReading profile from Obsidian...`);

  const prompt = `You are preparing a provider profile submission for OnlyHuman to submit to the "${directory}" NDIS directory.

OnlyHuman project context:
${profileData || 'NDIS companionship service providing AI-assisted social support and companionship for NDIS participants.'}

Generate a complete submission profile with these standard fields:
- Organisation name
- Service type
- Description (150 words max)
- Target population
- Geographic coverage
- Contact email placeholder
- Website placeholder
- Key services (bullet list)
- Registration/accreditation note

Format ready to copy-paste into a web form.`;

  const profile = await claudeRun(prompt);

  await sendToTelegram(
    `Submission profile for ${directory}:\n\n${profile}\n\n——\nNote: Automated browser form-filling requires computer use capabilities not yet active.\nReply 'copy' to confirm you've copied this, or 'save [filename]' to save to Obsidian.`
  );

  if (!chatId || !pendingConfirmations) return;

  const reply = await waitForReply(chatId, pendingConfirmations);
  const saveMatch = reply.match(/^save\s+(.+)/i);

  if (saveMatch) {
    const filename = saveMatch[1].trim();
    const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
    const content = `# Directory Submission — ${directory}\n_${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}_\n\n${profile}\n`;
    const filepath = saveToVault(safeName, content);
    await sendToTelegram(`Saved to ${filepath}`);
  } else {
    await sendToTelegram('Got it. Profile stays in chat for manual copy.');
  }
}

async function tiktokStrategy(sendToTelegram) {
  await sendToTelegram('Building Shrody TikTok strategy...');

  const prompt = `Write a full TikTok distribution strategy for Shrody, a what-if simulation engine that lets users explore alternate life scenarios.

Include:

## Posting Cadence
- Recommended frequency
- Best posting times (AU timezone)
- Content mix ratio

## Content Pillars (5)
- Name, description, example video concept for each

## Hashtag Strategy
- Core hashtags (always use)
- Niche hashtags (rotate)
- Trending categories to watch

## Creator Partnership Approach
- Target creator profile
- Outreach sequence
- Partnership types (affiliate, collab, gifted access)
- What to offer vs what to ask

## First 30 Days Plan
- Week by week breakdown
- KPIs to track
- What success looks like at day 30

Be specific. Give real examples. Shrody's hook is: "what would your life look like if you'd made a different choice?"`;

  const result = await claudeRun(prompt);
  const content = `# Shrody TikTok Strategy\n_${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}_\n\n${result}\n`;
  const filepath = saveToVault(`tiktok-strategy-shrody-${timestamp()}.md`, content);

  // Send in chunks if too long for Telegram (4096 char limit)
  const MAX = 3800;
  if (result.length <= MAX) {
    await sendToTelegram(`${result}\n\n——\nSaved to ${filepath}`);
  } else {
    const chunks = result.match(/.{1,3800}/gs) || [result];
    for (const chunk of chunks) await sendToTelegram(chunk);
    await sendToTelegram(`——\nSaved to ${filepath}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function distribution(userMessage, sendToTelegram, context = {}) {
  const cmd = parseCommand(userMessage);
  console.log('[distribution] action:', cmd.action);

  try {
    switch (cmd.action) {
      case 'influencers':      return await findInfluencers(sendToTelegram);
      case 'outreach':         return await writeOutreach(cmd.handle, sendToTelegram);
      case 'ndis_directories': return await findNdisDirs(sendToTelegram);
      case 'submit':           return await submitToDirectory(cmd.directory, sendToTelegram, context);
      case 'tiktok_strategy':  return await tiktokStrategy(sendToTelegram);
      default:
        await sendToTelegram(
          'Distribution commands:\n' +
          '• find influencers for shrody\n' +
          '• outreach for @[handle]\n' +
          '• ndis directories\n' +
          '• submit to [directory name]\n' +
          '• tiktok strategy for shrody'
        );
    }
  } catch (err) {
    console.error('[distribution] error:', err.message);
    await sendToTelegram(`Distribution agent error: ${err.message}`);
  }
}

module.exports = distribution;
