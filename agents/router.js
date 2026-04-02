const { exec } = require('child_process');
const agentsConfig = require('../agents.config');

const EXAMPLES = [
  { message: 'whats blocked',                        intent: 'projects' },
  { message: "what's blocked",                        intent: 'projects' },
  { message: 'how are the projects',                  intent: 'projects' },
  { message: "what's next on shrody",                 intent: 'projects' },
  { message: 'project status',                        intent: 'projects' },
  { message: 'log bench press 3x8 80kg',              intent: 'trainer' },
  { message: 'give me a workout',                     intent: 'trainer' },
  { message: 'log 50 min walk',                       intent: 'trainer' },
  { message: 'plan chest day',                        intent: 'trainer' },
  { message: 'analyse my workouts',                   intent: 'trainer' },
  { message: 'what should I eat today',               intent: 'nutritionist' },
  { message: 'meal plan for the week',                intent: 'nutritionist' },
  { message: 'log coffee and eggs for breakfast',     intent: 'nutritionist' },
  { message: 'how are my macros',                     intent: 'nutritionist' },
  { message: "I'm struggling today",                  intent: 'psychologist' },
  { message: 'journal',                               intent: 'psychologist' },
  { message: 'fuck this I hate everything',           intent: 'psychologist' },
  { message: 'I need to vent',                        intent: 'psychologist' },
  { message: 'idea: add dark mode',                   intent: 'ideas' },
  { message: 'book idea: memoir about founding',      intent: 'ideas' },
  { message: 'story idea: detective in space',        intent: 'ideas' },
  { message: 'park this thought',                     intent: 'ideas' },
  { message: 'self improvement scan',                 intent: 'improve' },
  { message: 'give me improvement recommendations',   intent: 'improve' },
  { message: 'how can I improve this week',           intent: 'improve' },
  { message: 'generate an image of a mountain',       intent: 'image' },
  { message: 'draw a portrait of a detective',        intent: 'image' },
  { message: 'create artwork for shrody',             intent: 'image' },
  { message: 'hey',                                   intent: 'general' },
  { message: 'what time is it',                       intent: 'general' },
  { message: 'tell me a joke',                        intent: 'general' },
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
