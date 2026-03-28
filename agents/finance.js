const Stripe = require('stripe');

function parseWindow(message) {
  const lower = message.toLowerCase();
  if (/last\s+payment|most\s+recent|latest\s+(charge|payment)/i.test(lower)) return 'last';
  if (/this\s+week|last\s+7|past\s+7|7\s+days/i.test(lower))               return 'week';
  if (/this\s+month|last\s+30|past\s+30|30\s+days/i.test(lower))           return 'month';
  return 'today'; // default
}

function aud(cents) {
  return `$${(cents / 100).toFixed(2)} AUD`;
}

function since(days) {
  return Math.floor(Date.now() / 1000) - days * 86400;
}

async function fetchCharges(stripe, createdAfter) {
  const charges = [];
  let hasMore = true;
  let startingAfter;

  while (hasMore) {
    const params = {
      limit: 100,
      created: { gte: createdAfter },
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripe.charges.list(params);
    charges.push(...page.data);
    hasMore = page.has_more;
    if (hasMore) startingAfter = page.data[page.data.length - 1].id;
  }

  return charges.filter(c => c.status === 'succeeded');
}

function sumAud(charges) {
  // Stripe amounts are in the currency's smallest unit; convert AUD (cents) → dollars
  return charges.reduce((acc, c) => {
    const amount = c.currency.toLowerCase() === 'aud' ? c.amount : 0;
    return acc + amount;
  }, 0);
}

async function finance(userMessage, sendToTelegram) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    await sendToTelegram('STRIPE_SECRET_KEY not set.');
    return;
  }

  const stripe = Stripe(key);
  const window = parseWindow(userMessage);

  try {
    if (window === 'last') {
      const page = await stripe.charges.list({ limit: 1 });
      const succeeded = page.data.find(c => c.status === 'succeeded');
      if (!succeeded) {
        await sendToTelegram('No successful charges found.');
        return;
      }
      const date = new Date(succeeded.created * 1000).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
      await sendToTelegram(`Last payment: ${aud(succeeded.amount)} on ${date}`);
      return;
    }

    const days = window === 'today' ? 1 : window === 'week' ? 7 : 30;
    const label = window === 'today' ? 'today' : window === 'week' ? 'this week' : 'this month';

    const charges = await fetchCharges(stripe, since(days));
    const total = sumAud(charges);
    const count = charges.length;

    await sendToTelegram(`Revenue ${label}: ${aud(total)} across ${count} payment${count !== 1 ? 's' : ''}`);
  } catch (err) {
    console.error('[finance] Stripe error:', err.message);
    await sendToTelegram(`Stripe error: ${err.message}`);
  }
}

module.exports = finance;
