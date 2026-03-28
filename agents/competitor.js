const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const VAULT       = '/Users/bgame/Documents/Obsidian Vault';
const COMP_DIR    = path.join(VAULT, 'marketing', 'competitive');

function claudeRun(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// claude -p with web search enabled
function claudeWebSearch(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(
      `claude -p "${escaped}" --allowedTools web_search`,
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Fall back to standard claude if web_search tool unavailable
          console.warn('[competitor] web_search failed, falling back to base model:', stderr?.slice(0, 80));
          claudeRun(prompt).then(resolve).catch(reject);
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function saveToVault(filename, content) {
  fs.mkdirSync(COMP_DIR, { recursive: true });
  const filepath = path.join(COMP_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

async function sendChunked(sendToTelegram, text, footer) {
  const MAX = 3800;
  for (let i = 0; i < text.length; i += MAX) {
    await sendToTelegram(text.slice(i, i + MAX));
  }
  if (footer) await sendToTelegram(footer);
}

function parseCommand(message) {
  const lower = message.toLowerCase();

  if (/market\s+scan.*shrody|shrody.*market\s+scan/i.test(message))
    return { action: 'scan_shrody' };

  if (/market\s+scan.*onlyhuman|onlyhuman.*market\s+scan|market\s+scan.*ndis|ndis.*market\s+scan/i.test(message))
    return { action: 'scan_onlyhuman' };

  if (/positioning.*shrody|shrody.*positioning/i.test(message))
    return { action: 'positioning_shrody' };

  const monitorMatch = message.match(/monitor\s+(.+)/i);
  if (monitorMatch)
    return { action: 'monitor', topic: monitorMatch[1].trim() };

  return { action: 'unknown' };
}

// ---------------------------------------------------------------------------
// 1. Market scan — Shrody
// ---------------------------------------------------------------------------
async function scanShrody(sendToTelegram) {
  await sendToTelegram('Running market scan for Shrody...');

  const prompt = `You are a competitive intelligence analyst. Analyse the market landscape for Shrody, a what-if life simulation engine that lets users explore alternate scenarios for major life decisions.

## Search Behaviour
What are people searching for around: AI decision making, what-if scenarios, life simulation, alternate life paths, regret exploration, decision support tools? List 15 real query patterns.

## Competitive Landscape
Who are the actual or adjacent competitors?
- AI tools people use for what-if questions (ChatGPT prompts, Claude, etc.)
- Journaling and reflection apps (Day One, Reflectly, etc.)
- Decision-making frameworks and apps
- Life simulation games (The Sims, BitLife, etc.)
- Therapy and coaching apps that touch on life choices
For each: name, what they do, why someone chooses them over Shrody, their weakness.

## Reddit & Community Signals
What subreddits and communities are discussing what-if thinking, life regret, alternate decisions, simulation? What are the recurring themes and pain points?

## TikTok & Social Trends
What content styles and creators are already capturing this audience? What hooks are working?

## ChatGPT/Claude Overlap
How are people currently using LLMs for what-if life questions? What prompt patterns are common? Where does Shrody outperform a raw LLM conversation?

## Threats
Top 3 competitive threats to Shrody right now.

## Opportunities
Top 3 market gaps Shrody can move into immediately.

## Positioning Recommendation
One sharp paragraph: how Shrody should position itself given this landscape.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# Market Scan — Shrody\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`shrody-market-scan-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 2. Market scan — OnlyHuman
// ---------------------------------------------------------------------------
async function scanOnlyHuman(sendToTelegram) {
  await sendToTelegram('Running market scan for OnlyHuman...');

  const prompt = `You are a competitive intelligence analyst specialising in the NDIS sector in Australia. Analyse the market landscape for OnlyHuman, an AI-assisted companionship and social support service for NDIS participants.

## NDIS Provider Landscape
Who are the registered NDIS providers in the companionship, social support, and community participation categories?
- List the major players (national and state-level)
- What support types do they provide?
- What is the typical pricing model (per hour, package, subscription)?
- How are they positioned (clinical, friendly, tech-forward, grassroots)?

## Pricing Benchmarks
What does social support / companionship typically cost under NDIS? What does the NDIS price guide allow? What are providers charging?

## Digital Presence Gaps
Which providers have weak digital presence, poor SEO, or no online booking? These are opportunities for OnlyHuman.

## AI & Tech Differentiation
Are any NDIS providers using AI, chat, or tech-enabled support? If so, who and how? Where is the gap?

## Participant Pain Points
What do NDIS participants and their families complain about when it comes to finding companionship support? (Base on known community sentiment, forums, reviews.)

## Gaps OnlyHuman Can Own
List 5 specific positioning gaps or service niches that no current provider is clearly owning.

## Recommended Positioning
One sharp paragraph on how OnlyHuman should position against existing providers.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# Market Scan — OnlyHuman\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`onlyhuman-market-scan-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 3. Monitor topic
// ---------------------------------------------------------------------------
async function monitorTopic(topic, sendToTelegram) {
  await sendToTelegram(`Monitoring: ${topic}...`);

  const prompt = `You are a market intelligence analyst for Brian Game, a solo founder building:
- Shrody: a what-if life simulation engine
- OnlyHuman: an NDIS AI companionship service
- Caligulas: a counter-award institution

Search for and summarise recent activity around: "${topic}"

Cover:
1. Recent news (last 30 days if possible)
2. Reddit discussion (what communities are saying, sentiment, top threads)
3. TikTok/social trends (what content is getting traction)
4. Startup/product activity (any new launches, funding, pivots)
5. Relevance to Brian's products — is this a threat, opportunity, or signal to watch?

Be specific. Surface what's actionable.`;

  const result = await claudeWebSearch(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const content = `# Monitor: ${topic}\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`monitor-${slug}-${timestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 4. Positioning — Shrody
// ---------------------------------------------------------------------------
async function positioningShrody(sendToTelegram) {
  await sendToTelegram('Building positioning analysis for Shrody...');

  const prompt = `You are a brand strategist. Develop a sharp competitive positioning for Shrody, a what-if life simulation engine.

## Direct Alternatives
Compare Shrody head-to-head against each of these:

1. **ChatGPT / Claude for what-if questions**
   - What the user does: types "what if I had taken that job" into a chatbot
   - What they get: a generic conversational response
   - What Shrody gives that this doesn't:

2. **Journaling apps (Day One, Reflectly, Jour)**
   - What the user does: writes about their feelings and past choices
   - What they get: a record and mild reflection prompts
   - What Shrody gives that this doesn't:

3. **Therapy and coaching apps (BetterHelp, Headspace, Calm)**
   - What the user does: guided reflection, CBT exercises, mood tracking
   - What they get: regulated emotional support
   - What Shrody gives that this doesn't:

4. **Life simulation games (BitLife, The Sims)**
   - What the user does: plays out a fictional life
   - What they get: entertainment, escapism
   - What Shrody gives that this doesn't:

## Positioning Statement
Write a crisp positioning statement using this format:
"For [target user] who [situation], Shrody is the [category] that [key benefit]. Unlike [main alternative], Shrody [key differentiator]."

## 3 Differentiators
The 3 things only Shrody does. One sentence each. Sharp enough to use in copy.

## Tagline Options
Give 5 tagline options. Short. Memorable. Captures the what-if energy.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# Shrody Positioning Analysis\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`shrody-positioning-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function competitor(userMessage, sendToTelegram, context = {}) {
  const cmd = parseCommand(userMessage);
  console.log('[competitor] action:', cmd.action, cmd.topic || '');

  try {
    switch (cmd.action) {
      case 'scan_shrody':       return await scanShrody(sendToTelegram);
      case 'scan_onlyhuman':    return await scanOnlyHuman(sendToTelegram);
      case 'monitor':           return await monitorTopic(cmd.topic, sendToTelegram);
      case 'positioning_shrody':return await positioningShrody(sendToTelegram);
      default:
        await sendToTelegram(
          'Competitor commands:\n' +
          '• market scan for shrody\n' +
          '• market scan for onlyhuman\n' +
          '• monitor [topic]\n' +
          '• positioning for shrody'
        );
    }
  } catch (err) {
    console.error('[competitor] error:', err.message);
    await sendToTelegram(`Competitor agent error: ${err.message}`);
  }
}

module.exports = competitor;
