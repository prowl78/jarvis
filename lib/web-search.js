const { exec } = require('child_process');

function encodeQuery(query) {
  return encodeURIComponent(query);
}

function parseResults(html, maxResults) {
  const results = [];

  // Match each result block
  const resultBlockRe = /<div class="result[^"]*"[\s\S]*?(?=<div class="result[^"]*"|<\/div>\s*<\/div>\s*<\/div>\s*$)/g;

  // Simpler per-field extraction
  const titleRe = /<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/;
  const urlRe = /<a[^>]+class="result__url"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  function stripTags(str) {
    return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
  }

  // Split on result divs
  const blocks = html.split(/<div class="result(?:__body)?[ "]/).slice(1);

  for (const block of blocks) {
    if (results.length >= maxResults) break;

    const titleMatch = block.match(titleRe);
    const urlMatch = block.match(urlRe);
    const snippetMatch = block.match(snippetRe);

    const title = titleMatch ? stripTags(titleMatch[1]) : '';
    const url = urlMatch ? stripTags(urlMatch[1]).replace(/\s/g, '') : '';
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

async function webSearch(query, maxResults = 10) {
  return new Promise((resolve) => {
    const encoded = encodeQuery(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const cmd = `curl -sL --max-time 15 -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "${url}"`;

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
