/* Run: npm run test:brand-tokens */
import { brandTokens } from "./brandTokens";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); passed++; }
  else { console.log(`  FAIL ${label}\n       got ${a}\n       want ${e}`); failed++; }
}

/* Every name on the dashboard that showed a letter instead of a logo. */
check('Google One keeps the brand, drops the size',
  brandTokens('Google', 'Google One (100 GB)'), ['google']);
check('Apple One Family keeps Apple',
  brandTokens('Apple', 'Apple One Family'), ['apple']);
check('iCloud+ falls back to the service head when merchant is empty',
  brandTokens(null, 'iCloud+ with 200 GB'), ['icloud']);
check('YouTube Premium drops Premium',
  brandTokens(null, 'YouTube Premium'), ['youtube']);
check('Netflix is already a brand', brandTokens(null, 'Netflix'), ['netflix']);
check('Spotify is already a brand', brandTokens(null, 'Spotify'), ['spotify']);

/* The ones that already worked must keep working. */
check('Swiggy BLCK', brandTokens('Swiggy', 'Swiggy BLCK'), ['swiggy']);
/* Only the head of the service name is taken, so "Black" never appears --
   the brand is Airtel and "Black" is what they sell. */
check('Airtel Black', brandTokens('Airtel', 'Airtel Black'), ['airtel']);
check('Claude Pro', brandTokens('Anthropic', 'Claude Pro'), ['anthropic', 'claude']);

/* Refusing to guess is the whole point. */
check('Cloud Network names no company', brandTokens(null, 'Cloud Network'), []);
check('an insurance policy names no company',
  brandTokens(null, 'Auto Secure Private Car Package Policy'), []);
check('a bare plan name names no company', brandTokens(null, 'Premium Plan'), []);
check('nothing in, nothing out', brandTokens(null, ''), []);
check('short words never match', brandTokens(null, 'One Plus'), []);

/* Order: the merchant leads, because it is the company. */
check('merchant before service', brandTokens('Tata AIG', 'Auto Secure Policy'), ['tata']);
check('no duplicates', brandTokens('Netflix', 'Netflix'), ['netflix']);

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
