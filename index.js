require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

console.log('JARVIS listening');

bot.on('message', (msg) => {
  console.log(msg);
  bot.sendMessage(msg.chat.id, 'JARVIS online');
});
