/**
 * Grocery Normalization Module
 *
 * Normalizes and deduplicates grocery add-ons from plan results.
 * Provides categorized, sorted lists with human-readable summaries.
 *
 * All functions are pure and deterministic.
 */

import {
  NormalizedGroceryList,
  NormalizedGroceryItem,
  IngredientCategory,
} from '../../types';
import { getIngredientCategory } from '../inventory-intelligence';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Category sort order for grocery lists.
 * Items are sorted by this order, then alphabetically within category.
 */
const CATEGORY_ORDER: IngredientCategory[] = [
  'produce',
  'protein',
  'dairy',
  'frozen',
  'pantry',
  'other',
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GroceryAddonInput {
  canonical_name: string;
  required_quantity: number;
  unit: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a display name from a canonical name.
 * Capitalizes first letter of each word.
 */
function toDisplayName(canonicalName: string): string {
  return canonicalName
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format quantity with unit for display.
 */
function formatQuantity(quantity: number, unit: string): string {
  // Convert to more readable units if applicable
  if (unit === 'g' && quantity >= 1000) {
    return `${(quantity / 1000).toFixed(1).replace(/\.0$/, '')} kg`;
  }
  if (unit === 'ml' && quantity >= 1000) {
    return `${(quantity / 1000).toFixed(1).replace(/\.0$/, '')} L`;
  }

  // Format with appropriate precision
  const formattedQty = Number.isInteger(quantity)
    ? quantity.toString()
    : quantity.toFixed(1).replace(/\.0$/, '');

  return `${formattedQty} ${unit}`;
}

/**
 * Generate a one-line summary for the grocery list.
 */
function generateSummary(items: NormalizedGroceryItem[]): string {
  if (items.length === 0) {
    return 'No items needed.';
  }

  if (items.length === 1) {
    const item = items[0];
    return `Pick up ${item.display_name} (${formatQuantity(item.total_quantity, item.unit)}).`;
  }

  if (items.length === 2) {
    return `Pick up ${items[0].display_name} and ${items[1].display_name}.`;
  }

  // More than 2 items
  const firstTwo = items.slice(0, 2).map((i) => i.display_name);
  const remaining = items.length - 2;
  return `Pick up ${firstTwo.join(', ')} and ${remaining} more item${remaining > 1 ? 's' : ''}.`;
}

/**
 * Normalize and deduplicate grocery add-ons.
 *
 * Logic:
 * - Deduplicates by canonical_name + unit
 * - Sums quantities for duplicates
 * - Assigns category via getIngredientCategory()
 * - Sorts by category order (produce → protein → dairy → pantry), then alphabetically
 * - Generates one-line summary
 *
 * @param addons - Raw grocery add-ons from plan result
 * @returns Normalized grocery list with summary
 */
export function normalizeGroceryAddons(
  addons: GroceryAddonInput[]
): NormalizedGroceryList {
  if (addons.length === 0) {
    return {
      items: [],
      summary: 'No items needed.',
    };
  }

  // Group by canonical_name + unit and sum quantities
  const grouped = new Map<string, NormalizedGroceryItem>();

  for (const addon of addons) {
    const key = `${addon.canonical_name}:${addon.unit}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.total_quantity += addon.required_quantity;
    } else {
      grouped.set(key, {
        canonical_name: addon.canonical_name,
        display_name: toDisplayName(addon.canonical_name),
        total_quantity: addon.required_quantity,
        unit: addon.unit,
        category: getIngredientCategory(addon.canonical_name),
      });
    }
  }

  // Convert to array
  const items = Array.from(grouped.values());

  // Sort by category order, then alphabetically by display name
  items.sort((a, b) => {
    const categoryDiff =
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.display_name.localeCompare(b.display_name);
  });

  return {
    items,
    summary: generateSummary(items),
  };
}

/**
 * Format a normalized grocery list for WhatsApp display.
 *
 * @param groceryList - Normalized grocery list
 * @returns Formatted string for WhatsApp
 */
export function formatGroceryListForWhatsApp(
  groceryList: NormalizedGroceryList
): string {
  if (groceryList.items.length === 0) {
    return 'You have everything you need!';
  }

  const lines: string[] = ['Shopping list:'];

  let currentCategory: IngredientCategory | null = null;

  for (const item of groceryList.items) {
    // Add category header if changed
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      // Only add category headers if we have multiple categories
      if (groceryList.items.some((i) => i.category !== groceryList.items[0].category)) {
        lines.push(`\n*${capitalize(item.category)}*`);
      }
    }

    lines.push(`- ${item.display_name} (${formatQuantity(item.total_quantity, item.unit)})`);
  }

  return lines.join('\n');
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

