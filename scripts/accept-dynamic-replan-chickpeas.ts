/**
 * Acceptance Script: Dynamic Replanning / Variety Penalties v0.6
 *
 * Tests the "chickpeas scenario":
 * - User ate chickpea curry on Monday
 * - Planning for Thursday should apply variety penalty to chickpea dishes
 * - Unless chickpeas are expiring (urgency trumps variety)
 *
 * Run with: npx ts-node scripts/accept-dynamic-replan-chickpeas.ts
 */

import {
  VARIETY_RULES,
  getVarietyCategory,
  getVarietyRule,
  buildRecentConsumptionProfile,
  calculateVarietyPenalties,
  createShadowInventory,
  applyShadowConsumption,
  getExpiringIngredients,
  EXPIRY_URGENCY_THRESHOLD_DAYS,
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

console.log('\n=== Dynamic Replanning / Variety Tests (v0.6) ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Variety Rules Configuration
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. Variety Rules Tests');

test('Chickpeas are in pantry_legumes category', () => {
  const category = getVarietyCategory('canned chickpeas');
  return category === 'pantry_legumes';
}, 'Canned chickpeas should be pantry_legumes');

test('Chickpeas in pantry_legumes have 7-day avoid window', () => {
  const rule = getVarietyRule('pantry_legumes');
  return rule?.avoid_repeat_days === 7;
}, 'Pantry legumes should have 7-day window');

test('Proteins have 4-day avoid window', () => {
  const rule = getVarietyRule('proteins');
  return rule?.avoid_repeat_days === 4;
}, 'Proteins should have 4-day window');

test('Salmon is in proteins category', () => {
  const category = getVarietyCategory('salmon fillet');
  return category === 'proteins';
}, 'Salmon should be proteins');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Consumption Profile Building
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Consumption Profile Tests');

const mondayRecords: ConsumptionRecord[] = [
  {
    date_local: '2026-01-26', // Monday
    recipe_slug: 'chickpea-curry',
    ingredients_used: ['canned chickpeas', 'onion', 'garlic', 'coconut milk'],
    tags: ['indian', 'vegetarian'],
  },
];

test('Profile correctly tracks chickpea consumption', () => {
  const profile = buildRecentConsumptionProfile(
    mondayRecords,
    7, // 7-day window
    '2026-01-29' // Thursday
  );
  const chickpeaData = profile.ingredientsConsumed.get('canned chickpeas');
  return (
    chickpeaData !== undefined &&
    chickpeaData.lastDate === '2026-01-26' &&
    chickpeaData.count === 1
  );
}, 'Should track chickpeas consumed on Monday');

test('Profile tracks tags used', () => {
  const profile = buildRecentConsumptionProfile(mondayRecords, 7, '2026-01-29');
  const indianTag = profile.tagsUsed.get('indian');
  return indianTag !== undefined && indianTag.count === 1;
}, 'Should track Indian cuisine tag');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Variety Penalty Calculation - The Chickpeas Scenario
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Chickpeas Scenario Tests');

test('Thursday plan with chickpeas gets variety penalty', () => {
  const profile = buildRecentConsumptionProfile(mondayRecords, 7, '2026-01-29');

  // Recipe that uses chickpeas
  const result = calculateVarietyPenalties(
    ['canned chickpeas', 'onion', 'tomato'],
    ['mediterranean'],
    profile,
    '2026-01-29', // Thursday
    new Set() // No expiring ingredients
  );

  // Chickpeas consumed 3 days ago, within 7-day window, should get penalty
  return (
    result.totalPenalty > 0 &&
    result.penalties.some((p) => p.ingredient === 'canned chickpeas')
  );
}, 'Should apply penalty for chickpeas (3 days since consumption)');

test('Penalty shows correct days since consumption', () => {
  const profile = buildRecentConsumptionProfile(mondayRecords, 7, '2026-01-29');

  const result = calculateVarietyPenalties(
    ['canned chickpeas'],
    [],
    profile,
    '2026-01-29',
    new Set()
  );

  const chickpeaPenalty = result.penalties.find((p) => p.ingredient === 'canned chickpeas');
  return chickpeaPenalty?.days_since === 3;
}, 'Should correctly calculate 3 days since Monday');

test('Recipe without chickpeas has no chickpea penalty', () => {
  const profile = buildRecentConsumptionProfile(mondayRecords, 7, '2026-01-29');

  const result = calculateVarietyPenalties(
    ['salmon fillet', 'rice', 'broccoli'],
    ['asian'],
    profile,
    '2026-01-29',
    new Set()
  );

  return !result.penalties.some((p) => p.ingredient === 'canned chickpeas');
}, 'No chickpea penalty for recipe without chickpeas');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Expiry Urgency Trumps Variety
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Expiry Urgency Trumps Variety Tests');

test('Expiring chickpeas skip variety penalty', () => {
  const profile = buildRecentConsumptionProfile(mondayRecords, 7, '2026-01-29');

  // Chickpeas are expiring!
  const expiringIngredients = new Set(['canned chickpeas']);

  const result = calculateVarietyPenalties(
    ['canned chickpeas', 'onion'],
    [],
    profile,
    '2026-01-29',
    expiringIngredients
  );

  // Should NOT have penalty because chickpeas are expiring
  return !result.penalties.some((p) => p.ingredient === 'canned chickpeas');
}, 'Expiry urgency should trump variety penalty');

test('Non-expiring ingredient still gets penalty', () => {
  const profile = buildRecentConsumptionProfile(
    [
      ...mondayRecords,
      {
        date_local: '2026-01-27',
        recipe_slug: 'grilled-salmon',
        ingredients_used: ['salmon fillet', 'lemon'],
        tags: ['seafood'],
      },
    ],
    7,
    '2026-01-29'
  );

  // Only chickpeas are expiring, salmon is not
  const expiringIngredients = new Set(['canned chickpeas']);

  const result = calculateVarietyPenalties(
    ['salmon fillet', 'canned chickpeas'],
    [],
    profile,
    '2026-01-29',
    expiringIngredients
  );

  // Salmon should get penalty (not expiring), chickpeas should not (expiring)
  return (
    result.penalties.some((p) => p.ingredient === 'salmon fillet') &&
    !result.penalties.some((p) => p.ingredient === 'canned chickpeas')
  );
}, 'Non-expiring recently-used ingredient still gets penalty');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Shadow Inventory
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Shadow Inventory Tests');

test('Shadow inventory tracks expiring ingredients', () => {
  const today = new Date('2026-01-29');
  const inventory = [
    {
      id: '1',
      canonicalName: 'canned chickpeas',
      quantity: 400,
      unit: 'g',
      expirationDate: new Date('2026-01-30'), // Expires tomorrow
    },
    {
      id: '2',
      canonicalName: 'salmon fillet',
      quantity: 2,
      unit: 'pcs',
      expirationDate: new Date('2026-02-05'), // Expires in a week
    },
  ];

  const shadow = createShadowInventory(inventory, today);
  const expiring = getExpiringIngredients(shadow);

  // Chickpeas expire in 1 day (within threshold), salmon in 7 days (outside)
  return (
    expiring.has('canned chickpeas') &&
    !expiring.has('salmon fillet')
  );
}, `Items expiring within ${EXPIRY_URGENCY_THRESHOLD_DAYS} days should be flagged`);

test('Shadow consumption decrements quantities', () => {
  const today = new Date('2026-01-29');
  const inventory = [
    {
      id: '1',
      canonicalName: 'canned chickpeas',
      quantity: 800,
      unit: 'g',
      expirationDate: null,
    },
  ];

  const shadow = createShadowInventory(inventory, today);

  applyShadowConsumption(shadow, [
    { inventoryItemId: '1', consumedQuantity: 400 },
  ]);

  return shadow[0].quantity === 400;
}, 'Should decrement shadow inventory quantity');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Full Chickpeas Scenario
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n6. Full Chickpeas Scenario Integration');

test('Day 1: Plan with chickpeas, Day 4: Chickpeas penalized', () => {
  // Day 1: Ate chickpea curry
  const consumption: ConsumptionRecord[] = [
    {
      date_local: '2026-01-26',
      recipe_slug: 'chickpea-curry',
      ingredients_used: ['canned chickpeas', 'coconut milk', 'onion'],
      tags: ['indian'],
    },
  ];

  // Day 4: Planning - check penalty for hummus (uses chickpeas)
  const profile = buildRecentConsumptionProfile(consumption, 7, '2026-01-29');
  const hummusIngredients = ['canned chickpeas', 'tahini', 'olive oil', 'garlic'];

  const penaltyResult = calculateVarietyPenalties(
    hummusIngredients,
    ['mediterranean'],
    profile,
    '2026-01-29',
    new Set()
  );

  // Check salmon recipe has no chickpea penalty
  const salmonIngredients = ['salmon fillet', 'lemon', 'dill'];
  const salmonPenalty = calculateVarietyPenalties(
    salmonIngredients,
    ['seafood'],
    profile,
    '2026-01-29',
    new Set()
  );

  return (
    penaltyResult.totalPenalty > salmonPenalty.totalPenalty &&
    penaltyResult.penalties.some((p) =>
      p.reason.includes('chickpeas') && p.reason.includes('3 days ago')
    )
  );
}, 'Hummus should be penalized vs salmon on Day 4 after chickpea curry');

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
