// Capture the current detection result as a comparison baseline.
// Suggestion count and the set of services found are the regression canary for
// every later phase -- especially the Phase 6 model swaps.
//
//   node --env-file=.env scripts/detection-baseline.mjs [userId]
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const userId = process.argv[2] ?? 'b86f1a3c-1fac-446f-bb54-6784c91c9820';

const [emails] = await sql`
  select count(*)::int as n from emails where user_id = ${userId}
`;
const suggestions = await sql`
  select service_name, amount, currency, frequency, confidence
  from subscription_suggestions where user_id = ${userId}
  order by service_name
`;
const subs = await sql`
  select service_name, amount, currency, frequency, status, merchant_name
  from subscriptions where user_id = ${userId}
  order by service_name
`;

console.log('emails stored      :', emails.n);
console.log('pending suggestions:', suggestions.length);
if (suggestions.length) console.table(suggestions);
console.log('subscriptions      :', subs.length);
if (subs.length) console.table(subs);
