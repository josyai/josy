/**
 * Acceptance Script: Grocery Normalization Module
 *
 * Tests:
 * - normalizeGroceryAddons() deduplication
 * - Category assignment
 * - Sorting by category order
 * - Summary generation
 *
 * Run with: npx ts-node scripts/accept-grocery-normalization.ts
 */

import {
  normalizeGroceryAddons,
  formatGroceryListForWhatsApp,
  GroceryAddonInput,
} from '../src/services/grocery';

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

console.log('\n=== Grocery Normalization Acceptance Tests ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: Basic Normalization
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. Basic Normalization Tests');

test('Empty addons returns empty list', () => {
  const result = normalizeGroceryAddons([]);
  return result.items.length === 0 && result.summary === 'No items needed.';
});

test('Single item preserves data', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return (
    result.items.length === 1 &&
    result.items[0].canonical_name === 'tomato' &&
    result.items[0].total_quantity === 4 &&
    result.items[0].unit === 'pcs'
  );
});

test('Generates display name from canonical name', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'salmon fillet', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items[0].display_name === 'Salmon Fillet';
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Deduplication
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. Deduplication Tests');

test('Deduplicates same item + unit', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 2, unit: 'pcs' },
    { canonical_name: 'tomato', required_quantity: 3, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items.length === 1 && result.items[0].total_quantity === 5;
});

test('Does not dedupe different units', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'chicken breast', required_quantity: 500, unit: 'g' },
    { canonical_name: 'chicken breast', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items.length === 2;
});

test('Sums quantities correctly across multiple duplicates', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'onion', required_quantity: 1, unit: 'pcs' },
    { canonical_name: 'onion', required_quantity: 2, unit: 'pcs' },
    { canonical_name: 'onion', required_quantity: 1, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items.length === 1 && result.items[0].total_quantity === 4;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Category Assignment
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. Category Assignment Tests');

test('Assigns protein category', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'salmon fillet', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items[0].category === 'protein';
});

test('Assigns produce category', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items[0].category === 'produce';
});

test('Assigns dairy category', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'butter', required_quantity: 200, unit: 'g' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items[0].category === 'dairy';
});

test('Assigns pantry category', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'pasta', required_quantity: 500, unit: 'g' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.items[0].category === 'pantry';
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Sorting
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Sorting Tests');

test('Sorts by category order: produce → protein → dairy → pantry', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'pasta', required_quantity: 500, unit: 'g' },      // pantry
    { canonical_name: 'salmon fillet', required_quantity: 2, unit: 'pcs' }, // protein
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },     // produce
    { canonical_name: 'butter', required_quantity: 200, unit: 'g' },     // dairy
  ];
  const result = normalizeGroceryAddons(addons);

  const categories = result.items.map((i) => i.category);
  return (
    categories[0] === 'produce' &&
    categories[1] === 'protein' &&
    categories[2] === 'dairy' &&
    categories[3] === 'pantry'
  );
});

test('Sorts alphabetically within same category', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'onion', required_quantity: 2, unit: 'pcs' },
    { canonical_name: 'garlic', required_quantity: 1, unit: 'pcs' },
    { canonical_name: 'tomato', required_quantity: 3, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);

  const names = result.items.map((i) => i.display_name);
  return names[0] === 'Garlic' && names[1] === 'Onion' && names[2] === 'Tomato';
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Summary Generation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Summary Generation Tests');

test('Single item summary includes item and quantity', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.summary.includes('Tomato') && result.summary.includes('4 pcs');
});

test('Two items summary lists both', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
    { canonical_name: 'onion', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.summary.includes('Tomato') && result.summary.includes('Onion');
});

test('Multiple items summary uses "and X more"', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
    { canonical_name: 'onion', required_quantity: 2, unit: 'pcs' },
    { canonical_name: 'garlic', required_quantity: 1, unit: 'pcs' },
    { canonical_name: 'salmon fillet', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  return result.summary.includes('more item');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: WhatsApp Formatting
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n6. WhatsApp Formatting Tests');

test('Empty list returns friendly message', () => {
  const result = normalizeGroceryAddons([]);
  const formatted = formatGroceryListForWhatsApp(result);
  return formatted === 'You have everything you need!';
});

test('Formatted list includes items with quantities', () => {
  const addons: GroceryAddonInput[] = [
    { canonical_name: 'tomato', required_quantity: 4, unit: 'pcs' },
    { canonical_name: 'salmon fillet', required_quantity: 2, unit: 'pcs' },
  ];
  const result = normalizeGroceryAddons(addons);
  const formatted = formatGroceryListForWhatsApp(result);
  return (
    formatted.includes('Shopping list:') &&
    formatted.includes('Tomato') &&
    formatted.includes('Salmon Fillet')
  );
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

console.log('\n✓ All grocery normalization tests passed!\n');
