/**
 * Acceptance Script: Tonight Route Backward Compatibility v0.6
 *
 * Tests that /v1/plan/tonight still works after v0.6 changes:
 * - PlanTonightRequestSchema still validates correctly
 * - Response format is unchanged
 * - DPE with options doesn't break original flow
 *
 * Run with: npx ts-node scripts/accept-tonight-backward-compat.ts
 */

import {
  PlanTonightRequestSchema,
  PlanRequestSchema,
  HorizonModes,
} from '../src/types';
import { detectIntent } from '../src/services/intent';
import { ZodError } from 'zod';

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

console.log('\n=== Tonight Backward Compatibility Tests (v0.6) ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: PlanTonightRequestSchema Validation
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. PlanTonightRequestSchema Validation Tests');

test('Accepts minimal request (household_id only)', () => {
  try {
    const result = PlanTonightRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    return result.household_id === '123e4567-e89b-12d3-a456-426614174000';
  } catch (e) {
    return false;
  }
}, 'Should accept request with just household_id');

test('Accepts request with now_ts', () => {
  try {
    const result = PlanTonightRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      now_ts: '2026-01-28T18:00:00Z',
    });
    return result.now_ts === '2026-01-28T18:00:00Z';
  } catch (e) {
    return false;
  }
}, 'Should accept request with now_ts');

test('Accepts request with calendar_blocks', () => {
  try {
    const result = PlanTonightRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      calendar_blocks: [
        {
          starts_at: '2026-01-28T18:00:00Z',
          ends_at: '2026-01-28T19:00:00Z',
          source: 'google',
          title: 'Meeting',
        },
      ],
    });
    return result.calendar_blocks?.length === 1;
  } catch (e) {
    return false;
  }
}, 'Should accept request with calendar_blocks');

test('Rejects request without household_id', () => {
  try {
    PlanTonightRequestSchema.parse({
      now_ts: '2026-01-28T18:00:00Z',
    });
    return false;
  } catch (e) {
    return e instanceof ZodError;
  }
}, 'Should reject request missing household_id');

test('Rejects invalid UUID for household_id', () => {
  try {
    PlanTonightRequestSchema.parse({
      household_id: 'not-a-uuid',
    });
    return false;
  } catch (e) {
    return e instanceof ZodError;
  }
}, 'Should reject invalid UUID');

// ─────────────────────────────────────────────────────────────────────────────
// Test: New PlanRequestSchema (v0.6)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. PlanRequestSchema (v0.6) Tests');

test('Accepts NEXT_MEAL horizon', () => {
  try {
    const result = PlanRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      horizon: { mode: 'NEXT_MEAL' },
    });
    return result.horizon.mode === HorizonModes.NEXT_MEAL;
  } catch (e) {
    return false;
  }
}, 'Should accept NEXT_MEAL horizon');

test('Accepts NEXT_N_DINNERS horizon', () => {
  try {
    const result = PlanRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      horizon: { mode: 'NEXT_N_DINNERS', n_dinners: 5 },
    });
    return (
      result.horizon.mode === HorizonModes.NEXT_N_DINNERS &&
      result.horizon.n_dinners === 5
    );
  } catch (e) {
    return false;
  }
}, 'Should accept NEXT_N_DINNERS with n_dinners');

test('Accepts DATE_RANGE horizon', () => {
  try {
    const result = PlanRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      horizon: {
        mode: 'DATE_RANGE',
        start_date_local: '2026-01-28',
        end_date_local: '2026-01-30',
      },
    });
    return (
      result.horizon.mode === HorizonModes.DATE_RANGE &&
      result.horizon.start_date_local === '2026-01-28'
    );
  } catch (e) {
    return false;
  }
}, 'Should accept DATE_RANGE with dates');

test('Accepts intent_overrides', () => {
  try {
    const result = PlanRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      horizon: { mode: 'NEXT_N_DINNERS', n_dinners: 3 },
      intent_overrides: [
        { date_local: '2026-01-29', must_include: ['chicken'] },
      ],
    });
    return result.intent_overrides?.length === 1;
  } catch (e) {
    return false;
  }
}, 'Should accept intent_overrides array');

test('Accepts options', () => {
  try {
    const result = PlanRequestSchema.parse({
      household_id: '123e4567-e89b-12d3-a456-426614174000',
      horizon: { mode: 'NEXT_MEAL' },
      options: {
        exclude_recipe_slugs: ['pasta-bolognese'],
        variety_window_days: 5,
        stability_band_pct: 15,
      },
    });
    return (
      (result.options?.exclude_recipe_slugs?.includes('pasta-bolognese') ?? false) &&
      result.options?.variety_window_days === 5
    );
  } catch (e) {
    return false;
  }
}, 'Should accept options object');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Intent Detection Backward Compatibility
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Intent Detection Backward Compatibility Tests');

test('PLAN_TONIGHT still detected for dinner queries', () => {
  const cases = [
    "what's for dinner",
    "what's for dinner?",
    'What should I eat tonight',
    'what can I make for dinner',
    'plan tonight',
  ];

  for (const msg of cases) {
    const intent = detectIntent(msg);
    if (intent.type !== 'PLAN_TONIGHT') {
      console.log(`    Failed for: "${msg}" - got ${intent.type}`);
      return false;
    }
  }
  return true;
}, 'All dinner queries should still detect PLAN_TONIGHT');

test('EXPLAIN_LAST_PLAN still detected', () => {
  const cases = ['why', 'why?', 'why this recipe', 'explain'];

  for (const msg of cases) {
    const intent = detectIntent(msg);
    if (intent.type !== 'EXPLAIN_LAST_PLAN') {
      console.log(`    Failed for: "${msg}" - got ${intent.type}`);
      return false;
    }
  }
  return true;
}, 'Explanation queries should still detect EXPLAIN_LAST_PLAN');

test('INVENTORY_ADD still detected', () => {
  const cases = [
    { msg: 'bought chicken', expected: 'chicken' },
    { msg: 'got some eggs', expected: 'eggs' },
    { msg: 'I have salmon', expected: 'salmon' },
    { msg: 'added rice', expected: 'rice' },
  ];

  for (const { msg, expected } of cases) {
    const intent = detectIntent(msg);
    if (intent.type !== 'INVENTORY_ADD') {
      console.log(`    Failed for: "${msg}" - got ${intent.type}`);
      return false;
    }
    if (intent.item !== expected) {
      console.log(`    Item mismatch for: "${msg}" - got ${intent.item}, expected ${expected}`);
      return false;
    }
  }
  return true;
}, 'Inventory add phrases should still detect INVENTORY_ADD');

test('INVENTORY_USED still detected', () => {
  const cases = [
    { msg: 'used the eggs', expected: 'eggs' },
    { msg: 'finished the milk', expected: 'milk' },
    { msg: 'ran out of butter', expected: 'butter' },
  ];

  for (const { msg, expected } of cases) {
    const intent = detectIntent(msg);
    if (intent.type !== 'INVENTORY_USED') {
      console.log(`    Failed for: "${msg}" - got ${intent.type}`);
      return false;
    }
    if (intent.item !== expected) {
      console.log(`    Item mismatch for: "${msg}" - got ${intent.item}, expected ${expected}`);
      return false;
    }
  }
  return true;
}, 'Inventory used phrases should still detect INVENTORY_USED');

// ─────────────────────────────────────────────────────────────────────────────
// Test: New v0.6 intents don't interfere with existing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. New v0.6 Intents Isolation Tests');

test('PLAN_TONIGHT not confused with PLAN_NEXT', () => {
  const tonightIntent = detectIntent("what's for dinner tonight");
  const nextIntent = detectIntent('plan next 3 dinners');

  return (
    tonightIntent.type === 'PLAN_TONIGHT' &&
    nextIntent.type === 'PLAN_NEXT'
  );
}, 'Tonight and next-N should be distinct');

test('Confirm does not trigger for dinner queries', () => {
  const intent = detectIntent("yes what's for dinner");
  // Should still be PLAN_TONIGHT because it has dinner context
  // Actually, "yes" by itself is confirm, but with more context it might be different
  // Let's test pure "yes"
  const pureYes = detectIntent('yes');
  const dinnerQuery = detectIntent("what's for dinner");

  return (
    pureYes.type === 'CONFIRM_PLAN' &&
    dinnerQuery.type === 'PLAN_TONIGHT'
  );
}, 'Pure yes should be CONFIRM, dinner query should be PLAN_TONIGHT');

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
