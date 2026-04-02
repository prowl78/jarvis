const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const IDEAS_DIR = '/Users/bgame/Documents/Obsidian Vault/ideas';

const BUCKET_FILES = {
  books:   path.join(IDEAS_DIR, 'books.md'),
  stories: path.join(IDEAS_DIR, 'stories.md'),
  general: path.join(IDEAS_DIR, 'general.md'),
};

const CLASSIFY_SYSTEM = `You are classifying a creative idea for a solo founder and writer. Reply with only one word — the bucket name.

Buckets:
- books: book ideas, non-fiction concepts, memoir ideas, publishing ideas
- stories: fiction story ideas, narrative concepts, characters, plot ideas, scripts, screenplays
- general: everything else — creative concepts, product ideas, random inspiration

Reply with only: books, stories, or general`;

function stripPrefix(text) {
  return text.replace(/^(idea|park|remember|note|log this|book idea|story idea)[:\s]*/i, '').trim();
}

function classifyIdea(ideaText) {
  return new Promise((resolve) => {
    const prompt = `${CLASSIFY_SYSTEM}\n\nIdea: ${ideaText}`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout) => {
      if (err) {
        console.error('[ideas] classify error:', err.message);
        resolve('general');
        return;
      }
      const result = stdout.trim().toLowerCase();
      resolve(Object.keys(BUCKET_FILES).includes(result) ? result : 'general');
    });
  });
}

function saveIdea(bucket, text) {
  const file = BUCKET_FILES[bucket];
  fs.mkdirSync(IDEAS_DIR, { recursive: true });
  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const entry = `\n- ${text} _(${timestamp})_\n`;
  fs.appendFileSync(file, entry, 'utf8');
}

async function ideas(userMessage, sendToTelegram) {
  const ideaText = stripPrefix(userMessage);
  console.log('[ideas] idea text:', ideaText);

  let bucket;
  try {
    bucket = await classifyIdea(ideaText);
    console.log('[ideas] classified as:', bucket);
  } catch (err) {
    console.error('[ideas] classification failed:', err.message);
    bucket = 'general';
  }

  try {
    saveIdea(bucket, ideaText);
    console.log('[ideas] saved to', BUCKET_FILES[bucket]);
  } catch (err) {
    console.error('[ideas] save failed:', err.message);
    await sendToTelegram(`Classified as ${bucket} but failed to save: ${err.message}`);
    return;
  }

  await sendToTelegram(`Parked to ${bucket}: ${ideaText}`);
}

module.exports = ideas;
