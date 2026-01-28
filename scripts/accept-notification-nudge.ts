/**
 * Acceptance Script: Notifications Module
 *
 * Tests:
 * - buildDinnerNotification() message construction
 * - buildCommitConfirmation() status messages
 * - formatForWhatsApp() formatting
 *
 * Run with: npx ts-node scripts/accept-notification-nudge.ts
 */

import {
  buildDinnerNotification,
  buildCommitConfirmation,
  formatForWhatsApp,
  buildInventoryAddConfirmation,
  buildInventoryUsedConfirmation,
  buildNoRecipeMessage,
  buildUnknownIntentMessage,
} from '../src/services/notifications';
import { ReasoningTrace, NormalizedGroceryList } from '../src/types';

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

// Mock data for tests
const mockTrace: ReasoningTrace = {
  version: 'v0.3',
  generated_at: new Date().toISOString(),
  inventory_snapshot: [
    {
      canonical_name: 'salmon fillet',
      quantity: 2,
      quantity_confidence: 'exact',
      unit: 'pcs',
      expiration_date: new Date().toISOString().split('T')[0],
      urgency: 4, // Expiring soon
    },
    {
      canonical_name: 'frozen peas',
      quantity: 300,
      quantity_confidence: 'exact',
      unit: 'g',
      expiration_date: null,
      urgency: 0,
    },
  ],
  calendar_constraints: {
    dinner_window: {
      start: '2024-01-15T18:00:00Z',
      end: '2024-01-15T21:00:00Z',
    },
    busy_blocks: [],
    available_minutes: 180,
  },
  eligible_recipes: [
    {
      recipe: 'salmon-with-peas',
      eligible: true,
      rejections: [],
      scores: {
        waste: 10,
        grocery_penalty: 0,
        time_penalty: 4,
        final: 6,
      },
      missing_ingredients: [],
      uses_inventory: ['salmon fillet', 'frozen peas'],
    },
  ],
  rejected_recipes: [],
  winner: 'salmon-with-peas',
  tie_breaker: null,
  scoring_details: {
    waste_weight: 1,
    grocery_penalty_per_item: 10,
    time_penalty_factor: 0.2,
  },
};

const mockGroceryList: NormalizedGroceryList = {
  items: [
    {
      canonical_name: 'lemon',
      display_name: 'Lemon',
      total_quantity: 2,
      unit: 'pcs',
      category: 'produce',
    },
  ],
  summary: 'Pick up Lemon (2 pcs).',
};

console.log('\n=== Notification Nudge Acceptance Tests ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test: buildDinnerNotification
// ─────────────────────────────────────────────────────────────────────────────

console.log('1. buildDinnerNotification() Tests');

test('Includes recipe name', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  return notification.recipe_name === 'Salmon with Peas';
});

test('Includes plan_id', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  return notification.plan_id === 'plan-123';
});

test('Generates why_short for expiring items', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  return notification.why_short.includes('expires') || notification.why_short.includes('expiring');
});

test('Includes grocery_summary when groceries needed', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    mockGroceryList,
    'plan-123'
  );
  return notification.grocery_summary !== null && notification.grocery_summary.includes('Lemon');
});

test('grocery_summary is null when no groceries needed', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  return notification.grocery_summary === null;
});

test('Includes confirm and swap actions', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  return notification.actions.confirm !== '' && notification.actions.swap !== '';
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: buildCommitConfirmation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n2. buildCommitConfirmation() Tests');

test('Cooked status includes recipe name and positive message', () => {
  const message = buildCommitConfirmation('Salmon with Peas', 'cooked');
  return message.includes('Salmon with Peas') && message.includes('Enjoy');
});

test('Skipped status includes recipe name and acknowledgment', () => {
  const message = buildCommitConfirmation('Salmon with Peas', 'skipped');
  return message.includes('Salmon with Peas') && message.includes('skipped');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: formatForWhatsApp
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n3. formatForWhatsApp() Tests');

test('Includes recipe name with bold formatting', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  const formatted = formatForWhatsApp(notification);
  return formatted.includes('*') && formatted.includes('Salmon with Peas');
});

test('Includes why explanation', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  const formatted = formatForWhatsApp(notification);
  return formatted.includes(notification.why_short);
});

test('Includes grocery summary when present', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    mockGroceryList,
    'plan-123'
  );
  const formatted = formatForWhatsApp(notification);
  return formatted.includes('Lemon');
});

test('Includes action prompts', () => {
  const notification = buildDinnerNotification(
    'Salmon with Peas',
    mockTrace,
    null,
    'plan-123'
  );
  const formatted = formatForWhatsApp(notification);
  return formatted.includes('Reply') && formatted.includes('confirm');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Inventory Confirmations
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n4. Inventory Confirmation Tests');

test('Add confirmation includes item and quantity', () => {
  const message = buildInventoryAddConfirmation('Salmon Fillet', 2, 'pcs');
  return message.includes('Salmon Fillet') && message.includes('2 pcs');
});

test('Add confirmation without quantity mentions item', () => {
  const message = buildInventoryAddConfirmation('Salmon Fillet', null, 'pcs');
  return message.includes('Salmon Fillet') && !message.includes('null');
});

test('Used confirmation mentions item', () => {
  const message = buildInventoryUsedConfirmation('Salmon Fillet');
  return message.includes('Salmon Fillet') && message.includes('used');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Error Messages
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n5. Error Message Tests');

test('No recipe message for time constraint', () => {
  const message = buildNoRecipeMessage('Insufficient time available');
  return message.includes('schedule') || message.includes('time');
});

test('No recipe message for equipment constraint', () => {
  const message = buildNoRecipeMessage('Missing equipment: blender');
  return message.includes('equipment');
});

test('No recipe message for generic constraint', () => {
  const message = buildNoRecipeMessage('No matching recipes');
  return message.includes('recipe') || message.includes('inventory');
});

test('Unknown intent message includes help options', () => {
  const message = buildUnknownIntentMessage();
  return (
    message.includes('dinner') &&
    message.includes('bought') &&
    message.includes('Why')
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

console.log('\n✓ All notification nudge tests passed!\n');
