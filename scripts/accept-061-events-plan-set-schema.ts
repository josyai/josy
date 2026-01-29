/**
 * Acceptance Script: v0.6.1 PlanSet Event Schema
 *
 * Tests that PlanSet events use correct event types and payload keys:
 * - plan_set_proposed with plan_set_id (not plan_id)
 * - plan_set_confirmed with plan_set_id
 * - plan_set_item_swapped with plan_set_id, date_local
 * - plan_set_overridden with plan_set_id, reason
 *
 * Run with: npx ts-node scripts/accept-061-events-plan-set-schema.ts
 */

import { EventTypesV06 } from '../src/types';
import { emitEventV06 } from '../src/services/events';
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
  console.log('\n=== v0.6.1 PlanSet Event Schema Tests ===\n');

  // Test household ID for events (must be valid UUID)
  const testHouseholdId = '00000000-0000-0000-0000-000000000061';

  // Clean up any previous test events
  await prisma.eventLog.deleteMany({
    where: { householdId: testHouseholdId },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Event Type Constants
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. Event Type Constants Tests');

  await test('PLAN_SET_PROPOSED is correct string', () => {
    return EventTypesV06.PLAN_SET_PROPOSED === 'plan_set_proposed';
  }, 'Should be "plan_set_proposed"');

  await test('PLAN_SET_CONFIRMED is correct string', () => {
    return EventTypesV06.PLAN_SET_CONFIRMED === 'plan_set_confirmed';
  }, 'Should be "plan_set_confirmed"');

  await test('PLAN_SET_ITEM_SWAPPED is correct string', () => {
    return EventTypesV06.PLAN_SET_ITEM_SWAPPED === 'plan_set_item_swapped';
  }, 'Should be "plan_set_item_swapped"');

  await test('PLAN_SET_OVERRIDDEN is correct string', () => {
    return EventTypesV06.PLAN_SET_OVERRIDDEN === 'plan_set_overridden';
  }, 'Should be "plan_set_overridden"');

  await test('CONSUMPTION_LOGGED is correct string', () => {
    return EventTypesV06.CONSUMPTION_LOGGED === 'consumption_logged';
  }, 'Should be "consumption_logged"');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Event Emission with Correct Payloads
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Event Emission Tests');

  await test('plan_set_proposed emits with plan_set_id', async () => {
    const result = await emitEventV06({
      householdId: testHouseholdId,
      eventType: EventTypesV06.PLAN_SET_PROPOSED,
      payload: {
        plan_set_id: 'ps-test-001',
        horizon: { mode: 'NEXT_N_DINNERS', n_dinners: 3 },
        recipe_slugs: ['recipe-a', 'recipe-b', 'recipe-c'],
      },
    });

    // Verify event was written to DB with correct structure
    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;
    const payload = event.payload as Record<string, unknown>;
    return (
      event.eventType === 'plan_set_proposed' &&
      payload.plan_set_id === 'ps-test-001' &&
      Array.isArray(payload.recipe_slugs)
    );
  }, 'Should emit plan_set_proposed with plan_set_id in payload');

  await test('plan_set_confirmed emits with plan_set_id', async () => {
    const result = await emitEventV06({
      householdId: testHouseholdId,
      eventType: EventTypesV06.PLAN_SET_CONFIRMED,
      payload: {
        plan_set_id: 'ps-test-002',
      },
    });

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;
    const payload = event.payload as Record<string, unknown>;
    return (
      event.eventType === 'plan_set_confirmed' &&
      payload.plan_set_id === 'ps-test-002'
    );
  }, 'Should emit plan_set_confirmed with plan_set_id');

  await test('plan_set_item_swapped emits with correct fields', async () => {
    const result = await emitEventV06({
      householdId: testHouseholdId,
      eventType: EventTypesV06.PLAN_SET_ITEM_SWAPPED,
      payload: {
        plan_set_id: 'ps-test-003',
        date_local: '2026-01-29',
        old_recipe_slug: 'old-recipe',
        new_recipe_slug: 'new-recipe',
      },
    });

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;
    const payload = event.payload as Record<string, unknown>;
    return (
      event.eventType === 'plan_set_item_swapped' &&
      payload.plan_set_id === 'ps-test-003' &&
      payload.date_local === '2026-01-29' &&
      payload.old_recipe_slug === 'old-recipe' &&
      payload.new_recipe_slug === 'new-recipe'
    );
  }, 'Should emit plan_set_item_swapped with all required fields');

  await test('plan_set_overridden emits with plan_set_id and reason', async () => {
    const result = await emitEventV06({
      householdId: testHouseholdId,
      eventType: EventTypesV06.PLAN_SET_OVERRIDDEN,
      payload: {
        plan_set_id: 'ps-test-004',
        reason: 'inventory_change',
      },
    });

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;
    const payload = event.payload as Record<string, unknown>;
    return (
      event.eventType === 'plan_set_overridden' &&
      payload.plan_set_id === 'ps-test-004' &&
      payload.reason === 'inventory_change'
    );
  }, 'Should emit plan_set_overridden with plan_set_id and reason');

  await test('consumption_logged emits with correct structure', async () => {
    const result = await emitEventV06({
      householdId: testHouseholdId,
      eventType: EventTypesV06.CONSUMPTION_LOGGED,
      payload: {
        plan_id: 'plan-test-001',
        recipe_slug: 'test-recipe',
        date_local: '2026-01-28',
        ingredients_used: ['chicken', 'rice', 'vegetables'],
        tags: ['asian', 'quick'],
      },
    });

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    if (!event) return false;
    const payload = event.payload as Record<string, unknown>;
    return (
      event.eventType === 'consumption_logged' &&
      payload.recipe_slug === 'test-recipe' &&
      payload.date_local === '2026-01-28' &&
      Array.isArray(payload.ingredients_used) &&
      Array.isArray(payload.tags)
    );
  }, 'Should emit consumption_logged with all fields');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Event Querying
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. Event Querying Tests');

  await test('Can query plan_set events by type', async () => {
    const events = await prisma.eventLog.findMany({
      where: {
        householdId: testHouseholdId,
        eventType: 'plan_set_proposed',
      },
    });

    return events.length >= 1;
  }, 'Should find plan_set_proposed events');

  await test('All test events have correct household', async () => {
    const events = await prisma.eventLog.findMany({
      where: { householdId: testHouseholdId },
    });

    return events.every((e) => e.householdId === testHouseholdId);
  }, 'All events should belong to test household');

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  // Clean up test events
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
