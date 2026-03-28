const { Client } = require('@notionhq/client');

const PROJECTS = ['Shrody', 'OnlyHuman', 'Caligulas', 'JARVIS'];

const STATUS_KEYWORDS = /blocked|in progress|next steps?|todo|done|complete|pending|waiting|paused/i;

function extractRichText(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map((t) => t.plain_text || '').join('');
}

function extractStatus(properties) {
  const statusFields = {};
  for (const [key, val] of Object.entries(properties)) {
    if (val.type === 'status' && val.status) {
      statusFields[key] = val.status.name;
    } else if (val.type === 'select' && val.select) {
      statusFields[key] = val.select.name;
    } else if (val.type === 'multi_select' && val.multi_select?.length) {
      statusFields[key] = val.multi_select.map((s) => s.name).join(', ');
    }
  }
  return statusFields;
}

async function getPageText(notion, pageId) {
  const snippets = [];
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
    for (const block of blocks.results) {
      const type = block.type;
      const content = block[type];
      if (content?.rich_text) {
        const text = extractRichText(content.rich_text);
        if (text && STATUS_KEYWORDS.test(text)) {
          snippets.push(text.trim());
        }
      }
    }
  } catch {
    // Non-fatal — return whatever we have
  }
  return snippets;
}

async function searchProject(notion, projectName) {
  try {
    const result = await notion.search({
      query: projectName,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    });

    if (!result.results.length) {
      return { project: projectName, found: false, status: 'unknown', snippets: [] };
    }

    const page = result.results[0];
    const props = page.properties || {};

    // Extract title
    let title = projectName;
    for (const val of Object.values(props)) {
      if (val.type === 'title' && val.title?.length) {
        title = extractRichText(val.title);
        break;
      }
    }

    const statusFields = extractStatus(props);
    const snippets = await getPageText(notion, page.id);

    return {
      project: title,
      found: true,
      pageId: page.id,
      lastEdited: page.last_edited_time,
      status: statusFields,
      snippets,
    };
  } catch (err) {
    return { project: projectName, found: false, status: 'error', error: err.message, snippets: [] };
  }
}

async function run(message) {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    return { error: 'NOTION_API_KEY not set', projects: [] };
  }

  const notion = new Client({ auth: apiKey });

  const results = await Promise.all(PROJECTS.map((p) => searchProject(notion, p)));

  return {
    query: message,
    timestamp: new Date().toISOString(),
    projects: results,
  };
}

module.exports = run;
