const { exec } = require('child_process');
const obsidian = require('../lib/obsidian');

const BUCKETS = ['shrody_backlog', 'story_bytes', 'new_product', 'onlyhuman', 'caligulas', 'jarvis'];

const CLASSIFY_SYSTEM = `You are classifying ideas for a solo founder. Buckets: shrody_backlog (features for Shrody what-if simulation app), story_bytes (creative writing, stories, scripts), new_product (new business ideas), onlyhuman (ideas for NDIS companionship service), caligulas (ideas for counter-award institution), jarvis (ideas for the JARVIS AI assistant). Reply with only the bucket name, nothing else.`;

function stripPrefix(text) {
  return text.replace(/^(idea|park|remember|note|log this)[:\s]*/i, '').trim();
}

function classifyIdea(ideaText) {
  return new Promise((resolve) => {
    const prompt = `${CLASSIFY_SYSTEM}\n\nIdea: ${ideaText}`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout) => {
      if (err) {
        console.error('[ideas] classify error:', err.message);
        resolve('new_product');
        return;
      }
      const result = stdout.trim().toLowerCase();
      resolve(BUCKETS.includes(result) ? result : 'new_product');
    });
  });
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
    bucket = 'new_product';
  }

  try {
    obsidian.appendIdea(bucket, ideaText);
    console.log('[ideas] appended to Obsidian');
  } catch (err) {
    console.error('[ideas] Obsidian write failed:', err.message);
    await sendToTelegram(`Classified as ${bucket} but failed to save: ${err.message}`);
    return { success: false, reason: err.message };
  }

  await sendToTelegram(`Parked to ${bucket}: ${ideaText}`);
  return { success: true, bucket, ideaText };
}

module.exports = ideas;
