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
    const prompt = `Classify this message into exactly one of these intents: brief / status / projects / money / stripe / finance / revenue / build / fix / create / make / deploy / idea / park / remember / error / monitor / vercel / ops / unknown. Reply with only the intent word, nothing else. Message: ${text}`;
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
  brief: projectManager,
  status: projectManager,
  projects: projectManager,
  money: finance,
  stripe: finance,
  finance: finance,
  revenue: finance,
  build: builder,
  fix: builder,
  create: builder,
  make: builder,
  deploy: builder,
  idea: ideas,
  park: ideas,
  remember: ideas,
  error: ops,
  monitor: ops,
  vercel: ops,
  ops: ops,
};

bot.on('message', async (msg) => {
  console.log(msg);

  const text = msg.text || '';

  try {
    const intent = await classifyIntent(text);
    console.log('intent:', intent);

    const agent = intentMap[intent];
    let agentOutput;

    if (agent) {
      agentOutput = await agent(text);
    } else {
      // Unknown — pass directly to JARVIS as a general question
      agentOutput = text;
    }

    const reply = await claudeSpeak(agentOutput);
    bot.sendMessage(msg.chat.id, reply);
  } catch (err) {
    console.error('handler error:', err);
    bot.sendMessage(msg.chat.id, "Something went wrong, Boss.");
  }
});
