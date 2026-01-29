/**
 * Acceptance Script: Stability Band v0.6
 *
 * Tests the stability rules that prevent plan thrashing:
 * - Same stable key should return existing plan (idempotency)
 * - Different stable keys should trigger recompute
 * - Inventory changes should invalidate plans
 *
 * Run with: npx ts-node scripts/accept-stability-band.ts
 */

import {
  stableKeyForRequest,
  computeInventoryDigest,
  computeCalendarDigest,
} from '../src/services/planning-horizon';
import { HorizonModes, CalendarBlockInput } from '../src/types';

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

console.log('\n=== Stability Band Acceptance Tests (v0.6) ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Stable Key Determinism
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. Stable Key Determinism Tests');

const baseHorizon = { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 };

test('Identical requests produce identical keys', () => {
  const key1 = stableKeyForRequest(
    'hh-1',
    baseHorizon,
    [],
    undefined,
    'inv-digest-1',
    'cal-digest-1'
  );
  const key2 = stableKeyForRequest(
    'hh-1',
    baseHorizon,
    [],
    undefined,
    'inv-digest-1',
    'cal-digest-1'
  );
  return key1 === key2;
}, 'Same inputs should produce same key');

test('Multiple calls remain deterministic', () => {
  const keys = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const key = stableKeyForRequest(
      'hh-1',
      baseHorizon,
      [],
      undefined,
      'inv-digest-1',
      'cal-digest-1'
    );
    keys.add(key);
  }
  return keys.size === 1;
}, '100 calls with same inputs should all produce same key');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Key Varies with Input Changes
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Key Varies with Input Changes Tests');

test('Different household produces different key', () => {
  const key1 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv', 'cal');
  const key2 = stableKeyForRequest('hh-2', baseHorizon, [], undefined, 'inv', 'cal');
  return key1 !== key2;
}, 'Different household should change key');

test('Different horizon produces different key', () => {
  const key1 = stableKeyForRequest(
    'hh-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    'inv',
    'cal'
  );
  const key2 = stableKeyForRequest(
    'hh-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 5 },
    [],
    undefined,
    'inv',
    'cal'
  );
  return key1 !== key2;
}, 'Different n_dinners should change key');

test('Different inventory digest produces different key', () => {
  const key1 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv-1', 'cal');
  const key2 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv-2', 'cal');
  return key1 !== key2;
}, 'Inventory change should change key');

test('Different calendar digest produces different key', () => {
  const key1 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv', 'cal-1');
  const key2 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv', 'cal-2');
  return key1 !== key2;
}, 'Calendar change should change key');

test('Intent override changes key', () => {
  const key1 = stableKeyForRequest('hh-1', baseHorizon, [], undefined, 'inv', 'cal');
  const key2 = stableKeyForRequest(
    'hh-1',
    baseHorizon,
    [{ date_local: '2026-01-29', must_include: ['chicken'] }],
    undefined,
    'inv',
    'cal'
  );
  return key1 !== key2;
}, 'Intent override should change key');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Inventory Digest
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Inventory Digest Tests');

test('Same inventory produces same digest', () => {
  const inv = [
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
    { id: '2', canonicalName: 'rice', quantity: 1000, unit: 'g', expirationDate: null },
  ];
  const digest1 = computeInventoryDigest(inv);
  const digest2 = computeInventoryDigest(inv);
  return digest1 === digest2;
}, 'Identical inventory should produce same digest');

test('Different order produces same digest', () => {
  const inv1 = [
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
    { id: '2', canonicalName: 'rice', quantity: 1000, unit: 'g', expirationDate: null },
  ];
  const inv2 = [
    { id: '2', canonicalName: 'rice', quantity: 1000, unit: 'g', expirationDate: null },
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
  ];
  const digest1 = computeInventoryDigest(inv1);
  const digest2 = computeInventoryDigest(inv2);
  return digest1 === digest2;
}, 'Order should not affect digest (sorted by id)');

test('Quantity change produces different digest', () => {
  const inv1 = [
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
  ];
  const inv2 = [
    { id: '1', canonicalName: 'chicken', quantity: 400, unit: 'g', expirationDate: null },
  ];
  const digest1 = computeInventoryDigest(inv1);
  const digest2 = computeInventoryDigest(inv2);
  return digest1 !== digest2;
}, 'Quantity change should change digest');

test('Added item produces different digest', () => {
  const inv1 = [
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
  ];
  const inv2 = [
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
    { id: '2', canonicalName: 'rice', quantity: 1000, unit: 'g', expirationDate: null },
  ];
  const digest1 = computeInventoryDigest(inv1);
  const digest2 = computeInventoryDigest(inv2);
  return digest1 !== digest2;
}, 'Added inventory item should change digest');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Calendar Digest
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Calendar Digest Tests');

const block1: CalendarBlockInput = {
  starts_at: '2026-01-28T18:00:00',
  ends_at: '2026-01-28T19:00:00',
  source: 'google',
};

const block2: CalendarBlockInput = {
  starts_at: '2026-01-29T18:00:00',
  ends_at: '2026-01-29T19:00:00',
  source: 'google',
};

test('Same calendar produces same digest', () => {
  const digest1 = computeCalendarDigest([block1]);
  const digest2 = computeCalendarDigest([block1]);
  return digest1 === digest2;
}, 'Identical calendar should produce same digest');

test('Different order produces same digest', () => {
  const digest1 = computeCalendarDigest([block1, block2]);
  const digest2 = computeCalendarDigest([block2, block1]);
  return digest1 === digest2;
}, 'Order should not affect digest (sorted by starts_at)');

test('Time change produces different digest', () => {
  const block1Modified: CalendarBlockInput = {
    starts_at: '2026-01-28T18:30:00',
    ends_at: '2026-01-28T19:30:00',
    source: 'google',
  };
  const digest1 = computeCalendarDigest([block1]);
  const digest2 = computeCalendarDigest([block1Modified]);
  return digest1 !== digest2;
}, 'Different time should change digest');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Stability Band Scenario
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Stability Band Scenario Tests');

test('First request generates new plan (new key)', () => {
  const key = stableKeyForRequest(
    'hh-stability-test',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    'inv-abc',
    'cal-xyz'
  );
  // Key should be a 32-char hex string
  return key.length === 32 && /^[a-f0-9]+$/.test(key);
}, 'Should generate valid stable key');

test('Identical second request matches first (idempotent)', () => {
  const invDigest = computeInventoryDigest([
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
  ]);

  const key1 = stableKeyForRequest(
    'hh-stability-test',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    invDigest,
    'cal-xyz'
  );

  // Same request again
  const key2 = stableKeyForRequest(
    'hh-stability-test',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    invDigest,
    'cal-xyz'
  );

  return key1 === key2;
}, 'Second identical request should match first key');

test('Inventory change triggers new key (invalidation)', () => {
  const invDigest1 = computeInventoryDigest([
    { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: null },
  ]);

  const invDigest2 = computeInventoryDigest([
    { id: '1', canonicalName: 'chicken', quantity: 300, unit: 'g', expirationDate: null }, // Used some
  ]);

  const key1 = stableKeyForRequest(
    'hh-stability-test',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    invDigest1,
    'cal-xyz'
  );

  const key2 = stableKeyForRequest(
    'hh-stability-test',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    invDigest2,
    'cal-xyz'
  );

  return key1 !== key2;
}, 'Inventory quantity change should produce new key');

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
