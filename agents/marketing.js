const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const VAULT = '/Users/bgame/Documents/Obsidian Vault';
const PROJECTS_DIR = path.join(VAULT, 'projects');
const MARKETING_DIR = path.join(VAULT, 'marketing');

// ---------------------------------------------------------------------------
// Brand voice profiles
// ---------------------------------------------------------------------------
const VOICES = {
  shrody: {
    keywords: ['shrody', 'sim', 'simulation', 'what-if', 'what if', 'scenario'],
    profile: `Brand: Shrody — a what-if simulation engine.
Voice: Punchy, curiosity-driven, "what if" energy. Viral potential. Gen Z/millennial tone. Short sentences. Hooks fast. Makes people wonder. Bold claims backed by intrigue. Think: TikTok-native, scroll-stopping.`,
  },
  onlyhuman: {
    keywords: ['onlyhuman', 'only human', 'ndis', 'charlie', 'companion', 'disability', 'companionship'],
    profile: `Brand: OnlyHuman — NDIS companionship service.
Voice: Warm, human, empathetic. Charlie is the AI companion persona — friendly, safe, trustworthy. NDIS-aware language. Never clinical. Focus on dignity, connection, independence. Think: a kind letter from a friend.`,
  },
  caligulas: {
    keywords: ['caligulas', 'counter-award', 'award', 'institution', 'dark'],
    profile: `Brand: Caligulas — counter-award institution.
Voice: Institutional, serious, counter-establishment. Dark gravitas. Dry wit. Awards failure, mediocrity, and absurdity with ceremony. Think: a press release from a satirical government body that takes itself very seriously.`,
  },
  general: {
    keywords: [],
    profile: `Voice: Direct founder voice. Brian Game. Solo founder in Sydney. Honest, clear, no fluff. Builds in public. Speaks plainly.`,
  },
};

const CALIGULAS_PILLARS = ['Intrigue', 'Principle', 'Humanity', 'Light', 'Process'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function detectProduct(text) {
  const lower = text.toLowerCase();
  for (const [product, { keywords }] of Object.entries(VOICES)) {
    if (product === 'general') continue;
    if (keywords.some(kw => lower.includes(kw))) return product;
  }
  return 'general';
}

function readProjectContext(product) {
  try {
    const file = path.join(PROJECTS_DIR, `${product}.md`);
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function detectCopyType(text) {
  const lower = text.toLowerCase();
  if (/caption/i.test(lower))                          return 'caption';
  if (/email/i.test(lower))                            return 'email';
  if (/directory|ndis.*bio|bio.*ndis/i.test(lower))    return 'directory';
  if (/influencer.*brief|brief.*influencer|tiktok.*brief|creator.*brief/i.test(lower)) return 'influencer_brief';
  if (/post.*caligulas|caligulas.*post|monthly.*post/i.test(lower)) return 'caligulas_post';
  return 'general_copy';
}

function buildCopyPrompt(copyType, product, userMessage, voiceProfile, projectContext) {
  const contextBlock = projectContext
    ? `\nProject context:\n${projectContext.slice(0, 600)}\n`
    : '';

  const voiceBlock = `\n${voiceProfile}\n`;

  const pillar = CALIGULAS_PILLARS[Math.floor(Math.random() * CALIGULAS_PILLARS.length)];

  const instructions = {
    caption: `Write a single Instagram/TikTok caption. Include a hook on line 1, body of 2-4 lines, and 5 relevant hashtags. Max 220 characters before hashtags.`,
    email:   `Write a short marketing email. Subject line on line 1 prefixed "Subject:". Then a blank line. Then the body: max 150 words, one clear CTA at the end.`,
    directory: `Write a full NDIS service provider directory bio for OnlyHuman. 200-300 words. Cover: what the service is, who it's for, how it works, why it's different. Professional tone, NDIS language, warm close.`,
    influencer_brief: `Write a TikTok creator brief for Shrody. Include: concept summary (2 sentences), key message, suggested hook options (3), content dos and don'ts, CTA. Keep it punchy and creator-friendly.`,
    caligulas_post: `Write a monthly Caligulas counter-award post using the content pillar: ${pillar}. Structure: opening statement (1 sentence), the nomination/award (2-3 sentences), closing ceremony line. Ceremonial, dry, serious.`,
    general_copy: `Write copy based on this request: "${userMessage}". Be creative, on-brand, and concise.`,
  };

  return `You are a professional copywriter.
${voiceBlock}${contextBlock}
Task: ${instructions[copyType]}

Request: ${userMessage}

Output only the copy itself. No preamble, no meta-commentary.`;
}

function generateCopy(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function saveDraft(filename, content) {
  fs.mkdirSync(MARKETING_DIR, { recursive: true });
  const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
  const filepath = path.join(MARKETING_DIR, safeName);
  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  fs.writeFileSync(filepath, `# ${safeName.replace('.md', '')}\n_${timestamp}_\n\n${content}\n`, 'utf8');
  return filepath;
}

function waitForReply(chatId, pendingConfirmations) {
  return new Promise(resolve => {
    pendingConfirmations.set(chatId, reply => resolve(reply.trim()));
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function marketing(userMessage, sendToTelegram, context = {}) {
  const { chatId, pendingConfirmations } = context;

  const product  = detectProduct(userMessage);
  const copyType = detectCopyType(userMessage);
  const voice    = VOICES[product];
  const projectContext = readProjectContext(product);

  console.log(`[marketing] product=${product} type=${copyType}`);

  await sendToTelegram(`Writing ${copyType.replace(/_/g, ' ')} for ${product}...`);

  let draft;
  try {
    const prompt = buildCopyPrompt(copyType, product, userMessage, voice.profile, projectContext);
    draft = await generateCopy(prompt);
  } catch (err) {
    console.error('[marketing] generation error:', err.message);
    await sendToTelegram(`Copy generation failed: ${err.message}`);
    return;
  }

  // Send draft with save/redo instructions
  await sendToTelegram(`DRAFT\n\n${draft}\n\n——\nReply 'save [filename]' to park to Obsidian or 'redo' to regenerate.`);

  if (!chatId || !pendingConfirmations) return;

  // Wait for save / redo / ignore
  const reply = await waitForReply(chatId, pendingConfirmations);
  console.log('[marketing] reply received:', reply);

  if (/^redo$/i.test(reply)) {
    // Regenerate — call recursively with same message
    await marketing(userMessage, sendToTelegram, context);
    return;
  }

  const saveMatch = reply.match(/^save\s+(.+)/i);
  if (saveMatch) {
    const filename = saveMatch[1].trim();
    try {
      const filepath = saveDraft(filename, draft);
      await sendToTelegram(`Parked to Obsidian: ${filepath}`);
    } catch (err) {
      console.error('[marketing] save error:', err.message);
      await sendToTelegram(`Failed to save: ${err.message}`);
    }
    return;
  }

  // Any other reply — do nothing, draft stays in chat
  await sendToTelegram('Draft kept in chat. Send another request when ready.');
}

module.exports = marketing;
