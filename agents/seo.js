const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const VAULT    = '/Users/bgame/Documents/Obsidian Vault';
const MKTG_DIR = path.join(VAULT, 'marketing');

function claudeRun(prompt) {
  return new Promise((resolve, reject) => {
    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}

function saveToVault(filename, content) {
  fs.mkdirSync(MKTG_DIR, { recursive: true });
  const filepath = path.join(MKTG_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

async function sendChunked(sendToTelegram, text, footer) {
  const MAX = 3800;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX) chunks.push(text.slice(i, i + MAX));
  for (const chunk of chunks) await sendToTelegram(chunk);
  if (footer) await sendToTelegram(footer);
}

function parseCommand(message) {
  const lower = message.toLowerCase();
  if (/aio\s+audit|seo\s+audit/i.test(lower))              return 'aio_audit';
  if (/update\s+meta|meta\s+tags?|meta\s+descriptions?/i.test(lower)) return 'update_meta';
  if (/content\s+gaps?/i.test(lower))                       return 'content_gaps';
  if (/aio\s+checklist|checklist/i.test(lower))             return 'aio_checklist';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 1. AIO Audit
// ---------------------------------------------------------------------------
async function aioAudit(sendToTelegram) {
  await sendToTelegram('Running AIO audit for Shrody...');

  const prompt = `You are an expert in AI-native SEO (AIO — AI Overview Optimisation). Analyse the content positioning for Shrody, a what-if simulation engine that lets users explore alternate life scenarios.

Produce a full AIO audit covering:

## Target Queries
List 15 specific queries Shrody should appear in for: Perplexity answers, ChatGPT responses, Google AI Overviews. Include question-based, comparison, and navigational queries.

## Content Gaps
What content assets are missing that would make Shrody citation-worthy in AI search results? List 8 specific gaps.

## Schema Markup Needed
List every schema.org type Shrody should implement. For each: schema type, why it matters for AIO, and the key fields to populate.

## Meta Description Strategy
What is the meta description formula Shrody should use across all pages? Write the formula, then give one example for the homepage.

## Entity Definition
How should Shrody define itself as an entity for AI engines? Write the entity definition paragraph (100 words) that should appear on the about page and in structured data.

## Quick Wins
5 immediate changes that would improve AI search visibility this week.

Be specific. Shrody's core value prop: "explore what your life could look like if you'd made a different choice."`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# AIO Audit — Shrody\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`seo-audit-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 2. Update Meta
// ---------------------------------------------------------------------------
async function updateMeta(sendToTelegram) {
  await sendToTelegram('Generating Next.js metadata for Shrody pages...');

  const prompt = `Write optimised Next.js metadata objects for all main Shrody pages. Shrody is a what-if simulation engine — users describe a life choice they're facing (or revisiting) and see a simulated alternate scenario play out.

For each page produce a complete Next.js 13+ metadata export:

Pages to cover:
1. Home (/)
2. Simulation Result (/result)
3. About (/about)
4. Pricing (/pricing)

Rules:
- Title: 50-60 chars, include "Shrody" and primary keyword
- Description: 140-160 chars, include the core value prop, end with a soft CTA
- OG title and description can be slightly longer and more evocative
- Keywords array: 8-10 per page
- Use real Next.js metadata syntax (export const metadata: Metadata = { ... })

Output ready-to-paste TypeScript. No explanation, just the code blocks.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# Shrody Meta Tags\n_${ts}_\n\n\`\`\`typescript\n${result}\n\`\`\`\n`;
  const filepath = saveToVault(`shrody-meta-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 3. Content Gaps
// ---------------------------------------------------------------------------
async function contentGaps(sendToTelegram) {
  await sendToTelegram('Identifying content gaps for Shrody AI search traffic...');

  const prompt = `You are an AIO content strategist. Identify 10 blog posts or landing pages Shrody should create to capture AI search traffic.

Shrody is a what-if simulation engine for life decisions — "what would my life look like if I'd taken that job / stayed in that relationship / moved cities?"

Focus topics on:
- What-if questions people actually search
- Simulation psychology and decision science
- Life choices and regret research
- Alternate timeline thinking
- Decision making frameworks

For each content piece provide:
1. Page title (H1)
2. Target query (the exact question it answers for AI search)
3. Content pillars (3 bullet points of what the page must cover)
4. AI citation hook (one sentence that would get this page cited in a Perplexity or ChatGPT answer)
5. Suggested URL slug

Format as a numbered list. Be specific and keyword-aware.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# Shrody Content Gaps\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`shrody-content-gaps-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// 4. AIO Checklist
// ---------------------------------------------------------------------------
async function aioChecklist(sendToTelegram) {
  await sendToTelegram('Running AIO checklist for Shrody...');

  const prompt = `Run through the AIO (AI Overview Optimisation) checklist for Shrody, a what-if simulation engine.

For each item, output: ✅ Likely present / ⚠️ Needs work / ❌ Missing — and a one-line action if it needs work.

Checklist items:

**Structured Data**
- WebApplication schema
- SoftwareApplication schema
- FAQPage schema
- HowTo schema
- BreadcrumbList schema
- SiteLinksSearchBox

**Entity & Brand Signals**
- Clear entity definition on About page
- Consistent brand name + tagline across all pages
- Wikipedia/Wikidata entry or equivalent
- Google Business Profile (if applicable)
- Crunchbase or Product Hunt presence

**Content Formatting for AI Extraction**
- Direct answer paragraphs (first sentence answers the query)
- FAQ sections on key pages
- Definition of core concept ("A simulation engine is...")
- Comparison content ("Shrody vs journaling / therapy / coaching")
- Statistics or research citations

**Technical AIO**
- Canonical URLs set
- Hreflang (if targeting AU + global)
- Core Web Vitals passing
- Mobile-first content hierarchy
- Page speed under 2.5s LCP

**Citation Worthiness**
- Original data or research published
- Expert author attribution
- Last updated dates on content
- External links to credible sources
- Press/media mentions

After the checklist, provide a prioritised action list: Top 5 things to fix this week.`;

  const result = await claudeRun(prompt);
  const ts = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
  const content = `# AIO Checklist — Shrody\n_${ts}_\n\n${result}\n`;
  const filepath = saveToVault(`aio-checklist-${datestamp()}.md`, content);

  await sendChunked(sendToTelegram, result, `——\nSaved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function seo(userMessage, sendToTelegram, context = {}) {
  const action = parseCommand(userMessage);
  console.log('[seo] action:', action);

  try {
    switch (action) {
      case 'aio_audit':    return await aioAudit(sendToTelegram);
      case 'update_meta':  return await updateMeta(sendToTelegram);
      case 'content_gaps': return await contentGaps(sendToTelegram);
      case 'aio_checklist':return await aioChecklist(sendToTelegram);
      default:
        await sendToTelegram(
          'SEO/AIO commands:\n' +
          '• aio audit for shrody\n' +
          '• update meta for shrody\n' +
          '• content gaps for shrody\n' +
          '• aio checklist'
        );
    }
  } catch (err) {
    console.error('[seo] error:', err.message);
    await sendToTelegram(`SEO agent error: ${err.message}`);
  }
}

module.exports = seo;
