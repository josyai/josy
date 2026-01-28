/**
 * Notifications Module
 *
 * Builds user-facing notification messages from plan results.
 * Deterministic formatting for WhatsApp and other channels.
 *
 * All functions are pure and deterministic.
 */

import {
  DinnerNotification,
  ReasoningTrace,
  NormalizedGroceryList,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Dinner Notification Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a dinner notification from plan results.
 *
 * @param recipeName - Name of the selected recipe
 * @param trace - Reasoning trace from DPE
 * @param groceryList - Normalized grocery list (can be null if no items needed)
 * @param planId - Plan ID for reference
 * @returns Dinner notification object
 */
export function buildDinnerNotification(
  recipeName: string,
  trace: ReasoningTrace,
  groceryList: NormalizedGroceryList | null,
  planId: string
): DinnerNotification {
  // Generate short "why" explanation
  const whyShort = generateWhyShort(trace);

  // Generate grocery summary
  const grocerySummary = groceryList && groceryList.items.length > 0
    ? groceryList.summary
    : null;

  return {
    recipe_name: recipeName,
    why_short: whyShort,
    grocery_summary: grocerySummary,
    plan_id: planId,
    actions: {
      confirm: 'Sounds good!',
      swap: 'Something else',
    },
  };
}

/**
 * Generate a short "why" explanation from the reasoning trace.
 */
function generateWhyShort(trace: ReasoningTrace): string {
  // Find urgent items being used
  const urgentItems = trace.inventory_snapshot
    .filter((item) => item.urgency >= 3)
    .map((item) => item.canonical_name);

  const winnerRecipe = trace.eligible_recipes.find((r) => r.recipe === trace.winner);
  const usedUrgentItems = urgentItems.filter(
    (name) => winnerRecipe?.uses_inventory.includes(name)
  );

  // Priority 1: Expiring items
  if (usedUrgentItems.length > 0) {
    const item = usedUrgentItems[0];
    return `Uses your ${item} before it expires.`;
  }

  // Priority 2: All ingredients in inventory
  const missingCount = winnerRecipe?.missing_ingredients.length || 0;
  if (missingCount === 0) {
    return 'You have everything you need.';
  }

  // Priority 3: Only one item needed
  if (missingCount === 1 && winnerRecipe) {
    return `Just need to pick up ${winnerRecipe.missing_ingredients[0]}.`;
  }

  // Default
  return 'Quick and easy with what you have.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit Confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a commit confirmation message.
 *
 * @param recipeName - Name of the committed recipe
 * @param status - Commit status (cooked/skipped)
 * @returns Confirmation message string
 */
export function buildCommitConfirmation(
  recipeName: string,
  status: 'cooked' | 'skipped'
): string {
  if (status === 'cooked') {
    return `Great! I've updated your inventory. Enjoy your ${recipeName}!`;
  }

  return `Got it! I've skipped ${recipeName} for tonight. Let me know if you want another suggestion.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a dinner notification for WhatsApp.
 * Uses WhatsApp markdown: *bold*, _italic_
 *
 * @param notification - Dinner notification object
 * @returns Formatted WhatsApp message string
 */
export function formatForWhatsApp(notification: DinnerNotification): string {
  const lines: string[] = [];

  // Recipe name with emphasis
  lines.push(`*Tonight's suggestion: ${notification.recipe_name}*`);
  lines.push('');

  // Why explanation
  lines.push(notification.why_short);

  // Grocery summary if any
  if (notification.grocery_summary) {
    lines.push('');
    lines.push(`_${notification.grocery_summary}_`);
  }

  // Actions
  lines.push('');
  lines.push(`Reply "${notification.actions.confirm}" to confirm or "${notification.actions.swap}" for alternatives.`);

  return lines.join('\n');
}

/**
 * Format a simple text message for WhatsApp.
 * Just wraps the message - no special formatting.
 *
 * @param message - Plain text message
 * @returns Same message (pass-through for consistency)
 */
export function formatTextForWhatsApp(message: string): string {
  return message;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory Notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an inventory add confirmation message.
 *
 * @param displayName - Display name of the item
 * @param quantity - Quantity added (can be null for unknown)
 * @param unit - Unit of measurement
 * @returns Confirmation message string
 */
export function buildInventoryAddConfirmation(
  displayName: string,
  quantity: number | null,
  unit: string
): string {
  if (quantity !== null) {
    return `Got it! Added ${quantity} ${unit} of ${displayName} to your inventory.`;
  }
  return `Got it! Added ${displayName} to your inventory.`;
}

/**
 * Build an inventory used confirmation message.
 *
 * @param displayName - Display name of the item
 * @returns Confirmation message string
 */
export function buildInventoryUsedConfirmation(displayName: string): string {
  return `Got it! I've noted you used the ${displayName}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an error message for no eligible recipes.
 *
 * @param reason - Primary reason for no eligible recipes
 * @returns User-friendly error message
 */
export function buildNoRecipeMessage(reason: string): string {
  if (reason.includes('time')) {
    return "I couldn't find a recipe that fits your schedule tonight. Try asking earlier or check if you have any calendar conflicts.";
  }

  if (reason.includes('equipment')) {
    return "I couldn't find a recipe that works with your available equipment. You might need to update your household settings.";
  }

  return "I couldn't find a suitable recipe for tonight. Try adding more items to your inventory or adjusting your preferences.";
}

/**
 * Build an unknown intent response message.
 *
 * @returns Help message for unknown intents
 */
export function buildUnknownIntentMessage(): string {
  return `I can help you with dinner! Try:
• "What's for dinner?"
• "I bought salmon"
• "Why?" (after getting a suggestion)`;
}
