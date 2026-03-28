const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const JARVIS_DIR = '/Users/bgame/jarvis';
const AGENTS_CONFIG_PATH = path.join(JARVIS_DIR, 'agents.config.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 5 * 1024 * 1024, cwd: JARVIS_DIR, ...opts }, (err, stdout, stderr) => {
      resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), err });
    });
  });
}

function claudeSearch(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(
      `claude -p "${escaped}" --allowedTools web_search`,
      { maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

function claudeAnalyse(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(
      `claude -p "${escaped}"`,
      { maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

function readAgentsConfig() {
  try { return fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8'); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// 1. Improvement scan
// ---------------------------------------------------------------------------
async function handleScan(sendToTelegram) {
  await sendToTelegram('Running improvement scan...');

  // npm outdated
  const { stdout: outdated } = await run('npm outdated 2>/dev/null || true');
  const npmSection = outdated
    ? `Outdated packages:\n${outdated}`
    : 'All npm packages up to date.';

  // Claude Code version
  const { stdout: claudeVer } = await run('claude --version 2>/dev/null || echo "unknown"', { cwd: undefined });
  const versionSection = `Claude Code version: ${claudeVer || 'unknown'}`;

  // AI review of agents.config.js
  const configSrc = readAgentsConfig();
  const reviewPrompt =
    `You are reviewing a personal AI chief-of-staff Telegram bot called JARVIS. ` +
    `It runs on Node.js with these agents:\n\n${configSrc}\n\n` +
    `Suggest exactly 3 specific improvements using only free/open-source tools. ` +
    `Focus on: better intent routing, faster responses, useful new agent capabilities. ` +
    `Be concrete — name the tool, the npm package or GitHub repo, and what it would replace or add. ` +
    `Keep each suggestion to 2-3 sentences.`;

  let suggestions;
  try {
    suggestions = await claudeAnalyse(reviewPrompt);
  } catch (err) {
    suggestions = `Could not generate suggestions: ${err.message}`;
  }

  await sendToTelegram(
    `🔍 JARVIS Improvement Scan\n\n${versionSection}\n\n${npmSection}\n\n💡 Suggestions:\n${suggestions}`
  );
}

// ---------------------------------------------------------------------------
// 2. Find new agents
// ---------------------------------------------------------------------------
async function handleFindAgents(sendToTelegram) {
  await sendToTelegram('Searching GitHub for relevant projects...');

  const prompt =
    `Search the web and GitHub for these topics and return the top 3 most relevant repositories ` +
    `for improving a personal Node.js Telegram bot AI assistant:\n` +
    `- "telegram bot agent node.js 2025 2026"\n` +
    `- "open source personal AI assistant agents"\n` +
    `- "comfyui telegram integration"\n\n` +
    `For each result include: repo name, GitHub URL, what it does, and one sentence on how it could ` +
    `improve JARVIS (a Telegram bot with agents for projects, finance, ops, fitness, nutrition, ` +
    `psychology, image generation, SEO, competitor analysis). ` +
    `Only include repos with recent activity (2024-2026). Format as a numbered list.`;

  let result;
  try {
    result = await claudeSearch(prompt);
  } catch (err) {
    result = `Search failed: ${err.message}`;
  }

  await sendToTelegram(`🤖 New Agent Ideas from GitHub:\n\n${result}`);
}

// ---------------------------------------------------------------------------
// 3. Find better approach for [problem]
// ---------------------------------------------------------------------------
async function handleFindApproach(problem, sendToTelegram) {
  await sendToTelegram(`Searching for open source solutions for: "${problem}"...`);

  const prompt =
    `Search GitHub and the web for open source solutions to this problem: "${problem}"\n\n` +
    `Context: this is for a personal Node.js Telegram bot AI assistant running on macOS with PM2. ` +
    `Return the top 3 solutions with: name, GitHub URL or npm package, brief description, ` +
    `and why it fits this stack. Prefer solutions with recent activity and simple integration.`;

  let result;
  try {
    result = await claudeSearch(prompt);
  } catch (err) {
    result = `Search failed: ${err.message}`;
  }

  await sendToTelegram(`🔧 Solutions for "${problem}":\n\n${result}`);
}

// ---------------------------------------------------------------------------
// 4. GitHub trending
// ---------------------------------------------------------------------------
async function handleTrending(sendToTelegram) {
  await sendToTelegram('Checking GitHub trending for relevant projects...');

  const prompt =
    `Search GitHub trending and the web for the most relevant NEW repositories in these areas ` +
    `(focus on repos active in 2025-2026):\n` +
    `- AI agents and automation\n` +
    `- Personal assistant / life OS tools\n` +
    `- ComfyUI integrations and workflows\n` +
    `- Telegram bot frameworks\n` +
    `- Node.js AI tooling\n\n` +
    `Return the top 5 most relevant to a personal AI Telegram bot with image generation, ` +
    `project management, finance, health tracking, and web research capabilities. ` +
    `Include GitHub URLs. Format as a numbered list with name, URL, and 1-sentence description.`;

  let result;
  try {
    result = await claudeSearch(prompt);
  } catch (err) {
    result = `Search failed: ${err.message}`;
  }

  await sendToTelegram(`📈 GitHub Trending — JARVIS Relevant:\n\n${result}`);
}

// ---------------------------------------------------------------------------
// Proactive cron scan (exported)
// ---------------------------------------------------------------------------
async function proactiveScan() {
  console.log('[improvement] running proactive scan');

  // npm outdated
  const { stdout: outdated } = await run('npm outdated 2>/dev/null || true');
  const hasOutdated = outdated && outdated.trim().length > 0;

  // Web search for new tooling
  const configSrc = readAgentsConfig();
  const searchPrompt =
    `Search the web and GitHub for any new open source tools, npm packages, or GitHub repos ` +
    `released or updated in the last 30 days that would be useful for this Node.js Telegram AI bot:\n\n` +
    `Current agents: ${configSrc}\n\n` +
    `Only return something if you find a genuinely useful, specific new tool. ` +
    `If nothing new is worth mentioning, reply with exactly: NOTHING_NEW\n` +
    `If something is found: give the name, GitHub URL, and one sentence on why it's relevant.`;

  let searchResult;
  try {
    searchResult = await claudeSearch(searchPrompt);
  } catch (err) {
    console.error('[improvement] web search failed:', err.message);
    return null;
  }

  if (/NOTHING_NEW/i.test(searchResult) && !hasOutdated) {
    console.log('[improvement] proactive scan: nothing new');
    return null;
  }

  // Generate one specific suggestion
  const suggestionPrompt =
    `Based on this JARVIS agent config:\n${configSrc}\n\n` +
    `${searchResult !== 'NOTHING_NEW' ? `New tool found: ${searchResult}\n\n` : ''}` +
    `${hasOutdated ? `Outdated packages: ${outdated}\n\n` : ''}` +
    `Give ONE specific, actionable improvement suggestion. Include the GitHub URL or npm install command. ` +
    `2-3 sentences max. Be concrete.`;

  let suggestion;
  try {
    suggestion = await claudeAnalyse(suggestionPrompt);
  } catch (err) {
    suggestion = searchResult !== 'NOTHING_NEW' ? searchResult : `npm packages outdated:\n${outdated}`;
  }

  return `💡 JARVIS improvement found:\n\n${suggestion}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function improvement(userMessage, sendToTelegram) {
  const msg = userMessage.toLowerCase().trim();

  if (/^find new agents?$/.test(msg)) {
    await handleFindAgents(sendToTelegram);
    return;
  }

  if (/^check github trending$/.test(msg)) {
    await handleTrending(sendToTelegram);
    return;
  }

  const approachMatch = userMessage.match(/^find better approach for (.+)$/i);
  if (approachMatch) {
    await handleFindApproach(approachMatch[1].trim(), sendToTelegram);
    return;
  }

  // Default: improvement scan
  await handleScan(sendToTelegram);
}

module.exports = improvement;
module.exports.proactiveScan = proactiveScan;
