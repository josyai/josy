/**
 * DPE (Deterministic Planning Engine) - Main Orchestrator
 *
 * This is the entry point for dinner planning. It coordinates:
 * - Time window calculation
 * - Inventory allocation
 * - Recipe scoring and selection
 * - Plan persistence
 *
 * All subfunctions are pure and deterministic.
 * See docs/dpe-rules-v0.md for the full decision tables.
 */

import { toZonedTime } from 'date-fns-tz';
import { addMinutes, differenceInMinutes, startOfDay, parseISO } from 'date-fns';
import { prisma } from '../../models/prisma';
import {
  CalendarBlockInput,
  TimeInterval,
  InventorySnapshot,
  RecipeCandidate,
  DPETrace,
  PlanTonightResponse,
  ReasoningTrace,
  EligibleRecipe,
  RejectedRecipe,
  InventorySnapshotTrace,
} from '../../types';
import {
  InvalidInputError,
  NoFeasibleTimeWindowError,
  NoEligibleRecipeError,
} from '../../utils/errors';
import type { Prisma } from '@prisma/client';

// Import pure functions from submodules
import { DPE_VERSION, SCORING } from './constants';
import { createTimeOnDate, subtractBlocks, pickLongestThenEarliest } from './time';
import { computeUrgency, computeWasteScore } from './scoring';
import { computeUsageAndMissing } from './allocation';
import { checkEquipment } from './equipment';
import { generateWhy, determineTieBreaker } from './explanations';

// Re-export for external use
export { DPE_VERSION, SCORING };
export { computeUrgency } from './scoring';
export { checkEquipment } from './equipment';

/**
 * Main DPE function: Plan tonight's dinner.
 *
 * Algorithm:
 * 1. Load household configuration
 * 2. Compute dinner window and free intervals
 * 3. Load inventory (exclude expired/depleted)
 * 4. Load and evaluate all recipes
 * 5. Select winner using scoring + tie-breakers
 * 6. Persist plan and return response
 *
 * @param householdId - Household to plan for
 * @param nowTs - Current timestamp
 * @param calendarBlocksInput - Calendar blocks (busy periods)
 * @returns Complete plan response with recipe, inventory usage, and trace
 */
export async function planTonight(
  householdId: string,
  nowTs: Date,
  calendarBlocksInput: CalendarBlockInput[]
): Promise<PlanTonightResponse> {
  // ─────────────────────────────────────────────────────────────
  // STEP 1: Load household
  // ─────────────────────────────────────────────────────────────
  const household = await prisma.household.findUnique({
    where: { id: householdId },
  });

  if (!household) {
    throw new InvalidInputError('Household not found', { householdId });
  }

  const tz = household.timezone;
  const nowLocal = toZonedTime(nowTs, tz);
  const todayLocal = startOfDay(nowLocal);

  // ─────────────────────────────────────────────────────────────
  // STEP 2: Compute dinner window
  // ─────────────────────────────────────────────────────────────
  const dinnerEarliest = createTimeOnDate(nowTs, household.dinnerEarliestLocal, tz);
  const dinnerLatest = createTimeOnDate(nowTs, household.dinnerLatestLocal, tz);

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

  // ─────────────────────────────────────────────────────────────
  // STEP 3: Process calendar blocks and compute free intervals
  // ─────────────────────────────────────────────────────────────
  const calendarBlocks: Array<{ startsAt: Date; endsAt: Date; source: string; title: string | null }> = [];

  for (const block of calendarBlocksInput) {
    const startsAt = parseISO(block.starts_at);
    const endsAt = parseISO(block.ends_at);

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

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Load inventory (exclude expired, include unknown qty)
  // ─────────────────────────────────────────────────────────────
  const inventoryRaw = await prisma.inventoryItem.findMany({
    where: {
      householdId,
      assumedDepleted: false,
      OR: [
        { quantity: { gt: 0 } },
        { quantityConfidence: 'unknown' },
      ],
    },
    orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
  });

  const inventorySnapshot: InventorySnapshot[] = inventoryRaw
    .filter((item) => {
      if (!item.expirationDate) return true;
      const urgency = computeUrgency(item.expirationDate, todayLocal);
      return urgency >= 0; // Exclude expired items
    })
    .map((item) => ({
      id: item.id,
      canonicalName: item.canonicalName,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      quantityConfidence: item.quantityConfidence as 'exact' | 'estimate' | 'unknown',
      unit: item.unit,
      expirationDate: item.expirationDate,
      createdAt: item.createdAt,
    }));

  const originalInventory = inventorySnapshot.map((i) => ({ ...i }));

  // Build inventory snapshot for trace with urgency
  const inventorySnapshotTrace: InventorySnapshotTrace[] = originalInventory.map((item) => ({
    canonical_name: item.canonicalName,
    quantity: item.quantity,
    quantity_confidence: item.quantityConfidence,
    unit: item.unit,
    expiration_date: item.expirationDate?.toISOString().split('T')[0] || null,
    urgency: computeUrgency(item.expirationDate, todayLocal),
  }));

  // ─────────────────────────────────────────────────────────────
  // STEP 5: Load recipes and evaluate candidates
  // ─────────────────────────────────────────────────────────────
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: true },
  });

  const candidates: RecipeCandidate[] = [];
  const eligibleRecipesTrace: EligibleRecipe[] = [];
  const rejectedRecipesTrace: RejectedRecipe[] = [];

  for (const recipe of recipes) {
    const totalTime = recipe.prepTimeMinutes + recipe.cookTimeMinutes;

    // Check equipment (hard constraint)
    const equipmentCheck = checkEquipment(recipe.equipmentRequired, household);
    if (!equipmentCheck.ok) {
      candidates.push({
        recipeId: recipe.id,
        recipeSlug: recipe.slug,
        recipeName: recipe.name,
        totalTimeMinutes: totalTime,
        eligible: false,
        ineligibilityReason: `Missing equipment: ${equipmentCheck.missing.join(', ')}`,
        missingRequired: [],
        usagePlan: [],
        scores: { wasteScore: 0, spendPenalty: 0, timePenalty: 0, final: -Infinity },
      });

      rejectedRecipesTrace.push({
        recipe: recipe.slug,
        eligible: false,
        reason: `Missing equipment: ${equipmentCheck.missing.join(', ')}`,
      });
      continue;
    }

    // Check time (hard constraint)
    if (selectedInterval.minutes < totalTime) {
      candidates.push({
        recipeId: recipe.id,
        recipeSlug: recipe.slug,
        recipeName: recipe.name,
        totalTimeMinutes: totalTime,
        eligible: false,
        ineligibilityReason: `Insufficient time: requires ${totalTime} min, only ${selectedInterval.minutes} min available`,
        missingRequired: [],
        usagePlan: [],
        scores: { wasteScore: 0, spendPenalty: 0, timePenalty: 0, final: -Infinity },
      });

      rejectedRecipesTrace.push({
        recipe: recipe.slug,
        eligible: false,
        reason: `Insufficient time: requires ${totalTime} min, only ${selectedInterval.minutes} min available`,
      });
      continue;
    }

    // Compute usage and missing ingredients
    const invCopy = inventorySnapshot.map((i) => ({ ...i }));
    const ingredientsWithNumbers = recipe.ingredients.map((ing) => ({
      canonicalName: ing.canonicalName,
      requiredQuantity: Number(ing.requiredQuantity),
      unit: ing.unit,
      optional: ing.optional,
    }));
    const { usagePlan, missingRequired } = computeUsageAndMissing(
      ingredientsWithNumbers,
      invCopy
    );

    // Compute scores
    const wasteScore = computeWasteScore(usagePlan, originalInventory, todayLocal);
    const spendPenalty = missingRequired.length * SCORING.GROCERY_PENALTY_PER_ITEM;
    const timePenalty = totalTime * SCORING.TIME_PENALTY_FACTOR;
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

    eligibleRecipesTrace.push({
      recipe: recipe.slug,
      eligible: true,
      rejections: [],
      scores: {
        waste: wasteScore,
        grocery_penalty: spendPenalty,
        time_penalty: timePenalty,
        final: finalScore,
      },
      missing_ingredients: missingRequired.map((m) => m.canonicalName),
      uses_inventory: usagePlan.map((u) => u.canonicalName),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 6: Select winner
  // ─────────────────────────────────────────────────────────────
  const eligibleCandidates = candidates.filter((c) => c.eligible);

  if (eligibleCandidates.length === 0) {
    // Build rejection summary for error response
    const rejectionCounts = new Map<string, number>();
    for (const rejected of rejectedRecipesTrace) {
      let category = 'other';
      if (rejected.reason.includes('Insufficient time')) {
        category = 'time_window';
      } else if (rejected.reason.includes('Missing equipment')) {
        category = 'equipment';
      }
      rejectionCounts.set(category, (rejectionCounts.get(category) || 0) + 1);
    }

    const rejectionReasons = Array.from(rejectionCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    throw new NoEligibleRecipeError({
      free_interval_minutes: selectedInterval.minutes,
      totalCandidatesEvaluated: candidates.length,
      rejection_reasons: rejectionReasons,
      all_rejections: rejectedRecipesTrace.map((r) => ({
        recipe: r.recipe,
        reason: r.reason,
      })),
    });
  }

  // Sort by deterministic tie-breakers
  eligibleCandidates.sort((a, b) => {
    // 1. Highest final score
    if (b.scores.final !== a.scores.final) {
      return b.scores.final - a.scores.final;
    }
    // 2. Lowest missing ingredients
    if (a.missingRequired.length !== b.missingRequired.length) {
      return a.missingRequired.length - b.missingRequired.length;
    }
    // 3. Highest waste score
    if (b.scores.wasteScore !== a.scores.wasteScore) {
      return b.scores.wasteScore - a.scores.wasteScore;
    }
    // 4. Shortest cook time
    if (a.totalTimeMinutes !== b.totalTimeMinutes) {
      return a.totalTimeMinutes - b.totalTimeMinutes;
    }
    // 5. Alphabetical slug
    return a.recipeSlug.localeCompare(b.recipeSlug);
  });

  const winner = eligibleCandidates[0];
  const runnerUp = eligibleCandidates.length > 1 ? eligibleCandidates[1] : null;
  const tieBreaker = determineTieBreaker(winner, runnerUp);

  // ─────────────────────────────────────────────────────────────
  // STEP 7: Build reasoning trace
  // ─────────────────────────────────────────────────────────────
  const reasoningTrace: ReasoningTrace = {
    version: DPE_VERSION,
    generated_at: nowTs.toISOString(),
    inventory_snapshot: inventorySnapshotTrace,
    calendar_constraints: {
      dinner_window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      busy_blocks: calendarBlocks.map((b) => ({
        start: b.startsAt.toISOString(),
        end: b.endsAt.toISOString(),
        title: b.title,
      })),
      available_minutes: selectedInterval.minutes,
    },
    eligible_recipes: eligibleRecipesTrace,
    rejected_recipes: rejectedRecipesTrace,
    winner: winner.recipeSlug,
    tie_breaker: tieBreaker,
    scoring_details: {
      waste_weight: SCORING.WASTE_WEIGHT,
      grocery_penalty_per_item: SCORING.GROCERY_PENALTY_PER_ITEM,
      time_penalty_factor: SCORING.TIME_PENALTY_FACTOR,
    },
  };

  // Build legacy trace (with reasoning_trace embedded)
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
      quantityConfidence: i.quantityConfidence,
      unit: i.unit,
      expirationDate: i.expirationDate?.toISOString().split('T')[0] || null,
    })),
    candidates,
    winner: {
      recipeSlug: winner.recipeSlug,
      finalScore: winner.scores.final,
    },
    warnings: [],
    reasoning_trace: reasoningTrace,
  };

  // ─────────────────────────────────────────────────────────────
  // STEP 8: Persist plan
  // ─────────────────────────────────────────────────────────────
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
        consumedUnknown: usage.consumedUnknown,
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

  // ─────────────────────────────────────────────────────────────
  // STEP 9: Build and return response
  // ─────────────────────────────────────────────────────────────
  const selectedRecipe = await prisma.recipe.findUnique({
    where: { id: winner.recipeId },
  });

  if (!selectedRecipe) {
    throw new Error('Selected recipe not found - this should never happen');
  }

  const why = generateWhy(
    winner.usagePlan,
    winner.missingRequired,
    winner.totalTimeMinutes,
    originalInventory,
    todayLocal,
    selectedInterval.minutes
  );

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
      consumed_unknown: u.consumedUnknown,
      unit: u.unit,
    })),
    grocery_addons: winner.missingRequired.map((m) => ({
      canonical_name: m.canonicalName,
      required_quantity: m.requiredQuantity,
      unit: m.unit,
    })),
    why,
    reasoning_trace: reasoningTrace,
  };

  return response;
}
