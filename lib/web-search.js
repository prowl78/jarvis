const { exec } = require('child_process');

function encodeQuery(query) {
  return encodeURIComponent(query);
}

function stripTags(str) {
  return str
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseResults(html, maxResults) {
  const results = [];

  // Each result is in <div class="result css-...">
  const resultRe = /<div[^>]*class="result css-[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="result css-|<\/section)/g;

  let m;
  while ((m = resultRe.exec(html)) !== null && results.length < maxResults) {
    const block = m[1];

    // URL from the result-title result-link anchor
    const urlM = block.match(/class="result-title result-link[^"]*"[^>]*href="([^"]+)"/);
    if (!urlM) continue;

    // Title from the h2 inside the link
    const titleM = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const title = titleM ? stripTags(titleM[1]) : '';
    if (!title) continue;

    // Snippet from first meaningful <p> tag (after removing style blocks)
    const noStyle = block.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
    const pTags = noStyle.match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
    const snippet = pTags
      .map(p => stripTags(p))
      .find(s => s.length > 20) || '';

    results.push({ title, url: urlM[1], snippet });
  }

  return results;
}

async function webSearch(query, maxResults = 10) {
  return new Promise((resolve) => {
    const encoded = encodeQuery(query);
    const url = `https://www.startpage.com/do/search?query=${encoded}&language=english`;
    const cmd = [
      'curl', '-sL', '--max-time', '15',
      '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      url,
    ].map(a => (a.includes(' ') ? `'${a}'` : a)).join(' ');

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[web-search] curl error:', err.message);
        resolve([]);
        return;
      }

      try {
        const results = parseResults(stdout, maxResults);
        console.log(`[web-search] "${query}" → ${results.length} results`);
        resolve(results);
      } catch (parseErr) {
        console.error('[web-search] parse error:', parseErr.message);
        resolve([]);
      }
    });
  });
}

module.exports = webSearch;
