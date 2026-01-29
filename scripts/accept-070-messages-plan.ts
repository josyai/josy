/**
 * Acceptance Script: v0.7 Messages & Plan Response
 *
 * Tests messaging module and plan response:
 * - Message builders produce valid output
 * - Messages are under length limits
 * - Error messages use stable codes
 * - Trace observability fields are present
 *
 * Run with: npx ts-node scripts/accept-070-messages-plan.ts
 */

import {
  buildDayPlanMessage,
  buildPlanSetSummaryMessage,
  buildSwapResultMessage,
  buildConfirmMessage,
  buildErrorMessage,
  extractWhyReasons,
} from '../src/services/messaging';
import { ReasoningTrace, TraceSummary } from '../src/types';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean | Promise<boolean>, details?: string): Promise<void> {
  return Promise.resolve(fn())
    .then((passed) => {
      results.push({ name, passed, details: details || (passed ? 'OK' : 'Failed') });
      console.log(`  ${passed ? '✓' : '✗'} ${name}`);
      if (!passed && details) console.log(`    ${details}`);
    })
    .catch((e) => {
      const error = e as Error;
      results.push({ name, passed: false, details: error.message });
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
    });
}

async function main() {
  console.log('\n=== v0.7 Messages & Plan Response Tests ===\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Day Plan Message
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. Day Plan Message Tests');

  await test('buildDayPlanMessage produces valid string', () => {
    const message = buildDayPlanMessage({
      dateLocal: '2026-01-29',
      recipeName: 'Salmon with Roasted Vegetables',
      totalTimeMinutes: 45,
      whyReasons: ['Uses your salmon', 'Uses expiring vegetables'],
      groceryAddons: [],
    });

    return typeof message === 'string' && message.length > 0;
  });

  await test('Day message includes recipe name', () => {
    const message = buildDayPlanMessage({
      dateLocal: '2026-01-29',
      recipeName: 'Pasta Carbonara',
      totalTimeMinutes: 30,
      whyReasons: ['Quick to prepare'],
      groceryAddons: [],
    });

    return message.includes('Pasta Carbonara');
  });

  await test('Day message includes why reasons', () => {
    const message = buildDayPlanMessage({
      dateLocal: '2026-01-29',
      recipeName: 'Chicken Stir Fry',
      totalTimeMinutes: 25,
      whyReasons: ['Uses your chicken', 'Minimal grocery add-ons'],
      groceryAddons: [],
    });

    return message.includes('Why:') && message.includes('chicken');
  });

  await test('Day message under 600 character limit', () => {
    const message = buildDayPlanMessage({
      dateLocal: '2026-01-29',
      recipeName: 'Very Long Recipe Name That Goes On And On',
      totalTimeMinutes: 120,
      whyReasons: [
        'This is a very long reason that explains in detail why',
        'Another long reason with lots of explanation text',
      ],
      groceryAddons: [
        { canonical_name: 'ingredient_1', required_quantity: 1, unit: 'pcs' },
        { canonical_name: 'ingredient_2', required_quantity: 2, unit: 'pcs' },
        { canonical_name: 'ingredient_3', required_quantity: 3, unit: 'pcs' },
        { canonical_name: 'ingredient_4', required_quantity: 4, unit: 'pcs' },
      ],
    });

    return message.length <= 600;
  }, 'Message exceeds 600 character limit');

  await test('Day message shows grocery add-ons when present', () => {
    const message = buildDayPlanMessage({
      dateLocal: '2026-01-29',
      recipeName: 'Test Recipe',
      totalTimeMinutes: 30,
      whyReasons: ['Test reason'],
      groceryAddons: [
        { canonical_name: 'onion', required_quantity: 2, unit: 'pcs' },
      ],
    });

    return message.includes('Grocery') && message.includes('onion');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Plan Set Summary Message
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Plan Set Summary Message Tests');

  await test('buildPlanSetSummaryMessage produces valid string', () => {
    const message = buildPlanSetSummaryMessage({
      dayCount: 3,
      days: [
        { dateLocal: '2026-01-29', recipeName: 'Recipe A' },
        { dateLocal: '2026-01-30', recipeName: 'Recipe B' },
        { dateLocal: '2026-01-31', recipeName: 'Recipe C' },
      ],
      groceryList: null,
    });

    return typeof message === 'string' && message.length > 0;
  });

  await test('Summary message under 1200 character limit', () => {
    const message = buildPlanSetSummaryMessage({
      dayCount: 7,
      days: [
        { dateLocal: '2026-01-29', recipeName: 'Long Recipe Name One' },
        { dateLocal: '2026-01-30', recipeName: 'Long Recipe Name Two' },
        { dateLocal: '2026-01-31', recipeName: 'Long Recipe Name Three' },
        { dateLocal: '2026-02-01', recipeName: 'Long Recipe Name Four' },
        { dateLocal: '2026-02-02', recipeName: 'Long Recipe Name Five' },
        { dateLocal: '2026-02-03', recipeName: 'Long Recipe Name Six' },
        { dateLocal: '2026-02-04', recipeName: 'Long Recipe Name Seven' },
      ],
      groceryList: {
        items: [
          { canonical_name: 'item1', display_name: 'Item 1', total_quantity: 1, unit: 'pcs', category: 'produce' },
          { canonical_name: 'item2', display_name: 'Item 2', total_quantity: 2, unit: 'pcs', category: 'protein' },
          { canonical_name: 'item3', display_name: 'Item 3', total_quantity: 3, unit: 'pcs', category: 'dairy' },
        ],
        summary: '3 items: Item 1, Item 2, Item 3',
      },
    });

    return message.length <= 1200;
  }, 'Message exceeds 1200 character limit');

  await test('Summary includes all day names', () => {
    const message = buildPlanSetSummaryMessage({
      dayCount: 2,
      days: [
        { dateLocal: '2026-01-29', recipeName: 'Recipe A' },
        { dateLocal: '2026-01-30', recipeName: 'Recipe B' },
      ],
      groceryList: null,
    });

    return message.includes('Recipe A') && message.includes('Recipe B');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Swap Result Message
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. Swap Result Message Tests');

  await test('buildSwapResultMessage produces valid string', () => {
    const message = buildSwapResultMessage({
      dateLocal: '2026-01-29',
      oldRecipeName: 'Old Recipe',
      newRecipeName: 'New Recipe',
      newRecipeTime: 30,
      whyReasons: ['Different ingredients'],
      groceryAddons: [],
    });

    return typeof message === 'string' && message.length > 0;
  });

  await test('Swap message includes old and new recipes', () => {
    const message = buildSwapResultMessage({
      dateLocal: '2026-01-29',
      oldRecipeName: 'Chicken Curry',
      newRecipeName: 'Beef Stir Fry',
      newRecipeTime: 25,
      whyReasons: ['Uses your beef'],
      groceryAddons: [],
    });

    return message.includes('Chicken Curry') && message.includes('Beef Stir Fry');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Confirm Message
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n4. Confirm Message Tests');

  await test('buildConfirmMessage produces valid string', () => {
    const message = buildConfirmMessage({
      dayCount: 3,
      firstRecipeName: 'Pasta Carbonara',
      groceryItemCount: 5,
    });

    return typeof message === 'string' && message.length > 0;
  });

  await test('Confirm message mentions grocery items when present', () => {
    const message = buildConfirmMessage({
      dayCount: 1,
      firstRecipeName: 'Test Recipe',
      groceryItemCount: 3,
    });

    return message.includes('3') && message.toLowerCase().includes('grocery');
  });

  await test('Confirm message handles zero grocery items', () => {
    const message = buildConfirmMessage({
      dayCount: 1,
      firstRecipeName: 'Test Recipe',
      groceryItemCount: 0,
    });

    // Should not mention groceries when count is 0
    return !message.includes('0 grocery');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Error Messages
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n5. Error Message Tests');

  await test('NO_ACTIVE_PLAN error message', () => {
    const message = buildErrorMessage('NO_ACTIVE_PLAN');
    return message.length > 0 && message.includes('plan');
  });

  await test('INVALID_DAY error message', () => {
    const message = buildErrorMessage('INVALID_DAY');
    return message.length > 0 && message.toLowerCase().includes('swap');
  });

  await test('INVALID_DAY with context', () => {
    const message = buildErrorMessage('INVALID_DAY', { day: 'BLURSDAY' });
    return message.includes('BLURSDAY');
  });

  await test('NEEDS_HOUSEHOLD error message', () => {
    const message = buildErrorMessage('NEEDS_HOUSEHOLD');
    return message.length > 0;
  });

  await test('INTERNAL error message', () => {
    const message = buildErrorMessage('INTERNAL');
    return message.length > 0 && message.toLowerCase().includes('wrong');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Extract Why Reasons
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n6. Extract Why Reasons Tests');

  await test('extractWhyReasons returns default when no trace', () => {
    const reasons = extractWhyReasons(null, 'test-recipe');
    return Array.isArray(reasons) && reasons.length > 0;
  });

  await test('extractWhyReasons extracts from trace', () => {
    const trace: ReasoningTrace = {
      version: '0.7',
      generated_at: new Date().toISOString(),
      inventory_snapshot: [],
      calendar_constraints: {
        dinner_window: { start: '18:00', end: '20:00' },
        busy_blocks: [],
        available_minutes: 120,
      },
      eligible_recipes: [
        {
          recipe: 'test-recipe',
          eligible: true,
          rejections: [],
          scores: { waste: 10, grocery_penalty: 0, time_penalty: 0, final: 10 },
          missing_ingredients: [],
          uses_inventory: ['chicken', 'rice'],
        },
      ],
      rejected_recipes: [],
      winner: 'test-recipe',
      tie_breaker: null,
      scoring_details: {
        waste_weight: 1,
        grocery_penalty_per_item: 5,
        time_penalty_factor: 0.1,
      },
    };

    const reasons = extractWhyReasons(trace, 'test-recipe');
    return Array.isArray(reasons) && reasons.length > 0;
  });

  await test('extractWhyReasons max 2 reasons', () => {
    const trace: ReasoningTrace = {
      version: '0.7',
      generated_at: new Date().toISOString(),
      inventory_snapshot: [],
      calendar_constraints: {
        dinner_window: { start: '18:00', end: '20:00' },
        busy_blocks: [],
        available_minutes: 120,
      },
      eligible_recipes: [
        {
          recipe: 'test-recipe',
          eligible: true,
          rejections: [],
          scores: { waste: 10, grocery_penalty: 0, time_penalty: 0, final: 10 },
          missing_ingredients: [],
          uses_inventory: ['a', 'b', 'c', 'd', 'e'],
        },
      ],
      rejected_recipes: [],
      winner: 'test-recipe',
      tie_breaker: null,
      scoring_details: {
        waste_weight: 1,
        grocery_penalty_per_item: 5,
        time_penalty_factor: 0.1,
      },
    };

    const reasons = extractWhyReasons(trace, 'test-recipe');
    return reasons.length <= 2;
  }, 'Should return max 2 reasons');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Trace Summary Structure
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n7. Trace Summary Structure Tests');

  await test('TraceSummary has required fields', () => {
    const summary: TraceSummary = {
      top_factors: ['5 inventory items', '3 recent meals'],
      penalties: ['2026-01-29: 2 variety penalties'],
      kept_days: 1,
      changed_days: 2,
    };

    return (
      Array.isArray(summary.top_factors) &&
      Array.isArray(summary.penalties) &&
      typeof summary.kept_days === 'number' &&
      typeof summary.changed_days === 'number'
    );
  });

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
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
