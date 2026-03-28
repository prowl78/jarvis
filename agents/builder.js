const { exec, spawn } = require('child_process');

const PROJECT_PATHS = {
  'shrody-core': '/Users/bgame/projects/shrody-core',
  jarvis: '/Users/bgame/jarvis',
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
  const meta = `You are writing Claude Code prompts for a solo founder. Projects: Shrody (Next.js/Supabase/Vercel at /Users/bgame/projects/shrody-core), JARVIS (Node.js at /Users/bgame/jarvis). Write a complete specific Claude Code prompt with no placeholders, exact file paths, exact code. End every prompt with: use --dangerously-skip-permissions, and when done commit all changes, push to GitHub, and run pm2 restart jarvis. Task: ${userMessage}`;
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

async function builder(userMessage, sendToTelegram, pendingConfirmations, chatId) {
  console.log('[builder] BUILDER CALLED with:', userMessage);

  await sendToTelegram('Generating prompt Boss...');

  // Step 1: generate the claude code prompt
  let generatedPrompt;
  try {
    generatedPrompt = await generatePrompt(userMessage);
    console.log('[builder] PROMPT GENERATED:', generatedPrompt);
  } catch (err) {
    console.error('[builder] generatePrompt error:', err.message);
    await sendToTelegram(`Failed to generate prompt: ${err.message}`);
    return { success: false, reason: err.message };
  }

  // Step 2: detect project
  const projectDir = detectProject(userMessage + ' ' + generatedPrompt);
  const cwd = PROJECT_PATHS[projectDir];
  console.log('[builder] PROJECT DETECTED:', projectDir, '->', cwd);

  // Step 3: confirmation gate
  const preview = generatedPrompt.slice(0, 200);
  await sendToTelegram(
    `Ready to build in ${cwd}:\n\n${preview}...\n\nReply 'yes' to execute or 'cancel' to abort.`
  );

  const confirmation = await waitForConfirmation(chatId, pendingConfirmations);
  console.log('[builder] confirmation received:', confirmation);

  if (confirmation !== 'yes') {
    await sendToTelegram('Cancelled.');
    return { success: false, reason: 'cancelled by user' };
  }

  await sendToTelegram('Building now Boss...');

  // Step 4: shell out — stream so we can send progress ticks
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

    // Progress ping every 30 seconds
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
        resolve({ success: true, output: stdout });
      } else {
        const errMsg = stderr.slice(-800) || stdout.slice(-800) || `Exit code ${code}`;
        console.error('[builder] build failed:', errMsg.slice(0, 200));
        await sendToTelegram(`Build failed (exit ${code}):\n\n${errMsg}`);
        resolve({ success: false, reason: errMsg });
      }
    });

    child.on('error', async (err) => {
      clearInterval(ticker);
      console.error('[builder] spawn error:', err.message);
      await sendToTelegram(`Spawn error: ${err.message}`);
      resolve({ success: false, reason: err.message });
    });
  });
}

module.exports = builder;
