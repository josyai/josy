import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { addMinutes, differenceInMinutes, startOfDay, parseISO } from 'date-fns';
import { prisma } from '../models/prisma';
import {
  CalendarBlockInput,
  TimeInterval,
  InventorySnapshot,
  RecipeCandidate,
  MissingIngredient,
  UsagePlanItem,
  DPETrace,
  PlanTonightResponse,
} from '../types';
import {
  InvalidInputError,
  NoFeasibleTimeWindowError,
  NoEligibleRecipeError,
} from '../utils/errors';
import type { Prisma } from '@prisma/client';

const DPE_VERSION = 'v0.1';

interface RecipeWithIngredients {
  id: string;
  slug: string;
  name: string;
  cookTimeMinutes: number;
  prepTimeMinutes: number;
  equipmentRequired: string[];
  instructionsMd: string;
  ingredients: Array<{
    canonicalName: string;
    requiredQuantity: number;
    unit: string;
    optional: boolean;
  }>;
}

interface HouseholdConfig {
  timezone: string;
  dinnerEarliestLocal: string;
  dinnerLatestLocal: string;
  hasOven: boolean;
  hasStovetop: boolean;
  hasBlender: boolean;
}

/**
 * Parse a time string (HH:MM) into hours and minutes
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Create a Date object for a specific time on a given day in a timezone
 */
function createTimeOnDate(
  date: Date,
  timeStr: string,
  timezone: string
): Date {
  const { hours, minutes } = parseTimeString(timeStr);
  const zonedDate = toZonedTime(date, timezone);
  const dayStart = startOfDay(zonedDate);
  const localTime = new Date(dayStart);
  localTime.setHours(hours, minutes, 0, 0);
  return fromZonedTime(localTime, timezone);
}

/**
 * Subtract calendar blocks from a time interval to get free intervals
 */
function subtractBlocks(
  interval: TimeInterval,
  blocks: Array<{ startsAt: Date; endsAt: Date }>
): TimeInterval[] {
  // Sort blocks by start time
  const sortedBlocks = [...blocks].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  const freeIntervals: TimeInterval[] = [];
  let currentStart = interval.start;

  for (const block of sortedBlocks) {
    // Skip blocks that don't overlap with our interval
    if (block.endsAt <= interval.start || block.startsAt >= interval.end) {
      continue;
    }

    // Clamp block to interval bounds
    const blockStart = block.startsAt < interval.start ? interval.start : block.startsAt;
    const blockEnd = block.endsAt > interval.end ? interval.end : block.endsAt;

    // Add free interval before this block if there's space
    if (currentStart < blockStart) {
      const minutes = differenceInMinutes(blockStart, currentStart);
      if (minutes > 0) {
        freeIntervals.push({
          start: currentStart,
          end: blockStart,
          minutes,
        });
      }
    }

    // Move current start past this block
    if (blockEnd > currentStart) {
      currentStart = blockEnd;
    }
  }

  // Add remaining interval after all blocks
  if (currentStart < interval.end) {
    const minutes = differenceInMinutes(interval.end, currentStart);
    if (minutes > 0) {
      freeIntervals.push({
        start: currentStart,
        end: interval.end,
        minutes,
      });
    }
  }

  return freeIntervals;
}

/**
 * Pick the longest interval, then earliest if tied
 */
function pickLongestThenEarliest(intervals: TimeInterval[]): TimeInterval | null {
  if (intervals.length === 0) return null;

  return intervals.reduce((best, current) => {
    if (current.minutes > best.minutes) return current;
    if (current.minutes === best.minutes && current.start < best.start) return current;
    return best;
  });
}

/**
 * Check if household has required equipment for a recipe
 */
function checkEquipment(
  required: string[],
  household: HouseholdConfig
): boolean {
  for (const eq of required) {
    if (eq === 'oven' && !household.hasOven) return false;
    if (eq === 'stovetop' && !household.hasStovetop) return false;
    if (eq === 'blender' && !household.hasBlender) return false;
  }
  return true;
}

/**
 * Compute expiration urgency for an inventory item
 * Returns 0 for null expiration, or weight based on days to expiration
 */
function computeUrgency(expirationDate: Date | null, todayLocal: Date): number {
  if (!expirationDate) return 0;

  const daysToExp = Math.floor(
    (expirationDate.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysToExp < 0) return -1; // Expired, should be filtered out
  if (daysToExp <= 1) return 5;
  if (daysToExp <= 3) return 3;
  if (daysToExp <= 7) return 1;
  return 0;
}

/**
 * Compute usage plan and missing ingredients for a recipe
 * Uses deterministic allocation: earliest expiration first, then oldest created_at
 */
function computeUsageAndMissing(
  ingredients: Array<{
    canonicalName: string;
    requiredQuantity: number;
    unit: string;
    optional: boolean;
  }>,
  inventory: InventorySnapshot[],
  todayLocal: Date
): { usagePlan: UsagePlanItem[]; missingRequired: MissingIngredient[] } {
  const usagePlan: UsagePlanItem[] = [];
  const missingRequired: MissingIngredient[] = [];

  for (const ing of ingredients) {
    if (ing.optional) continue; // Skip optional ingredients for v0.1

    const needed = Number(ing.requiredQuantity);
    let remaining = needed;

    // Find matching inventory items (same canonical name and unit)
    const matchingItems = inventory
      .filter(
        (item) =>
          item.canonicalName === ing.canonicalName &&
          item.unit === ing.unit &&
          item.quantity > 0
      )
      .sort((a, b) => {
        // Sort by expiration date (earliest first, nulls last)
        if (a.expirationDate && b.expirationDate) {
          const diff = a.expirationDate.getTime() - b.expirationDate.getTime();
          if (diff !== 0) return diff;
        } else if (a.expirationDate && !b.expirationDate) {
          return -1;
        } else if (!a.expirationDate && b.expirationDate) {
          return 1;
        }
        // Then by created_at (oldest first)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    for (const item of matchingItems) {
      if (remaining <= 0) break;

      const toConsume = Math.min(remaining, item.quantity);
      usagePlan.push({
        inventoryItemId: item.id,
        canonicalName: item.canonicalName,
        consumedQuantity: toConsume,
        unit: item.unit,
      });

      remaining -= toConsume;
      // Reduce available quantity for subsequent calculations
      item.quantity -= toConsume;
    }

    if (remaining > 0) {
      missingRequired.push({
        canonicalName: ing.canonicalName,
        requiredQuantity: remaining,
        unit: ing.unit,
      });
    }
  }

  return { usagePlan, missingRequired };
}

/**
 * Compute waste score based on urgency of items being used
 */
function computeWasteScore(
  usagePlan: UsagePlanItem[],
  originalInventory: InventorySnapshot[],
  todayLocal: Date
): number {
  let score = 0;

  for (const usage of usagePlan) {
    const item = originalInventory.find((i) => i.id === usage.inventoryItemId);
    if (!item) continue;

    const urgency = computeUrgency(item.expirationDate, todayLocal);
    if (urgency > 0) {
      // Weight by fraction of item being used
      const originalQty = item.quantity;
      const fractionUsed = originalQty > 0 ? usage.consumedQuantity / originalQty : 0;
      score += urgency * fractionUsed;
    }
  }

  return score;
}

/**
 * Generate deterministic "why" explanations (no LLM)
 */
function generateWhy(
  candidate: RecipeCandidate,
  originalInventory: InventorySnapshot[],
  todayLocal: Date,
  intervalMinutes: number
): string[] {
  const reasons: string[] = [];

  // Check for items with high urgency
  const urgentItems: string[] = [];
  for (const usage of candidate.usagePlan) {
    const item = originalInventory.find((i) => i.id === usage.inventoryItemId);
    if (item) {
      const urgency = computeUrgency(item.expirationDate, todayLocal);
      if (urgency >= 3) {
        urgentItems.push(
          `${item.canonicalName} (urgency=${urgency})`
        );
      }
    }
  }

  if (urgentItems.length > 0) {
    reasons.push(`Uses items expiring soon: ${urgentItems.join(', ')}`);
  }

  // Missing ingredients count
  const missingCount = candidate.missingRequired.length;
  if (missingCount === 0) {
    reasons.push('All required ingredients available in inventory');
  } else {
    reasons.push(`Requires ${missingCount} missing ingredient${missingCount > 1 ? 's' : ''}`);
  }

  // Time fit
  reasons.push(
    `Fits in your available window (${candidate.totalTimeMinutes} min recipe, ${intervalMinutes} min available)`
  );

  return reasons;
}

/**
 * Main DPE function: planTonight
 */
export async function planTonight(
  householdId: string,
  nowTs: Date,
  calendarBlocksInput: CalendarBlockInput[]
): Promise<PlanTonightResponse> {
  // 1. Load household
  const household = await prisma.household.findUnique({
    where: { id: householdId },
  });

  if (!household) {
    throw new InvalidInputError('Household not found', { householdId });
  }

  const tz = household.timezone;
  const nowLocal = toZonedTime(nowTs, tz);
  const todayLocal = startOfDay(nowLocal);

  // 2. Compute dinner window
  const dinnerEarliest = createTimeOnDate(nowTs, household.dinnerEarliestLocal, tz);
  const dinnerLatest = createTimeOnDate(nowTs, household.dinnerLatestLocal, tz);

  // window_start = max(now + 15m, dinner_earliest)
  const nowPlus15 = addMinutes(nowTs, 15);
  const windowStart = nowPlus15 > dinnerEarliest ? nowPlus15 : dinnerEarliest;
  const windowEnd = dinnerLatest;

  if (windowStart >= windowEnd) {
    throw new NoFeasibleTimeWindowError({
      reason: 'Dinner window has passed or is too short',
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
  }

  // 3. Store calendar blocks and compute free intervals
  const calendarBlocks: Array<{ startsAt: Date; endsAt: Date; source: string; title: string | null }> = [];

  for (const block of calendarBlocksInput) {
    const startsAt = parseISO(block.starts_at);
    const endsAt = parseISO(block.ends_at);

    // Store for traceability
    await prisma.calendarBlock.create({
      data: {
        householdId,
        source: block.source,
        startsAt,
        endsAt,
        title: block.title || null,
      },
    });

    calendarBlocks.push({
      startsAt,
      endsAt,
      source: block.source,
      title: block.title || null,
    });
  }

  const dinnerWindow: TimeInterval = {
    start: windowStart,
    end: windowEnd,
    minutes: differenceInMinutes(windowEnd, windowStart),
  };

  const freeIntervals = subtractBlocks(dinnerWindow, calendarBlocks);

  if (freeIntervals.length === 0) {
    throw new NoFeasibleTimeWindowError({
      reason: 'Calendar blocks cover entire dinner window',
    });
  }

  const selectedInterval = pickLongestThenEarliest(freeIntervals);
  if (!selectedInterval) {
    throw new NoFeasibleTimeWindowError({
      reason: 'No free interval found',
    });
  }

  // 4. Load inventory (exclude expired items)
  const inventoryRaw = await prisma.inventoryItem.findMany({
    where: {
      householdId,
      quantity: { gt: 0 },
    },
    orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
  });

  // Filter out expired items
  const inventorySnapshot: InventorySnapshot[] = inventoryRaw
    .filter((item) => {
      if (!item.expirationDate) return true;
      const urgency = computeUrgency(item.expirationDate, todayLocal);
      return urgency >= 0; // Keep non-expired
    })
    .map((item) => ({
      id: item.id,
      canonicalName: item.canonicalName,
      quantity: Number(item.quantity),
      unit: item.unit,
      expirationDate: item.expirationDate,
      createdAt: item.createdAt,
    }));

  // Keep a copy for scoring (before mutations)
  const originalInventory = inventorySnapshot.map((i) => ({ ...i }));

  // 5. Load recipes
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: true },
  });

  // 6. Evaluate candidates
  const candidates: RecipeCandidate[] = [];

  for (const recipe of recipes) {
    const totalTime = recipe.prepTimeMinutes + recipe.cookTimeMinutes;

    // Check equipment
    if (!checkEquipment(recipe.equipmentRequired, household)) {
      candidates.push({
        recipeId: recipe.id,
        recipeSlug: recipe.slug,
        recipeName: recipe.name,
        totalTimeMinutes: totalTime,
        eligible: false,
        ineligibilityReason: 'Missing required equipment',
        missingRequired: [],
        usagePlan: [],
        scores: { wasteScore: 0, spendPenalty: 0, timePenalty: 0, final: -Infinity },
      });
      continue;
    }

    // Check time
    if (selectedInterval.minutes < totalTime) {
      candidates.push({
        recipeId: recipe.id,
        recipeSlug: recipe.slug,
        recipeName: recipe.name,
        totalTimeMinutes: totalTime,
        eligible: false,
        ineligibilityReason: `Recipe requires ${totalTime} min but only ${selectedInterval.minutes} min available`,
        missingRequired: [],
        usagePlan: [],
        scores: { wasteScore: 0, spendPenalty: 0, timePenalty: 0, final: -Infinity },
      });
      continue;
    }

    // Compute usage and missing (use a copy of inventory to allow mutation)
    const invCopy = inventorySnapshot.map((i) => ({ ...i }));
    const ingredientsWithNumbers = recipe.ingredients.map((ing) => ({
      canonicalName: ing.canonicalName,
      requiredQuantity: Number(ing.requiredQuantity),
      unit: ing.unit,
      optional: ing.optional,
    }));
    const { usagePlan, missingRequired } = computeUsageAndMissing(
      ingredientsWithNumbers,
      invCopy,
      todayLocal
    );

    // Compute scores
    const wasteScore = computeWasteScore(usagePlan, originalInventory, todayLocal);
    const spendPenalty = missingRequired.length * 10;
    const timePenalty = totalTime * 0.2;
    const finalScore = wasteScore - spendPenalty - timePenalty;

    candidates.push({
      recipeId: recipe.id,
      recipeSlug: recipe.slug,
      recipeName: recipe.name,
      totalTimeMinutes: totalTime,
      eligible: true,
      missingRequired,
      usagePlan,
      scores: {
        wasteScore,
        spendPenalty,
        timePenalty,
        final: finalScore,
      },
    });
  }

  // 7. Select winner
  const eligibleCandidates = candidates.filter((c) => c.eligible);

  if (eligibleCandidates.length === 0) {
    throw new NoEligibleRecipeError({
      free_interval_minutes: selectedInterval.minutes,
      totalCandidatesEvaluated: candidates.length,
    });
  }

  // Sort by deterministic tie-breakers
  eligibleCandidates.sort((a, b) => {
    // 1. Higher final score first
    if (b.scores.final !== a.scores.final) {
      return b.scores.final - a.scores.final;
    }
    // 2. Fewer missing ingredients
    if (a.missingRequired.length !== b.missingRequired.length) {
      return a.missingRequired.length - b.missingRequired.length;
    }
    // 3. Higher waste score
    if (b.scores.wasteScore !== a.scores.wasteScore) {
      return b.scores.wasteScore - a.scores.wasteScore;
    }
    // 4. Shorter total time
    if (a.totalTimeMinutes !== b.totalTimeMinutes) {
      return a.totalTimeMinutes - b.totalTimeMinutes;
    }
    // 5. Lexicographic slug
    return a.recipeSlug.localeCompare(b.recipeSlug);
  });

  const winner = eligibleCandidates[0];

  // 8. Build trace
  const trace: DPETrace = {
    version: DPE_VERSION,
    nowTs: nowTs.toISOString(),
    timezone: tz,
    computedWindow: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
    },
    calendarBlocksConsidered: calendarBlocks.map((b) => ({
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      source: b.source,
      title: b.title,
    })),
    freeIntervals: freeIntervals.map((i) => ({
      start: i.start.toISOString(),
      end: i.end.toISOString(),
      minutes: i.minutes,
    })),
    selectedInterval: {
      start: selectedInterval.start.toISOString(),
      end: selectedInterval.end.toISOString(),
      minutes: selectedInterval.minutes,
    },
    inventorySnapshot: originalInventory.map((i) => ({
      id: i.id,
      canonicalName: i.canonicalName,
      quantity: i.quantity,
      unit: i.unit,
      expirationDate: i.expirationDate?.toISOString().split('T')[0] || null,
    })),
    candidates,
    winner: {
      recipeSlug: winner.recipeSlug,
      finalScore: winner.scores.final,
    },
    warnings: [],
  };

  // 9. Persist plan
  const plan = await prisma.plan.create({
    data: {
      householdId,
      planDateLocal: todayLocal,
      selectedRecipeId: winner.recipeId,
      status: 'proposed',
      feasibleWindowStart: selectedInterval.start,
      feasibleWindowEnd: selectedInterval.end,
      dpeTraceJson: trace as unknown as Prisma.InputJsonValue,
    },
  });

  // Persist consumptions
  for (const usage of winner.usagePlan) {
    await prisma.planConsumption.create({
      data: {
        planId: plan.id,
        inventoryItemId: usage.inventoryItemId,
        consumedQuantity: usage.consumedQuantity,
        unit: usage.unit,
      },
    });
  }

  // Persist grocery add-ons
  for (const missing of winner.missingRequired) {
    await prisma.planGroceryAddon.create({
      data: {
        planId: plan.id,
        canonicalName: missing.canonicalName,
        requiredQuantity: missing.requiredQuantity,
        unit: missing.unit,
      },
    });
  }

  // 10. Load full recipe for response
  const selectedRecipe = await prisma.recipe.findUnique({
    where: { id: winner.recipeId },
  });

  if (!selectedRecipe) {
    throw new Error('Selected recipe not found - this should never happen');
  }

  // 11. Generate why
  const why = generateWhy(winner, originalInventory, todayLocal, selectedInterval.minutes);

  // 12. Build response
  const response: PlanTonightResponse = {
    plan_id: plan.id,
    plan_date_local: todayLocal.toISOString().split('T')[0],
    feasible_window: {
      start: selectedInterval.start.toISOString(),
      end: selectedInterval.end.toISOString(),
    },
    recipe: {
      id: selectedRecipe.id,
      slug: selectedRecipe.slug,
      name: selectedRecipe.name,
      total_time_minutes: winner.totalTimeMinutes,
      instructions_md: selectedRecipe.instructionsMd,
    },
    inventory_to_consume: winner.usagePlan.map((u) => ({
      inventory_item_id: u.inventoryItemId,
      canonical_name: u.canonicalName,
      consumed_quantity: u.consumedQuantity,
      unit: u.unit,
    })),
    grocery_addons: winner.missingRequired.map((m) => ({
      canonical_name: m.canonicalName,
      required_quantity: m.requiredQuantity,
      unit: m.unit,
    })),
    why,
  };

  return response;
}
