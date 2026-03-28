const { exec } = require('child_process');
const { Client } = require('@notionhq/client');

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
        resolve('new_product'); // safe fallback
        return;
      }
      const result = stdout.trim().toLowerCase();
      resolve(BUCKETS.includes(result) ? result : 'new_product');
    });
  });
}

async function appendToNotion(ideaText, bucket, timestamp) {
  const apiKey = process.env.NOTION_API_KEY;
  const pageId = process.env.NOTION_VULCANIUM_PAGE_ID;

  if (!apiKey) throw new Error('NOTION_API_KEY not set');
  if (!pageId) throw new Error('NOTION_VULCANIUM_PAGE_ID not set');

  const notion = new Client({ auth: apiKey });

  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            {
              type: 'text',
              text: { content: `[${bucket}]  ${ideaText}` },
              annotations: { bold: false },
            },
          ],
          icon: { type: 'emoji', emoji: '💡' },
          color: 'default',
        },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: timestamp },
              annotations: { color: 'gray', italic: true },
            },
          ],
        },
      },
    ],
  });
}

async function ideas(userMessage, sendToTelegram) {
  const ideaText = stripPrefix(userMessage);
  console.log('[ideas] idea text:', ideaText);

  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });

  let bucket;
  try {
    bucket = await classifyIdea(ideaText);
    console.log('[ideas] classified as:', bucket);
  } catch (err) {
    console.error('[ideas] classification failed:', err.message);
    bucket = 'new_product';
  }

  try {
    await appendToNotion(ideaText, bucket, timestamp);
    console.log('[ideas] appended to Notion');
  } catch (err) {
    console.error('[ideas] Notion write failed:', err.message);
    await sendToTelegram(`Classified as ${bucket} but failed to save to Notion: ${err.message}`);
    return { success: false, reason: err.message };
  }

  await sendToTelegram(`Parked to ${bucket}: ${ideaText}`);
  return { success: true, bucket, ideaText };
}

module.exports = ideas;
