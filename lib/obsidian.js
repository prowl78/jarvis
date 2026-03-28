const fs = require('fs');
const path = require('path');

const VAULT = '/Users/bgame/Documents/Obsidian Vault';
const PROJECTS_DIR = path.join(VAULT, 'projects');
const IDEAS_DIR = path.join(VAULT, 'ideas');

function projectFile(name) {
  return path.join(PROJECTS_DIR, `${name.toLowerCase()}.md`);
}

function ideaFile(bucket) {
  return path.join(IDEAS_DIR, `${bucket}.md`);
}

function readProject(name) {
  const file = projectFile(name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeProject(name, content) {
  const file = projectFile(name);
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function appendIdea(bucket, text) {
  const file = ideaFile(bucket);
  fs.mkdirSync(IDEAS_DIR, { recursive: true });
  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const entry = `\n- ${text} _(${timestamp})_\n`;
  fs.appendFileSync(file, entry, 'utf8');
}

function getBlockedTasks() {
  const results = [];
  let files;
  try {
    files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md'));
  } catch {
    return results;
  }
  for (const file of files) {
    const project = path.basename(file, '.md');
    const content = fs.readFileSync(path.join(PROJECTS_DIR, file), 'utf8');
    for (const line of content.split('\n')) {
      if (/blocked|TODO/i.test(line) && line.trim()) {
        results.push({ project, line: line.trim() });
      }
    }
  }
  return results;
}

function addTask(project, task) {
  const file = projectFile(project);
  let content = readProject(project);
  if (content === null) {
    content = `# ${project}\n\n## Status\n\n## Tasks\n\n## Blocked\n\n## Notes\n`;
  }
  const entry = `- [ ] ${task}`;
  // Insert under ## Tasks section if present, otherwise append
  if (/^## Tasks/m.test(content)) {
    content = content.replace(/^(## Tasks\n)/m, `$1${entry}\n`);
  } else {
    content += `\n${entry}\n`;
  }
  writeProject(project, content);
}

module.exports = { readProject, writeProject, appendIdea, getBlockedTasks, addTask };
