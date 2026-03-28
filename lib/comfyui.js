const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const COMFYUI_HOST = 'localhost';
const COMFYUI_PORT = 8188;
const REFINER_PATH = path.join(
  process.env.HOME, 'ComfyUI', 'models', 'checkpoints', 'sd_xl_refiner_1.0.safetensors'
);

const OFFLINE_MSG = 'ComfyUI is offline. Start it with: cd ~/ComfyUI && python main.py --listen';

const NEGATIVE_PROMPT =
  'blurry, low quality, watermark, text, deformed, ugly, bad anatomy, ' +
  'worst quality, low resolution, jpeg artifacts, noise, grainy';

const ENHANCE_SYSTEM =
  'You are an SDXL image prompt engineer. Take the user\'s simple description and expand it into ' +
  'a high quality SDXL prompt. Add: art style, lighting, composition, quality tokens. Always append: ' +
  'highly detailed, sharp focus, professional quality, 8k resolution. ' +
  'For portraits add: professional portrait photography, studio lighting, sharp eyes. ' +
  'For illustrations add: masterpiece, best quality, intricate details. ' +
  'Return ONLY the enhanced prompt, nothing else.';

// ---------------------------------------------------------------------------
// Prompt enhancer
// ---------------------------------------------------------------------------
function enhancePrompt(userPrompt) {
  return new Promise((resolve) => {
    const full = `${ENHANCE_SYSTEM}\n\nUser: ${userPrompt}`;
    const escaped = full.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.warn('[comfyui] prompt enhancement failed, using original:', err.message);
        resolve(userPrompt);
      } else {
        const enhanced = stdout.trim();
        console.log(`[comfyui] enhanced prompt: ${enhanced}`);
        resolve(enhanced);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Workflow builder
// ---------------------------------------------------------------------------
function hasRefiner() {
  try { fs.accessSync(REFINER_PATH); return true; } catch { return false; }
}

function buildWorkflow(prompt, options = {}) {
  const { width = 1024, height = 1024, style = '' } = options;
  const fullPrompt = style ? `${style}, ${prompt}` : prompt;
  const useRefiner = hasRefiner();

  if (!useRefiner) {
    console.log('[comfyui] Refiner not found, using base only');
  } else {
    console.log('[comfyui] Refiner found, using two-pass SDXL');
  }

  // Node map:
  //  4  = base CheckpointLoader
  //  5  = EmptyLatentImage
  //  6  = positive CLIP (base)
  //  7  = negative CLIP (base)
  //  3  = KSampler base
  //  10 = refiner CheckpointLoader      (refiner only)
  //  11 = positive CLIP refiner         (refiner only)
  //  12 = negative CLIP refiner         (refiner only)
  //  13 = KSampler refiner              (refiner only)
  //  8  = VAEDecode (from base or refiner output)
  //  9  = SaveImage

  const seed = Math.floor(Math.random() * 1e15);
  const baseSteps = useRefiner ? 15 : 20;
  const totalSteps = useRefiner ? 20 : 20; // refiner sees steps 15-20 (add_noise=false)

  const workflow = {
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: fullPrompt, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: NEGATIVE_PROMPT, clip: ['4', 1] },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: baseSteps,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: useRefiner ? ['13', 0] : ['3', 0],
        vae: ['4', 2],
      },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'jarvis', images: ['8', 0] },
    },
  };

  if (useRefiner) {
    Object.assign(workflow, {
      '10': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_refiner_1.0.safetensors' },
      },
      '11': {
        class_type: 'CLIPTextEncode',
        inputs: { text: fullPrompt, clip: ['10', 1] },
      },
      '12': {
        class_type: 'CLIPTextEncode',
        inputs: { text: NEGATIVE_PROMPT, clip: ['10', 1] },
      },
      '13': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: totalSteps,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 0.2,   // refiner-style: low denoise on latent from base
          start_at_step: baseSteps,
          end_at_step: totalSteps,
          return_with_leftover_noise: 'disable',
          model: ['10', 0],
          positive: ['11', 0],
          negative: ['12', 0],
          latent_image: ['3', 0],
        },
      },
    });
  }

  return workflow;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (options.responseType === 'buffer') {
          resolve(buf);
        } else {
          try { resolve(JSON.parse(buf.toString())); }
          catch { resolve(buf.toString()); }
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------
async function generateImage(prompt, options = {}) {
  // Enhance prompt via claude before building workflow
  const enhanced = await enhancePrompt(prompt);

  const workflow = buildWorkflow(enhanced, options);
  const payload = JSON.stringify({ prompt: workflow });

  let submitResult;
  try {
    submitResult = await httpRequest(
      {
        host: COMFYUI_HOST,
        port: COMFYUI_PORT,
        path: '/prompt',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      payload
    );
  } catch {
    throw new Error('OFFLINE');
  }

  const promptId = submitResult.prompt_id;
  if (!promptId) throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(submitResult)}`);

  console.log(`[comfyui] prompt_id=${promptId} — polling /history`);

  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    let history;
    try {
      history = await httpRequest({
        host: COMFYUI_HOST,
        port: COMFYUI_PORT,
        path: `/history/${promptId}`,
        method: 'GET',
      });
    } catch {
      throw new Error('OFFLINE');
    }

    console.log(`[comfyui] poll ${i + 1} history response:`, JSON.stringify(history));

    const entry = history[promptId];
    if (!entry) continue;
    if (entry.status && !entry.status.completed) continue;

    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId].images;
      if (!images || images.length === 0) continue;

      const { filename, subfolder = '', type = 'output' } = images[0];
      const viewUrl = `http://${COMFYUI_HOST}:${COMFYUI_PORT}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      console.log(`[comfyui] fetching image from: ${viewUrl}`);

      const imageBuffer = await httpRequest({
        host: COMFYUI_HOST,
        port: COMFYUI_PORT,
        path: `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,
        method: 'GET',
        responseType: 'buffer',
      });

      console.log(`[comfyui] image buffer size: ${imageBuffer.length} bytes`);
      return imageBuffer;
    }
  }

  throw new Error('ComfyUI timed out — generation took too long.');
}

// ---------------------------------------------------------------------------
// Telegram helper
// ---------------------------------------------------------------------------
async function generateForTelegram(prompt, options = {}, chatId, bot, sendToTelegram) {
  await sendToTelegram('Generating image...');
  let buffer;
  try {
    buffer = await generateImage(prompt, options);
  } catch (err) {
    if (err.message === 'OFFLINE') {
      await sendToTelegram(OFFLINE_MSG);
      return null;
    }
    await sendToTelegram(`Image generation failed: ${err.message}`);
    return null;
  }
  console.log(`[comfyui] sending photo to chatId=${chatId}, buffer size=${buffer.length}`);
  await bot.sendPhoto(chatId, buffer, { caption: prompt });
  return buffer;
}

module.exports = { generateImage, generateForTelegram };
