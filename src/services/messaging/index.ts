/**
 * Messaging Module v0.7
 *
 * Single source of truth for all assistant-facing text.
 * All messages are derived from deterministic outputs (plan payload + reasoning_trace).
 * No DB lookups inside this module.
 *
 * Style rules:
 * - Short, directive, assistant-like
 * - Always include: what's recommended, why (1-2 bullets), what user can do next
 * - Grocery summary: "Grocery: X items" + top 3 items max
 * - Never include raw JSON or internal module names
 */

import { format, parseISO } from 'date-fns';
import {
  PlanResponse,
  PlanDayResponse,
  NormalizedGroceryList,
  ReasoningTrace,
  PlanSetReasoningTrace,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DayPlanMessageArgs {
  dateLocal: string;
  recipeName: string;
  totalTimeMinutes: number;
  whyReasons: string[];
  groceryAddons: Array<{ canonical_name: string; required_quantity: number; unit: string }>;
}

export interface PlanSetSummaryMessageArgs {
  dayCount: number;
  days: Array<{
    dateLocal: string;
    recipeName: string;
  }>;
  groceryList: NormalizedGroceryList | null;
  traceHighlights?: {
    topFactors?: string[];
    keptDays?: number;
    changedDays?: number;
  };
}

export interface SwapResultMessageArgs {
  dateLocal: string;
  oldRecipeName: string;
  newRecipeName: string;
  newRecipeTime: number;
  whyReasons: string[];
  groceryAddons: Array<{ canonical_name: string }>;
}

export interface ConfirmMessageArgs {
  dayCount: number;
  firstRecipeName: string;
  groceryItemCount: number;
}

export type ErrorCode = 'NO_ACTIVE_PLAN' | 'INVALID_DAY' | 'NEEDS_HOUSEHOLD' | 'INTERNAL';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DAY_MESSAGE_LENGTH = 600;
const MAX_SUMMARY_MESSAGE_LENGTH = 1200;
const MAX_GROCERY_ITEMS_SHOWN = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format date as weekday name (e.g., "Tuesday") or "Tonight"/"Tomorrow"
 */
function formatWeekday(dateLocal: string): string {
  const date = parseISO(dateLocal);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr = format(today, 'yyyy-MM-dd');
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');

  if (dateLocal === todayStr) {
    return 'Tonight';
  }
  if (dateLocal === tomorrowStr) {
    return 'Tomorrow';
  }
  return format(date, 'EEEE'); // Full weekday name
}

/**
 * Format weekday as short name for commands (e.g., "TUE")
 */
function formatWeekdayShort(dateLocal: string): string {
  const date = parseISO(dateLocal);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr = format(today, 'yyyy-MM-dd');
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');

  if (dateLocal === todayStr) {
    return 'TODAY';
  }
  if (dateLocal === tomorrowStr) {
    return 'TOMORROW';
  }
  return format(date, 'EEE').toUpperCase(); // Short weekday (TUE, WED, etc.)
}

/**
 * Extract "why" reasons from reasoning trace
 */
export function extractWhyReasons(trace: ReasoningTrace | null, recipeSlug: string): string[] {
  if (!trace) return ['Uses your available ingredients'];

  const reasons: string[] = [];

  // Find the winning recipe info
  const winner = trace.eligible_recipes?.find((r) => r.recipe === recipeSlug);

  if (winner) {
    // Check for expiring ingredients (waste score)
    if (winner.scores?.waste > 0) {
      reasons.push('Uses ingredients expiring soon');
    }

    // Check what inventory is being used
    if (winner.uses_inventory && winner.uses_inventory.length > 0) {
      const topItems = winner.uses_inventory.slice(0, 2).join(', ');
      reasons.push(`Uses your ${topItems}`);
    }

    // Check for missing ingredients (grocery penalty)
    if (winner.missing_ingredients && winner.missing_ingredients.length === 0) {
      reasons.push('No grocery shopping needed');
    } else if (winner.missing_ingredients && winner.missing_ingredients.length <= 2) {
      reasons.push('Minimal grocery add-ons');
    }

    // Time consideration
    if (winner.scores?.time_penalty === 0) {
      reasons.push('Fits your available time');
    }
  }

  // Fallback if no specific reasons
  if (reasons.length === 0) {
    reasons.push('Best match for your inventory and time');
  }

  return reasons.slice(0, 2); // Max 2 reasons
}

/**
 * Format grocery summary
 */
function formatGrocerySummary(
  groceryList: NormalizedGroceryList | null,
  addons?: Array<{ canonical_name: string }>
): string | null {
  if (groceryList && groceryList.items.length > 0) {
    const count = groceryList.items.length;
    const topItems = groceryList.items
      .slice(0, MAX_GROCERY_ITEMS_SHOWN)
      .map((i) => i.display_name || i.canonical_name)
      .join(', ');
    return `${count} item${count > 1 ? 's' : ''} (${topItems})`;
  }

  if (addons && addons.length > 0) {
    const count = addons.length;
    const topItems = addons
      .slice(0, MAX_GROCERY_ITEMS_SHOWN)
      .map((i) => i.canonical_name)
      .join(', ');
    return `${count} item${count > 1 ? 's' : ''} (${topItems})`;
  }

  return null;
}

/**
 * Truncate message to max length
 */
function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.substring(0, maxLength - 3) + '...';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Builder Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a single day plan message.
 *
 * Template:
 * "Dinner {weekday}: {recipe_name}"
 * "Why: {reason1}; {reason2}"
 * "Grocery add-ons: {summary}"
 * "Reply: SWAP {weekday} / CONFIRM"
 */
export function buildDayPlanMessage(args: DayPlanMessageArgs): string {
  const { dateLocal, recipeName, whyReasons, groceryAddons } = args;

  const weekday = formatWeekday(dateLocal);
  const weekdayShort = formatWeekdayShort(dateLocal);

  const lines: string[] = [];

  // Main recommendation
  lines.push(`Dinner ${weekday}: ${recipeName}`);

  // Why
  if (whyReasons.length > 0) {
    lines.push(`Why: ${whyReasons.join('; ')}`);
  }

  // Grocery add-ons
  const grocerySummary = formatGrocerySummary(null, groceryAddons);
  if (grocerySummary) {
    lines.push(`Grocery add-ons: ${grocerySummary}`);
  } else {
    lines.push('Grocery add-ons: None needed');
  }

  // Next action
  lines.push(`Reply: SWAP ${weekdayShort} / CONFIRM`);

  const message = lines.join('\n');
  return truncateMessage(message, MAX_DAY_MESSAGE_LENGTH);
}

/**
 * Build a plan set summary message (multi-day horizon).
 *
 * Template:
 * "Here's your next {N} dinners:"
 * list each day: "Tue — Recipe"
 * "Grocery: {X} items ({top 3})"
 * "Reply: SWAP TUE / CONFIRM PLAN"
 */
export function buildPlanSetSummaryMessage(args: PlanSetSummaryMessageArgs): string {
  const { dayCount, days, groceryList } = args;

  const lines: string[] = [];

  // Header
  if (dayCount === 1) {
    lines.push("Here's your dinner plan:");
  } else {
    lines.push(`Here's your next ${dayCount} dinners:`);
  }

  lines.push('');

  // Day list
  for (const day of days) {
    const weekday = formatWeekday(day.dateLocal);
    const weekdayShort = weekday.length > 9 ? format(parseISO(day.dateLocal), 'EEE') : weekday;
    lines.push(`${weekdayShort} — ${day.recipeName}`);
  }

  // Grocery summary
  const grocerySummary = formatGrocerySummary(groceryList);
  if (grocerySummary) {
    lines.push('');
    lines.push(`Grocery: ${grocerySummary}`);
  }

  // Next action
  lines.push('');
  if (dayCount === 1) {
    const dayShort = formatWeekdayShort(days[0].dateLocal);
    lines.push(`Reply: SWAP ${dayShort} / CONFIRM`);
  } else {
    const firstDayShort = formatWeekdayShort(days[0].dateLocal);
    lines.push(`Reply: SWAP ${firstDayShort} / CONFIRM PLAN`);
  }

  const message = lines.join('\n');
  return truncateMessage(message, MAX_SUMMARY_MESSAGE_LENGTH);
}

/**
 * Build a swap result message.
 */
export function buildSwapResultMessage(args: SwapResultMessageArgs): string {
  const { dateLocal, oldRecipeName, newRecipeName, newRecipeTime, whyReasons, groceryAddons } = args;

  const weekday = formatWeekday(dateLocal);
  const weekdayShort = formatWeekdayShort(dateLocal);

  const lines: string[] = [];

  // Swap confirmation
  lines.push(`Swapped ${weekday}: ${newRecipeName}`);
  lines.push(`(was: ${oldRecipeName})`);

  // Why
  if (whyReasons.length > 0) {
    lines.push(`Why: ${whyReasons.join('; ')}`);
  }

  // Time
  lines.push(`Time: ${newRecipeTime} min`);

  // Grocery
  const grocerySummary = formatGrocerySummary(null, groceryAddons);
  if (grocerySummary) {
    lines.push(`Grocery add-ons: ${grocerySummary}`);
  }

  // Next action
  lines.push('');
  lines.push(`Reply: SWAP ${weekdayShort} again / CONFIRM`);

  const message = lines.join('\n');
  return truncateMessage(message, MAX_DAY_MESSAGE_LENGTH);
}

/**
 * Build a confirm message.
 */
export function buildConfirmMessage(args: ConfirmMessageArgs): string {
  const { dayCount, firstRecipeName, groceryItemCount } = args;

  const lines: string[] = [];

  if (dayCount === 1) {
    lines.push(`Plan confirmed: ${firstRecipeName}`);
  } else {
    lines.push(`Plan confirmed: ${dayCount} dinners starting with ${firstRecipeName}`);
  }

  if (groceryItemCount > 0) {
    lines.push(`Don't forget: ${groceryItemCount} grocery item${groceryItemCount > 1 ? 's' : ''} to pick up`);
  }

  lines.push('');
  lines.push('Enjoy your meal! Reply anytime to plan again.');

  return lines.join('\n');
}

/**
 * Build an error message with stable codes.
 */
export function buildErrorMessage(code: ErrorCode, context?: Record<string, unknown>): string {
  switch (code) {
    case 'NO_ACTIVE_PLAN':
      return "No active plan to modify. Say \"what's for dinner\" to get a new recommendation.";

    case 'INVALID_DAY':
      const dayHint = context?.day ? ` "${context.day}"` : '';
      return `I couldn't find${dayHint} in your current plan. Try "SWAP TUE" or "SWAP TOMORROW".`;

    case 'NEEDS_HOUSEHOLD':
      return "I don't have your household set up yet. Please contact support to get started.";

    case 'INTERNAL':
      return "Something went wrong on my end. Please try again in a moment.";

    default:
      return "I couldn't process that request. Please try again.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions for API Responses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build assistant message for a PlanDayResponse
 */
export function buildDayMessageFromResponse(day: PlanDayResponse): string {
  const whyReasons = extractWhyReasons(day.reasoning_trace, day.recipe.slug);

  return buildDayPlanMessage({
    dateLocal: day.date_local,
    recipeName: day.recipe.name,
    totalTimeMinutes: day.recipe.total_time_minutes,
    whyReasons,
    groceryAddons: day.grocery_addons,
  });
}

/**
 * Build assistant message for a full PlanResponse
 */
export function buildSummaryMessageFromResponse(response: PlanResponse): string {
  return buildPlanSetSummaryMessage({
    dayCount: response.days.length,
    days: response.days.map((d) => ({
      dateLocal: d.date_local,
      recipeName: d.recipe.name,
    })),
    groceryList: response.grocery_list_normalized,
    traceHighlights: response.reasoning_trace
      ? {
          topFactors: response.reasoning_trace.inputs_summary
            ? [`${response.reasoning_trace.inputs_summary.inventory_item_count} inventory items`]
            : undefined,
          keptDays: response.reasoning_trace.stability_decisions?.filter(
            (s) => s.decision === 'kept'
          ).length,
          changedDays: response.reasoning_trace.stability_decisions?.filter(
            (s) => s.decision === 'changed'
          ).length,
        }
      : undefined,
  });
}
