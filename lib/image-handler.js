const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateImg2Img } = require('./comfyui');

const IMG2IMG_TRIGGERS = /\b(generate|draw|create image|make image|img2img|redraw|restyle|reimagine)\b/i;

// ---------------------------------------------------------------------------
// Mode A: Visual context — send image to Claude for analysis
// ---------------------------------------------------------------------------
function analyseWithClaude(imagePath, caption) {
  return new Promise((resolve, reject) => {
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

    const system =
      'You are JARVIS. Boss has sent you an image to help explain something. ' +
      'Analyse it and respond helpfully based on what you see and the caption provided. ' +
      'Be concise and direct. Call the user Boss.';

    const userContent = caption
      ? `Caption: "${caption}"\n\nPlease analyse this image.`
      : 'Please analyse this image and tell me what you see.';

    // Build a JSON message using claude -p with image via stdin as a multimodal message
    // Pass image as base64 data URL in the prompt using Claude's vision support
    const prompt = `${system}\n\n[Image provided as base64 below]\nData: data:${mimeType};base64,${base64}\n\n${userContent}`;

    // Use --image flag approach: write temp file and reference it
    // Claude CLI supports: claude -p "..." --image /path/to/file
    const escaped = (system + '\n\n' + userContent)
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    exec(
      `claude -p "${escaped}" --image "${imagePath}"`,
      { maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Fallback: try without --image flag, describing image path
          console.warn('[image-handler] --image flag failed, trying base64 inline:', stderr.slice(0, 100));
          const fallbackPrompt =
            `${system}\n\n` +
            `The user sent an image (saved at ${imagePath}) with caption: "${caption || 'no caption'}". ` +
            `Acknowledge you received it and note you cannot view it in this mode, ask Boss to describe what they need help with.`;
          const fe = fallbackPrompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          exec(`claude -p "${fe}"`, { maxBuffer: 2 * 1024 * 1024 }, (e2, out2) => {
            if (e2) reject(new Error(e2.message));
            else resolve(out2.trim());
          });
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
async function handleIncomingImage(imagePath, caption, chatId, bot, sendToTelegram) {
  console.log(`[image-handler] received image: ${imagePath}, caption: ${caption || 'none'}`);

  try {
    if (IMG2IMG_TRIGGERS.test(caption || '')) {
      // Mode B — img2img via ComfyUI
      console.log('[image-handler] mode B: img2img');
      await sendToTelegram('Got it — generating variation...');
      const prompt = caption
        ? caption.replace(IMG2IMG_TRIGGERS, '').trim() || 'enhance this image, high quality'
        : 'enhance this image, high quality';
      await generateImg2Img(imagePath, prompt, {}, chatId, bot, sendToTelegram);
    } else {
      // Mode A — visual analysis via Claude
      console.log('[image-handler] mode A: visual analysis');
      await sendToTelegram('Looking at that...');
      const analysis = await analyseWithClaude(imagePath, caption);
      await sendToTelegram(analysis);
    }
  } catch (err) {
    console.error('[image-handler] error:', err.message);
    await sendToTelegram(`Couldn't process that image: ${err.message}`);
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(imagePath); } catch {}
  }
}

module.exports = { handleIncomingImage };
