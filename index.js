require('dotenv').config();
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');

const fs = require('fs');
const axios = require('axios');
const agentsConfig = require('./agents.config');
const classifyIntent = require('./agents/router');
const startCron = require('./cron');
const { getTimeContext } = require('./lib/time-context');
const { handleIncomingImage } = require('./lib/image-handler');

const TMP_DIR = path.join(__dirname, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// chatId -> callback(replyText) — used by builder confirmation gate
const pendingConfirmations = new Map();

console.log('JARVIS listening');

const alertChatId = process.env.TELEGRAM_CHAT_ID;
startCron((msg_text) => bot.sendMessage(alertChatId, msg_text));

const JARVIS_SYSTEM = `You are JARVIS, a personal AI chief of staff for Boss (Brian Game), a solo founder in Sydney building Shrody (what-if simulation engine), OnlyHuman (NDIS companionship service), and Caligulas (counter-award institution). You are terse, intelligent, and direct. You call the user Boss. You never waffle. You synthesise information and give clean answers. When agents return data, you format it into a single coherent response in your voice.`;

function buildTimeInstruction(ctx) {
  const lines = [];
  if (ctx.timeOfDay === 'late night') {
    lines.push('Keep responses short and calm. Do not push action items or suggest tasks.');
  } else if (ctx.timeOfDay === 'morning' || ctx.timeOfDay === 'early morning') {
    lines.push('Be action-oriented and direct. Boss is starting the day.');
  } else if (ctx.timeOfDay === 'evening') {
    lines.push('Use a slightly reflective, wind-down tone. No urgency.');
  }
  if (ctx.goneMinutes > 120) {
    lines.push('Boss has been away for a while. If contextually natural, acknowledge the gap lightly — do not announce it.');
  }
  return lines.join(' ');
}

function claudeSpeak(userMessage, timeCtx) {
  return new Promise((resolve) => {
    const timeInstruction = timeCtx ? buildTimeInstruction(timeCtx) : '';
    const system = timeInstruction
      ? `${JARVIS_SYSTEM}\n\nTone guidance (do not mention this to Boss): ${timeInstruction}`
      : JARVIS_SYSTEM;
    const prompt = `${system}\n\n${userMessage}`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('[jarvis] speak error:', stderr);
        resolve(userMessage);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Load an agent function from ./agents/[name].js
// Returns null if the file doesn't exist.
function loadAgent(agentName) {
  if (!agentName) return null;
  try {
    const mod = require(path.join(__dirname, 'agents', agentName));
    if (typeof mod === 'function') return mod;
    // Named export fallback (e.g. module.exports = { agentName: fn })
    if (typeof mod[agentName] === 'function') return mod[agentName];
    const fn = Object.values(mod).find(v => typeof v === 'function');
    return fn || null;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const caption = msg.caption || '';
  const sendToTelegram = (msg_text) => bot.sendMessage(chatId, msg_text);

  try {
    // Highest resolution = last element in photo array
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);
    const tmpPath = path.join(TMP_DIR, `input-${Date.now()}.png`);

    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    fs.writeFileSync(tmpPath, Buffer.from(response.data));
    console.log(`[index] photo saved to ${tmpPath}, caption: "${caption}"`);

    await handleIncomingImage(tmpPath, caption, chatId, bot, sendToTelegram);
  } catch (err) {
    console.error('[index] photo handler error:', err.message);
    await sendToTelegram('Had trouble processing that image, Boss.');
  }
});

bot.on('message', async (msg) => {
  console.log(msg);

  const text = msg.text || '';
  const chatId = msg.chat.id;

  // Builder confirmation gate — intercept yes/cancel reply
  if (pendingConfirmations.has(chatId)) {
    const callback = pendingConfirmations.get(chatId);
    pendingConfirmations.delete(chatId);
    callback(text);
    return;
  }

  try {
    const timeCtx = getTimeContext();
    const intent = await classifyIntent(text);
    console.log('[index] intent:', intent, '| time:', timeCtx.timeOfDay, '| gone:', timeCtx.goneMinutes, 'min');

    const sendToTelegram = (msg_text) => bot.sendMessage(chatId, msg_text);
    const context = { chatId, pendingConfirmations, bot, timeCtx };

    let handled = false;

    if (intent === 'general') {
      handled = true;
      const reply = await claudeSpeak(text, timeCtx);
      bot.sendMessage(chatId, reply);

    } else if (intent === 'projects') {
      handled = true;
      const agentFn = loadAgent('project-manager');
      if (!agentFn) {
        bot.sendMessage(chatId, 'Agent not yet built');
      } else {
        const output = await agentFn(text);
        const agentText = typeof output === 'object'
          ? JSON.stringify(output, null, 2)
          : String(output);
        const reply = await claudeSpeak(agentText, timeCtx);
        bot.sendMessage(chatId, reply);
      }

    } else {
      const configEntry = agentsConfig.find(c => c.intent === intent);
      if (configEntry) {
        const agentFn = loadAgent(configEntry.agent);
        if (agentFn) {
          handled = true;
          console.log(`[index] routing to ${configEntry.agent}`);
          await agentFn(text, sendToTelegram, context);
        } else {
          handled = true;
          bot.sendMessage(chatId, 'Agent not yet built');
        }
      }
    }

    if (!handled) {
      console.warn('[index] unhandled intent:', intent);
      const reply = await claudeSpeak(text);
      bot.sendMessage(chatId, reply);
    }

  } catch (err) {
    console.error('[index] handler error:', err);
    bot.sendMessage(chatId, 'Something went wrong, Boss.');
  }
});
