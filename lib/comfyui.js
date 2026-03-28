const http = require('http');

const COMFYUI_HOST = 'localhost';
const COMFYUI_PORT = 8188;

const OFFLINE_MSG = 'ComfyUI is offline. Start it with: cd ~/ComfyUI && python main.py --listen';

function buildWorkflow(prompt, options = {}) {
  const { width = 1024, height = 1024, steps = 20, style = '' } = options;
  const fullPrompt = style ? `${style}, ${prompt}` : prompt;

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 1e15),
        steps,
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
      inputs: {
        text: 'blurry, low quality, watermark, text, deformed, ugly',
        clip: ['4', 1],
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'jarvis', images: ['8', 0] },
    },
  };
}

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
          try {
            resolve(JSON.parse(buf.toString()));
          } catch {
            resolve(buf.toString());
          }
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateImage(prompt, options = {}) {
  const workflow = buildWorkflow(prompt, options);
  const payload = JSON.stringify({ prompt: workflow });

  // Submit prompt
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
  } catch (err) {
    throw new Error('OFFLINE');
  }

  const promptId = submitResult.prompt_id;
  if (!promptId) throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(submitResult)}`);

  // Poll for completion
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

    const entry = history[promptId];
    if (!entry) continue;

    // Find output image
    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId].images;
      if (images && images.length > 0) {
        const img = images[0];
        const imageBuffer = await httpRequest(
          {
            host: COMFYUI_HOST,
            port: COMFYUI_PORT,
            path: `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`,
            method: 'GET',
            responseType: 'buffer',
          }
        );
        return imageBuffer;
      }
    }
  }

  throw new Error('ComfyUI timed out — generation took too long.');
}

async function generateForTelegram(prompt, options = {}, sendToTelegram) {
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
  await sendToTelegram({ photo: buffer, caption: prompt });
  return buffer;
}

module.exports = { generateImage, generateForTelegram };
