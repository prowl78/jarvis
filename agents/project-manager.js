const obsidian = require('../lib/obsidian');

// ---------------------------------------------------------------------------
// Project catalogue + fuzzy aliases
// ---------------------------------------------------------------------------
const PROJECTS = ['shrody', 'onlyhuman', 'caligulas', 'jarvis'];

const PROJECT_ALIASES = {
  shrody:         'shrody',
  'sim thing':    'shrody',
  simulation:     'shrody',
  'what-if':      'shrody',
  whatif:         'shrody',
  onlyhuman:      'onlyhuman',
  'only human':   'onlyhuman',
  ndis:           'onlyhuman',
  companionship:  'onlyhuman',
  caligulas:      'caligulas',
  'counter-award':'caligulas',
  counteraward:   'caligulas',
  award:          'caligulas',
  jarvis:         'jarvis',
  bot:            'jarvis',
};

function resolveProject(text) {
  const lower = text.toLowerCase();
  for (const [alias, canonical] of Object.entries(PROJECT_ALIASES)) {
    if (lower.includes(alias)) return canonical;
  }
  for (const name of PROJECTS) {
    if (lower.includes(name)) return name;
  }
  return null;
}

function parseCommand(message) {
  if (/what'?s?\s+(blocked|stuck|stalled)|show.*blocked|blocked.*tasks?/i.test(message)) {
    return { action: 'blocked' };
  }
  if (/what'?s?\s+next|next\s+(task|thing|step)|show.*next/i.test(message)) {
    return { action: 'next', project: resolveProject(message) };
  }
  if (/mark\s+(.+?)\s+as\s+done|complete\s+task\s+(.+)|set\s+(.+?)\s+to\s+done/i.test(message)) {
    const m = message.match(/mark\s+(.+?)\s+as\s+done|complete\s+task\s+(.+)|set\s+(.+?)\s+to\s+done/i);
    return { action: 'mark_done', taskName: (m[1] || m[2] || m[3]).trim() };
  }
  if (/add\s+task\s+(.+?)\s+to\s+(.+)/i.test(message)) {
    const m = message.match(/add\s+task\s+(.+?)\s+to\s+(.+)/i);
    return { action: 'add_task', description: m[1].trim(), project: resolveProject(m[2]) || m[2].trim() };
  }
  if (/add\s+(.+?)\s+to\s+(.+)/i.test(message)) {
    const m = message.match(/add\s+(.+?)\s+to\s+(.+)/i);
    return { action: 'add_task', description: m[1].trim(), project: resolveProject(m[2]) || m[2].trim() };
  }
  return { action: 'status', project: resolveProject(message) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actionStatus(projectName) {
  const targets = projectName ? [projectName] : PROJECTS;
  const results = targets.map((name) => {
    const content = obsidian.readProject(name);
    if (content === null) return { project: name, found: false };
    return { project: name, found: true, content };
  });
  return { action: 'status', timestamp: new Date().toISOString(), projects: results };
}

function actionNext(projectName) {
  if (!projectName) return { action: 'next', error: "No project specified. Try: what's next on Shrody" };
  const content = obsidian.readProject(projectName);
  if (content === null) return { action: 'next', project: projectName, found: false };

  const incomplete = content
    .split('\n')
    .filter(l => /^- \[ \]/.test(l))
    .map(l => l.replace(/^- \[ \]\s*/, '').trim())
    .filter(Boolean);

  return {
    action: 'next',
    project: projectName,
    next: incomplete[0] || null,
    totalIncomplete: incomplete.length,
  };
}

function actionMarkDone(taskName) {
  let found = false;
  for (const name of PROJECTS) {
    const content = obsidian.readProject(name);
    if (!content) continue;
    const lower = taskName.toLowerCase();
    if (content.toLowerCase().includes(lower)) {
      const updated = content.replace(
        new RegExp(`- \\[ \\] (.*${taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*)`,'i'),
        '- [x] $1'
      );
      if (updated !== content) {
        obsidian.writeProject(name, updated);
        found = true;
        return { action: 'mark_done', success: true, task: taskName, project: name };
      }
    }
  }
  return { action: 'mark_done', success: false, reason: `No incomplete task found matching "${taskName}"` };
}

function actionAddTask(description, projectName) {
  if (!projectName) return { action: 'add_task', success: false, reason: 'Could not identify project from message' };
  try {
    obsidian.addTask(projectName, description);
    return { action: 'add_task', success: true, task: description, project: projectName };
  } catch (err) {
    return { action: 'add_task', success: false, reason: err.message };
  }
}

function actionBlocked() {
  const blocked = obsidian.getBlockedTasks();
  return { action: 'blocked', timestamp: new Date().toISOString(), blocked };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function run(message) {
  const cmd = parseCommand(message);
  switch (cmd.action) {
    case 'next':      return actionNext(cmd.project);
    case 'mark_done': return actionMarkDone(cmd.taskName);
    case 'add_task':  return actionAddTask(cmd.description, cmd.project);
    case 'blocked':   return actionBlocked();
    default:          return actionStatus(cmd.project);
  }
}

module.exports = run;
