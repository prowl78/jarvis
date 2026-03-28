const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const VAULT      = '/Users/bgame/Documents/Obsidian Vault';
const LIFE_DIR   = path.join(VAULT, 'life');
const PROJ_DIR   = path.join(VAULT, 'projects');
const IDEAS_DIR  = path.join(VAULT, 'ideas');

const LIFE_LOGS  = ['nutrition-log', 'fitness-log', 'psych-log'];
const LARGE_FILE_WARN_BYTES  = 50  * 1024;   // 50 KB — flag in status
const LARGE_FILE_CRON_BYTES  = 100 * 1024;   // 100 KB — cron alert threshold

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function statSafe(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function mdFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(dir, f));
  } catch { return []; }
}

function claudeSummarise(content, maxLines = 20) {
  return new Promise((resolve, reject) => {
    const system =
      `You are a log compactor. Summarise the following notes/log into key facts only. ` +
      `Maximum ${maxLines} lines. Use bullet points. Keep dates for important events. ` +
      `Strip any repetitive or low-value entries. Return ONLY the summary, nothing else.`;
    const full = `${system}\n\n${content}`;
    const escaped = full.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function estimateTokens(chars) {
  return Math.round(chars / 4).toLocaleString();
}

// Split a log file into entries older than cutoff and entries within cutoff.
// Entries are separated by "## " headings (the format appendLog uses).
function splitByAge(content, cutoffMs) {
  const sections = content.split(/(?=\n## )/);
  const old = [];
  const recent = [];
  for (const s of sections) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    // Try to parse date from heading line
    const heading = trimmed.match(/^## (.+)/m);
    if (heading) {
      const d = new Date(heading[1]);
      if (!isNaN(d) && d.getTime() < cutoffMs) { old.push(trimmed); continue; }
    }
    recent.push(trimmed);
  }
  return { old, recent };
}

// ---------------------------------------------------------------------------
// 1. Token status
// ---------------------------------------------------------------------------
async function handleStatus(sendToTelegram) {
  const dirs = [
    { label: 'Life logs', dir: LIFE_DIR },
    { label: 'Projects',  dir: PROJ_DIR },
    { label: 'Ideas',     dir: IDEAS_DIR },
  ];

  let totalChars = 0;
  let totalLines = 0;
  const largeFiles = [];
  const fileRows = [];

  for (const { label, dir } of dirs) {
    const files = mdFiles(dir);
    let dirChars = 0;
    let dirLines = 0;
    for (const f of files) {
      const content = readSafe(f);
      if (!content) continue;
      const bytes = Buffer.byteLength(content);
      dirChars += content.length;
      dirLines += content.split('\n').length;
      totalChars += content.length;
      totalLines += content.split('\n').length;
      if (bytes >= LARGE_FILE_WARN_BYTES) {
        largeFiles.push(`  ⚠️  ${path.basename(f)} — ${formatBytes(bytes)}`);
      }
    }
    if (files.length) {
      fileRows.push(`  ${label}: ${files.length} files, ${dirLines.toLocaleString()} lines, ~${estimateTokens(dirChars)} tokens`);
    }
  }

  // PM2 log activity today
  const pm2Activity = await new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    exec(
      `pm2 logs jarvis --nostream --lines 500 2>/dev/null | grep '\\[index\\] routing to' | grep -v '${today}' || true`,
      (err, stdout) => {
        if (err || !stdout.trim()) { resolve(null); return; }
        const counts = {};
        for (const line of stdout.split('\n')) {
          const m = line.match(/routing to (\S+)/);
          if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        resolve(sorted.map(([a, c]) => `  ${a}: ${c}x`).join('\n') || null);
      }
    );
  });

  let msg = `📊 Token / Memory Status\n\n`;
  msg += `Total: ${totalLines.toLocaleString()} lines | ~${estimateTokens(totalChars)} tokens if fully loaded\n\n`;
  msg += fileRows.join('\n') + '\n';
  if (largeFiles.length) {
    msg += `\n⚠️ Large files (>50KB):\n${largeFiles.join('\n')}`;
  } else {
    msg += `\n✅ No files over 50KB`;
  }
  if (pm2Activity) {
    msg += `\n\nAgent usage today:\n${pm2Activity}`;
  }

  await sendToTelegram(msg);
}

// ---------------------------------------------------------------------------
// 2. Compact a specific file
// ---------------------------------------------------------------------------
async function handleCompactFile(filePath, sendToTelegram, context) {
  const content = readSafe(filePath);
  if (!content) {
    await sendToTelegram(`File not found: ${filePath}`);
    return;
  }

  const bytes = Buffer.byteLength(content);
  await sendToTelegram(`Reading ${path.basename(filePath)} (${formatBytes(bytes)})... summarising with Claude.`);

  let summary;
  try {
    summary = await claudeSummarise(content);
  } catch (err) {
    await sendToTelegram(`Summarisation failed: ${err.message}`);
    return;
  }

  const date = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const compacted = `# Compacted: ${date}\n\n${summary}\n`;

  await sendToTelegram(
    `Summary (${compacted.split('\n').length} lines):\n\n${summary.slice(0, 800)}${summary.length > 800 ? '\n...' : ''}\n\nReply "confirm compact" to overwrite, or anything else to cancel.`
  );

  // Wait for confirmation via pendingConfirmations
  const { chatId, pendingConfirmations } = context;
  if (!chatId || !pendingConfirmations) {
    await sendToTelegram('Cannot wait for confirmation — no context available.');
    return;
  }

  await new Promise((resolve) => {
    pendingConfirmations.set(chatId, async (reply) => {
      if (/confirm compact/i.test(reply.trim())) {
        fs.writeFileSync(filePath, compacted, 'utf8');
        const newBytes = Buffer.byteLength(compacted);
        await sendToTelegram(
          `✅ Compacted. ${path.basename(filePath)} reduced from ${formatBytes(bytes)} → ${formatBytes(newBytes)}.`
        );
      } else {
        await sendToTelegram('Cancelled. File unchanged.');
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Compact all life logs (entries older than 30 days)
// ---------------------------------------------------------------------------
async function handleCompactLogs(sendToTelegram) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const results = [];

  for (const logName of LIFE_LOGS) {
    const filePath = path.join(LIFE_DIR, `${logName}.md`);
    const content = readSafe(filePath);
    if (!content) { results.push(`  ${logName}: not found, skipped`); continue; }

    const { old: oldEntries, recent } = splitByAge(content, cutoff);
    if (oldEntries.length === 0) {
      results.push(`  ${logName}: nothing older than 30 days`);
      continue;
    }

    await sendToTelegram(`Compacting old entries in ${logName}...`);
    let oldSummary;
    try {
      oldSummary = await claudeSummarise(oldEntries.join('\n\n'), 15);
    } catch (err) {
      results.push(`  ${logName}: summarisation failed — ${err.message}`);
      continue;
    }

    const date = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
    const newContent =
      `# Archive summary (entries before 30 days ago) — compacted ${date}\n\n${oldSummary}\n\n---\n\n` +
      recent.join('\n\n');

    const before = Buffer.byteLength(content);
    const after  = Buffer.byteLength(newContent);
    fs.mkdirSync(LIFE_DIR, { recursive: true });
    fs.writeFileSync(filePath, newContent, 'utf8');
    results.push(`  ${logName}: ${formatBytes(before)} → ${formatBytes(after)} (${oldEntries.length} old entries summarised)`);
  }

  await sendToTelegram(`✅ Log compaction done:\n${results.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Resolve a partial filename to a full path
// ---------------------------------------------------------------------------
function resolveFile(name) {
  const candidates = [
    path.join(LIFE_DIR,  name),
    path.join(PROJ_DIR,  name),
    path.join(IDEAS_DIR, name),
    path.join(LIFE_DIR,  `${name}.md`),
    path.join(PROJ_DIR,  `${name}.md`),
    path.join(IDEAS_DIR, `${name}.md`),
    path.join(LIFE_DIR,  `${name}-log.md`),
  ];
  return candidates.find(c => { try { fs.accessSync(c); return true; } catch { return false; } }) || null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function tokenManager(userMessage, sendToTelegram, context = {}) {
  const msg = userMessage.toLowerCase().trim();

  if (/token status|how are we doing on tokens|memory status|context status/.test(msg)) {
    await handleStatus(sendToTelegram);
    return;
  }

  if (/^compact logs?$/.test(msg)) {
    await handleCompactLogs(sendToTelegram);
    return;
  }

  const compactMatch = userMessage.match(/^compact\s+(.+)$/i);
  if (compactMatch) {
    const name = compactMatch[1].trim();
    const filePath = resolveFile(name);
    if (!filePath) {
      await sendToTelegram(`Couldn't find a file matching "${name}". Try the exact filename.`);
      return;
    }
    await handleCompactFile(filePath, sendToTelegram, context);
    return;
  }

  // Default
  await handleStatus(sendToTelegram);
}

// Exported for cron
async function checkLargeFiles() {
  const allDirs = [LIFE_DIR, PROJ_DIR, IDEAS_DIR];
  const alerts = [];
  for (const dir of allDirs) {
    for (const f of mdFiles(dir)) {
      const stat = statSafe(f);
      if (stat && stat.size >= LARGE_FILE_CRON_BYTES) {
        alerts.push(`${path.basename(f)} (${formatBytes(stat.size)})`);
      }
    }
  }
  return alerts;
}

module.exports = tokenManager;
module.exports.checkLargeFiles = checkLargeFiles;
