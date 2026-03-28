require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');

const projectManager = require('./agents/project-manager');
const finance = require('./agents/finance');
const builder = require('./agents/builder');
const ideas = require('./agents/ideas');
const ops = require('./agents/ops');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// chatId -> callback(replyText) — used by builder confirmation gate
const pendingConfirmations = new Map();

console.log('JARVIS listening');

const JARVIS_SYSTEM = `You are JARVIS, a personal AI chief of staff for Boss (Brian Game), a solo founder in Sydney building Shrody (what-if simulation engine), OnlyHuman (NDIS companionship service), and Caligulas (counter-award institution). You are terse, intelligent, and direct. You call the user Boss. You never waffle. You synthesise information and give clean answers. When agents return data, you format it into a single coherent response in your voice.`;

function claudeSpeak(userMessage) {
  return new Promise((resolve) => {
    const prompt = `${JARVIS_SYSTEM}\n\n${userMessage}`;
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('jarvis speak error:', stderr);
        resolve(userMessage);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function classifyIntent(text) {
  return new Promise((resolve) => {
    const prompt = `Classify this message into exactly one of these intents and reply with only the intent word, nothing else.

Intents:
- projects: anything about project status, what's blocked, what's next, task updates, mark done, add task, "how are projects", "status update", "what's next on X", "blocked tasks", "what's blocked", "next on X", "brief", "project status"
- finance: money, stripe, revenue, invoices, payments, MRR, cashflow
- builder: build, fix, create, make, deploy, code, ship, PR
- ideas: idea, park, remember, note, log this
- ops: vercel, deployment, error, monitor, server, downtime, logs
- unknown: anything else

Message: ${text}`;
    const escaped = prompt.replace(/"/g, '\\"');
    exec(`claude -p "${escaped}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('classify error:', stderr);
        resolve('unknown');
      } else {
        resolve(stdout.trim().toLowerCase());
      }
    });
  });
}

const intentMap = {
  projects: projectManager,
  finance: finance,
  builder: builder,
  ideas: ideas,
  ops: ops,
};

bot.on('message', async (msg) => {
  console.log(msg);

  const text = msg.text || '';
  const chatId = msg.chat.id;

  // If builder is waiting for a yes/cancel confirmation, hand off and return
  if (pendingConfirmations.has(chatId)) {
    const callback = pendingConfirmations.get(chatId);
    pendingConfirmations.delete(chatId);
    callback(text);
    return;
  }

  try {
    const intent = await classifyIntent(text);
    console.log('intent:', intent);

    const agent = intentMap[intent];
    let agentOutput;

    if (intent === 'builder') {
      // Builder streams directly to Telegram — bypass JARVIS speak layer
      console.log('[index] routing to builder with message:', text);
      const sendToTelegram = (msg_text) => {
        console.log('[index] sendToTelegram called with:', msg_text.slice(0, 80));
        return bot.sendMessage(chatId, msg_text);
      };
      await builder(text, sendToTelegram, pendingConfirmations, chatId);
      return;
    }

    if (intent === 'ideas') {
      // Ideas writes directly to Telegram — bypass JARVIS speak layer
      console.log('[index] routing to ideas with message:', text);
      const sendToTelegram = (msg_text) => bot.sendMessage(chatId, msg_text);
      await ideas(text, sendToTelegram);
      return;
    }

    if (intent === 'finance') {
      // Finance replies directly to Telegram — bypass JARVIS speak layer
      console.log('[index] routing to finance with message:', text);
      const sendToTelegram = (msg_text) => bot.sendMessage(chatId, msg_text);
      await finance(text, sendToTelegram);
      return;
    }

    if (agent) {
      agentOutput = await agent(text);
    } else {
      // Unknown — pass directly to JARVIS as a general question
      agentOutput = text;
    }

    const agentText = typeof agentOutput === 'object'
      ? JSON.stringify(agentOutput, null, 2)
      : String(agentOutput);

    const reply = await claudeSpeak(agentText);
    bot.sendMessage(msg.chat.id, reply);
  } catch (err) {
    console.error('handler error:', err);
    bot.sendMessage(msg.chat.id, "Something went wrong, Boss.");
  }
});
