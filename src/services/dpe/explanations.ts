/**
 * DPE Explanations
 *
 * Pure functions for generating human-readable explanations.
 * All explanations are deterministic (no LLM).
 */

import { InventorySnapshot, UsagePlanItem, MissingIngredient, RecipeCandidate } from '../../types';
import { computeUrgency } from './scoring';

/**
 * Generate deterministic "why" explanations for recipe selection.
 *
 * These explanations help users understand why a recipe was chosen
 * without using an LLM - purely rule-based.
 *
 * @param usagePlan - Items to be consumed
 * @param missingRequired - Missing required ingredients
 * @param totalTimeMinutes - Recipe total time
 * @param originalInventory - Inventory snapshot for urgency lookup
 * @param todayLocal - Today's date for urgency calculation
 * @param intervalMinutes - Available cooking time
 * @returns Array of explanation strings
 */
export function generateWhy(
  usagePlan: UsagePlanItem[],
  missingRequired: MissingIngredient[],
  totalTimeMinutes: number,
  originalInventory: InventorySnapshot[],
  todayLocal: Date,
  intervalMinutes: number
): string[] {
  const reasons: string[] = [];

  // Check for urgent items being used
  const urgentItems: string[] = [];
  for (const usage of usagePlan) {
    const item = originalInventory.find((i) => i.id === usage.inventoryItemId);
    if (item) {
      const urgency = computeUrgency(item.expirationDate, todayLocal);
      if (urgency >= 3) {
        urgentItems.push(`${item.canonicalName} (urgency=${urgency})`);
      }
    }
  }

  if (urgentItems.length > 0) {
    reasons.push(`Uses items expiring soon: ${urgentItems.join(', ')}`);
  }

  // Note about ingredient availability
  const missingCount = missingRequired.length;
  if (missingCount === 0) {
    reasons.push('All required ingredients available in inventory');
  } else {
    reasons.push(`Requires ${missingCount} missing ingredient${missingCount > 1 ? 's' : ''}`);
  }

  // Time fit explanation
  reasons.push(
    `Fits in your available window (${totalTimeMinutes} min recipe, ${intervalMinutes} min available)`
  );

  return reasons;
}

/**
 * Determine which tie-breaker was used to select the winner.
 *
 * Tie-breaker order (from docs/dpe-rules-v0.md):
 * 1. Highest final score
 * 2. Lowest missing ingredients
 * 3. Highest waste score
 * 4. Shortest cook time
 * 5. Alphabetical slug
 *
 * @param winner - The winning candidate
 * @param runnerUp - The second-place candidate (or null)
 * @returns Name of the tie-breaker used, or null if no tie
 */
export function determineTieBreaker(
  winner: RecipeCandidate,
  runnerUp: RecipeCandidate | null
): string | null {
  if (!runnerUp) return null;

  // Check each tie-breaker in order
  if (winner.scores.final !== runnerUp.scores.final) {
    return 'highest_final_score';
  }
  if (winner.missingRequired.length !== runnerUp.missingRequired.length) {
    return 'lowest_missing_ingredients';
  }
  if (winner.scores.wasteScore !== runnerUp.scores.wasteScore) {
    return 'highest_waste_score';
  }
  if (winner.totalTimeMinutes !== runnerUp.totalTimeMinutes) {
    return 'shortest_cook_time';
  }
  return 'alphabetical_slug';
}
