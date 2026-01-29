/**
 * Acceptance Script: v0.7 WhatsApp Intents
 *
 * Tests intent detection improvements:
 * - Day name normalization (tuesday, TUES, tue → TUE)
 * - Extended confirm variants
 * - Swap pattern recognition
 * - Add intent parsing
 *
 * Run with: npx ts-node scripts/accept-070-whatsapp-intents.ts
 */

import { detectIntent, normalizeDay, Intent } from '../src/services/intent';

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
  console.log('\n=== v0.7 WhatsApp Intents Tests ===\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Day Name Normalization
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('1. Day Name Normalization Tests');

  await test('normalizeDay: "tuesday" → "TUE"', () => {
    return normalizeDay('tuesday') === 'TUE';
  });

  await test('normalizeDay: "TUESDAY" → "TUE"', () => {
    return normalizeDay('TUESDAY') === 'TUE';
  });

  await test('normalizeDay: "tue" → "TUE"', () => {
    return normalizeDay('tue') === 'TUE';
  });

  await test('normalizeDay: "tues" → "TUE"', () => {
    return normalizeDay('tues') === 'TUE';
  });

  await test('normalizeDay: "thursday" → "THU"', () => {
    return normalizeDay('thursday') === 'THU';
  });

  await test('normalizeDay: "thur" → "THU"', () => {
    return normalizeDay('thur') === 'THU';
  });

  await test('normalizeDay: "thurs" → "THU"', () => {
    return normalizeDay('thurs') === 'THU';
  });

  await test('normalizeDay: "tonight" → "TODAY"', () => {
    return normalizeDay('tonight') === 'TODAY';
  });

  await test('normalizeDay: "tomorrow" → "TOMORROW"', () => {
    return normalizeDay('tomorrow') === 'TOMORROW';
  });

  await test('normalizeDay: "monday" → "MON"', () => {
    return normalizeDay('monday') === 'MON';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Confirm Intent Variants
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n2. Confirm Intent Variants Tests');

  const confirmVariants = [
    'confirm',
    'yes',
    'ok',
    'okay',
    'sure',
    'yep',
    'yeah',
    'yup',
    'sounds good',
    'looks good',
    'perfect',
    'great',
    'awesome',
    'done',
    'go for it',
    "let's do it",
    'that works',
    'good',
    'fine',
    'confirm plan',
    'confirm the plan',
    'lock it in',
    "i'm in",
    'yes please',
  ];

  for (const variant of confirmVariants) {
    await test(`Confirm: "${variant}"`, () => {
      const intent = detectIntent(variant);
      return intent.type === 'CONFIRM_PLAN';
    });
  }

  await test('Confirm: "yes that sounds great"', () => {
    const intent = detectIntent('yes that sounds great');
    return intent.type === 'CONFIRM_PLAN';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Swap Intent Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n3. Swap Intent Patterns Tests');

  await test('Swap: "swap tuesday"', () => {
    const intent = detectIntent('swap tuesday');
    return intent.type === 'SWAP_DAY' && intent.day === 'tuesday';
  });

  await test('Swap: "swap TUESDAY" normalizes to TUE', () => {
    const intent = detectIntent('swap TUESDAY');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'TUE';
  });

  await test('Swap: "swap tomorrow"', () => {
    const intent = detectIntent('swap tomorrow');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'TOMORROW';
  });

  await test('Swap: "change monday"', () => {
    const intent = detectIntent('change monday');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'MON';
  });

  await test('Swap: "something else for friday"', () => {
    const intent = detectIntent('something else for friday');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'FRI';
  });

  await test('Swap: "different meal for wednesday"', () => {
    const intent = detectIntent('different meal for wednesday');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'WED';
  });

  await test('Swap: "try something else for sat"', () => {
    const intent = detectIntent('try something else for sat');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'SAT';
  });

  await test('Swap: "another option for sunday"', () => {
    const intent = detectIntent('another option for sunday');
    return intent.type === 'SWAP_DAY' && intent.dayNormalized === 'SUN';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Plan Intent Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n4. Plan Intent Patterns Tests');

  await test('Plan Tonight: "what\'s for dinner"', () => {
    const intent = detectIntent("what's for dinner");
    return intent.type === 'PLAN_TONIGHT';
  });

  await test('Plan Tonight: "dinner"', () => {
    const intent = detectIntent('dinner');
    return intent.type === 'PLAN_TONIGHT';
  });

  await test('Plan Tonight: "plan tonight"', () => {
    const intent = detectIntent('plan tonight');
    return intent.type === 'PLAN_TONIGHT';
  });

  await test('Plan Next: "plan next 3 days"', () => {
    const intent = detectIntent('plan next 3 days');
    return intent.type === 'PLAN_NEXT' && intent.days === 3;
  });

  await test('Plan Next: "plan the week"', () => {
    const intent = detectIntent('plan the week');
    return intent.type === 'PLAN_NEXT' && intent.days === 7;
  });

  await test('Plan Next: "weekly plan"', () => {
    const intent = detectIntent('weekly plan');
    return intent.type === 'PLAN_NEXT' && intent.days === 7;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Inventory Add Intent Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n5. Inventory Add Intent Patterns Tests');

  await test('Add: "bought chicken"', () => {
    const intent = detectIntent('bought chicken');
    return intent.type === 'INVENTORY_ADD' && intent.item.includes('chicken');
  });

  await test('Add: "got 500g salmon"', () => {
    const intent = detectIntent('got 500g salmon');
    return intent.type === 'INVENTORY_ADD' && intent.quantity === 500 && intent.unit === 'g';
  });

  await test('Add: "add eggs"', () => {
    const intent = detectIntent('add eggs');
    return intent.type === 'INVENTORY_ADD' && intent.item.includes('eggs');
  });

  await test('Add: "just bought 1kg chicken"', () => {
    const intent = detectIntent('just bought 1kg chicken');
    return intent.type === 'INVENTORY_ADD' && intent.quantity === 1000 && intent.unit === 'g';
  });

  await test('Add: "have 2 liters milk"', () => {
    const intent = detectIntent('have 2 liters milk');
    return intent.type === 'INVENTORY_ADD' && intent.quantity === 2000 && intent.unit === 'ml';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Inventory Used Intent Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n6. Inventory Used Intent Patterns Tests');

  await test('Used: "used the chicken"', () => {
    const intent = detectIntent('used the chicken');
    return intent.type === 'INVENTORY_USED' && intent.item.includes('chicken');
  });

  await test('Used: "finished the eggs"', () => {
    const intent = detectIntent('finished the eggs');
    return intent.type === 'INVENTORY_USED' && intent.item.includes('eggs');
  });

  await test('Used: "ran out of milk"', () => {
    const intent = detectIntent('ran out of milk');
    return intent.type === 'INVENTORY_USED' && intent.item.includes('milk');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Explain Intent Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n7. Explain Intent Patterns Tests');

  await test('Explain: "why"', () => {
    const intent = detectIntent('why');
    return intent.type === 'EXPLAIN_LAST_PLAN';
  });

  await test('Explain: "why?"', () => {
    const intent = detectIntent('why?');
    return intent.type === 'EXPLAIN_LAST_PLAN';
  });

  await test('Explain: "explain"', () => {
    const intent = detectIntent('explain');
    return intent.type === 'EXPLAIN_LAST_PLAN';
  });

  await test('Explain: "why this recipe"', () => {
    const intent = detectIntent('why this recipe');
    return intent.type === 'EXPLAIN_LAST_PLAN';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test: Unknown Intent
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n8. Unknown Intent Tests');

  await test('Unknown: "asdfghjkl"', () => {
    const intent = detectIntent('asdfghjkl');
    return intent.type === 'UNKNOWN';
  });

  await test('Unknown: "random gibberish text here"', () => {
    const intent = detectIntent('random gibberish text here');
    return intent.type === 'UNKNOWN';
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
