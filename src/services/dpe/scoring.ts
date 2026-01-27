/**
 * DPE Scoring Functions
 *
 * Pure functions for computing urgency and waste scores.
 * See docs/dpe-rules-v0.md for decision tables.
 */

import { InventorySnapshot, UsagePlanItem } from '../../types';
import { SCORING } from './constants';

/**
 * Compute expiration urgency for an inventory item.
 *
 * Urgency Table:
 * | Days to Expiry | Urgency Score |
 * |----------------|---------------|
 * | < 0 (expired)  | -1 (exclude)  |
 * | 0-1            | 5 (critical)  |
 * | 2-3            | 3 (high)      |
 * | 4-7            | 1 (medium)    |
 * | > 7 or null    | 0 (low)       |
 *
 * @param expirationDate - Item expiration date (null = no expiry)
 * @param todayLocal - Today's date in household timezone
 * @returns Urgency score (0-5, or -1 for expired)
 */
export function computeUrgency(expirationDate: Date | null, todayLocal: Date): number {
  if (!expirationDate) return 0;

  const daysToExp = Math.floor(
    (expirationDate.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysToExp < 0) return -1; // Expired
  if (daysToExp <= 1) return 5; // Critical
  if (daysToExp <= 3) return 3; // High
  if (daysToExp <= 7) return 1; // Medium
  return 0; // Low
}

/**
 * Compute waste score based on urgency of items being used.
 *
 * Formula: Σ (urgency × fractionUsed × WASTE_WEIGHT)
 *
 * This incentivizes recipes that use expiring ingredients,
 * reducing food waste.
 *
 * @param usagePlan - Items to be consumed by the recipe
 * @param originalInventory - Snapshot of inventory before allocation
 * @param todayLocal - Today's date for urgency calculation
 * @returns Waste score (higher = better for reducing waste)
 */
export function computeWasteScore(
  usagePlan: UsagePlanItem[],
  originalInventory: InventorySnapshot[],
  todayLocal: Date
): number {
  let score = 0;

  for (const usage of usagePlan) {
    // Skip unknown quantity items in waste score (they contribute no numeric score)
    if (usage.consumedUnknown || usage.consumedQuantity === null) continue;

    const item = originalInventory.find((i) => i.id === usage.inventoryItemId);
    if (!item || item.quantity === null) continue;

    const urgency = computeUrgency(item.expirationDate, todayLocal);
    if (urgency > 0) {
      const originalQty = item.quantity;
      const fractionUsed = originalQty > 0 ? usage.consumedQuantity / originalQty : 0;
      score += urgency * fractionUsed * SCORING.WASTE_WEIGHT;
    }
  }

  return score;
}

/**
 * Compute the final score for a recipe candidate.
 *
 * Formula: wasteScore - spendPenalty - timePenalty
 *
 * This balances:
 * - Using expiring ingredients (waste reduction)
 * - Minimizing grocery trips (convenience)
 * - Shorter cook times (time efficiency)
 *
 * @param wasteScore - Score for using urgent items
 * @param missingCount - Number of missing required ingredients
 * @param totalTimeMinutes - Total recipe time (prep + cook)
 * @returns Final composite score
 */
export function computeFinalScore(
  wasteScore: number,
  missingCount: number,
  totalTimeMinutes: number
): { wasteScore: number; spendPenalty: number; timePenalty: number; final: number } {
  const spendPenalty = missingCount * SCORING.GROCERY_PENALTY_PER_ITEM;
  const timePenalty = totalTimeMinutes * SCORING.TIME_PENALTY_FACTOR;
  const final = wasteScore - spendPenalty - timePenalty;

  return { wasteScore, spendPenalty, timePenalty, final };
}
