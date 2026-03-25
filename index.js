require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log('JARVIS listening');

const intentReplies = {
  brief: 'Brief agent not yet built',
  dispatch: 'Dispatch agent not yet built',
  idea: 'Idea agent not yet built',
  ndis: 'NDIS agent not yet built',
  caligulas: 'Caligulas agent not yet built',
  unknown: "I didn't understand that",
};

bot.on('message', (msg) => {
  console.log(msg);

  const text = msg.text || '';
  const prompt = `Classify this message into exactly one of these intents: brief / dispatch / idea / ndis / caligulas / unknown. Reply with only the intent word, nothing else. Message: ${text}`;

  exec(`claude -p "${prompt.replace(/"/g, '\\"')}"`, (err, stdout, stderr) => {
    if (err) {
      console.error('claude error:', stderr);
      bot.sendMessage(msg.chat.id, "I didn't understand that");
      return;
    }

    const intent = stdout.trim().toLowerCase();
    console.log('intent:', intent);

    const reply = intentReplies[intent] || intentReplies.unknown;
    bot.sendMessage(msg.chat.id, reply);
  });
});
