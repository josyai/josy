/**
 * Acceptance Script: Planning Horizon v0.6
 *
 * Tests:
 * - computePlanningDates() for different horizon modes
 * - normalizeHorizon() response normalization
 * - buildDinnerWindow() with calendar blocks
 * - stableKeyForRequest() idempotency key generation
 *
 * Run with: npx ts-node scripts/accept-horizon-next-n.ts
 */

import {
  computePlanningDates,
  normalizeHorizon,
  buildDinnerWindow,
  stableKeyForRequest,
  computeInventoryDigest,
  computeCalendarDigest,
  getIntentOverrideForDate,
  checkRecipeMatchesIntent,
} from '../src/services/planning-horizon';
import { HorizonModes } from '../src/types';

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

console.log('\n=== Planning Horizon Acceptance Tests (v0.6) ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: computePlanningDates
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. computePlanningDates() Tests');

const testDate = new Date('2026-01-28T18:00:00Z');
const timezone = 'America/New_York';

test('NEXT_MEAL returns single date (today)', () => {
  const dates = computePlanningDates(
    { mode: HorizonModes.NEXT_MEAL },
    timezone,
    testDate
  );
  return dates.length === 1;
}, 'Should return exactly 1 date');

test('NEXT_N_DINNERS returns correct number of dates', () => {
  const dates = computePlanningDates(
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 5 },
    timezone,
    testDate
  );
  return dates.length === 5;
}, 'Should return 5 consecutive dates');

test('NEXT_N_DINNERS dates are consecutive', () => {
  const dates = computePlanningDates(
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    timezone,
    testDate
  );
  const d0 = new Date(dates[0]);
  const d1 = new Date(dates[1]);
  const d2 = new Date(dates[2]);
  const diff1 = (d1.getTime() - d0.getTime()) / (24 * 60 * 60 * 1000);
  const diff2 = (d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000);
  return diff1 === 1 && diff2 === 1;
}, 'Days should be exactly 1 day apart');

test('DATE_RANGE returns correct dates', () => {
  const dates = computePlanningDates(
    {
      mode: HorizonModes.DATE_RANGE,
      start_date_local: '2026-01-28',
      end_date_local: '2026-01-30',
    },
    timezone,
    testDate
  );
  return (
    dates.length === 3 &&
    dates[0] === '2026-01-28' &&
    dates[1] === '2026-01-29' &&
    dates[2] === '2026-01-30'
  );
}, 'Should return 3 specific dates');

test('DATE_RANGE throws for > 14 days', () => {
  try {
    computePlanningDates(
      {
        mode: HorizonModes.DATE_RANGE,
        start_date_local: '2026-01-01',
        end_date_local: '2026-01-20',
      },
      timezone,
      testDate
    );
    return false;
  } catch (e) {
    return true;
  }
}, 'Should throw error for range > 14 days');

// ─────────────────────────────────────────────────────────────────────────────
// Test: normalizeHorizon
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. normalizeHorizon() Tests');

test('Normalizes NEXT_MEAL correctly', () => {
  const normalized = normalizeHorizon(
    { mode: HorizonModes.NEXT_MEAL },
    ['2026-01-28']
  );
  return normalized.mode === HorizonModes.NEXT_MEAL;
}, 'Should preserve NEXT_MEAL mode');

test('Normalizes NEXT_N_DINNERS with computed count', () => {
  const normalized = normalizeHorizon(
    { mode: HorizonModes.NEXT_N_DINNERS },
    ['2026-01-28', '2026-01-29', '2026-01-30']
  );
  return (
    normalized.mode === HorizonModes.NEXT_N_DINNERS &&
    normalized.n_dinners === 3
  );
}, 'Should set n_dinners from computed dates');

// ─────────────────────────────────────────────────────────────────────────────
// Test: buildDinnerWindow
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. buildDinnerWindow() Tests');

test('Computes basic dinner window', () => {
  const window = buildDinnerWindow(
    '2026-01-28',
    [],
    timezone,
    '17:00',
    '21:00'
  );
  return (
    window.dateLocal === '2026-01-28' &&
    window.availableMinutes === 240 // 4 hours
  );
}, 'Should compute 4 hour window');

test('Subtracts calendar blocks from window', () => {
  const window = buildDinnerWindow(
    '2026-01-28',
    [
      {
        starts_at: '2026-01-28T18:00:00',
        ends_at: '2026-01-28T19:00:00',
        source: 'google',
        title: 'Meeting',
      },
    ],
    timezone,
    '17:00',
    '21:00'
  );
  // 4 hours - 1 hour meeting = 180 minutes
  return window.availableMinutes === 180;
}, 'Should subtract 1 hour meeting');

// ─────────────────────────────────────────────────────────────────────────────
// Test: stableKeyForRequest
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. stableKeyForRequest() Tests');

test('Same inputs produce same key', () => {
  const key1 = stableKeyForRequest(
    'household-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    'inv123',
    'cal456'
  );
  const key2 = stableKeyForRequest(
    'household-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    'inv123',
    'cal456'
  );
  return key1 === key2;
}, 'Stable key should be deterministic');

test('Different inputs produce different keys', () => {
  const key1 = stableKeyForRequest(
    'household-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 3 },
    [],
    undefined,
    'inv123',
    'cal456'
  );
  const key2 = stableKeyForRequest(
    'household-1',
    { mode: HorizonModes.NEXT_N_DINNERS, n_dinners: 4 }, // Different
    [],
    undefined,
    'inv123',
    'cal456'
  );
  return key1 !== key2;
}, 'Different n_dinners should produce different key');

// ─────────────────────────────────────────────────────────────────────────────
// Test: getIntentOverrideForDate
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. getIntentOverrideForDate() Tests');

test('Returns matching intent override', () => {
  const override = getIntentOverrideForDate('2026-01-29', [
    { date_local: '2026-01-28', must_include: ['chicken'] },
    { date_local: '2026-01-29', preferred_recipe_tags: ['italian'] },
  ]);
  return (
    override !== undefined &&
    override.date_local === '2026-01-29' &&
    (override.preferred_recipe_tags?.includes('italian') ?? false)
  );
}, 'Should find matching override');

test('Returns undefined for no match', () => {
  const override = getIntentOverrideForDate('2026-01-30', [
    { date_local: '2026-01-28', must_include: ['chicken'] },
  ]);
  return override === undefined;
}, 'Should return undefined when no match');

// ─────────────────────────────────────────────────────────────────────────────
// Test: checkRecipeMatchesIntent
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n6. checkRecipeMatchesIntent() Tests');

test('Hard fails on must_exclude match', () => {
  const result = checkRecipeMatchesIntent(
    { slug: 'pasta-dish', tags: ['italian'], ingredientNames: ['pasta', 'beef'] },
    { date_local: '2026-01-28', must_exclude: ['beef'] }
  );
  return result.hardFail === true;
}, 'Should hard fail when must_exclude ingredient present');

test('Boosts for must_include match', () => {
  const result = checkRecipeMatchesIntent(
    { slug: 'chicken-stir-fry', tags: ['asian'], ingredientNames: ['chicken', 'vegetables'] },
    { date_local: '2026-01-28', must_include: ['chicken'] }
  );
  return result.boost > 0 && !result.hardFail;
}, 'Should boost score when must_include present');

test('Boosts for preferred_recipe_slugs', () => {
  const result = checkRecipeMatchesIntent(
    { slug: 'grandmas-pasta', tags: ['italian'], ingredientNames: ['pasta'] },
    { date_local: '2026-01-28', preferred_recipe_slugs: ['grandmas-pasta'] }
  );
  return result.boost >= 30;
}, 'Should boost 30 points for preferred slug');

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
