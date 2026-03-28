const { Client } = require('@notionhq/client');

// ---------------------------------------------------------------------------
// Project catalogue + fuzzy aliases
// ---------------------------------------------------------------------------
const PROJECTS = ['Shrody', 'OnlyHuman', 'Caligulas', 'JARVIS'];

const PROJECT_ALIASES = {
  shrody:      'Shrody',
  'sim thing': 'Shrody',
  simulation:  'Shrody',
  'what-if':   'Shrody',
  whatif:      'Shrody',
  onlyhuman:   'OnlyHuman',
  'only human':'OnlyHuman',
  ndis:        'OnlyHuman',
  companionship:'OnlyHuman',
  caligulas:   'Caligulas',
  'counter-award':'Caligulas',
  counteraward:'Caligulas',
  award:       'Caligulas',
  jarvis:      'JARVIS',
  bot:         'JARVIS',
};

const STATUS_KEYWORDS = /blocked|in progress|next steps?|todo|done|complete|pending|waiting|paused/i;

const DONE_VALUES   = new Set(['done', 'complete', 'completed', 'closed', 'finished']);
const BLOCKED_VALUES = new Set(['blocked', 'stuck', 'on hold', 'waiting']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractRichText(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((t) => t.plain_text || '').join('');
}

function getTitle(properties) {
  for (const val of Object.values(properties)) {
    if (val.type === 'title' && val.title?.length) return extractRichText(val.title);
  }
  return '(untitled)';
}

function getStatusValue(properties) {
  for (const [, val] of Object.entries(properties)) {
    if (val.type === 'status' && val.status?.name) return val.status.name;
    if (val.type === 'select' && val.select?.name)  return val.select.name;
  }
  return null;
}

function getStatusPropertyName(properties) {
  for (const [key, val] of Object.entries(properties)) {
    if (val.type === 'status') return { key, type: 'status' };
    if (val.type === 'select') return { key, type: 'select' };
  }
  return null;
}

function getPriority(properties) {
  for (const [, val] of Object.entries(properties)) {
    if (val.type === 'select' && val.select?.name &&
        /priority|importance|urgency/i.test(Object.keys(properties).find(
          k => properties[k] === val) || '')) {
      return val.select.name;
    }
  }
  return null;
}

function resolveProject(text) {
  const lower = text.toLowerCase();
  // Direct alias check
  for (const [alias, canonical] of Object.entries(PROJECT_ALIASES)) {
    if (lower.includes(alias)) return canonical;
  }
  // Substring match against canonical names
  for (const name of PROJECTS) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

function parseCommand(message) {
  const lower = message.toLowerCase().trim();

  if (/what'?s?\s+(blocked|stuck|stalled)|show.*blocked|blocked.*tasks?/i.test(message)) {
    return { action: 'blocked' };
  }
  if (/what'?s?\s+next|next\s+(task|thing|step)|show.*next/i.test(message)) {
    return { action: 'next', project: resolveProject(message) };
  }
  if (/mark\s+(.+?)\s+as\s+done|complete\s+task\s+(.+)|set\s+(.+?)\s+to\s+done/i.test(message)) {
    const m = message.match(/mark\s+(.+?)\s+as\s+done|complete\s+task\s+(.+)|set\s+(.+?)\s+to\s+done/i);
    const taskName = (m[1] || m[2] || m[3]).trim();
    return { action: 'mark_done', taskName };
  }
  if (/add\s+task\s+(.+?)\s+to\s+(.+)/i.test(message)) {
    const m = message.match(/add\s+task\s+(.+?)\s+to\s+(.+)/i);
    return { action: 'add_task', description: m[1].trim(), project: resolveProject(m[2]) || m[2].trim() };
  }
  if (/add\s+(.+?)\s+to\s+(.+)/i.test(message)) {
    const m = message.match(/add\s+(.+?)\s+to\s+(.+)/i);
    return { action: 'add_task', description: m[1].trim(), project: resolveProject(m[2]) || m[2].trim() };
  }

  // Default: full project status
  return { action: 'status', project: resolveProject(message) };
}

// ---------------------------------------------------------------------------
// Notion queries
// ---------------------------------------------------------------------------
async function findProjectPage(notion, projectName) {
  const result = await notion.search({
    query: projectName,
    filter: { value: 'page', property: 'object' },
    page_size: 10,
  });
  if (!result.results.length) return null;
  // Prefer the best title match
  const sorted = result.results.sort((a, b) => {
    const ta = getTitle(a.properties || {}).toLowerCase();
    const tb = getTitle(b.properties || {}).toLowerCase();
    const pn = projectName.toLowerCase();
    return (ta === pn ? -1 : 0) - (tb === pn ? -1 : 0);
  });
  return sorted[0];
}

async function getChildTasks(notion, pageId) {
  const tasks = [];
  try {
    let cursor;
    do {
      const res = await notion.databases.query
        ? null  // will fall through to block children for non-DB pages
        : null;
      void res;
      break;
    } while (cursor);
  } catch { /* */ }

  // Try as a database
  try {
    const db = await notion.databases.query({ database_id: pageId, page_size: 100 });
    for (const page of db.results) {
      tasks.push({
        id: page.id,
        title: getTitle(page.properties),
        status: getStatusValue(page.properties),
        lastEdited: page.last_edited_time,
        statusPropMeta: getStatusPropertyName(page.properties),
      });
    }
    return tasks;
  } catch { /* not a database */ }

  // Try as a page with child databases
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
    for (const block of blocks.results) {
      if (block.type === 'child_database') {
        try {
          const db = await notion.databases.query({ database_id: block.id, page_size: 100 });
          for (const page of db.results) {
            tasks.push({
              id: page.id,
              title: getTitle(page.properties),
              status: getStatusValue(page.properties),
              lastEdited: page.last_edited_time,
              statusPropMeta: getStatusPropertyName(page.properties),
            });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return tasks;
}

async function getPageText(notion, pageId) {
  const snippets = [];
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
    for (const block of blocks.results) {
      const content = block[block.type];
      if (content?.rich_text) {
        const text = extractRichText(content.rich_text);
        if (text && STATUS_KEYWORDS.test(text)) snippets.push(text.trim());
      }
    }
  } catch { /* */ }
  return snippets;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function actionStatus(notion, projectName) {
  const targets = projectName ? [projectName] : PROJECTS;
  const results = await Promise.all(targets.map(async (name) => {
    try {
      const page = await findProjectPage(notion, name);
      if (!page) return { project: name, found: false };
      const snippets = await getPageText(notion, page.id);
      const tasks = await getChildTasks(notion, page.id);
      return {
        project: getTitle(page.properties),
        found: true,
        pageId: page.id,
        lastEdited: page.last_edited_time,
        tasks: tasks.map(t => ({ title: t.title, status: t.status, lastEdited: t.lastEdited })),
        snippets,
      };
    } catch (err) {
      return { project: name, found: false, error: err.message };
    }
  }));
  return { action: 'status', timestamp: new Date().toISOString(), projects: results };
}

async function actionNext(notion, projectName) {
  if (!projectName) return { action: 'next', error: 'No project specified. Try: what\'s next on Shrody' };
  try {
    const page = await findProjectPage(notion, projectName);
    if (!page) return { action: 'next', project: projectName, found: false };

    const tasks = await getChildTasks(notion, page.id);
    const incomplete = tasks.filter(t => {
      if (!t.status) return true;
      return !DONE_VALUES.has(t.status.toLowerCase());
    });

    // Sort: non-blocked first, then by lastEdited ascending (oldest = most overdue)
    incomplete.sort((a, b) => {
      const aBlocked = a.status && BLOCKED_VALUES.has(a.status.toLowerCase());
      const bBlocked = b.status && BLOCKED_VALUES.has(b.status.toLowerCase());
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
      return new Date(a.lastEdited) - new Date(b.lastEdited);
    });

    const next = incomplete[0] || null;
    return {
      action: 'next',
      project: getTitle(page.properties),
      next,
      totalIncomplete: incomplete.length,
    };
  } catch (err) {
    return { action: 'next', project: projectName, error: err.message };
  }
}

async function actionMarkDone(notion, taskName) {
  try {
    const result = await notion.search({
      query: taskName,
      filter: { value: 'page', property: 'object' },
      page_size: 10,
    });

    const matches = result.results.filter(p => {
      const title = getTitle(p.properties || {}).toLowerCase();
      return title.includes(taskName.toLowerCase()) || taskName.toLowerCase().includes(title);
    });

    if (!matches.length) return { action: 'mark_done', success: false, reason: `No task found matching "${taskName}"` };

    const target = matches[0];
    const props = target.properties || {};
    const meta = getStatusPropertyName(props);

    if (!meta) return { action: 'mark_done', success: false, reason: `Task "${getTitle(props)}" has no status property to update` };

    const update = {};
    if (meta.type === 'status') {
      update[meta.key] = { status: { name: 'Done' } };
    } else {
      update[meta.key] = { select: { name: 'Done' } };
    }

    await notion.pages.update({ page_id: target.id, properties: update });

    return {
      action: 'mark_done',
      success: true,
      task: getTitle(props),
      pageId: target.id,
    };
  } catch (err) {
    return { action: 'mark_done', success: false, reason: err.message };
  }
}

async function actionAddTask(notion, description, projectName) {
  if (!projectName) return { action: 'add_task', success: false, reason: 'Could not identify project from message' };
  try {
    const projectPage = await findProjectPage(notion, projectName);
    if (!projectPage) return { action: 'add_task', success: false, reason: `Project "${projectName}" not found in Notion` };

    // Find a child database to add into
    let dbId = null;
    try {
      const db = await notion.databases.query({ database_id: projectPage.id, page_size: 1 });
      if (db) dbId = projectPage.id;
    } catch { /* not a db */ }

    if (!dbId) {
      const blocks = await notion.blocks.children.list({ block_id: projectPage.id, page_size: 50 });
      for (const block of blocks.results) {
        if (block.type === 'child_database') { dbId = block.id; break; }
      }
    }

    if (!dbId) {
      return { action: 'add_task', success: false, reason: `No task database found inside "${getTitle(projectPage.properties)}"` };
    }

    // Inspect DB schema to find the title property key
    const schema = await notion.databases.retrieve({ database_id: dbId });
    const titleKey = Object.entries(schema.properties).find(([, v]) => v.type === 'title')?.[0] || 'Name';

    const newPage = await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        [titleKey]: { title: [{ text: { content: description } }] },
      },
    });

    return {
      action: 'add_task',
      success: true,
      task: description,
      project: getTitle(projectPage.properties),
      pageId: newPage.id,
    };
  } catch (err) {
    return { action: 'add_task', success: false, reason: err.message };
  }
}

async function actionBlocked(notion) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const blocked = [];

  await Promise.all(PROJECTS.map(async (name) => {
    try {
      const page = await findProjectPage(notion, name);
      if (!page) return;
      const tasks = await getChildTasks(notion, page.id);
      for (const task of tasks) {
        const isBlocked = task.status && BLOCKED_VALUES.has(task.status.toLowerCase());
        const isStale = task.lastEdited && new Date(task.lastEdited) < sevenDaysAgo &&
          task.status && !DONE_VALUES.has(task.status.toLowerCase());
        if (isBlocked || isStale) {
          blocked.push({
            project: name,
            task: task.title,
            status: task.status,
            lastEdited: task.lastEdited,
            reason: isBlocked ? 'blocked' : 'stale (7+ days)',
          });
        }
      }
    } catch { /* skip */ }
  }));

  return { action: 'blocked', timestamp: new Date().toISOString(), blocked };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function run(message) {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return { error: 'NOTION_API_KEY not set' };

  const notion = new Client({ auth: apiKey });
  const cmd = parseCommand(message);

  switch (cmd.action) {
    case 'next':       return actionNext(notion, cmd.project);
    case 'mark_done':  return actionMarkDone(notion, cmd.taskName);
    case 'add_task':   return actionAddTask(notion, cmd.description, cmd.project);
    case 'blocked':    return actionBlocked(notion);
    default:           return actionStatus(notion, cmd.project);
  }
}

module.exports = run;
