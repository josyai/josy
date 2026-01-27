/**
 * Phase 2: Scripted Test Scenarios
 *
 * These tests verify the DPE produces different plans when inputs change.
 * Run with: npx ts-node scripts/test-scenarios.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function createHousehold(name: string): Promise<string> {
  const result = await apiCall('POST', '/v1/households', {
    name,
    timezone: 'America/New_York',
  }) as { id: string };
  return result.id;
}

async function addInventoryItem(householdId: string, item: {
  canonical_name: string;
  display_name: string;
  quantity: number;
  unit: string;
  expiration_date?: string;
  location?: string;
}): Promise<string> {
  const result = await apiCall('POST', '/v1/inventory/items', {
    household_id: householdId,
    ...item,
  }) as { id: string };
  return result.id;
}

async function planTonight(householdId: string, calendarBlocks?: Array<{
  starts_at: string;
  ends_at: string;
  title?: string;
}>, nowTs?: string): Promise<{ recipe_slug: string; reasoning_trace: unknown } | null> {
  try {
    const result = await apiCall('POST', '/v1/plan/tonight', {
      household_id: householdId,
      calendar_blocks: calendarBlocks || [],
      now_ts: nowTs,
    }) as { recipe: { slug: string }; reasoning_trace: unknown };
    return { recipe_slug: result.recipe.slug, reasoning_trace: result.reasoning_trace };
  } catch (e) {
    const error = e as Error;
    if (error.message.includes('NO_ELIGIBLE_RECIPE') || error.message.includes('NO_FEASIBLE_TIME_WINDOW')) {
      return null;
    }
    throw e;
  }
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function getNextWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// ============================================================
// TEST SCENARIO 1: INVENTORY SENSITIVITY
// With frozen peas → salmon recipe, Without peas → different recipe
// ============================================================
async function testInventorySensitivity(): Promise<TestResult> {
  const testName = '1. Inventory Sensitivity';
  console.log(`\n--- ${testName} ---`);

  try {
    // Scenario A: WITH frozen peas + salmon → should pick sheet-pan-salmon-peas
    const householdA = await createHousehold(`test-inv-A-${Date.now()}`);
    console.log(`Created household A: ${householdA}`);

    await addInventoryItem(householdA, {
      canonical_name: 'frozen peas',
      display_name: 'Frozen Peas',
      quantity: 200,
      unit: 'g',
      expiration_date: getToday(), // Expiring today for urgency
      location: 'freezer',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'salmon fillet',
      display_name: 'Salmon Fillet',
      quantity: 400,
      unit: 'g',
      expiration_date: getToday(), // Expiring today
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'olive oil',
      display_name: 'Olive Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });

    console.log('Scenario A: With frozen peas + salmon');
    const planA = await planTonight(householdA);
    console.log(`  Selected recipe: ${planA?.recipe_slug}`);

    // Scenario B: WITHOUT frozen peas (only salmon) → should pick different recipe
    const householdB = await createHousehold(`test-inv-B-${Date.now()}`);
    console.log(`Created household B: ${householdB}`);

    // Add ingredients for a different recipe (eggs + tomatoes for omelet)
    await addInventoryItem(householdB, {
      canonical_name: 'eggs',
      display_name: 'Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getToday(),
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'tomato',
      display_name: 'Fresh Tomatoes',
      quantity: 300,
      unit: 'g',
      expiration_date: getToday(),
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'bread',
      display_name: 'Bread',
      quantity: 4,
      unit: 'pcs',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'butter',
      display_name: 'Butter',
      quantity: 100,
      unit: 'g',
      location: 'fridge',
    });

    console.log('Scenario B: Without frozen peas/salmon (eggs, tomatoes instead)');
    const planB = await planTonight(householdB);
    console.log(`  Selected recipe: ${planB?.recipe_slug}`);

    // Verify different recipes were selected
    const passed = planA !== null && planB !== null && planA.recipe_slug !== planB.recipe_slug;
    const details = `Plan A: ${planA?.recipe_slug}, Plan B: ${planB?.recipe_slug}`;

    console.log(`Result: ${passed ? 'PASSED' : 'FAILED'} - ${details}`);
    return { name: testName, passed, details };

  } catch (error) {
    const err = error as Error;
    console.log(`Result: FAILED - ${err.message}`);
    return { name: testName, passed: false, details: err.message };
  }
}

// ============================================================
// TEST SCENARIO 2: EXPIRY SENSITIVITY
// Item expiring today → prioritized, Expiry pushed out → different recipe
// ============================================================
async function testExpirySensitivity(): Promise<TestResult> {
  const testName = '2. Expiry Sensitivity';
  console.log(`\n--- ${testName} ---`);

  try {
    // Scenario A: Chicken expiring TODAY → should prioritize stir-fry-chicken
    const householdA = await createHousehold(`test-exp-A-${Date.now()}`);
    console.log(`Created household A: ${householdA}`);

    await addInventoryItem(householdA, {
      canonical_name: 'chicken breast',
      display_name: 'Chicken Breast',
      quantity: 500,
      unit: 'g',
      expiration_date: getToday(), // Expiring TODAY - high urgency
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'frozen mixed vegetables',
      display_name: 'Mixed Veggies',
      quantity: 200,
      unit: 'g',
      expiration_date: getNextWeek(),
      location: 'freezer',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'soy sauce',
      display_name: 'Soy Sauce',
      quantity: 100,
      unit: 'ml',
      location: 'pantry',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'vegetable oil',
      display_name: 'Vegetable Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
    // Also add eggs (not expiring) for tomato-omelet option
    await addInventoryItem(householdA, {
      canonical_name: 'eggs',
      display_name: 'Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getNextWeek(), // NOT expiring
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'tomato',
      display_name: 'Tomatoes',
      quantity: 200,
      unit: 'g',
      expiration_date: getNextWeek(),
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'bread',
      display_name: 'Bread',
      quantity: 4,
      unit: 'pcs',
      location: 'pantry',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'butter',
      display_name: 'Butter',
      quantity: 100,
      unit: 'g',
      location: 'fridge',
    });

    console.log('Scenario A: Chicken expiring TODAY, eggs not expiring');
    const planA = await planTonight(householdA);
    console.log(`  Selected recipe: ${planA?.recipe_slug}`);

    // Scenario B: Chicken NOT expiring, eggs expiring TODAY → should prioritize eggs
    const householdB = await createHousehold(`test-exp-B-${Date.now()}`);
    console.log(`Created household B: ${householdB}`);

    await addInventoryItem(householdB, {
      canonical_name: 'chicken breast',
      display_name: 'Chicken Breast',
      quantity: 500,
      unit: 'g',
      expiration_date: getNextWeek(), // NOT expiring - low urgency
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'frozen mixed vegetables',
      display_name: 'Mixed Veggies',
      quantity: 200,
      unit: 'g',
      expiration_date: getNextWeek(),
      location: 'freezer',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'soy sauce',
      display_name: 'Soy Sauce',
      quantity: 100,
      unit: 'ml',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'vegetable oil',
      display_name: 'Vegetable Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'eggs',
      display_name: 'Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getToday(), // EXPIRING TODAY - high urgency
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'tomato',
      display_name: 'Tomatoes',
      quantity: 200,
      unit: 'g',
      expiration_date: getToday(), // Also expiring
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'bread',
      display_name: 'Bread',
      quantity: 4,
      unit: 'pcs',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'butter',
      display_name: 'Butter',
      quantity: 100,
      unit: 'g',
      location: 'fridge',
    });

    console.log('Scenario B: Chicken NOT expiring, eggs expiring TODAY');
    const planB = await planTonight(householdB);
    console.log(`  Selected recipe: ${planB?.recipe_slug}`);

    // Verify different recipes were selected due to expiry urgency
    const passed = planA !== null && planB !== null && planA.recipe_slug !== planB.recipe_slug;
    const details = `Plan A (chicken urgent): ${planA?.recipe_slug}, Plan B (eggs urgent): ${planB?.recipe_slug}`;

    console.log(`Result: ${passed ? 'PASSED' : 'FAILED'} - ${details}`);
    return { name: testName, passed, details };

  } catch (error) {
    const err = error as Error;
    console.log(`Result: FAILED - ${err.message}`);
    return { name: testName, passed: false, details: err.message };
  }
}

// ============================================================
// TEST SCENARIO 3: CALENDAR SENSITIVITY
// Full window → longer recipes allowed, 15-min window → only quick recipes
// Default dinner window is 18:00-21:00 (6 PM - 9 PM) LOCAL TIME
// Household timezone is America/New_York (UTC-5 in winter)
// ============================================================
async function testCalendarSensitivity(): Promise<TestResult> {
  const testName = '3. Calendar Sensitivity';
  console.log(`\n--- ${testName} ---`);

  try {
    // Use a fixed now_ts at 5:30 PM Eastern (22:30 UTC in winter, EST is UTC-5)
    // This ensures the dinner window 6:00-9:00 PM ET is fully available
    const today = getToday();
    // 5:30 PM EST = 22:30 UTC
    const fixedNowTs = `${today}T22:30:00.000Z`;

    // Scenario A: Full evening free → can pick longer recipes (sheet-pan-salmon: 35 min)
    const householdA = await createHousehold(`test-cal-A-${Date.now()}`);
    console.log(`Created household A: ${householdA}`);

    // Add inventory for sheet-pan-salmon (35 min) - with high urgency
    await addInventoryItem(householdA, {
      canonical_name: 'salmon fillet',
      display_name: 'Salmon',
      quantity: 400,
      unit: 'g',
      expiration_date: getToday(), // HIGH urgency
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'frozen peas',
      display_name: 'Frozen Peas',
      quantity: 200,
      unit: 'g',
      expiration_date: getToday(), // HIGH urgency
      location: 'freezer',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'olive oil',
      display_name: 'Olive Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
    // Also add quick recipe ingredients with lower urgency
    await addInventoryItem(householdA, {
      canonical_name: 'eggs',
      display_name: 'Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getNextWeek(), // LOW urgency
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'tomato',
      display_name: 'Tomatoes',
      quantity: 200,
      unit: 'g',
      expiration_date: getNextWeek(), // LOW urgency
      location: 'fridge',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'bread',
      display_name: 'Bread',
      quantity: 4,
      unit: 'pcs',
      location: 'pantry',
    });
    await addInventoryItem(householdA, {
      canonical_name: 'butter',
      display_name: 'Butter',
      quantity: 100,
      unit: 'g',
      location: 'fridge',
    });

    console.log('Scenario A: Full evening free (no calendar blocks)');
    const planA = await planTonight(householdA, [], fixedNowTs);
    console.log(`  Selected recipe: ${planA?.recipe_slug}`);

    // Scenario B: Only 15-min window → must pick quick recipes, cannot do salmon (35 min)
    const householdB = await createHousehold(`test-cal-B-${Date.now()}`);
    console.log(`Created household B: ${householdB}`);

    // Same inventory as A
    await addInventoryItem(householdB, {
      canonical_name: 'salmon fillet',
      display_name: 'Salmon',
      quantity: 400,
      unit: 'g',
      expiration_date: getToday(),
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'frozen peas',
      display_name: 'Frozen Peas',
      quantity: 200,
      unit: 'g',
      expiration_date: getToday(),
      location: 'freezer',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'olive oil',
      display_name: 'Olive Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'eggs',
      display_name: 'Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getNextWeek(),
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'tomato',
      display_name: 'Tomatoes',
      quantity: 200,
      unit: 'g',
      expiration_date: getNextWeek(),
      location: 'fridge',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'bread',
      display_name: 'Bread',
      quantity: 4,
      unit: 'pcs',
      location: 'pantry',
    });
    await addInventoryItem(householdB, {
      canonical_name: 'butter',
      display_name: 'Butter',
      quantity: 100,
      unit: 'g',
      location: 'fridge',
    });

    // Block most of the evening, leaving only a 15-min slot
    // Dinner window is 18:00-21:00 EST. Block from 18:15-21:00 EST leaving only 15 min.
    // 18:15 EST = 23:15 UTC, 21:00 EST = 02:00 UTC next day
    const blockStart = `${today}T23:15:00.000Z`;
    const blockEnd = `${getTomorrow()}T02:00:00.000Z`;

    console.log('Scenario B: Only 15-min window (18:00-18:15 ET)');
    const planB = await planTonight(householdB, [{
      starts_at: blockStart,
      ends_at: blockEnd,
      title: 'Busy evening',
    }], fixedNowTs);

    if (planB === null) {
      // If no recipe fits in 15 min, that's valid (salmon needs 35 min)
      console.log('  No recipe fits in 15-min window');
      console.log(`Result: PASSED - Plan A: ${planA?.recipe_slug}, Plan B: No feasible recipe (time constraint)`);
      return {
        name: testName,
        passed: true,
        details: `Plan A: ${planA?.recipe_slug}, Plan B: No feasible recipe (correctly rejected due to time)`
      };
    }

    console.log(`  Selected recipe: ${planB?.recipe_slug}`);

    // Verify: either different recipes selected, or planB is null (no time)
    const passed = planA !== null && (planB === null || planA.recipe_slug !== planB.recipe_slug);
    const details = `Plan A (full eve): ${planA?.recipe_slug}, Plan B (15min): ${planB?.recipe_slug || 'none'}`;

    console.log(`Result: ${passed ? 'PASSED' : 'FAILED'} - ${details}`);
    return { name: testName, passed, details };

  } catch (error) {
    const err = error as Error;
    console.log(`Result: FAILED - ${err.message}`);
    return { name: testName, passed: false, details: err.message };
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('='.repeat(60));
  console.log('Phase 2: Scripted Test Scenarios');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toISOString()}`);

  const results: TestResult[] = [];

  results.push(await testInventorySensitivity());
  results.push(await testExpirySensitivity());
  results.push(await testCalendarSensitivity());

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  for (const result of results) {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${result.name}`);
    console.log(`       ${result.details}`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! DPE is input-sensitive.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Review DPE logic.');
    process.exit(1);
  }
}

main().catch(console.error);
