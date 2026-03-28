const { generateForTelegram } = require('../lib/comfyui');
const { appendLog } = require('../lib/life-agent');

const LOG = 'comfyui';

const STYLE_KEYWORDS = {
  photo: 'photorealistic, 8k, sharp focus',
  art: 'digital art, concept art, vibrant colors',
  logo: 'flat design, vector style, clean logo',
  portrait: 'portrait photography, studio lighting, detailed face',
  product: 'product photography, white background, commercial',
};

function parseOptions(message) {
  const options = {};
  const lower = message.toLowerCase();

  // Width/height overrides e.g. "1920x1080"
  const sizeMatch = message.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (sizeMatch) {
    options.width = parseInt(sizeMatch[1]);
    options.height = parseInt(sizeMatch[2]);
  }

  // Style detection
  for (const [key, val] of Object.entries(STYLE_KEYWORDS)) {
    if (lower.includes(key)) {
      options.style = val;
      break;
    }
  }

  // Steps override e.g. "50 steps"
  const stepsMatch = message.match(/(\d+)\s*steps?/i);
  if (stepsMatch) options.steps = parseInt(stepsMatch[1]);

  return options;
}

function extractPrompt(message) {
  return message
    .replace(/^(generate|create|make|draw|render|image of|picture of|photo of|generate image|create image)\s*/i, '')
    .replace(/\b\d+\s*[x×]\s*\d+\b/i, '')
    .replace(/\b\d+\s*steps?\b/i, '')
    .replace(/\b(photo|art|logo|portrait|product)\b/gi, (m) => (STYLE_KEYWORDS[m.toLowerCase()] ? '' : m))
    .replace(/\s+/g, ' ')
    .trim();
}

async function comfyui(userMessage, sendToTelegram) {
  const prompt = extractPrompt(userMessage);
  const options = parseOptions(userMessage);

  if (!prompt) {
    await sendToTelegram('What do you want me to generate? Give me a description.');
    return;
  }

  appendLog(LOG, `**Prompt:** ${prompt} | **Options:** ${JSON.stringify(options)}`);
  await generateForTelegram(prompt, options, sendToTelegram);
}

module.exports = comfyui;
