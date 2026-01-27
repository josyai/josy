/**
 * Phase 2: End-to-End Demo Script
 *
 * This script demonstrates the complete Josy workflow:
 * 1. Create a household
 * 2. Add inventory items (with urgency)
 * 3. Request a dinner plan
 * 4. Show the reasoning trace
 * 5. Commit the plan
 * 6. Verify inventory was consumed
 * 7. Demonstrate re-plan trigger on inventory change
 *
 * Run with: npx ts-node scripts/demo.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface ApiResponse {
  [key: string]: unknown;
}

async function apiCall(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`API Error ${response.status}: ${text}`);
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (response.status === 204 || !text) return {};
  return JSON.parse(text);
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

function printSection(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printJson(label: string, data: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Josy End-to-End Demo');
  console.log('='.repeat(60));
  console.log(`API URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toISOString()}`);

  // ===== STEP 1: Create Household =====
  printSection('STEP 1: Create Household');

  const householdName = `Demo Household ${Date.now()}`;
  const household = await apiCall('POST', '/v1/households', {
    name: householdName,
    timezone: 'America/New_York',
  }) as { id: string; timezone: string };

  console.log(`Created household: ${householdName}`);
  console.log(`  ID: ${household.id}`);
  console.log(`  Timezone: ${household.timezone}`);

  const householdId = household.id;

  // ===== STEP 2: Add Inventory Items =====
  printSection('STEP 2: Add Inventory Items');

  // Add items with different urgencies
  const inventoryItems = [
    {
      canonical_name: 'salmon fillet',
      display_name: 'Fresh Atlantic Salmon',
      quantity: 400,
      unit: 'g',
      expiration_date: getToday(), // URGENT - expires today!
      location: 'fridge',
    },
    {
      canonical_name: 'frozen peas',
      display_name: 'Frozen Green Peas',
      quantity: 300,
      unit: 'g',
      expiration_date: getTomorrow(), // Semi-urgent
      location: 'freezer',
    },
    {
      canonical_name: 'olive oil',
      display_name: 'Extra Virgin Olive Oil',
      quantity: 500,
      unit: 'ml',
      // No expiration - pantry item
      location: 'pantry',
    },
    {
      canonical_name: 'eggs',
      display_name: 'Organic Eggs',
      quantity: 6,
      unit: 'pcs',
      expiration_date: getNextWeek(), // Not urgent
      location: 'fridge',
    },
    {
      canonical_name: 'tomato',
      display_name: 'Roma Tomatoes',
      quantity: 400,
      unit: 'g',
      expiration_date: getNextWeek(),
      location: 'fridge',
    },
    {
      canonical_name: 'butter',
      display_name: 'Unsalted Butter',
      quantity: 200,
      unit: 'g',
      location: 'fridge',
    },
    {
      canonical_name: 'bread',
      display_name: 'Sourdough Bread',
      quantity: 8,
      unit: 'pcs',
      location: 'pantry',
    },
  ];

  console.log('Adding inventory items:');
  for (const item of inventoryItems) {
    const result = await apiCall('POST', '/v1/inventory/items', {
      household_id: householdId,
      ...item,
    });
    console.log(`  + ${item.display_name}: ${item.quantity} ${item.unit}`);
    if (item.expiration_date === getToday()) {
      console.log(`    *** EXPIRES TODAY - will be prioritized ***`);
    }
  }

  // Show current inventory
  const inventory = await apiCall('GET', `/v1/inventory?household_id=${householdId}`) as {
    items: Array<{ canonical_name: string; quantity: number; unit: string; expiration_date: string | null }>;
  };

  console.log(`\nCurrent inventory (${inventory.items.length} items):`);
  for (const item of inventory.items) {
    const expiry = item.expiration_date
      ? item.expiration_date === getToday()
        ? 'TODAY!'
        : item.expiration_date
      : 'n/a';
    console.log(`  - ${item.canonical_name}: ${item.quantity} ${item.unit} (expires: ${expiry})`);
  }

  // ===== STEP 3: Request Dinner Plan =====
  printSection('STEP 3: Request Dinner Plan (POST /v1/plan/tonight)');

  console.log('Requesting plan with no calendar blocks...');
  const plan = await apiCall('POST', '/v1/plan/tonight', {
    household_id: householdId,
    calendar_blocks: [],
  }) as {
    plan_id: string;
    recipe: { slug: string; name: string; total_time_minutes: number };
    why: string[];
    inventory_to_consume: Array<{ canonical_name: string; consumed_quantity: number; unit: string }>;
    grocery_addons: Array<{ canonical_name: string; required_quantity: number; unit: string }>;
    reasoning_trace: {
      winner: string;
      tie_breaker: string | null;
      eligible_recipes: Array<{ recipe: string; scores: { final: number } }>;
      rejected_recipes: Array<{ recipe: string; reason: string }>;
      inventory_snapshot: Array<{ canonical_name: string; urgency: number }>;
    };
  };

  console.log(`\n*** SELECTED RECIPE: ${plan.recipe.name} ***`);
  console.log(`  Slug: ${plan.recipe.slug}`);
  console.log(`  Total time: ${plan.recipe.total_time_minutes} minutes`);
  console.log(`  Plan ID: ${plan.plan_id}`);

  console.log('\nWhy this recipe?');
  for (const reason of plan.why) {
    console.log(`  - ${reason}`);
  }

  console.log('\nInventory to consume:');
  for (const item of plan.inventory_to_consume) {
    console.log(`  - ${item.canonical_name}: ${item.consumed_quantity} ${item.unit}`);
  }

  if (plan.grocery_addons.length > 0) {
    console.log('\nGrocery add-ons needed:');
    for (const item of plan.grocery_addons) {
      console.log(`  - ${item.canonical_name}: ${item.required_quantity} ${item.unit}`);
    }
  } else {
    console.log('\nNo grocery add-ons needed - all ingredients available!');
  }

  // ===== STEP 4: Show Reasoning Trace =====
  printSection('STEP 4: Reasoning Trace (DPE Decision Details)');

  const trace = plan.reasoning_trace;

  console.log('Inventory urgency scores:');
  const urgentItems = trace.inventory_snapshot
    .filter((i) => i.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency);
  for (const item of urgentItems) {
    const urgencyLabel =
      item.urgency >= 4 ? 'CRITICAL' : item.urgency >= 2 ? 'MODERATE' : 'LOW';
    console.log(`  - ${item.canonical_name}: urgency=${item.urgency} (${urgencyLabel})`);
  }

  console.log(`\nWinner: ${trace.winner}`);
  if (trace.tie_breaker) {
    console.log(`Tie-breaker used: ${trace.tie_breaker}`);
  }

  console.log('\nEligible recipes (sorted by score):');
  const sortedEligible = [...trace.eligible_recipes].sort(
    (a, b) => b.scores.final - a.scores.final
  );
  for (const r of sortedEligible) {
    const isWinner = r.recipe === trace.winner ? ' <-- WINNER' : '';
    console.log(`  - ${r.recipe}: score=${r.scores.final.toFixed(2)}${isWinner}`);
  }

  if (trace.rejected_recipes.length > 0) {
    console.log('\nRejected recipes:');
    for (const r of trace.rejected_recipes) {
      console.log(`  - ${r.recipe}: ${r.reason}`);
    }
  }

  // ===== STEP 5: Commit the Plan =====
  printSection('STEP 5: Commit the Plan (POST /v1/plan/{id}/commit)');

  // Record inventory before commit
  const inventoryBeforeCommit = await apiCall('GET', `/v1/inventory?household_id=${householdId}`) as {
    items: Array<{ canonical_name: string; quantity: number; unit: string }>;
  };
  const beforeQuantities = new Map(
    inventoryBeforeCommit.items.map((i) => [i.canonical_name, i.quantity])
  );

  console.log(`Committing plan ${plan.plan_id} with status "cooked"...`);
  const commitResult = await apiCall('POST', `/v1/plan/${plan.plan_id}/commit`, {
    status: 'cooked',
  }) as { status: string; plan_id: string };

  console.log(`Plan committed with status: ${commitResult.status}`);

  // Get inventory after commit to show changes
  const inventoryAfterCommit = await apiCall('GET', `/v1/inventory?household_id=${householdId}`) as {
    items: Array<{ canonical_name: string; quantity: number; unit: string }>;
  };

  console.log('\nInventory changes (items consumed):');
  for (const consumed of plan.inventory_to_consume) {
    const before = beforeQuantities.get(consumed.canonical_name) || 0;
    const afterItem = inventoryAfterCommit.items.find((i) => i.canonical_name === consumed.canonical_name);
    const after = afterItem?.quantity || 0;
    console.log(
      `  - ${consumed.canonical_name}: ${before} -> ${after} ${consumed.unit} (consumed: ${consumed.consumed_quantity})`
    );
  }

  // ===== STEP 6: Verify Inventory Updated =====
  printSection('STEP 6: Verify Inventory Updated');

  console.log(`Inventory after commit (${inventoryAfterCommit.items.length} items with quantity > 0):`);
  for (const item of inventoryAfterCommit.items) {
    console.log(`  - ${item.canonical_name}: ${item.quantity} ${item.unit}`);
  }

  // ===== STEP 7: Demonstrate Re-Plan Trigger =====
  printSection('STEP 7: Demonstrate Re-Plan Trigger');

  console.log('Creating a new plan first...');

  // Add back some salmon to enable a new plan
  await apiCall('POST', '/v1/inventory/items', {
    household_id: householdId,
    canonical_name: 'salmon fillet',
    display_name: 'New Salmon',
    quantity: 300,
    unit: 'g',
    expiration_date: getTomorrow(),
    location: 'fridge',
  });

  const newPlan = await apiCall('POST', '/v1/plan/tonight', {
    household_id: householdId,
    calendar_blocks: [],
  }) as { plan_id: string; recipe: { name: string } };

  console.log(`Created new plan: ${newPlan.plan_id}`);
  console.log(`  Recipe: ${newPlan.recipe.name}`);

  // Now add more inventory - this should invalidate the proposed plan
  console.log('\nAdding more inventory (chicken breast)...');
  const addResult = await apiCall('POST', '/v1/inventory/items', {
    household_id: householdId,
    canonical_name: 'chicken breast',
    display_name: 'Fresh Chicken',
    quantity: 500,
    unit: 'g',
    expiration_date: getToday(), // Very urgent!
    location: 'fridge',
  }) as { plans_invalidated: number };

  console.log(`Inventory added.`);
  console.log(`*** ${addResult.plans_invalidated} proposed plan(s) invalidated ***`);

  if (addResult.plans_invalidated > 0) {
    console.log('\nThe DPE will re-evaluate next time /plan/tonight is called.');
    console.log('The new chicken (expiring today) may change the recommendation!');
  }

  // Request a new plan to show different recommendation
  console.log('\nRequesting new plan after inventory change...');
  const updatedPlan = await apiCall('POST', '/v1/plan/tonight', {
    household_id: householdId,
    calendar_blocks: [],
  }) as { plan_id: string; recipe: { name: string; slug: string } };

  console.log(`New plan created: ${updatedPlan.plan_id}`);
  console.log(`  Recipe: ${updatedPlan.recipe.name} (${updatedPlan.recipe.slug})`);

  // ===== SUMMARY =====
  printSection('DEMO COMPLETE');

  console.log(`
Key observations demonstrated:
1. DPE prioritizes items expiring soon (urgency scoring)
2. Plan commits update inventory quantities
3. Inventory changes invalidate proposed plans (re-plan trigger)
4. Reasoning trace explains decision-making process

The Josy DPE is deterministic and input-sensitive!
`);
}

main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
