/**
 * Explanation Formatter
 *
 * Converts reasoning_trace into short, human-readable explanations.
 * Rules: pick top reason(s), deterministic phrasing, no additional inference.
 */

import { ReasoningTrace } from '../types';

/**
 * Format a human-readable explanation from the reasoning trace.
 *
 * This is deterministic - no LLM, no inference beyond the trace data.
 *
 * @param trace - The DPE reasoning trace
 * @returns A 1-2 sentence human explanation
 */
export function formatExplanation(trace: ReasoningTrace): string {
  const reasons: string[] = [];

  // 1. Check for urgent items being used
  const urgentItems = trace.inventory_snapshot
    .filter((item) => item.urgency >= 3)
    .map((item) => item.canonical_name);

  // Find which urgent items are used by the winning recipe
  const winnerRecipe = trace.eligible_recipes.find((r) => r.recipe === trace.winner);
  const usedUrgentItems = urgentItems.filter(
    (name) => winnerRecipe?.uses_inventory.includes(name)
  );

  if (usedUrgentItems.length > 0) {
    const itemList = formatItemList(usedUrgentItems);
    if (usedUrgentItems.length === 1) {
      reasons.push(`your ${itemList} is expiring soon`);
    } else {
      reasons.push(`your ${itemList} are expiring soon`);
    }
  }

  // 2. Check for grocery add-ons (or lack thereof)
  const missingCount = winnerRecipe?.missing_ingredients.length || 0;
  if (missingCount === 0) {
    reasons.push('you already have all the ingredients');
  } else if (missingCount === 1 && winnerRecipe) {
    reasons.push(`you only need to pick up ${winnerRecipe.missing_ingredients[0]}`);
  }

  // 3. Check time constraint
  const availableMinutes = trace.calendar_constraints.available_minutes;
  if (availableMinutes < 30) {
    reasons.push('it fits your tight schedule');
  } else if (availableMinutes < 45) {
    reasons.push('it fits your available time');
  }

  // 4. Check if it was a close call (tie-breaker)
  if (trace.tie_breaker === 'highest_waste_score') {
    reasons.push('it uses up ingredients that would otherwise go to waste');
  } else if (trace.tie_breaker === 'shortest_cook_time') {
    reasons.push("it's the quickest option");
  }

  // Build the explanation
  if (reasons.length === 0) {
    return "It's a good match for what you have on hand.";
  }

  if (reasons.length === 1) {
    return `Because ${reasons[0]}.`;
  }

  // Combine first two reasons
  return `Because ${reasons[0]}, and ${reasons[1]}.`;
}

/**
 * Format a quick summary for the dinner response
 */
export function formatDinnerReason(trace: ReasoningTrace): string {
  // Find urgent items used
  const urgentItems = trace.inventory_snapshot
    .filter((item) => item.urgency >= 3)
    .map((item) => item.canonical_name);

  const winnerRecipe = trace.eligible_recipes.find((r) => r.recipe === trace.winner);
  const usedUrgentItems = urgentItems.filter(
    (name) => winnerRecipe?.uses_inventory.includes(name)
  );

  if (usedUrgentItems.length > 0) {
    const item = usedUrgentItems[0];
    return `Uses your ${item} before it expires.`;
  }

  const missingCount = winnerRecipe?.missing_ingredients.length || 0;
  if (missingCount === 0) {
    return 'You have everything you need.';
  }

  return `Quick and easy with what you have.`;
}

/**
 * Format a grocery add-on summary
 */
export function formatGrocerySummary(
  addons: Array<{ canonical_name: string; required_quantity: number; unit: string }>
): string | null {
  if (addons.length === 0) return null;

  if (addons.length === 1) {
    const item = addons[0];
    return `You'll need to pick up ${item.canonical_name}.`;
  }

  if (addons.length === 2) {
    return `You'll need ${addons[0].canonical_name} and ${addons[1].canonical_name}.`;
  }

  const firstTwo = addons.slice(0, 2).map((a) => a.canonical_name);
  const remaining = addons.length - 2;
  return `You'll need ${firstTwo.join(', ')} and ${remaining} more item${remaining > 1 ? 's' : ''}.`;
}

/**
 * Format a list of items in natural language
 */
function formatItemList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Format inventory add confirmation
 */
export function formatAddConfirmation(item: string, quantity?: number, unit?: string): string {
  if (quantity && unit) {
    return `Got it — I added ${quantity} ${unit} of ${item}.`;
  }
  return `Got it — I added ${item}.`;
}

/**
 * Format inventory used confirmation
 */
export function formatUsedConfirmation(item: string): string {
  return `Got it — I noted you used the ${item}.`;
}

/**
 * Format unknown message response
 */
export function formatUnknownResponse(): string {
  return `I can help you with dinner! Try:\n• "What's for dinner?"\n• "I bought salmon"\n• "Why?" (after getting a dinner suggestion)`;
}
