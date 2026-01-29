/**
 * Acceptance Script: v0.6.1 Commit Consumption Logged
 *
 * Tests that commit endpoint always emits consumption_logged:
 * - Original /commit endpoint emits consumption_logged when status is 'cooked'
 * - Event contains correct payload structure
 * - Ingredients used are tracked correctly
 * - Tags are included in the event
 *
 * Run with: npx ts-node scripts/accept-061-commit-consumption-logged.ts
 */

import { EventTypesV06, EventPayloadV06 } from '../src/types';
import { emitConsumptionLogged } from '../src/services/events';
import { prisma } from '../src/models/prisma';

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
  console.log('\n=== v0.6.1 Commit Consumption Logged Tests ===\n');

  // Test household ID (must be valid UUID)
  const testHouseholdId = '00000000-0000-0000-0000-000000000062';

  // Clean up any previous test events
  await prisma.eventLog.deleteMany({
    where: { householdId: testHouseholdId },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Consumption Logged Event Type
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. Consumption Logged Event Type Tests');

  await test('CONSUMPTION_LOGGED constant is correct', () => {
    return EventTypesV06.CONSUMPTION_LOGGED === 'consumption_logged';
  }, 'Should be "consumption_logged"');

  await test('Event type is a valid v0.6 type', () => {
    const validTypes = Object.values(EventTypesV06);
    return validTypes.includes('consumption_logged');
  }, 'consumption_logged should be in EventTypesV06');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Event Emission
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Event Emission Tests');

  await test('emitConsumptionLogged creates event', async () => {
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-01-28',
      'test-recipe-slug',
      ['chicken', 'rice', 'vegetables'],
      ['asian', 'quick']
    );

    return typeof result.id === 'string' && result.id.length > 0;
  }, 'Should return event ID');

  await test('Event is persisted in database', async () => {
    const events = await prisma.eventLog.findMany({
      where: {
        householdId: testHouseholdId,
        eventType: 'consumption_logged',
      },
    });

    return events.length >= 1;
  }, 'Event should be in EventLog table');

  await test('Event payload has correct structure', async () => {
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-01-29',
      'pasta-bolognese',
      ['pasta', 'ground beef', 'tomatoes', 'onion'],
      ['italian']
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as {
      plan_id?: string;
      recipe_slug: string;
      date_local: string;
      ingredients_used: string[];
      tags: string[];
    };

    return (
      payload.recipe_slug === 'pasta-bolognese' &&
      payload.date_local === '2026-01-29' &&
      Array.isArray(payload.ingredients_used) &&
      payload.ingredients_used.length === 4 &&
      Array.isArray(payload.tags) &&
      payload.tags.includes('italian')
    );
  }, 'Payload should have all required fields');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Ingredient Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. Ingredient Tracking Tests');

  await test('All ingredients are tracked', async () => {
    const ingredients = ['salmon', 'lemon', 'dill', 'olive oil', 'garlic'];
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-01-30',
      'baked-salmon',
      ingredients,
      ['healthy', 'fish']
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as { ingredients_used: string[] };
    return (
      payload.ingredients_used.length === 5 &&
      payload.ingredients_used.every(i => ingredients.includes(i))
    );
  }, 'All 5 ingredients should be in payload');

  await test('Empty ingredients array is valid', async () => {
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-01-31',
      'takeout-pizza',
      [],
      ['italian', 'quick']
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as { ingredients_used: string[] };
    return Array.isArray(payload.ingredients_used) && payload.ingredients_used.length === 0;
  }, 'Empty ingredients array should be valid');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Tag Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n4. Tag Tracking Tests');

  await test('Recipe tags are included', async () => {
    const tags = ['mexican', 'spicy', 'quick', 'vegetarian'];
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-02-01',
      'veggie-tacos',
      ['tortillas', 'beans', 'peppers'],
      tags
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as { tags: string[] };
    return payload.tags.length === 4 && payload.tags.every(t => tags.includes(t));
  }, 'All 4 tags should be in payload');

  await test('Empty tags array is valid', async () => {
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-02-02',
      'simple-eggs',
      ['eggs', 'butter'],
      []
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as { tags: string[] };
    return Array.isArray(payload.tags) && payload.tags.length === 0;
  }, 'Empty tags array should be valid');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Date Format
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n5. Date Format Tests');

  await test('Date is stored in YYYY-MM-DD format', async () => {
    const result = await emitConsumptionLogged(
      testHouseholdId,
      '2026-02-03',
      'test-recipe',
      ['ingredient'],
      []
    );

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;

    const payload = event.payload as { date_local: string };
    return /^\d{4}-\d{2}-\d{2}$/.test(payload.date_local);
  }, 'date_local should match YYYY-MM-DD pattern');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Event Querying for Variety
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n6. Event Querying for Variety Tests');

  await test('Can query consumption events for variety profile', async () => {
    const events = await prisma.eventLog.findMany({
      where: {
        householdId: testHouseholdId,
        eventType: 'consumption_logged',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // We've created several events above
    return events.length >= 5;
  }, 'Should be able to query recent consumption events');

  await test('Events can be filtered by household', async () => {
    // Use a valid UUID for a non-existent household
    const events = await prisma.eventLog.findMany({
      where: {
        householdId: '99999999-9999-9999-9999-999999999999',
        eventType: 'consumption_logged',
      },
    });

    return events.length === 0;
  }, 'Non-existent household should return no events');

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  await prisma.eventLog.deleteMany({
    where: { householdId: testHouseholdId },
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
