const fs = require('fs');
const path = require('path');
const { generateImage } = require('../lib/comfyui');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

function extractPrompt(message) {
  return message
    .replace(/^(generate|create|make|draw|render|image of|picture of|photo of|generate image|create image|visualise|visualize)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function comfyui(userMessage, sendToTelegram, context = {}) {
  const { chatId, bot } = context;

  const prompt = extractPrompt(userMessage);
  if (!prompt) {
    await sendToTelegram('What do you want me to generate? Give me a description.');
    return;
  }

  await sendToTelegram('Generating image...');

  let imageBuffer;
  try {
    imageBuffer = await generateImage(prompt);
  } catch (err) {
    const msg = err.message === 'OFFLINE'
      ? 'ComfyUI is offline. Start it with: cd ~/ComfyUI && python main.py --listen'
      : `Image generation failed Boss: ${err.message}`;
    await sendToTelegram(msg);
    return;
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const outPath = path.join(TMP_DIR, `output-${Date.now()}.png`);
  fs.writeFileSync(outPath, imageBuffer);

  try {
    await bot.sendPhoto(chatId, outPath, { caption: 'Here you go Boss.' });
  } catch (err) {
    await sendToTelegram(`Image generation failed Boss: ${err.message}`);
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

module.exports = comfyui;
