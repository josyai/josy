/**
 * Planning Horizon Service
 *
 * Handles horizon computation and date management for multi-day planning.
 * All functions are pure and deterministic.
 */

import { addDays, parseISO, format, differenceInDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createHash } from 'crypto';
import {
  Horizon,
  HorizonModes,
  CalendarBlockInput,
  IntentOverride,
  PlanOptions,
  TimeInterval,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Date Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the list of planning dates for a given horizon.
 *
 * @param horizon - The planning horizon configuration
 * @param timezone - IANA timezone string
 * @param nowTs - Current timestamp
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function computePlanningDates(
  horizon: Horizon,
  timezone: string,
  nowTs: Date
): string[] {
  const nowLocal = toZonedTime(nowTs, timezone);
  const todayLocal = format(nowLocal, 'yyyy-MM-dd');

  switch (horizon.mode) {
    case HorizonModes.NEXT_MEAL:
      return [todayLocal];

    case HorizonModes.NEXT_N_DINNERS: {
      const nDinners = horizon.n_dinners || 1;
      const dates: string[] = [];
      let currentDate = nowLocal;

      for (let i = 0; i < nDinners; i++) {
        dates.push(format(currentDate, 'yyyy-MM-dd'));
        currentDate = addDays(currentDate, 1);
      }
      return dates;
    }

    case HorizonModes.DATE_RANGE: {
      if (!horizon.start_date_local || !horizon.end_date_local) {
        throw new Error('DATE_RANGE requires start_date_local and end_date_local');
      }

      const startDate = parseISO(horizon.start_date_local);
      const endDate = parseISO(horizon.end_date_local);
      const dayCount = differenceInDays(endDate, startDate) + 1;

      if (dayCount < 1 || dayCount > 14) {
        throw new Error('DATE_RANGE must be between 1 and 14 days');
      }

      const dates: string[] = [];
      let currentDate = startDate;

      for (let i = 0; i < dayCount; i++) {
        dates.push(format(currentDate, 'yyyy-MM-dd'));
        currentDate = addDays(currentDate, 1);
      }
      return dates;
    }

    default:
      throw new Error(`Unknown horizon mode: ${horizon.mode}`);
  }
}

/**
 * Normalize a horizon for response (ensure all fields are present).
 *
 * @param horizon - Input horizon
 * @param computedDates - The computed dates
 * @returns Normalized horizon object
 */
export function normalizeHorizon(
  horizon: Horizon,
  computedDates: string[]
): Horizon {
  switch (horizon.mode) {
    case HorizonModes.NEXT_MEAL:
      return { mode: HorizonModes.NEXT_MEAL };

    case HorizonModes.NEXT_N_DINNERS:
      return {
        mode: HorizonModes.NEXT_N_DINNERS,
        n_dinners: horizon.n_dinners || computedDates.length,
      };

    case HorizonModes.DATE_RANGE:
      return {
        mode: HorizonModes.DATE_RANGE,
        start_date_local: computedDates[0],
        end_date_local: computedDates[computedDates.length - 1],
      };

    default:
      return horizon;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dinner Window Building
// ─────────────────────────────────────────────────────────────────────────────

export interface DinnerWindow {
  dateLocal: string;
  windowStart: Date;
  windowEnd: Date;
  availableMinutes: number;
  busyBlocks: Array<{
    start: Date;
    end: Date;
    title: string | null;
  }>;
}

/**
 * Build dinner window for a specific date considering calendar blocks.
 *
 * @param dateLocal - Date in YYYY-MM-DD format
 * @param calendarBlocks - Calendar blocks to consider
 * @param timezone - IANA timezone
 * @param dinnerEarliestLocal - Earliest dinner time (HH:MM)
 * @param dinnerLatestLocal - Latest dinner time (HH:MM)
 * @returns DinnerWindow with availability info
 */
export function buildDinnerWindow(
  dateLocal: string,
  calendarBlocks: CalendarBlockInput[],
  timezone: string,
  dinnerEarliestLocal: string,
  dinnerLatestLocal: string
): DinnerWindow {
  // Parse the date and create window boundaries
  const date = parseISO(dateLocal);
  const [earliestHour, earliestMin] = dinnerEarliestLocal.split(':').map(Number);
  const [latestHour, latestMin] = dinnerLatestLocal.split(':').map(Number);

  const windowStart = new Date(date);
  windowStart.setHours(earliestHour, earliestMin, 0, 0);

  const windowEnd = new Date(date);
  windowEnd.setHours(latestHour, latestMin, 0, 0);

  // Filter calendar blocks that overlap with this day's dinner window
  const relevantBlocks = calendarBlocks
    .map((block) => ({
      start: parseISO(block.starts_at),
      end: parseISO(block.ends_at),
      title: block.title || null,
    }))
    .filter((block) => {
      // Check if block overlaps with dinner window
      return block.start < windowEnd && block.end > windowStart;
    });

  // Calculate available minutes (simplified - just subtract overlapping blocks)
  let totalMinutes = (windowEnd.getTime() - windowStart.getTime()) / (1000 * 60);

  for (const block of relevantBlocks) {
    const overlapStart = Math.max(windowStart.getTime(), block.start.getTime());
    const overlapEnd = Math.min(windowEnd.getTime(), block.end.getTime());
    if (overlapEnd > overlapStart) {
      totalMinutes -= (overlapEnd - overlapStart) / (1000 * 60);
    }
  }

  return {
    dateLocal,
    windowStart,
    windowEnd,
    availableMinutes: Math.max(0, totalMinutes),
    busyBlocks: relevantBlocks,
  };
}

/**
 * Get the midpoint timestamp for a dinner window.
 * Used as the "now_ts" for DPE when planning a specific day.
 *
 * @param window - Dinner window
 * @returns Midpoint Date
 */
export function getDinnerMidpoint(window: DinnerWindow): Date {
  const midTime = (window.windowStart.getTime() + window.windowEnd.getTime()) / 2;
  return new Date(midTime);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable Key Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic stable key for idempotency.
 *
 * @param householdId - Household ID
 * @param horizon - Planning horizon
 * @param intentOverrides - Intent overrides
 * @param options - Plan options
 * @param inventoryDigest - Hash of current inventory state
 * @param calendarDigest - Hash of calendar blocks
 * @returns Stable key string
 */
export function stableKeyForRequest(
  householdId: string,
  horizon: Horizon,
  intentOverrides: IntentOverride[],
  options: PlanOptions | undefined,
  inventoryDigest: string,
  calendarDigest: string
): string {
  const keyData = {
    householdId,
    horizon,
    intentOverrides: intentOverrides.sort((a, b) =>
      a.date_local.localeCompare(b.date_local)
    ),
    options: {
      exclude_recipe_slugs: options?.exclude_recipe_slugs?.sort() || [],
      variety_window_days: options?.variety_window_days ?? 7,
      stability_band_pct: options?.stability_band_pct ?? 10,
    },
    inventoryDigest,
    calendarDigest,
  };

  const hash = createHash('sha256');
  hash.update(JSON.stringify(keyData));
  return hash.digest('hex').substring(0, 32);
}

/**
 * Compute a digest of inventory state for stable key.
 *
 * @param items - Array of inventory items (id, canonicalName, quantity, unit, expirationDate)
 * @returns Hash string
 */
export function computeInventoryDigest(
  items: Array<{
    id: string;
    canonicalName: string;
    quantity: number | null;
    unit: string;
    expirationDate: Date | null;
  }>
): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const data = sorted.map((i) => ({
    id: i.id,
    name: i.canonicalName,
    qty: i.quantity,
    unit: i.unit,
    exp: i.expirationDate?.toISOString() || null,
  }));

  const hash = createHash('sha256');
  hash.update(JSON.stringify(data));
  return hash.digest('hex').substring(0, 16);
}

/**
 * Compute a digest of calendar blocks for stable key.
 *
 * @param blocks - Array of calendar blocks
 * @returns Hash string
 */
export function computeCalendarDigest(blocks: CalendarBlockInput[]): string {
  const sorted = [...blocks].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at)
  );

  const hash = createHash('sha256');
  hash.update(JSON.stringify(sorted));
  return hash.digest('hex').substring(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent Override Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get intent override for a specific date.
 *
 * @param dateLocal - Date in YYYY-MM-DD format
 * @param intentOverrides - Array of intent overrides
 * @returns Intent override for the date or undefined
 */
export function getIntentOverrideForDate(
  dateLocal: string,
  intentOverrides: IntentOverride[]
): IntentOverride | undefined {
  return intentOverrides.find((io) => io.date_local === dateLocal);
}

/**
 * Check if a recipe matches intent constraints.
 *
 * @param recipe - Recipe with slug, tags, and ingredients
 * @param intent - Intent override
 * @returns Object with match status and boost/penalty
 */
export function checkRecipeMatchesIntent(
  recipe: {
    slug: string;
    tags: string[];
    ingredientNames: string[];
  },
  intent: IntentOverride
): { matches: boolean; hardFail: boolean; boost: number } {
  let boost = 0;
  let hardFail = false;

  // Check must_include (at least one ingredient must be present)
  if (intent.must_include && intent.must_include.length > 0) {
    const hasAny = intent.must_include.some((ing) =>
      recipe.ingredientNames.includes(ing)
    );
    if (!hasAny) {
      // Not a hard fail by default, but significant penalty
      boost -= 50;
    } else {
      boost += 20;
    }
  }

  // Check must_exclude (none of these ingredients)
  if (intent.must_exclude && intent.must_exclude.length > 0) {
    const hasExcluded = intent.must_exclude.some((ing) =>
      recipe.ingredientNames.includes(ing)
    );
    if (hasExcluded) {
      hardFail = true;
    }
  }

  // Check preferred recipe slugs
  if (intent.preferred_recipe_slugs && intent.preferred_recipe_slugs.length > 0) {
    if (intent.preferred_recipe_slugs.includes(recipe.slug)) {
      boost += 30;
    }
  }

  // Check preferred tags
  if (intent.preferred_recipe_tags && intent.preferred_recipe_tags.length > 0) {
    const matchingTags = intent.preferred_recipe_tags.filter((tag) =>
      recipe.tags.includes(tag)
    );
    boost += matchingTags.length * 10;
  }

  return {
    matches: boost > 0 && !hardFail,
    hardFail,
    boost: hardFail ? -Infinity : boost,
  };
}
