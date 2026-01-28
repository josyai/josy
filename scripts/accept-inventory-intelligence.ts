/**
 * Acceptance Script: Inventory Intelligence Module
 *
 * Tests:
 * - parseInventoryAdd() parsing with various inputs
 * - expiryHeuristic() returns correct rules
 * - getIngredientCategory() categorization
 *
 * Run with: npx ts-node scripts/accept-inventory-intelligence.ts
 */

import {
  parseInventoryAdd,
  expiryHeuristic,
  getIngredientCategory,
} from '../src/services/inventory-intelligence';

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

console.log('\n=== Inventory Intelligence Acceptance Tests ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: parseInventoryAdd
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. parseInventoryAdd() Tests');

// Test with explicit quantity (number followed by pcs)
test('Parses "2 pcs salmon" correctly', () => {
  const result = parseInventoryAdd('2 pcs salmon');
  return (
    result.canonical_name === 'salmon fillet' &&
    result.quantity === 2 &&
    result.unit === 'pcs' &&
    result.quantity_confidence === 'exact'
  );
}, 'Should parse salmon with quantity');

// Test with weight
test('Parses "500g chicken" correctly', () => {
  const result = parseInventoryAdd('500g chicken');
  return (
    result.canonical_name === 'chicken breast' &&
    result.quantity === 500 &&
    result.unit === 'g' &&
    result.quantity_confidence === 'exact'
  );
}, 'Should parse chicken with weight');

// Test with kg conversion
test('Parses "1kg rice" correctly (converts to g)', () => {
  const result = parseInventoryAdd('1kg rice');
  return (
    result.canonical_name === 'cooked rice' &&
    result.quantity === 1000 &&
    result.unit === 'g' &&
    result.quantity_confidence === 'exact'
  );
}, 'Should convert kg to g');

// Test with no quantity (uses defaults)
test('Parses "some eggs" with default quantity', () => {
  const result = parseInventoryAdd('some eggs');
  return (
    result.canonical_name === 'eggs' &&
    result.quantity === 6 &&
    result.unit === 'pcs' &&
    result.quantity_confidence === 'estimate'
  );
}, 'Should use default quantity for eggs');

// Test location inference
test('Infers freezer location for "frozen peas"', () => {
  const result = parseInventoryAdd('frozen peas');
  return result.location === 'freezer';
}, 'Should infer freezer location');

test('Infers pantry location for "pasta"', () => {
  const result = parseInventoryAdd('pasta');
  return result.location === 'pantry';
}, 'Should infer pantry location');

test('Infers fridge location for "salmon"', () => {
  const result = parseInventoryAdd('salmon');
  return result.location === 'fridge';
}, 'Should default to fridge for proteins');

// Test expiry calculation
test('Calculates heuristic expiry for protein in fridge', () => {
  const result = parseInventoryAdd('salmon fillet');
  return (
    result.expiration_source === 'heuristic' &&
    result.expiry_confidence === 'high' &&
    (result.expiry_rule_id?.includes('protein') ?? false)
  );
}, 'Should apply protein expiry heuristic');

// Test display name generation
test('Generates proper display name', () => {
  const result = parseInventoryAdd('frozen peas');
  return result.display_name === 'Frozen Peas';
}, 'Should capitalize display name');

// ─────────────────────────────────────────────────────────────────────────────
// Test: expiryHeuristic
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. expiryHeuristic() Tests');

test('Protein in fridge (closed) = 3 days, high confidence', () => {
  const result = expiryHeuristic('salmon fillet', 'fridge', false);
  return (
    result !== null &&
    result.expires_in_days === 3 &&
    result.confidence === 'high'
  );
});

test('Protein in fridge (opened) = 2 days, high confidence', () => {
  const result = expiryHeuristic('chicken breast', 'fridge', true);
  return (
    result !== null &&
    result.expires_in_days === 2 &&
    result.confidence === 'high'
  );
});

test('Protein in freezer = 180 days, medium confidence', () => {
  const result = expiryHeuristic('salmon fillet', 'freezer', false);
  return (
    result !== null &&
    result.expires_in_days === 180 &&
    result.confidence === 'medium'
  );
});

test('Dairy in fridge (closed) = 14 days, medium confidence', () => {
  const result = expiryHeuristic('milk', 'fridge', false);
  return (
    result !== null &&
    result.expires_in_days === 14 &&
    result.confidence === 'medium'
  );
});

test('Dairy in fridge (opened) = 7 days, medium confidence', () => {
  const result = expiryHeuristic('butter', 'fridge', true);
  return (
    result !== null &&
    result.expires_in_days === 7 &&
    result.confidence === 'medium'
  );
});

test('Produce in fridge = 7 days, low confidence', () => {
  const result = expiryHeuristic('tomato', 'fridge', false);
  return (
    result !== null &&
    result.expires_in_days === 7 &&
    result.confidence === 'low'
  );
});

test('Pantry items = 365 days, low confidence', () => {
  const result = expiryHeuristic('pasta', 'pantry', false);
  return (
    result !== null &&
    result.expires_in_days === 365 &&
    result.confidence === 'low'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: getIngredientCategory
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. getIngredientCategory() Tests');

test('Categorizes salmon as protein', () => {
  return getIngredientCategory('salmon fillet') === 'protein';
});

test('Categorizes butter as dairy', () => {
  return getIngredientCategory('butter') === 'dairy';
});

test('Categorizes tomato as produce', () => {
  return getIngredientCategory('tomato') === 'produce';
});

test('Categorizes pasta as pantry', () => {
  return getIngredientCategory('pasta') === 'pantry';
});

test('Categorizes frozen peas as frozen', () => {
  return getIngredientCategory('frozen peas') === 'frozen';
});

test('Returns "other" for unknown items', () => {
  return getIngredientCategory('mystery item xyz') === 'other';
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===\n');

const passed = results.filter((r) => r.passed).length;
const total = results.length;
const allPassed = passed === total;

console.log(`Results: ${passed}/${total} tests passed`);

if (!allPassed) {
  console.log('\nFailed tests:');
  results.filter((r) => !r.passed).forEach((r) => {
    console.log(`  - ${r.name}: ${r.details}`);
  });
  process.exit(1);
}

console.log('\n✓ All inventory intelligence tests passed!\n');
