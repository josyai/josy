/**
 * Phase 4: Chat Demo Script
 *
 * Simulates a WhatsApp conversation to demonstrate the interaction flow.
 * This can be run locally without actual WhatsApp/Twilio setup.
 *
 * Run with: npx ts-node scripts/demo-chat.ts
 *
 * Demo acceptance criteria:
 * 1. User adds inventory
 * 2. User asks for dinner → gets answer
 * 3. User asks "why" → gets explanation
 * 4. User adds a different ingredient
 * 5. User asks again → different dinner + different explanation
 */

import { handleMessage } from '../src/services/conversation';

// Unique phone number for each demo run (fresh household)
const DEMO_PHONE = `+1555${Date.now().toString().slice(-7)}`;

function printMessage(from: string, message: string): void {
  const prefix = from === 'user' ? '👤 User' : '🤖 Josy';
  console.log(`\n${prefix}: ${message}`);
}

function printSeparator(title?: string): void {
  console.log('\n' + '─'.repeat(50));
  if (title) {
    console.log(`  ${title}`);
    console.log('─'.repeat(50));
  }
}

async function chat(message: string): Promise<string> {
  printMessage('user', message);
  const response = await handleMessage(DEMO_PHONE, message);
  printMessage('josy', response.message);
  return response.message;
}

async function main(): Promise<void> {
  console.log('═'.repeat(50));
  console.log('  Phase 4: Josy Chat Demo');
  console.log('═'.repeat(50));
  console.log('\nSimulating a WhatsApp conversation...\n');

  // ═══════════════════════════════════════════════════════
  // STEP 1: User adds initial inventory
  // ═══════════════════════════════════════════════════════
  printSeparator('STEP 1: Add Initial Inventory');

  await chat('I bought salmon');
  await chat('Add frozen peas');
  await chat('I have olive oil');

  // ═══════════════════════════════════════════════════════
  // STEP 2: User asks for dinner
  // ═══════════════════════════════════════════════════════
  printSeparator('STEP 2: Ask for Dinner');

  await chat("What's for dinner tonight?");

  // ═══════════════════════════════════════════════════════
  // STEP 3: User asks why
  // ═══════════════════════════════════════════════════════
  printSeparator('STEP 3: Ask Why');

  await chat('Why?');

  // ═══════════════════════════════════════════════════════
  // STEP 4: User "uses" the salmon, then adds different ingredients
  // ═══════════════════════════════════════════════════════
  printSeparator('STEP 4: Context Change (Use Salmon, Add New Items)');

  await chat('I used the salmon');
  await chat('I bought eggs');
  await chat('I have tomatoes');
  await chat('Add bread');
  await chat('I have butter');

  // ═══════════════════════════════════════════════════════
  // STEP 5: User asks again - should see different suggestion
  // ═══════════════════════════════════════════════════════
  printSeparator('STEP 5: Ask Again (Different Recipe!)');

  await chat("What's for dinner?");
  await chat('Why this?');

  // ═══════════════════════════════════════════════════════
  // BONUS: Test unknown message handling
  // ═══════════════════════════════════════════════════════
  printSeparator('BONUS: Unknown Message');

  await chat('Hello there!');

  // Summary
  printSeparator();
  console.log('\n✅ Demo complete!\n');
  console.log('Key observations:');
  console.log('  • User can add inventory with natural language');
  console.log('  • Dinner suggestions are based on available ingredients');
  console.log('  • Explanations are clear and grounded in real constraints');
  console.log('  • Adding ingredients can change the dinner suggestion');
  console.log('  • Unknown messages get helpful guidance');
  console.log();
}

main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
