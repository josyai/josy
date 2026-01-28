/**
 * Acceptance Script: Events Module
 *
 * Tests:
 * - emitEvent() creates events
 * - Convenience functions (emitPlanProposed, emitInventoryAdded, etc.)
 * - getEvents() retrieves events with filtering
 * - Preference snapshots
 *
 * Note: These tests require a running database connection.
 * Run with: npx ts-node scripts/accept-events-preferences.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../src/models/prisma';
import {
  emitEvent,
  emitPlanProposed,
  emitPlanConfirmed,
  emitPlanCommitted,
  emitInventoryAdded,
  emitInventoryUsed,
  getEvents,
  savePreferenceSnapshot,
  getLatestPreferenceSnapshot,
  EventTypes,
} from '../src/services/events';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean>, details?: string): Promise<void> {
  try {
    const passed = await fn();
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

async function runTests() {
  console.log('\n=== Events & Preferences Acceptance Tests ===\n');

  // Create a test household for these tests
  const testHouseholdId = uuidv4();
  const testPlanId = uuidv4();
  const testItemId = uuidv4();

  // Setup: Create test household
  try {
    await prisma.household.create({
      data: {
        id: testHouseholdId,
        timezone: 'America/New_York',
      },
    });
  } catch (e) {
    console.log('Note: Could not create test household (may already exist)');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: emitEvent
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. emitEvent() Tests');

  await test('emitEvent returns id and timestamp', async () => {
    const result = await emitEvent({
      householdId: testHouseholdId,
      eventType: EventTypes.PLAN_PROPOSED,
      payload: { plan_id: testPlanId, recipe_slug: 'test-recipe' },
    });
    return result.id !== undefined && result.timestamp !== undefined;
  });

  await test('emitEvent persists to database', async () => {
    const result = await emitEvent({
      householdId: testHouseholdId,
      eventType: EventTypes.PLAN_PROPOSED,
      payload: { plan_id: testPlanId, recipe_slug: 'test-recipe' },
    });

    const event = await prisma.eventLog.findUnique({
      where: { id: result.id },
    });

    return event !== null && event.eventType === EventTypes.PLAN_PROPOSED;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Convenience Functions
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Convenience Function Tests');

  await test('emitPlanProposed creates correct event type', async () => {
    const result = await emitPlanProposed(testHouseholdId, testPlanId, 'salmon-with-peas');
    const event = await prisma.eventLog.findUnique({ where: { id: result.id } });
    return event?.eventType === EventTypes.PLAN_PROPOSED;
  });

  await test('emitPlanConfirmed creates correct event type', async () => {
    const result = await emitPlanConfirmed(testHouseholdId, testPlanId, 'salmon-with-peas');
    const event = await prisma.eventLog.findUnique({ where: { id: result.id } });
    return event?.eventType === EventTypes.PLAN_CONFIRMED;
  });

  await test('emitPlanCommitted creates correct event type', async () => {
    const result = await emitPlanCommitted(testHouseholdId, testPlanId, 'salmon-with-peas', 'cooked');
    const event = await prisma.eventLog.findUnique({ where: { id: result.id } });
    return event?.eventType === EventTypes.PLAN_COMMITTED;
  });

  await test('emitInventoryAdded creates correct event type', async () => {
    const result = await emitInventoryAdded(testHouseholdId, testItemId, 'salmon fillet', 2, 'pcs');
    const event = await prisma.eventLog.findUnique({ where: { id: result.id } });
    return event?.eventType === EventTypes.INVENTORY_ADDED;
  });

  await test('emitInventoryUsed creates correct event type', async () => {
    const result = await emitInventoryUsed(testHouseholdId, testItemId, 'salmon fillet', 2);
    const event = await prisma.eventLog.findUnique({ where: { id: result.id } });
    return event?.eventType === EventTypes.INVENTORY_USED;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: getEvents
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. getEvents() Tests');

  await test('getEvents returns events for household', async () => {
    const events = await getEvents(testHouseholdId);
    return events.length > 0;
  });

  await test('getEvents filters by eventType', async () => {
    const events = await getEvents(testHouseholdId, {
      eventType: EventTypes.PLAN_PROPOSED,
    });
    return events.every((e) => e.eventType === EventTypes.PLAN_PROPOSED);
  });

  await test('getEvents respects limit', async () => {
    const events = await getEvents(testHouseholdId, { limit: 2 });
    return events.length <= 2;
  });

  await test('getEvents orders by createdAt desc', async () => {
    const events = await getEvents(testHouseholdId, { limit: 5 });
    if (events.length < 2) return true; // Not enough events to test
    return events[0].createdAt >= events[1].createdAt;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Preference Snapshots
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n4. Preference Snapshot Tests');

  await test('savePreferenceSnapshot creates snapshot', async () => {
    const snapshotId = await savePreferenceSnapshot(testHouseholdId, {
      preferredCuisines: ['italian', 'mexican'],
      dietaryRestrictions: [],
    });
    return snapshotId !== undefined && snapshotId.length > 0;
  });

  await test('getLatestPreferenceSnapshot returns latest', async () => {
    // Create two snapshots
    await savePreferenceSnapshot(testHouseholdId, { version: 1 });
    await new Promise((r) => setTimeout(r, 100)); // Small delay
    await savePreferenceSnapshot(testHouseholdId, { version: 2 });

    const latest = await getLatestPreferenceSnapshot(testHouseholdId);
    const snapshotData = latest?.snapshotJson as { version: number };
    return snapshotData.version === 2;
  });

  await test('getLatestPreferenceSnapshot returns null for new household', async () => {
    const newHouseholdId = uuidv4();
    const result = await getLatestPreferenceSnapshot(newHouseholdId);
    return result === null;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  // Clean up test data
  try {
    await prisma.preferenceSnapshot.deleteMany({ where: { householdId: testHouseholdId } });
    await prisma.eventLog.deleteMany({ where: { householdId: testHouseholdId } });
    await prisma.household.delete({ where: { id: testHouseholdId } });
  } catch (e) {
    console.log('Note: Could not clean up test data');
  }

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
  }

  await prisma.$disconnect();

  if (!allPassed) {
    process.exit(1);
  }

  console.log('\n✓ All events & preferences tests passed!\n');
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
