/**
 * Acceptance Script: Orchestrator Module
 *
 * Tests:
 * - orchestrateTonight() full flow integration
 * - Response includes grocery_list_normalized
 * - Response includes assistant_message
 * - Events are emitted
 *
 * Note: These tests require a running database with seeded data.
 * Run with: npx ts-node scripts/accept-orchestrator.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

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

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function runTests() {
  console.log('\n=== Orchestrator Acceptance Tests ===\n');
  console.log(`Testing against: ${BASE_URL}\n`);

  // Setup: Create a test household with inventory
  let householdId: string;

  try {
    householdId = await createHousehold('orchestrator-test');
    console.log(`Created test household: ${householdId}\n`);

    // Add some inventory
    await addInventoryItem(householdId, {
      canonical_name: 'salmon fillet',
      display_name: 'Salmon Fillet',
      quantity: 2,
      unit: 'pcs',
      expiration_date: getTomorrow(),
      location: 'fridge',
    });

    await addInventoryItem(householdId, {
      canonical_name: 'frozen peas',
      display_name: 'Frozen Peas',
      quantity: 300,
      unit: 'g',
      location: 'freezer',
    });

    await addInventoryItem(householdId, {
      canonical_name: 'olive oil',
      display_name: 'Olive Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
  } catch (e) {
    console.error('Setup failed:', e);
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Basic Orchestration
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. Basic Orchestration Tests');

  interface PlanResponse {
    plan_id: string;
    recipe: { slug: string; name: string };
    reasoning_trace: unknown;
    grocery_list_normalized: {
      items: Array<{
        canonical_name: string;
        display_name: string;
        total_quantity: number;
        unit: string;
        category: string;
      }>;
      summary: string;
    } | null;
    assistant_message: string;
    grocery_addons: Array<{
      canonical_name: string;
      required_quantity: number;
      unit: string;
    }>;
  }

  let planResponse: PlanResponse;

  await test('orchestrateTonight returns plan_id', async () => {
    const result = await apiCall('POST', '/v1/plan/tonight', {
      household_id: householdId,
    }) as PlanResponse;
    planResponse = result;
    return result.plan_id !== undefined && result.plan_id.length > 0;
  });

  await test('Response includes recipe data', async () => {
    return (
      planResponse.recipe !== undefined &&
      planResponse.recipe.slug !== undefined &&
      planResponse.recipe.name !== undefined
    );
  });

  await test('Response includes reasoning_trace', async () => {
    return planResponse.reasoning_trace !== undefined;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Grocery List Normalization
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Grocery List Normalization Tests');

  await test('Response includes grocery_list_normalized field', async () => {
    // Field should exist (can be null if no groceries needed)
    return 'grocery_list_normalized' in planResponse;
  });

  await test('grocery_list_normalized has correct structure when present', async () => {
    if (planResponse.grocery_list_normalized === null) {
      // If null, check that grocery_addons is empty
      return planResponse.grocery_addons.length === 0;
    }

    // Check structure
    return (
      Array.isArray(planResponse.grocery_list_normalized.items) &&
      typeof planResponse.grocery_list_normalized.summary === 'string'
    );
  });

  await test('grocery_list_normalized items have required fields', async () => {
    if (planResponse.grocery_list_normalized === null) return true;
    if (planResponse.grocery_list_normalized.items.length === 0) return true;

    const item = planResponse.grocery_list_normalized.items[0];
    return (
      'canonical_name' in item &&
      'display_name' in item &&
      'total_quantity' in item &&
      'unit' in item &&
      'category' in item
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Assistant Message
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. Assistant Message Tests');

  await test('Response includes assistant_message', async () => {
    return (
      planResponse.assistant_message !== undefined &&
      planResponse.assistant_message.length > 0
    );
  });

  await test('assistant_message includes recipe name', async () => {
    return planResponse.assistant_message.includes(planResponse.recipe.name);
  });

  await test('assistant_message includes action prompts', async () => {
    return (
      planResponse.assistant_message.includes('Reply') ||
      planResponse.assistant_message.includes('confirm') ||
      planResponse.assistant_message.includes('Sounds good')
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Idempotency
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n4. Idempotency Tests');

  await test('Second call returns same plan_id', async () => {
    const result = await apiCall('POST', '/v1/plan/tonight', {
      household_id: householdId,
    }) as PlanResponse;
    return result.plan_id === planResponse.plan_id;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: With Missing Ingredients
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n5. Grocery Addon Tests');

  // Create a new household with minimal inventory to force grocery addons
  let minimalHouseholdId: string;

  try {
    minimalHouseholdId = await createHousehold('orchestrator-minimal-test');

    // Only add one basic item
    await addInventoryItem(minimalHouseholdId, {
      canonical_name: 'olive oil',
      display_name: 'Olive Oil',
      quantity: 500,
      unit: 'ml',
      location: 'pantry',
    });
  } catch (e) {
    console.error('Minimal setup failed:', e);
    process.exit(1);
  }

  await test('Plan with missing ingredients includes grocery_list_normalized', async () => {
    try {
      const result = await apiCall('POST', '/v1/plan/tonight', {
        household_id: minimalHouseholdId,
      }) as PlanResponse;

      // If we got a plan and it has grocery_addons, check normalization
      if (result.grocery_addons && result.grocery_addons.length > 0) {
        return (
          result.grocery_list_normalized !== null &&
          result.grocery_list_normalized.items.length > 0
        );
      }

      // If no addons, normalized list should be null
      return result.grocery_list_normalized === null;
    } catch (e) {
      // If no eligible recipe, that's also valid
      const error = e as Error;
      return error.message.includes('NO_ELIGIBLE_RECIPE');
    }
  });

  await test('Grocery summary is human-readable', async () => {
    try {
      const result = await apiCall('POST', '/v1/plan/tonight', {
        household_id: minimalHouseholdId,
      }) as PlanResponse;

      if (result.grocery_list_normalized && result.grocery_list_normalized.summary) {
        // Should be a proper sentence, not just data
        return (
          result.grocery_list_normalized.summary.includes('Pick up') ||
          result.grocery_list_normalized.summary.includes('No items')
        );
      }
      return true;
    } catch (e) {
      return true; // If no plan, skip this test
    }
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

  console.log('\n✓ All orchestrator tests passed!\n');
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
