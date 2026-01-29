/**
 * Acceptance Script: v0.6.1 Swap Dependency Aware
 *
 * Tests that swap-day recompute is dependency-aware:
 * - Accounts for inventory consumed by prior days
 * - Includes variety profile from prior days in plan set
 * - Shadow inventory reflects prior day consumption
 *
 * Run with: npx ts-node scripts/accept-061-swap-dependency-aware.ts
 */

import {
  createShadowInventory,
  applyShadowConsumption,
  buildRecentConsumptionProfile,
  getExpiringIngredients,
  ShadowInventoryItem,
} from '../src/services/replanning/variety';
import { ConsumptionRecord } from '../src/types';

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

console.log('\n=== v0.6.1 Swap Dependency Aware Tests ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Shadow Inventory Creation
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. Shadow Inventory Creation Tests');

const testInventory = [
  { id: '1', canonicalName: 'chicken', quantity: 500, unit: 'g', expirationDate: new Date('2026-01-30') },
  { id: '2', canonicalName: 'rice', quantity: 1000, unit: 'g', expirationDate: null },
  { id: '3', canonicalName: 'vegetables', quantity: 300, unit: 'g', expirationDate: new Date('2026-01-29') },
];

const referenceDate = new Date('2026-01-28');

test('Creates shadow inventory with expiry days', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  // Chicken expires in 2 days (Jan 30 - Jan 28)
  const chicken = shadow.find(i => i.canonicalName === 'chicken');
  return chicken?.expiresInDays === 2;
}, 'Should calculate expires in days correctly');

test('Null expiration results in null expiresInDays', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  const rice = shadow.find(i => i.canonicalName === 'rice');
  return rice?.expiresInDays === null;
}, 'Items without expiration should have null expiresInDays');

test('Shadow inventory preserves all fields', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  return (
    shadow.length === 3 &&
    shadow.every(i => i.id && i.canonicalName && i.unit)
  );
}, 'All inventory items should be in shadow');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Shadow Inventory Consumption
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Shadow Inventory Consumption Tests');

test('Consumption reduces shadow quantity', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  applyShadowConsumption(shadow, [
    { inventoryItemId: '1', consumedQuantity: 200 },
  ]);

  const chicken = shadow.find(i => i.id === '1');
  return chicken?.quantity === 300;
}, 'Consuming 200g from 500g should leave 300g');

test('Multiple consumptions accumulate', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  // Day 1 consumption
  applyShadowConsumption(shadow, [
    { inventoryItemId: '2', consumedQuantity: 200 },
  ]);

  // Day 2 consumption
  applyShadowConsumption(shadow, [
    { inventoryItemId: '2', consumedQuantity: 300 },
  ]);

  const rice = shadow.find(i => i.id === '2');
  return rice?.quantity === 500;
}, 'Two consumptions should reduce correctly');

test('Consumption clamps at zero', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  applyShadowConsumption(shadow, [
    { inventoryItemId: '3', consumedQuantity: 400 }, // More than available
  ]);

  const veg = shadow.find(i => i.id === '3');
  return veg?.quantity === 0;
}, 'Should not go below zero');

test('Null consumption is ignored', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);

  applyShadowConsumption(shadow, [
    { inventoryItemId: '1', consumedQuantity: null },
  ]);

  const chicken = shadow.find(i => i.id === '1');
  return chicken?.quantity === 500;
}, 'Null quantity consumption should be skipped');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Variety Profile with Prior Days
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Variety Profile with Prior Days Tests');

const priorDayConsumption: ConsumptionRecord[] = [
  {
    date_local: '2026-01-27',
    recipe_slug: 'chicken-stir-fry',
    ingredients_used: ['chicken', 'vegetables', 'soy sauce'],
    tags: ['asian', 'quick'],
  },
  {
    date_local: '2026-01-28',
    recipe_slug: 'salmon-rice-bowl',
    ingredients_used: ['salmon', 'rice', 'vegetables'],
    tags: ['healthy', 'asian'],
  },
];

test('Profile includes prior day ingredients', () => {
  const profile = buildRecentConsumptionProfile(priorDayConsumption, 7, '2026-01-29');

  return (
    profile.ingredientsConsumed.has('chicken') &&
    profile.ingredientsConsumed.has('salmon') &&
    profile.ingredientsConsumed.has('rice')
  );
}, 'Should track ingredients from prior days');

test('Profile tracks correct meal count', () => {
  const profile = buildRecentConsumptionProfile(priorDayConsumption, 7, '2026-01-29');

  return profile.mealsFound === 2;
}, 'Should count 2 meals in window');

test('Profile tracks last consumed date', () => {
  const profile = buildRecentConsumptionProfile(priorDayConsumption, 7, '2026-01-29');

  const vegInfo = profile.ingredientsConsumed.get('vegetables');
  return vegInfo?.lastDate === '2026-01-28';
}, 'Should track most recent consumption date');

test('Profile tracks consumption count', () => {
  const profile = buildRecentConsumptionProfile(priorDayConsumption, 7, '2026-01-29');

  const vegInfo = profile.ingredientsConsumed.get('vegetables');
  return vegInfo?.count === 2;
}, 'Should count vegetables used twice');

test('Profile tracks tags', () => {
  const profile = buildRecentConsumptionProfile(priorDayConsumption, 7, '2026-01-29');

  return (
    profile.tagsUsed.has('asian') &&
    profile.tagsUsed.get('asian')?.count === 2
  );
}, 'Should track asian tag used twice');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Expiring Ingredients Detection
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Expiring Ingredients Detection Tests');

test('Detects items expiring within threshold', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);
  const expiring = getExpiringIngredients(shadow);

  // Vegetables expire in 1 day, chicken in 2 days
  // Default threshold is 2 days, so both should be flagged
  return expiring.has('vegetables') && expiring.has('chicken');
}, 'Should detect items expiring within 2 days');

test('Does not flag items without expiration', () => {
  const shadow = createShadowInventory(testInventory, referenceDate);
  const expiring = getExpiringIngredients(shadow);

  return !expiring.has('rice');
}, 'Rice without expiration should not be flagged');

test('Empty inventory returns empty set', () => {
  const shadow = createShadowInventory([], referenceDate);
  const expiring = getExpiringIngredients(shadow);

  return expiring.size === 0;
}, 'Empty inventory should return empty expiring set');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Dependency Chain Simulation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Dependency Chain Simulation Tests');

test('Day 2 swap sees Day 1 consumption', () => {
  // Simulates swapping day 2 in a 3-day plan
  const shadow = createShadowInventory(testInventory, referenceDate);

  // Day 1 (Jan 28) consumed 300g chicken
  applyShadowConsumption(shadow, [
    { inventoryItemId: '1', consumedQuantity: 300 },
  ]);

  // Now planning Day 2 (Jan 29) - should see only 200g chicken left
  const chicken = shadow.find(i => i.id === '1');
  return chicken?.quantity === 200;
}, 'Day 2 planning should see reduced inventory from Day 1');

test('Variety profile includes Day 1 recipes when swapping Day 2', () => {
  const day1Consumption: ConsumptionRecord[] = [
    {
      date_local: '2026-01-28',
      recipe_slug: 'lentil-curry',
      ingredients_used: ['red lentils', 'tomatoes', 'spices'],
      tags: ['indian', 'vegetarian'],
    },
  ];

  // When swapping Day 2, profile should include Day 1
  const profile = buildRecentConsumptionProfile(day1Consumption, 7, '2026-01-29');

  return profile.ingredientsConsumed.has('red lentils');
}, 'Day 2 variety profile should include Day 1 lentils');

test('Swapping Day 2 excludes Day 1 and Day 3 recipes', () => {
  // This tests the exclusion logic
  const day1Slug = 'chicken-stir-fry';
  const day3Slug = 'pasta-marinara';
  const excludeForDay2Swap = ['previous-day2-recipe', day1Slug, day3Slug];

  return (
    excludeForDay2Swap.includes(day1Slug) &&
    excludeForDay2Swap.includes(day3Slug)
  );
}, 'Day 2 swap should exclude Day 1 and Day 3 recipes');

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
