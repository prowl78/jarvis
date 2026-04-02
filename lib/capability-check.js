const { exec } = require('child_process');

const LIMITATIONS = `
- No live web scraping or browsing (Puppeteer and Playwright are not installed)
- No email sending unless SENDGRID_KEY or SMTP credentials are in .env
- No TikTok or Instagram API access
- No Stripe access unless STRIPE_KEY is in .env
- No SMS sending
`.trim();

function checkCapabilities(intent, userMessage) {
  return new Promise((resolve) => {
    const prompt = `Given this user message and these known limitations of the JARVIS system, will JARVIS likely fail silently or stall trying to complete this task?

Known limitations:
${LIMITATIONS}

User message: ${userMessage}
Classified intent: ${intent}

If yes, return only valid JSON: { "blocked": true, "reason": "one line explanation", "suggestion": "what Boss should do or provide to unblock this" }
If no, return only valid JSON: { "blocked": false }

Return only the JSON object, no other text.`;

    const escaped = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`claude -p "${escaped}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('[capability-check] claude error:', stderr);
        resolve({ blocked: false });
        return;
      }

      try {
        const raw = stdout.trim();
        // Extract JSON from response in case Claude adds surrounding text
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
          console.warn('[capability-check] no JSON found in response:', raw.slice(0, 200));
          resolve({ blocked: false });
          return;
        }
        const result = JSON.parse(match[0]);
        resolve(result);
      } catch (parseErr) {
        console.error('[capability-check] JSON parse error:', parseErr.message);
        resolve({ blocked: false });
      }
    });
  });
}

module.exports = checkCapabilities;
