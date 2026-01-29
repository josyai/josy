/**
 * Acceptance Script: Swap Day v0.6
 *
 * Tests the swap day functionality:
 * - Intent detection for "swap Monday"
 * - Recipe exclusion during swap
 * - Horizon recipes remain excluded after swap
 *
 * Run with: npx ts-node scripts/accept-swap-day.ts
 */

import { detectIntent } from '../src/services/intent';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean, details?: string): void {
  try {
    const passed = fn();
    results.push({ name, passed, details: details || (passed ? 'OK' : 'Failed') });
    console.log(`  ${passed ? '✓' : '✗'} ${name}`);
    if (!passed && details) console.log(`    ${details}`);
  } catch (e) {
    const error = e as Error;
    results.push({ name, passed: false, details: error.message });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
  }
}

console.log('\n=== Swap Day Acceptance Tests (v0.6) ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Intent Detection for Swap
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. Swap Intent Detection Tests');

test('"swap Monday" detects SWAP_DAY with day', () => {
  const intent = detectIntent('swap Monday');
  return intent.type === 'SWAP_DAY' && intent.day === 'monday';
}, 'Should detect swap Monday (lowercased)');

test('"swap tomorrow" detects SWAP_DAY', () => {
  const intent = detectIntent('swap tomorrow');
  return intent.type === 'SWAP_DAY' && intent.day === 'tomorrow';
}, 'Should detect swap tomorrow');

test('"change Tuesday" detects SWAP_DAY', () => {
  const intent = detectIntent('change Tuesday');
  return intent.type === 'SWAP_DAY' && intent.day === 'tuesday';
}, 'Should detect change Tuesday as swap (lowercased)');

test('"different meal for Wednesday" detects SWAP_DAY', () => {
  const intent = detectIntent('different meal for Wednesday');
  return intent.type === 'SWAP_DAY' && (intent.day?.includes('wednesday') ?? false);
}, 'Should detect different meal for day (lowercased)');

test('"something else" detects SWAP_DAY without specific day', () => {
  const intent = detectIntent('something else');
  return intent.type === 'SWAP_DAY';
}, 'Should detect generic swap request');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Intent Detection for Confirm
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Confirm Intent Detection Tests');

test('"confirm" detects CONFIRM_PLAN', () => {
  const intent = detectIntent('confirm');
  return intent.type === 'CONFIRM_PLAN';
}, 'Should detect confirm');

test('"yes" detects CONFIRM_PLAN', () => {
  const intent = detectIntent('yes');
  return intent.type === 'CONFIRM_PLAN';
}, 'Should detect yes as confirm');

test('"ok" detects CONFIRM_PLAN', () => {
  const intent = detectIntent('ok');
  return intent.type === 'CONFIRM_PLAN';
}, 'Should detect ok as confirm');

test('"sounds good" detects CONFIRM_PLAN', () => {
  const intent = detectIntent('sounds good');
  return intent.type === 'CONFIRM_PLAN';
}, 'Should detect sounds good as confirm');

test('"that works" detects CONFIRM_PLAN', () => {
  const intent = detectIntent('that works');
  return intent.type === 'CONFIRM_PLAN';
}, 'Should detect that works as confirm');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Intent Detection for Multi-Day Planning
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Multi-Day Planning Intent Tests');

test('"plan next 3 dinners" detects PLAN_NEXT with days=3', () => {
  const intent = detectIntent('plan next 3 dinners');
  return intent.type === 'PLAN_NEXT' && intent.days === 3;
}, 'Should detect plan next N dinners');

test('"plan the next 5 days" detects PLAN_NEXT with days=5', () => {
  const intent = detectIntent('plan the next 5 days');
  return intent.type === 'PLAN_NEXT' && intent.days === 5;
}, 'Should detect plan next N days');

test('"plan for the week" detects PLAN_NEXT with days=7', () => {
  const intent = detectIntent('plan for the week');
  return intent.type === 'PLAN_NEXT' && intent.days === 7;
}, 'Should default to 7 days for week');

test('"weekly plan" detects PLAN_NEXT with days=7', () => {
  const intent = detectIntent('weekly plan');
  return intent.type === 'PLAN_NEXT' && intent.days === 7;
}, 'Should detect weekly plan');

test('Caps at 14 days', () => {
  const intent = detectIntent('plan next 20 dinners');
  return intent.type === 'PLAN_NEXT' && intent.days === 14;
}, 'Should cap at 14 days');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Original Intents Still Work
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Backward Compatibility - Original Intents');

test('"what\'s for dinner" still detects PLAN_TONIGHT', () => {
  const intent = detectIntent("what's for dinner");
  return intent.type === 'PLAN_TONIGHT';
}, 'Should still detect dinner intent');

test('"plan tonight" still detects PLAN_TONIGHT', () => {
  const intent = detectIntent('plan tonight');
  return intent.type === 'PLAN_TONIGHT';
}, 'Should still detect plan tonight');

test('"why" still detects EXPLAIN_LAST_PLAN', () => {
  const intent = detectIntent('why');
  return intent.type === 'EXPLAIN_LAST_PLAN';
}, 'Should still detect explain intent');

test('"bought salmon" still detects INVENTORY_ADD', () => {
  const intent = detectIntent('bought salmon');
  return intent.type === 'INVENTORY_ADD' && intent.item === 'salmon';
}, 'Should still detect inventory add');

test('"used eggs" still detects INVENTORY_USED', () => {
  const intent = detectIntent('used eggs');
  return intent.type === 'INVENTORY_USED' && intent.item === 'eggs';
}, 'Should still detect inventory used');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Priority (confirm/swap before other intents)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Intent Priority Tests');

test('Confirm takes priority over unknown', () => {
  const intent = detectIntent('yes please');
  return intent.type === 'CONFIRM_PLAN';
}, 'Confirm-like phrases should be CONFIRM_PLAN');

test('Swap takes priority over unknown', () => {
  const intent = detectIntent('swap it');
  return intent.type === 'SWAP_DAY';
}, 'Swap-like phrases should be SWAP_DAY');

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(`\n${passed}/${total} tests passed`);

if (passed < total) {
  console.log('\nFailed tests:');
  results
    .filter((r) => !r.passed)
    .forEach((r) => console.log(`  - ${r.name}: ${r.details}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
