const { exec } = require('child_process');

// ---------------------------------------------------------------------------
// Shell helper
// ---------------------------------------------------------------------------
function run(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 5 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', err });
    });
  });
}

// ---------------------------------------------------------------------------
// Known-safe process name fragments (lowercase)
// ---------------------------------------------------------------------------
const KNOWN_SAFE = [
  'kernel_task','launchd','system','/usr/','sbin/','loginwindow','coreaudiod',
  'spotlight','cfprefsd','diskarbitrationd','notifyd','configd','powerd',
  'opendirectoryd','trustd','syspolicyd','endpointsecu','xpcproxy','mdworker',
  'com.apple','mds','appleeventsd','WindowServer','dock','finder','node',
  'python','bash','zsh','sh','git','grep','ps','lsof','log','fdesetup',
  'ssh','sshd','claude','pm2','comfyui','jarvis','telegram',
  '/applications/','google chrome','safari','firefox','vscode','cursor',
  'postgres','redis','nginx','docker','containerd',
];

function isKnownSafe(line) {
  const lower = line.toLowerCase();
  return KNOWN_SAFE.some(s => lower.includes(s));
}

// Ports expected on a dev Mac
const EXPECTED_PORTS = [8188, 5432, 6379, 3000, 3001, 4000, 5000, 8080, 8000, 1080];

function formatSection(title, body) {
  return `*${title}*\n${body}`;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkProcesses() {
  const { stdout } = await run('ps aux');
  const lines = stdout.split('\n').slice(1).filter(Boolean);
  const suspicious = lines.filter(l => !isKnownSafe(l));
  if (!suspicious.length) return { flag: 'GREEN', text: 'No unusual processes detected.' };
  const top = suspicious.slice(0, 10).map(l => {
    const parts = l.trim().split(/\s+/);
    return `  ${parts[10] || parts[parts.length - 1]} (cpu:${parts[2]}% mem:${parts[3]}%)`;
  }).join('\n');
  return { flag: 'YELLOW', text: `${suspicious.length} unrecognised processes:\n${top}` };
}

async function checkLaunchAgents() {
  const dirs = [
    `${process.env.HOME}/Library/LaunchAgents`,
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
  ];
  const APPLE_PREFIXES = ['com.apple.', 'com.google.', 'com.microsoft.', 'com.adobe.',
                          'com.dropbox.', 'com.github.', 'com.jarvis.', 'homebrew.'];
  const flagged = [];
  const all = [];

  for (const dir of dirs) {
    const { stdout } = await run(`ls "${dir}" 2>/dev/null`);
    const files = stdout.split('\n').filter(f => f.endsWith('.plist'));
    for (const f of files) {
      all.push(`${dir}/${f}`);
      const known = APPLE_PREFIXES.some(p => f.toLowerCase().startsWith(p));
      if (!known) flagged.push(`⚠️  ${f} (${dir})`);
    }
  }

  if (!flagged.length) {
    return { flag: 'GREEN', text: `${all.length} agents loaded, all look standard.` };
  }
  return { flag: 'YELLOW', text: `${flagged.length} unfamiliar agents:\n${flagged.join('\n')}` };
}

async function checkOpenPorts() {
  const { stdout } = await run('lsof -i -n -P | grep LISTEN');
  const lines = stdout.split('\n').filter(Boolean);
  const unexpected = lines.filter(l => {
    const m = l.match(/:(\d+)\s*\(LISTEN\)/);
    if (!m) return false;
    const port = parseInt(m[1]);
    return !EXPECTED_PORTS.includes(port) && port > 1024;
  });
  if (!unexpected.length) return { flag: 'GREEN', text: 'No unexpected listening ports.' };
  const fmt = unexpected.map(l => `  ${l.trim()}`).join('\n');
  return { flag: 'YELLOW', text: `${unexpected.length} unexpected listeners:\n${fmt}` };
}

async function checkSSHFailures() {
  const { stdout } = await run(
    `log show --predicate 'process == "sshd"' --last 1h 2>/dev/null | grep -i 'failed\\|invalid\\|error' | tail -20`
  );
  const lines = stdout.split('\n').filter(Boolean);
  if (!lines.length) return { flag: 'GREEN', text: 'No SSH failures in last hour.' };
  if (lines.length > 5) return { flag: 'RED', text: `${lines.length} SSH failures in last hour — brute force attempt?\n${lines.slice(0, 5).join('\n')}` };
  return { flag: 'YELLOW', text: `${lines.length} SSH failures in last hour:\n${lines.join('\n')}` };
}

async function checkDiskEncryption() {
  const { stdout } = await run('fdesetup status');
  const on = /FileVault is On/i.test(stdout);
  return on
    ? { flag: 'GREEN', text: 'FileVault ON — disk encrypted.' }
    : { flag: 'RED', text: `FileVault OFF — disk NOT encrypted.\nRun: sudo fdesetup enable` };
}

// ---------------------------------------------------------------------------
// Full scan
// ---------------------------------------------------------------------------
async function fullScan() {
  const [procs, agents, ports, ssh, disk] = await Promise.all([
    checkProcesses(),
    checkLaunchAgents(),
    checkOpenPorts(),
    checkSSHFailures(),
    checkDiskEncryption(),
  ]);

  const sections = [
    { label: 'Processes', result: procs },
    { label: 'LaunchAgents', result: agents },
    { label: 'Open Ports', result: ports },
    { label: 'SSH Failures', result: ssh },
    { label: 'Disk Encryption', result: disk },
  ];

  const emoji = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' };
  const lines = sections.map(s => `${emoji[s.result.flag]} ${s.label}: ${s.result.text}`);
  const worstFlag = sections.some(s => s.result.flag === 'RED') ? 'RED'
    : sections.some(s => s.result.flag === 'YELLOW') ? 'YELLOW' : 'GREEN';

  return { summary: lines.join('\n\n'), worstFlag };
}

// ---------------------------------------------------------------------------
// Formatted handlers
// ---------------------------------------------------------------------------
async function handleScan(sendToTelegram) {
  await sendToTelegram('Running security scan...');
  const { summary, worstFlag } = await fullScan();
  const header = worstFlag === 'RED' ? '🔴 Security Scan — Issues Found'
    : worstFlag === 'YELLOW' ? '🟡 Security Scan — Warnings'
    : '🟢 Security Scan — All Clear';
  await sendToTelegram(`${header}\n\n${summary}`);
}

async function handleOpenPorts(sendToTelegram) {
  const { stdout } = await run('lsof -i -n -P | grep LISTEN');
  const lines = stdout.split('\n').filter(Boolean);
  if (!lines.length) { await sendToTelegram('No listening ports found.'); return; }
  const fmt = lines.map(l => {
    const parts = l.trim().split(/\s+/);
    const name = parts[0];
    const portMatch = l.match(/:(\d+)\s*\(LISTEN\)/);
    const port = portMatch ? portMatch[1] : '?';
    return `  :${port}  ${name}`;
  }).join('\n');
  await sendToTelegram(`Open ports (LISTEN):\n${fmt}`);
}

async function handleProcesses(sendToTelegram) {
  const { stdout } = await run("ps aux --sort=-%cpu 2>/dev/null || ps aux | sort -k3 -rn");
  const lines = stdout.split('\n').filter(Boolean);
  const header = lines[0];
  const top20 = lines.slice(1, 21).map(l => {
    const parts = l.trim().split(/\s+/);
    const cpu = parts[2];
    const mem = parts[3];
    const cmd = parts.slice(10).join(' ').slice(0, 50);
    return `  ${cpu.padStart(5)}% cpu  ${mem.padStart(5)}% mem  ${cmd}`;
  }).join('\n');
  await sendToTelegram(`Top 20 processes by CPU:\n${top20}`);
}

async function handleLaunchAgents(sendToTelegram) {
  const { result } = await checkLaunchAgents().then(r => ({ result: r }));
  // Re-run for full listing
  const dirs = [
    `${process.env.HOME}/Library/LaunchAgents`,
    '/Library/LaunchAgents',
    '/Library/LaunchDaemons',
  ];
  const APPLE_PREFIXES = ['com.apple.', 'com.google.', 'com.microsoft.', 'com.adobe.',
                          'com.dropbox.', 'com.github.', 'com.jarvis.', 'homebrew.'];
  const lines = [];
  for (const dir of dirs) {
    const { stdout } = await run(`ls "${dir}" 2>/dev/null`);
    const files = stdout.split('\n').filter(f => f.endsWith('.plist'));
    if (!files.length) continue;
    lines.push(`\n${dir}:`);
    for (const f of files) {
      const known = APPLE_PREFIXES.some(p => f.toLowerCase().startsWith(p));
      lines.push(`  ${known ? '✅' : '⚠️ '} ${f}`);
    }
  }
  await sendToTelegram(`LaunchAgents:\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function security(userMessage, sendToTelegram) {
  const msg = userMessage.toLowerCase().trim();

  if (/security scan|full scan|run scan/.test(msg)) {
    await handleScan(sendToTelegram);
  } else if (/open ports?|listening ports?/.test(msg)) {
    await handleOpenPorts(sendToTelegram);
  } else if (/running processes?|process list/.test(msg)) {
    await handleProcesses(sendToTelegram);
  } else if (/launch agents?/.test(msg)) {
    await handleLaunchAgents(sendToTelegram);
  } else {
    // Default to full scan
    await handleScan(sendToTelegram);
  }
}

module.exports = security;
module.exports.fullScan = fullScan;
