/**
 * DPE Inventory Allocation
 *
 * Pure functions for allocating inventory to recipes.
 * Implements deterministic, FIFO-based allocation policy.
 *
 * See docs/dpe-rules-v0.md and docs/inventory-rules-v0.md for policies.
 */

import { InventorySnapshot, UsagePlanItem, MissingIngredient } from '../../types';

/**
 * Allocation result for a recipe
 */
export interface AllocationResult {
  usagePlan: UsagePlanItem[];
  missingRequired: MissingIngredient[];
}

/**
 * Recipe ingredient requirements
 */
export interface IngredientRequirement {
  canonicalName: string;
  requiredQuantity: number;
  unit: string;
  optional: boolean;
}

/**
 * Compute usage plan and missing ingredients for a recipe.
 *
 * Uses deterministic allocation with the following priority:
 * 1. Earliest expiration date (null last)
 * 2. Exact confidence before estimate
 * 3. Oldest created_at (FIFO)
 *
 * Quantity Confidence Handling (Option 1 - "present but not quantifiable"):
 * - exact/estimate: normal allocation with quantity decrement
 * - unknown: counts as "present" (covers ingredient), no quantity allocation
 *
 * @param ingredients - Recipe ingredient requirements
 * @param inventory - Mutable copy of inventory (will be modified)
 * @returns Allocation result with usage plan and missing ingredients
 */
export function computeUsageAndMissing(
  ingredients: IngredientRequirement[],
  inventory: InventorySnapshot[]
): AllocationResult {
  const usagePlan: UsagePlanItem[] = [];
  const missingRequired: MissingIngredient[] = [];

  for (const ing of ingredients) {
    // Skip optional ingredients
    if (ing.optional) continue;

    const needed = Number(ing.requiredQuantity);
    let remaining = needed;
    let coveredByUnknown = false;

    // First, check for unknown quantity items that can "cover" the ingredient
    const unknownItems = inventory.filter(
      (item) =>
        item.canonicalName === ing.canonicalName &&
        item.unit === ing.unit &&
        item.quantityConfidence === 'unknown'
    );

    // If we have an unknown quantity item, it counts as "present"
    // We don't allocate a specific quantity, but the ingredient is covered
    if (unknownItems.length > 0) {
      const unknownItem = unknownItems[0]; // Use first unknown item
      usagePlan.push({
        inventoryItemId: unknownItem.id,
        canonicalName: unknownItem.canonicalName,
        consumedQuantity: null, // Unknown quantity
        consumedUnknown: true,
        unit: unknownItem.unit,
      });
      coveredByUnknown = true;
      remaining = 0; // Ingredient is "covered"
    }

    // Then, allocate from items with known quantities
    // Sort: earliest expiration first (null last), then exact before estimate, then oldest
    const matchingItems = inventory
      .filter(
        (item) =>
          item.canonicalName === ing.canonicalName &&
          item.unit === ing.unit &&
          item.quantity !== null &&
          item.quantity > 0 &&
          item.quantityConfidence !== 'unknown'
      )
      .sort((a, b) => {
        // 1. Earliest expiration date (null last)
        if (a.expirationDate && b.expirationDate) {
          const diff = a.expirationDate.getTime() - b.expirationDate.getTime();
          if (diff !== 0) return diff;
        } else if (a.expirationDate && !b.expirationDate) {
          return -1;
        } else if (!a.expirationDate && b.expirationDate) {
          return 1;
        }
        // 2. Exact before estimate
        if (a.quantityConfidence === 'exact' && b.quantityConfidence === 'estimate') {
          return -1;
        }
        if (a.quantityConfidence === 'estimate' && b.quantityConfidence === 'exact') {
          return 1;
        }
        // 3. Oldest created_at (FIFO)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    // Allocate from matching items
    for (const item of matchingItems) {
      if (remaining <= 0) break;
      if (item.quantity === null) continue;

      const toConsume = Math.min(remaining, item.quantity);
      usagePlan.push({
        inventoryItemId: item.id,
        canonicalName: item.canonicalName,
        consumedQuantity: toConsume,
        consumedUnknown: false,
        unit: item.unit,
      });

      remaining -= toConsume;
      item.quantity -= toConsume; // Mutate for subsequent allocations
    }

    // Only add to missing if not covered by unknown and still have remaining
    if (remaining > 0 && !coveredByUnknown) {
      missingRequired.push({
        canonicalName: ing.canonicalName,
        requiredQuantity: remaining,
        unit: ing.unit,
      });
    }
  }

  return { usagePlan, missingRequired };
}
