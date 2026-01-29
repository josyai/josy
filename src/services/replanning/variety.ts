/**
 * Variety Service
 *
 * Handles variety penalties to avoid unnecessary ingredient repetition.
 * Expiry urgency trumps variety penalties.
 *
 * All functions are pure and deterministic.
 */

import { differenceInDays, parseISO } from 'date-fns';
import {
  VarietyRule,
  VarietyCategory,
  ConsumptionRecord,
  VarietyPenaltyApplied,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Variety Rules Table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static variety rules table.
 * Defines which ingredients should be avoided after recent consumption.
 */
export const VARIETY_RULES: VarietyRule[] = [
  {
    category: 'pantry_legumes',
    ingredients: [
      'canned chickpeas',
      'chickpeas',
      'red lentils',
      'lentils',
      'canned black beans',
      'black beans',
      'canned kidney beans',
      'kidney beans',
    ],
    avoid_repeat_days: 7,
    penalty_per_occurrence: 15,
  },
  {
    category: 'proteins',
    ingredients: [
      'salmon fillet',
      'chicken breast',
      'beef',
      'ground beef',
      'tofu',
      'shrimp',
      'pork',
      'eggs',
    ],
    avoid_repeat_days: 4,
    penalty_per_occurrence: 10,
  },
  {
    category: 'produce',
    ingredients: [], // No repeat penalty for produce by default
    avoid_repeat_days: 0,
    penalty_per_occurrence: 0,
  },
  {
    category: 'other',
    ingredients: [],
    avoid_repeat_days: 3,
    penalty_per_occurrence: 5,
  },
];

/**
 * Expiry urgency threshold in days.
 * If an item expires within this many days, expiry urgency trumps variety penalty.
 */
export const EXPIRY_URGENCY_THRESHOLD_DAYS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Category Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the variety category for an ingredient.
 *
 * @param ingredientName - Canonical ingredient name
 * @returns Variety category
 */
export function getVarietyCategory(ingredientName: string): VarietyCategory {
  for (const rule of VARIETY_RULES) {
    if (rule.ingredients.includes(ingredientName)) {
      return rule.category;
    }
  }
  return 'other';
}

/**
 * Get the variety rule for a category.
 *
 * @param category - Variety category
 * @returns Variety rule or undefined
 */
export function getVarietyRule(category: VarietyCategory): VarietyRule | undefined {
  return VARIETY_RULES.find((r) => r.category === category);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumption Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface RecentConsumptionProfile {
  daysLookedBack: number;
  mealsFound: number;
  ingredientsConsumed: Map<string, { lastDate: string; count: number }>;
  tagsUsed: Map<string, { lastDate: string; count: number }>;
}

/**
 * Build a recent consumption profile from consumption records.
 *
 * @param records - Array of consumption records
 * @param windowDays - Number of days to look back
 * @param referenceDate - Reference date (usually planning date)
 * @returns Recent consumption profile
 */
export function buildRecentConsumptionProfile(
  records: ConsumptionRecord[],
  windowDays: number,
  referenceDate: string
): RecentConsumptionProfile {
  const refDate = parseISO(referenceDate);
  const ingredientsConsumed = new Map<string, { lastDate: string; count: number }>();
  const tagsUsed = new Map<string, { lastDate: string; count: number }>();
  let mealsFound = 0;

  for (const record of records) {
    const recordDate = parseISO(record.date_local);
    const daysDiff = differenceInDays(refDate, recordDate);

    if (daysDiff >= 0 && daysDiff <= windowDays) {
      mealsFound++;

      // Track ingredients
      for (const ingredient of record.ingredients_used) {
        const existing = ingredientsConsumed.get(ingredient);
        if (!existing || record.date_local > existing.lastDate) {
          ingredientsConsumed.set(ingredient, {
            lastDate: record.date_local,
            count: (existing?.count || 0) + 1,
          });
        } else {
          existing.count++;
        }
      }

      // Track tags
      for (const tag of record.tags) {
        const existing = tagsUsed.get(tag);
        if (!existing || record.date_local > existing.lastDate) {
          tagsUsed.set(tag, {
            lastDate: record.date_local,
            count: (existing?.count || 0) + 1,
          });
        } else {
          existing.count++;
        }
      }
    }
  }

  return {
    daysLookedBack: windowDays,
    mealsFound,
    ingredientsConsumed,
    tagsUsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Variety Penalty Calculation
// ─────────────────────────────────────────────────────────────────────────────

export interface VarietyPenaltyResult {
  totalPenalty: number;
  penalties: VarietyPenaltyApplied[];
}

/**
 * Calculate variety penalties for a recipe based on recent consumption.
 *
 * @param recipeIngredients - List of canonical ingredient names in the recipe
 * @param recipeTags - List of tags for the recipe
 * @param profile - Recent consumption profile
 * @param planningDate - The date being planned for (YYYY-MM-DD)
 * @param expiringIngredients - Set of ingredients expiring within urgency threshold
 * @returns Variety penalty result
 */
export function calculateVarietyPenalties(
  recipeIngredients: string[],
  recipeTags: string[],
  profile: RecentConsumptionProfile,
  planningDate: string,
  expiringIngredients: Set<string> = new Set()
): VarietyPenaltyResult {
  const penalties: VarietyPenaltyApplied[] = [];
  let totalPenalty = 0;
  const planDate = parseISO(planningDate);

  // Check ingredient-based penalties
  for (const ingredient of recipeIngredients) {
    const consumption = profile.ingredientsConsumed.get(ingredient);
    if (!consumption) continue;

    // Skip penalty if ingredient is expiring (urgency trumps variety)
    if (expiringIngredients.has(ingredient)) {
      continue;
    }

    const category = getVarietyCategory(ingredient);
    const rule = getVarietyRule(category);
    if (!rule || rule.avoid_repeat_days === 0) continue;

    const lastDate = parseISO(consumption.lastDate);
    const daysSince = differenceInDays(planDate, lastDate);

    if (daysSince < rule.avoid_repeat_days) {
      const penaltyPoints = rule.penalty_per_occurrence * consumption.count;
      penalties.push({
        ingredient,
        last_consumed_date: consumption.lastDate,
        days_since: daysSince,
        penalty_points: penaltyPoints,
        reason: `${ingredient} consumed ${daysSince} days ago (avoid for ${rule.avoid_repeat_days} days)`,
      });
      totalPenalty += penaltyPoints;
    }
  }

  // Check tag-based penalties (consecutive cuisine)
  const CONSECUTIVE_CUISINE_PENALTY = 8;
  for (const tag of recipeTags) {
    // Only apply to cuisine-type tags
    if (!tag.includes('cuisine') && !isCuisineTag(tag)) continue;

    const tagUsage = profile.tagsUsed.get(tag);
    if (!tagUsage) continue;

    const lastDate = parseISO(tagUsage.lastDate);
    const daysSince = differenceInDays(planDate, lastDate);

    // Consecutive day cuisine penalty
    if (daysSince === 1) {
      penalties.push({
        ingredient: `tag:${tag}`,
        last_consumed_date: tagUsage.lastDate,
        days_since: daysSince,
        penalty_points: CONSECUTIVE_CUISINE_PENALTY,
        reason: `Consecutive ${tag} meals`,
      });
      totalPenalty += CONSECUTIVE_CUISINE_PENALTY;
    }
  }

  return { totalPenalty, penalties };
}

/**
 * Check if a tag represents a cuisine type.
 */
function isCuisineTag(tag: string): boolean {
  const cuisineTags = [
    'italian',
    'mexican',
    'asian',
    'chinese',
    'japanese',
    'indian',
    'thai',
    'mediterranean',
    'american',
    'french',
    'greek',
  ];
  return cuisineTags.includes(tag.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow Inventory for Multi-Day Planning
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowInventoryItem {
  id: string;
  canonicalName: string;
  quantity: number | null;
  unit: string;
  expirationDate: Date | null;
  expiresInDays: number | null;
}

/**
 * Create a shadow copy of inventory for simulation.
 *
 * @param inventory - Current inventory state
 * @param referenceDate - Reference date for expiry calculation
 * @returns Shadow inventory items
 */
export function createShadowInventory(
  inventory: Array<{
    id: string;
    canonicalName: string;
    quantity: number | null;
    unit: string;
    expirationDate: Date | null;
  }>,
  referenceDate: Date
): ShadowInventoryItem[] {
  return inventory.map((item) => ({
    ...item,
    expiresInDays: item.expirationDate
      ? differenceInDays(item.expirationDate, referenceDate)
      : null,
  }));
}

/**
 * Apply consumption to shadow inventory.
 *
 * @param shadowInventory - Mutable shadow inventory
 * @param usagePlan - Items to consume with quantities
 */
export function applyShadowConsumption(
  shadowInventory: ShadowInventoryItem[],
  usagePlan: Array<{
    inventoryItemId: string;
    consumedQuantity: number | null;
  }>
): void {
  for (const usage of usagePlan) {
    const item = shadowInventory.find((i) => i.id === usage.inventoryItemId);
    if (item && item.quantity !== null && usage.consumedQuantity !== null) {
      item.quantity = Math.max(0, item.quantity - usage.consumedQuantity);
    }
  }
}

/**
 * Get ingredients that are expiring soon (within urgency threshold).
 *
 * @param shadowInventory - Shadow inventory
 * @returns Set of canonical names of expiring ingredients
 */
export function getExpiringIngredients(
  shadowInventory: ShadowInventoryItem[]
): Set<string> {
  const expiring = new Set<string>();
  for (const item of shadowInventory) {
    if (
      item.expiresInDays !== null &&
      item.expiresInDays <= EXPIRY_URGENCY_THRESHOLD_DAYS &&
      item.expiresInDays >= 0
    ) {
      expiring.add(item.canonicalName);
    }
  }
  return expiring;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumption Record Summary for Trace
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumptionSummary {
  days_looked_back: number;
  meals_found: number;
  ingredients_consumed: string[];
}

/**
 * Create a consumption summary for the reasoning trace.
 *
 * @param profile - Recent consumption profile
 * @returns Consumption summary
 */
export function createConsumptionSummary(
  profile: RecentConsumptionProfile
): ConsumptionSummary {
  return {
    days_looked_back: profile.daysLookedBack,
    meals_found: profile.mealsFound,
    ingredients_consumed: Array.from(profile.ingredientsConsumed.keys()).sort(),
  };
}
