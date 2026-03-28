const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_PATHS = {
  'shrody-core': '/Users/bgame/projects/shrody-core',
  jarvis: '/Users/bgame/jarvis',
};

const PROJECT_KEYWORDS = {
  'shrody-core': ['shrody', 'shrody-core', 'simulation', 'sim', 'what-if', 'supabase'],
  jarvis: ['jarvis', 'telegram', 'bot', 'index.js', 'agent'],
};

const AGENTS_CONFIG_PATH = path.join(__dirname, '..', 'agents.config.js');

function detectProject(text) {
  const lower = text.toLowerCase();
  for (const [dir, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return dir;
  }
  return 'jarvis';
}

function shellExec(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// If the generated prompt creates a new agent, register it in agents.config.js
function registerNewAgent(agentName, description) {
  try {
    const config = require(AGENTS_CONFIG_PATH);
    const intent = agentName.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const already = config.find(c => c.intent === intent || c.agent === agentName);
    if (already) return;

    // Read raw file and insert new entry before the 'general' catch-all
    let src = fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8');
    const newEntry = `  { intent: '${intent}', agent: '${agentName}', description: '${description}' },\n`;
    src = src.replace(
      /(\s*\{ intent: 'general')/,
      `${newEntry}$1`
    );
    fs.writeFileSync(AGENTS_CONFIG_PATH, src, 'utf8');
    // Bust require cache so next load picks up the change
    delete require.cache[require.resolve(AGENTS_CONFIG_PATH)];
    console.log(`[builder] registered new agent "${agentName}" in agents.config.js`);
  } catch (err) {
    console.error('[builder] failed to register agent:', err.message);
  }
}

async function generatePrompt(userMessage) {
  const meta = `You are writing Claude Code prompts for a solo founder. Projects: Shrody (Next.js/Supabase/Vercel at /Users/bgame/projects/shrody-core), JARVIS (Node.js at /Users/bgame/jarvis). Write a complete specific Claude Code prompt with no placeholders, exact file paths, exact code. If the task creates a new JARVIS agent file in /Users/bgame/jarvis/agents/, also add it to /Users/bgame/jarvis/agents.config.js following the existing format. End every prompt with: use --dangerously-skip-permissions, and when done commit all changes, push to GitHub, and run pm2 restart jarvis. Task: ${userMessage}`;
  const escaped = meta.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return shellExec(`claude -p "${escaped}"`);
}

function waitForConfirmation(chatId, pendingConfirmations) {
  return new Promise((resolve) => {
    pendingConfirmations.set(chatId, (replyText) => {
      resolve(replyText.trim().toLowerCase());
    });
  });
}

// Signature: builder(message, sendToTelegram, context)
// context = { chatId, pendingConfirmations }
async function builder(userMessage, sendToTelegram, context = {}) {
  const { chatId, pendingConfirmations } = context;
  console.log('[builder] BUILDER CALLED with:', userMessage);

  await sendToTelegram('Generating prompt Boss...');

  let generatedPrompt;
  try {
    generatedPrompt = await generatePrompt(userMessage);
    console.log('[builder] PROMPT GENERATED:', generatedPrompt);
  } catch (err) {
    console.error('[builder] generatePrompt error:', err.message);
    await sendToTelegram(`Failed to generate prompt: ${err.message}`);
    return;
  }

  const projectDir = detectProject(userMessage + ' ' + generatedPrompt);
  const cwd = PROJECT_PATHS[projectDir];
  console.log('[builder] PROJECT DETECTED:', projectDir, '->', cwd);

  const preview = generatedPrompt.slice(0, 200);
  await sendToTelegram(
    `Ready to build in ${cwd}:\n\n${preview}...\n\nReply 'yes' to execute or 'cancel' to abort.`
  );

  const confirmation = await waitForConfirmation(chatId, pendingConfirmations);
  console.log('[builder] confirmation received:', confirmation);

  if (confirmation !== 'yes') {
    await sendToTelegram('Cancelled.');
    return;
  }

  await sendToTelegram('Building now Boss...');

  return new Promise((resolve) => {
    const escapedPrompt = generatedPrompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const cmd = `cd "${cwd}" && claude --dangerously-skip-permissions -p "${escapedPrompt}"`;
    console.log('[builder] SPAWNING CLAUDE CODE in', cwd);
    console.log('[builder] full command:', cmd.slice(0, 200));

    const child = spawn('bash', ['-c', cmd], { env: process.env });
    const outputChunks = [];
    const errorChunks = [];

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      console.log('[builder] stdout chunk:', chunk.slice(0, 120));
      outputChunks.push(chunk);
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      console.error('[builder] stderr chunk:', chunk.slice(0, 120));
      errorChunks.push(chunk);
    });

    let elapsed = 30;
    const ticker = setInterval(async () => {
      await sendToTelegram(`Still building... (${elapsed}s elapsed)`);
      elapsed += 30;
    }, 30_000);

    child.on('close', async (code) => {
      clearInterval(ticker);
      console.log('[builder] process closed with code:', code);

      const stdout = outputChunks.join('').trim();
      const stderr = errorChunks.join('').trim();

      if (code === 0) {
        const summary = stdout.slice(-1000) || 'Done.';
        await sendToTelegram(`Build complete.\n\n${summary}`);
        resolve();
      } else {
        const errMsg = stderr.slice(-800) || stdout.slice(-800) || `Exit code ${code}`;
        console.error('[builder] build failed:', errMsg.slice(0, 200));
        await sendToTelegram(`Build failed (exit ${code}):\n\n${errMsg}`);
        resolve();
      }
    });

    child.on('error', async (err) => {
      clearInterval(ticker);
      console.error('[builder] spawn error:', err.message);
      await sendToTelegram(`Spawn error: ${err.message}`);
      resolve();
    });
  });
}

module.exports = builder;
module.exports.registerNewAgent = registerNewAgent;
