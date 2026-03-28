const { exec, spawn } = require('child_process');
const os = require('os');

const PROJECT_DIRS = {
  shrody: 'shrody-core',
  'shrody-core': 'shrody-core',
  jarvis: 'jarvis',
};

const PROJECT_KEYWORDS = {
  'shrody-core': ['shrody', 'shrody-core', 'simulation', 'sim', 'what-if', 'supabase'],
  jarvis: ['jarvis', 'telegram', 'bot', 'index.js', 'agent'],
};

function detectProject(text) {
  const lower = text.toLowerCase();
  for (const [dir, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return dir;
  }
  return 'jarvis'; // default
}

function shellExec(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function generatePrompt(userMessage) {
  const meta = `You are writing Claude Code prompts for a solo founder. Projects: Shrody (Next.js/Supabase/Vercel at ~/shrody-core), JARVIS (Node.js at ~/jarvis). Write a complete specific Claude Code prompt with no placeholders, exact file paths, exact code. End every prompt with: use --dangerously-skip-permissions, and when done commit all changes and push to GitHub. Task: ${userMessage}`;
  const escaped = meta.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return shellExec(`claude -p "${escaped}"`);
}

async function builder(userMessage, sendToTelegram) {
  // Immediately acknowledge
  await sendToTelegram('Building now Boss...');

  // Step 1: generate the claude code prompt
  let generatedPrompt;
  try {
    generatedPrompt = await generatePrompt(userMessage);
    console.log('[builder] generated prompt length:', generatedPrompt.length);
  } catch (err) {
    await sendToTelegram(`Failed to generate prompt: ${err.message}`);
    return { success: false, reason: err.message };
  }

  // Step 2: detect project
  const projectDir = detectProject(userMessage + ' ' + generatedPrompt);
  const cwd = `${os.homedir()}/${projectDir}`;
  console.log('[builder] project dir:', cwd);

  await sendToTelegram(`Detected project: ${projectDir}. Running Claude Code...`);

  // Step 3: shell out — stream so we can send progress ticks
  return new Promise((resolve) => {
    // Escape the generated prompt for shell embedding
    const escapedPrompt = generatedPrompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const child = spawn(
      'bash',
      ['-c', `cd "${cwd}" && claude --dangerously-skip-permissions -p "${escapedPrompt}"`],
      { env: process.env }
    );

    const outputChunks = [];
    const errorChunks = [];

    child.stdout.on('data', (d) => outputChunks.push(d.toString()));
    child.stderr.on('data', (d) => errorChunks.push(d.toString()));

    // Progress ping every 30 seconds
    let elapsed = 30;
    const ticker = setInterval(async () => {
      await sendToTelegram(`Still building... (${elapsed}s elapsed)`);
      elapsed += 30;
    }, 30_000);

    child.on('close', async (code) => {
      clearInterval(ticker);

      const stdout = outputChunks.join('').trim();
      const stderr = errorChunks.join('').trim();

      if (code === 0) {
        const summary = stdout.slice(-1000) || 'Done.';
        await sendToTelegram(`Build complete.\n\n${summary}`);
        resolve({ success: true, output: stdout });
      } else {
        const errMsg = stderr.slice(-800) || stdout.slice(-800) || `Exit code ${code}`;
        await sendToTelegram(`Build failed (exit ${code}):\n\n${errMsg}`);
        resolve({ success: false, reason: errMsg });
      }
    });

    child.on('error', async (err) => {
      clearInterval(ticker);
      await sendToTelegram(`Spawn error: ${err.message}`);
      resolve({ success: false, reason: err.message });
    });
  });
}

module.exports = builder;
