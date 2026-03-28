const { exec } = require('child_process');
const agentsConfig = require('../agents.config');

const EXAMPLES = [
  { message: 'is shrody up',                        intent: 'ops' },
  { message: 'whats blocked',                       intent: 'projects' },
  { message: "what's blocked",                      intent: 'projects' },
  { message: 'build a feature',                     intent: 'builder' },
  { message: 'fix the login bug',                   intent: 'builder' },
  { message: 'idea: add dark mode',                 intent: 'ideas' },
  { message: 'hey',                                 intent: 'general' },
  { message: 'how are the projects',                intent: 'projects' },
  { message: 'revenue this week',                   intent: 'finance' },
  { message: 'influencer brief for shrody',         intent: 'marketing' },
  { message: 'caption for shrody',                  intent: 'marketing' },
  { message: 'post for caligulas',                  intent: 'marketing' },
  { message: 'directory submission for onlyhuman',  intent: 'marketing' },
  { message: 'write copy for',                      intent: 'marketing' },
  { message: 'draft an email',                      intent: 'marketing' },
  { message: 'find influencers for shrody',         intent: 'distribution' },
  { message: 'outreach for @creator',               intent: 'distribution' },
  { message: 'ndis directories',                    intent: 'distribution' },
  { message: 'submit to ndis directory',            intent: 'distribution' },
  { message: 'tiktok strategy for shrody',          intent: 'distribution' },
];

function buildPrompt(message) {
  const intentLines = agentsConfig
    .map(({ intent, description }) => `- ${intent}: ${description}`)
    .join('\n');

  const exampleLines = EXAMPLES
    .map(({ message: m, intent: i }) => `"${m}" → ${i}`)
    .join('\n');

  const validIntents = agentsConfig.map(c => c.intent).join(' / ');

  return `Classify the message into exactly one of these intents. Reply with only the intent word, nothing else.

Intents:
${intentLines}

Examples:
${exampleLines}

Valid intents: ${validIntents}

Message: ${message}`;
}

function classifyIntent(message) {
  return new Promise((resolve) => {
    const prompt = buildPrompt(message);
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('[router] classify error:', stderr);
        resolve('general');
        return;
      }
      const result = stdout.trim().toLowerCase();
      const valid = agentsConfig.find(c => c.intent === result);
      if (!valid) {
        console.warn(`[router] unknown intent "${result}", falling back to general`);
        resolve('general');
        return;
      }
      resolve(result);
    });
  });
}

module.exports = classifyIntent;
