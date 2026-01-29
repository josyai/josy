/**
 * Replanning Service
 *
 * Main orchestration service for multi-day planning with variety and stability.
 * This is the single source of truth for POST /v1/plan.
 */

import { v4 as uuidv4 } from 'uuid';
import { parseISO, format } from 'date-fns';
import { prisma } from '../../models/prisma';
import type { Prisma } from '@prisma/client';
import {
  PlanRequest,
  PlanResponse,
  PlanDayResponse,
  Horizon,
  IntentOverride,
  PlanOptions,
  CalendarBlockInput,
  ReasoningTrace,
  PlanSetReasoningTrace,
  StabilityDecision,
  DependencyChange,
  VarietyPenaltyApplied,
  NormalizedGroceryList,
  ConsumptionRecord,
  EventTypesV06,
} from '../../types';
import {
  computePlanningDates,
  normalizeHorizon,
  buildDinnerWindow,
  getDinnerMidpoint,
  stableKeyForRequest,
  computeInventoryDigest,
  computeCalendarDigest,
  getIntentOverrideForDate,
} from '../planning-horizon';
import {
  buildRecentConsumptionProfile,
  calculateVarietyPenalties,
  createShadowInventory,
  applyShadowConsumption,
  getExpiringIngredients,
  createConsumptionSummary,
  ShadowInventoryItem,
  RecentConsumptionProfile,
} from './variety';
import { planTonightWithOptions, DPEOptionsV06 } from '../dpe';
import { normalizeGroceryAddons } from '../grocery';
import { buildDinnerNotification, formatForWhatsApp } from '../notifications';
import { emitEvent, emitEventV06 } from '../events';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanSetComputationResult {
  planSetId: string;
  response: PlanResponse;
  isExisting: boolean;
}

export interface ReplanReason {
  type: 'inventory_change' | 'swap_request' | 'force_recompute';
  details?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Computation Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a plan set for the given request.
 * This is the main entry point for POST /v1/plan.
 *
 * Algorithm:
 * 1) Load household + inventory + recipes
 * 2) Compute planning dates for the horizon
 * 3) Build recent consumption profile from EventLog
 * 4) For each date:
 *    a) Determine time window
 *    b) Determine intent override
 *    c) Determine exclusions (no repeat within horizon)
 *    d) Call DPE with variety penalties
 *    e) Update shadow inventory
 * 5) Consolidate grocery list
 * 6) Handle idempotency (stable key check)
 * 7) Persist PlanSet and PlanSetItems
 * 8) Return response
 */
export async function computePlanSet(
  request: PlanRequest
): Promise<PlanSetComputationResult> {
  const {
    household_id,
    now_ts,
    calendar_blocks = [],
    horizon,
    intent_overrides = [],
    options,
  } = request;

  const nowTs = now_ts ? parseISO(now_ts) : new Date();
  const forceRecompute = options?.force_recompute ?? false;
  const varietyWindowDays = options?.variety_window_days ?? 7;
  const stabilityBandPct = options?.stability_band_pct ?? 10;
  const excludeRecipeSlugs = options?.exclude_recipe_slugs ?? [];

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Load household
  // ─────────────────────────────────────────────────────────────────────────
  const household = await prisma.household.findUnique({
    where: { id: household_id },
  });

  if (!household) {
    throw new Error(`Household not found: ${household_id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Compute planning dates
  // ─────────────────────────────────────────────────────────────────────────
  const planningDates = computePlanningDates(horizon, household.timezone, nowTs);
  const normalizedHorizon = normalizeHorizon(horizon, planningDates);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Load inventory
  // ─────────────────────────────────────────────────────────────────────────
  const inventoryRaw = await prisma.inventoryItem.findMany({
    where: {
      householdId: household_id,
      assumedDepleted: false,
      OR: [
        { quantity: { gt: 0 } },
        { quantityConfidence: 'unknown' },
      ],
    },
    orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
  });

  const inventory = inventoryRaw.map((item) => ({
    id: item.id,
    canonicalName: item.canonicalName,
    quantity: item.quantity !== null ? Number(item.quantity) : null,
    unit: item.unit,
    expirationDate: item.expirationDate,
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Compute stable key and check for existing PlanSet
  // ─────────────────────────────────────────────────────────────────────────
  const inventoryDigest = computeInventoryDigest(inventory);
  const calendarDigest = computeCalendarDigest(calendar_blocks);
  const stableKey = stableKeyForRequest(
    household_id,
    horizon,
    intent_overrides,
    options,
    inventoryDigest,
    calendarDigest
  );

  // Check for exact match first (same stable key)
  if (!forceRecompute) {
    const existingPlanSet = await prisma.planSet.findFirst({
      where: {
        householdId: household_id,
        stableKey,
        status: 'proposed',
      },
      include: {
        items: {
          orderBy: { dateLocal: 'asc' },
        },
      },
    });

    if (existingPlanSet) {
      // Return existing plan set
      const response = await buildPlanSetResponse(existingPlanSet, household);
      return {
        planSetId: existingPlanSet.id,
        response,
        isExisting: true,
      };
    }
  }

  // Look up most recent proposed PlanSet for stability band comparison
  // This handles the case where inputs changed slightly but we might want to keep the old plan
  const previousPlanSet = !forceRecompute
    ? await prisma.planSet.findFirst({
        where: {
          householdId: household_id,
          status: 'proposed',
        },
        include: {
          items: {
            orderBy: { dateLocal: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  // Map of date -> existing recipe info for stability comparison
  const existingRecipesByDate = new Map<
    string,
    { slug: string; score: number }
  >();
  if (previousPlanSet) {
    for (const item of previousPlanSet.items) {
      // Use the trace stored in the PlanSetItem to get the score
      const trace = item.traceJson as ReasoningTrace | null;
      const score = trace?.eligible_recipes?.find(
        (r) => r.recipe === item.recipeSlug
      )?.scores?.final ?? 0;
      existingRecipesByDate.set(item.dateLocal, {
        slug: item.recipeSlug,
        score,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Build recent consumption profile
  // ─────────────────────────────────────────────────────────────────────────
  const consumptionEvents = await prisma.eventLog.findMany({
    where: {
      householdId: household_id,
      eventType: EventTypesV06.CONSUMPTION_LOGGED,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const consumptionRecords: ConsumptionRecord[] = consumptionEvents.map((e) => {
    const payload = e.payload as {
      date_local: string;
      recipe_slug: string;
      ingredients_used: string[];
      tags: string[];
    };
    return {
      date_local: payload.date_local,
      recipe_slug: payload.recipe_slug,
      ingredients_used: payload.ingredients_used || [],
      tags: payload.tags || [],
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: Plan each day
  // ─────────────────────────────────────────────────────────────────────────
  const shadowInventory = createShadowInventory(inventory, nowTs);
  const dayResults: PlanDayResponse[] = [];
  const usedRecipeSlugsInHorizon: string[] = [];
  const perDayVarietyPenalties: Record<string, VarietyPenaltyApplied[]> = {};
  const perDayTraces: Record<string, ReasoningTrace> = {};
  const stabilityDecisions: StabilityDecision[] = [];

  // Track planned consumption for variety profile updates
  const plannedConsumption: ConsumptionRecord[] = [];

  for (const dateLocal of planningDates) {
    // Build consumption profile including already-planned days
    const allConsumption = [...consumptionRecords, ...plannedConsumption];
    const profile = buildRecentConsumptionProfile(
      allConsumption,
      varietyWindowDays,
      dateLocal
    );

    // Get intent override for this date
    const intentOverride = getIntentOverrideForDate(dateLocal, intent_overrides);

    // Build dinner window
    const dinnerWindow = buildDinnerWindow(
      dateLocal,
      calendar_blocks,
      household.timezone,
      household.dinnerEarliestLocal,
      household.dinnerLatestLocal
    );

    // Get expiring ingredients
    const expiringIngredients = getExpiringIngredients(shadowInventory);

    // Build exclusions: global + no repeat within horizon
    const dayExclusions = [
      ...excludeRecipeSlugs,
      ...usedRecipeSlugsInHorizon,
    ];

    // Call DPE for this day
    const dpeOptions: DPEOptionsV06 = {
      excludeRecipeSlugs: dayExclusions,
      varietyProfile: profile,
      expiringIngredients,
      intentOverride,
      shadowInventory: shadowInventory.map((i) => ({
        id: i.id,
        canonicalName: i.canonicalName,
        quantity: i.quantity,
        unit: i.unit,
        expirationDate: i.expirationDate,
      })),
    };

    const dinnerMidpoint = getDinnerMidpoint(dinnerWindow);

    try {
      let planResult = await planTonightWithOptions(
        household_id,
        dinnerMidpoint,
        calendar_blocks.filter((b) => {
          const blockDate = format(parseISO(b.starts_at), 'yyyy-MM-dd');
          return blockDate === dateLocal;
        }),
        dpeOptions
      );

      // Stability band check: compare with existing plan if any
      const existingRecipe = existingRecipesByDate.get(dateLocal);
      if (existingRecipe) {
        const newScore = planResult.reasoning_trace.eligible_recipes?.find(
          (r) => r.recipe === planResult.recipe.slug
        )?.scores?.final ?? 0;

        // Calculate stability threshold: new score must exceed old by more than band %
        const stabilityThreshold = existingRecipe.score * (1 + stabilityBandPct / 100);
        const withinBand = newScore <= stabilityThreshold;

        if (withinBand && planResult.recipe.slug !== existingRecipe.slug) {
          // New recipe is not significantly better, consider keeping the old one
          // But only if the old recipe is still available (not excluded)
          const oldIsExcluded = dayExclusions.includes(existingRecipe.slug);

          if (!oldIsExcluded) {
            // Keep the old recipe - record decision and skip to next iteration
            stabilityDecisions.push({
              date_local: dateLocal,
              kept_recipe: existingRecipe.slug,
              new_best_recipe: planResult.recipe.slug,
              decision: 'kept',
              reason: `New score ${newScore.toFixed(1)} not significantly better than existing ${existingRecipe.score.toFixed(1)} (threshold ${stabilityThreshold.toFixed(1)})`,
              old_score: existingRecipe.score,
              new_score: newScore,
              within_band: true,
            });

            // Re-run DPE with the old recipe as preferred to maintain consistency
            const dpeOptionsWithPreferred: DPEOptionsV06 = {
              ...dpeOptions,
              intentOverride: {
                ...intentOverride,
                date_local: dateLocal,
                preferred_recipe_slugs: [
                  existingRecipe.slug,
                  ...(intentOverride?.preferred_recipe_slugs || []),
                ],
              },
            };

            planResult = await planTonightWithOptions(
              household_id,
              dinnerMidpoint,
              calendar_blocks.filter((b) => {
                const blockDate = format(parseISO(b.starts_at), 'yyyy-MM-dd');
                return blockDate === dateLocal;
              }),
              dpeOptionsWithPreferred
            );
          } else {
            // Old recipe is excluded, must use new one
            stabilityDecisions.push({
              date_local: dateLocal,
              kept_recipe: null,
              new_best_recipe: planResult.recipe.slug,
              decision: 'changed',
              reason: `Old recipe ${existingRecipe.slug} is excluded, using new recipe`,
              old_score: existingRecipe.score,
              new_score: newScore,
              within_band: true,
            });
          }
        } else if (planResult.recipe.slug !== existingRecipe.slug) {
          // New recipe is significantly better
          stabilityDecisions.push({
            date_local: dateLocal,
            kept_recipe: null,
            new_best_recipe: planResult.recipe.slug,
            decision: 'changed',
            reason: `New score ${newScore.toFixed(1)} exceeds threshold ${stabilityThreshold.toFixed(1)}`,
            old_score: existingRecipe.score,
            new_score: newScore,
            within_band: false,
          });
        }
        // If same recipe, no stability decision to record
      }

      // Record variety penalties
      const recipeIngredients = planResult.inventory_to_consume.map(
        (i) => i.canonical_name
      );
      const recipeTags: string[] = []; // Would need to load from recipe if available

      const varietyResult = calculateVarietyPenalties(
        recipeIngredients,
        recipeTags,
        profile,
        dateLocal,
        expiringIngredients
      );
      perDayVarietyPenalties[dateLocal] = varietyResult.penalties;
      perDayTraces[dateLocal] = planResult.reasoning_trace;

      // Build day response
      const dayGroceryList = planResult.grocery_addons.length > 0
        ? normalizeGroceryAddons(planResult.grocery_addons)
        : null;

      const notification = buildDinnerNotification(
        planResult.recipe.name,
        planResult.reasoning_trace,
        dayGroceryList,
        planResult.plan_id
      );

      dayResults.push({
        date_local: dateLocal,
        meal_slot: 'DINNER',
        plan_id: planResult.plan_id,
        recipe: {
          slug: planResult.recipe.slug,
          name: planResult.recipe.name,
          total_time_minutes: planResult.recipe.total_time_minutes,
        },
        inventory_to_consume: planResult.inventory_to_consume,
        grocery_addons: planResult.grocery_addons,
        grocery_list_normalized: dayGroceryList,
        assistant_message: formatForWhatsApp(notification),
        reasoning_trace: planResult.reasoning_trace,
      });

      // Update tracking
      usedRecipeSlugsInHorizon.push(planResult.recipe.slug);

      // Update shadow inventory
      applyShadowConsumption(
        shadowInventory,
        planResult.inventory_to_consume.map((i) => ({
          inventoryItemId: i.inventory_item_id,
          consumedQuantity: i.consumed_quantity,
        }))
      );

      // Track for variety profile
      plannedConsumption.push({
        date_local: dateLocal,
        recipe_slug: planResult.recipe.slug,
        ingredients_used: recipeIngredients,
        tags: recipeTags,
      });
    } catch (error) {
      // If planning fails for a day, we might need to handle gracefully
      // For now, re-throw
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 7: Consolidate grocery list
  // ─────────────────────────────────────────────────────────────────────────
  const allGroceryAddons = dayResults.flatMap((d) => d.grocery_addons);
  const consolidatedGroceryList = allGroceryAddons.length > 0
    ? normalizeGroceryAddons(allGroceryAddons)
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 8: Build reasoning trace
  // ─────────────────────────────────────────────────────────────────────────
  const consumptionSummary = createConsumptionSummary(
    buildRecentConsumptionProfile(consumptionRecords, varietyWindowDays, planningDates[0])
  );

  const planSetTrace: PlanSetReasoningTrace = {
    inputs_summary: {
      horizon: normalizedHorizon,
      intent_overrides_count: intent_overrides.length,
      inventory_item_count: inventory.length,
      calendar_blocks_count: calendar_blocks.length,
    },
    recent_consumption_summary: consumptionSummary,
    variety_penalties_applied: perDayVarietyPenalties,
    stability_decisions: stabilityDecisions,
    dependency_changes: [],
    per_day: perDayTraces,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Step 9: Build assistant message
  // ─────────────────────────────────────────────────────────────────────────
  const assistantMessage = buildHorizonAssistantMessage(
    dayResults,
    consolidatedGroceryList
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Step 10: Persist PlanSet
  // ─────────────────────────────────────────────────────────────────────────
  const planSetId = uuidv4();

  await prisma.planSet.create({
    data: {
      id: planSetId,
      householdId: household_id,
      horizonJson: normalizedHorizon as unknown as Prisma.InputJsonValue,
      status: 'proposed',
      stableKey,
      traceJson: planSetTrace as unknown as Prisma.InputJsonValue,
    },
  });

  // Create PlanSetItems
  for (const dayResult of dayResults) {
    await prisma.planSetItem.create({
      data: {
        planSetId,
        dateLocal: dayResult.date_local,
        mealSlot: 'DINNER',
        planId: dayResult.plan_id,
        recipeSlug: dayResult.recipe.slug,
        status: 'proposed',
        traceJson: dayResult.reasoning_trace as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 11: Emit event
  // ─────────────────────────────────────────────────────────────────────────
  emitEventV06({
    householdId: household_id,
    eventType: EventTypesV06.PLAN_SET_PROPOSED,
    payload: {
      plan_set_id: planSetId,
      horizon: normalizedHorizon,
      recipe_slugs: dayResults.map((d) => d.recipe.slug),
    },
  }).catch((err) => {
    console.error('[Replanning] Failed to emit plan_set_proposed event:', err);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 12: Build response
  // ─────────────────────────────────────────────────────────────────────────
  const response: PlanResponse = {
    plan_set_id: planSetId,
    horizon: normalizedHorizon,
    days: dayResults,
    grocery_list_normalized: consolidatedGroceryList,
    assistant_message: assistantMessage,
    reasoning_trace: planSetTrace,
  };

  return {
    planSetId,
    response,
    isExisting: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build PlanSet Response from existing data
// ─────────────────────────────────────────────────────────────────────────────

async function buildPlanSetResponse(
  planSet: {
    id: string;
    horizonJson: unknown;
    traceJson: unknown;
    items: Array<{
      dateLocal: string;
      mealSlot: string;
      planId: string | null;
      recipeSlug: string;
      traceJson: unknown;
    }>;
  },
  household: { timezone: string }
): Promise<PlanResponse> {
  const horizon = planSet.horizonJson as Horizon;
  const trace = planSet.traceJson as PlanSetReasoningTrace;

  // Load plans for each item
  const dayResults: PlanDayResponse[] = [];

  for (const item of planSet.items) {
    if (!item.planId) continue;

    const plan = await prisma.plan.findUnique({
      where: { id: item.planId },
      include: {
        selectedRecipe: true,
        consumptions: { include: { inventoryItem: true } },
        groceryAddons: true,
      },
    });

    if (!plan) continue;

    const dayGroceryList = plan.groceryAddons.length > 0
      ? normalizeGroceryAddons(
          plan.groceryAddons.map((g) => ({
            canonical_name: g.canonicalName,
            required_quantity: Number(g.requiredQuantity),
            unit: g.unit,
          }))
        )
      : null;

    const itemTrace = item.traceJson as ReasoningTrace;

    dayResults.push({
      date_local: item.dateLocal,
      meal_slot: 'DINNER',
      plan_id: item.planId,
      recipe: {
        slug: plan.selectedRecipe.slug,
        name: plan.selectedRecipe.name,
        total_time_minutes:
          plan.selectedRecipe.prepTimeMinutes + plan.selectedRecipe.cookTimeMinutes,
      },
      inventory_to_consume: plan.consumptions.map((c) => ({
        inventory_item_id: c.inventoryItemId,
        canonical_name: c.inventoryItem.canonicalName,
        consumed_quantity: c.consumedQuantity ? Number(c.consumedQuantity) : null,
        consumed_unknown: c.consumedUnknown,
        unit: c.unit,
      })),
      grocery_addons: plan.groceryAddons.map((g) => ({
        canonical_name: g.canonicalName,
        required_quantity: Number(g.requiredQuantity),
        unit: g.unit,
      })),
      grocery_list_normalized: dayGroceryList,
      assistant_message: '', // Regenerate if needed
      reasoning_trace: itemTrace,
    });
  }

  // Consolidate grocery list
  const allGroceryAddons = dayResults.flatMap((d) => d.grocery_addons);
  const consolidatedGroceryList = allGroceryAddons.length > 0
    ? normalizeGroceryAddons(allGroceryAddons)
    : null;

  const assistantMessage = buildHorizonAssistantMessage(
    dayResults,
    consolidatedGroceryList
  );

  return {
    plan_set_id: planSet.id,
    horizon,
    days: dayResults,
    grocery_list_normalized: consolidatedGroceryList,
    assistant_message: assistantMessage,
    reasoning_trace: trace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build assistant message for horizon
// ─────────────────────────────────────────────────────────────────────────────

function buildHorizonAssistantMessage(
  days: PlanDayResponse[],
  groceryList: NormalizedGroceryList | null
): string {
  if (days.length === 1) {
    return days[0].assistant_message;
  }

  const lines: string[] = [];
  lines.push(`*Your dinner plan for the next ${days.length} days:*`);
  lines.push('');

  for (const day of days) {
    const dayName = formatDayName(day.date_local);
    lines.push(`*${dayName}:* ${day.recipe.name}`);
  }

  if (groceryList && groceryList.items.length > 0) {
    lines.push('');
    lines.push(`_${groceryList.summary}_`);
  }

  lines.push('');
  lines.push('Reply "confirm" to confirm or "swap <day>" to change a day.');

  return lines.join('\n');
}

function formatDayName(dateLocal: string): string {
  const date = parseISO(dateLocal);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')) {
    return 'Tonight';
  }
  if (format(date, 'yyyy-MM-dd') === format(tomorrow, 'yyyy-MM-dd')) {
    return 'Tomorrow';
  }
  return format(date, 'EEEE'); // Day name
}

// ─────────────────────────────────────────────────────────────────────────────
// Swap Day
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Swap a single day in a plan set.
 * v0.6.1: Now dependency-aware - accounts for consumption from prior days
 * and rebuilds variety profile correctly.
 *
 * @param planSetId - Plan set ID
 * @param dateLocal - Date to swap
 * @param excludeRecipeSlugs - Additional slugs to exclude
 * @returns Updated plan set response
 */
export async function swapDay(
  planSetId: string,
  dateLocal: string,
  excludeRecipeSlugs: string[] = []
): Promise<PlanResponse> {
  const planSet = await prisma.planSet.findUnique({
    where: { id: planSetId },
    include: {
      items: {
        orderBy: { dateLocal: 'asc' },
      },
      household: true,
    },
  });

  if (!planSet) {
    throw new Error(`PlanSet not found: ${planSetId}`);
  }

  const itemToSwap = planSet.items.find((i: { dateLocal: string }) => i.dateLocal === dateLocal);
  if (!itemToSwap) {
    throw new Error(`No item found for date ${dateLocal} in plan set`);
  }

  // Get the old recipe slug to exclude
  const oldSlug = itemToSwap.recipeSlug;
  const allExcludes = [oldSlug, ...excludeRecipeSlugs];

  // Also exclude other recipes in the horizon
  const otherSlugs = planSet.items
    .filter((i: { dateLocal: string }) => i.dateLocal !== dateLocal)
    .map((i: { recipeSlug: string }) => i.recipeSlug);
  allExcludes.push(...otherSlugs);

  // Load current inventory
  const inventoryRaw = await prisma.inventoryItem.findMany({
    where: {
      householdId: planSet.householdId,
      assumedDepleted: false,
      OR: [
        { quantity: { gt: 0 } },
        { quantityConfidence: 'unknown' },
      ],
    },
  });

  const inventory = inventoryRaw.map((item) => ({
    id: item.id,
    canonicalName: item.canonicalName,
    quantity: item.quantity !== null ? Number(item.quantity) : null,
    unit: item.unit,
    expirationDate: item.expirationDate,
  }));

  // v0.6.1: Build shadow inventory accounting for consumption from prior days
  const shadowInventory = createShadowInventory(inventory, new Date());

  // Apply consumption from days BEFORE the swap date
  // Load Plans for prior days to get consumption data
  const priorDayItems = planSet.items.filter(
    (i: { dateLocal: string; planId: string | null }) => i.dateLocal < dateLocal && i.planId
  );

  for (const priorItem of priorDayItems) {
    if (priorItem.planId) {
      const priorPlan = await prisma.plan.findUnique({
        where: { id: priorItem.planId },
        include: {
          consumptions: { include: { inventoryItem: true } },
          selectedRecipe: true,
        },
      });

      if (priorPlan?.consumptions) {
        applyShadowConsumption(
          shadowInventory,
          priorPlan.consumptions.map((c) => ({
            inventoryItemId: c.inventoryItemId,
            consumedQuantity: c.consumedQuantity ? Number(c.consumedQuantity) : null,
          }))
        );
      }
    }
  }

  // v0.6.1: Build variety profile including prior days in the plan set
  // Load variety data from prior plans
  const priorDayConsumption: ConsumptionRecord[] = [];
  for (const priorItem of priorDayItems) {
    if (priorItem.planId) {
      const priorPlan = await prisma.plan.findUnique({
        where: { id: priorItem.planId },
        include: {
          consumptions: { include: { inventoryItem: true } },
          selectedRecipe: true,
        },
      });

      if (priorPlan?.selectedRecipe) {
        priorDayConsumption.push({
          date_local: priorItem.dateLocal,
          recipe_slug: priorPlan.selectedRecipe.slug,
          ingredients_used: priorPlan.consumptions.map((c) => c.inventoryItem.canonicalName),
          tags: Array.isArray(priorPlan.selectedRecipe.tags)
            ? priorPlan.selectedRecipe.tags as string[]
            : [],
        });
      }
    }
  }

  // Load historical consumption for variety profile
  const consumptionEvents = await prisma.eventLog.findMany({
    where: {
      householdId: planSet.householdId,
      eventType: EventTypesV06.CONSUMPTION_LOGGED,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const historicalConsumption: ConsumptionRecord[] = consumptionEvents.map((e) => {
    const payload = e.payload as {
      date_local: string;
      recipe_slug: string;
      ingredients_used: string[];
      tags: string[];
    };
    return {
      date_local: payload.date_local,
      recipe_slug: payload.recipe_slug,
      ingredients_used: payload.ingredients_used || [],
      tags: payload.tags || [],
    };
  });

  const allConsumption = [...historicalConsumption, ...priorDayConsumption];
  const varietyProfile = buildRecentConsumptionProfile(allConsumption, 7, dateLocal);

  const expiringIngredients = getExpiringIngredients(shadowInventory);

  // Build dinner window
  const dinnerWindow = buildDinnerWindow(
    dateLocal,
    [],
    planSet.household.timezone,
    planSet.household.dinnerEarliestLocal,
    planSet.household.dinnerLatestLocal
  );

  const dpeOptions: DPEOptionsV06 = {
    excludeRecipeSlugs: allExcludes,
    varietyProfile,
    expiringIngredients,
    shadowInventory: shadowInventory.map((i) => ({
      id: i.id,
      canonicalName: i.canonicalName,
      quantity: i.quantity,
      unit: i.unit,
      expirationDate: i.expirationDate,
    })),
  };

  const planResult = await planTonightWithOptions(
    planSet.householdId,
    getDinnerMidpoint(dinnerWindow),
    [],
    dpeOptions
  );

  // Update the PlanSetItem
  await prisma.planSetItem.update({
    where: { id: itemToSwap.id },
    data: {
      planId: planResult.plan_id,
      recipeSlug: planResult.recipe.slug,
      traceJson: planResult.reasoning_trace as unknown as Prisma.InputJsonValue,
    },
  });

  // Emit swap event
  emitEventV06({
    householdId: planSet.householdId,
    eventType: EventTypesV06.PLAN_SET_ITEM_SWAPPED,
    payload: {
      plan_set_id: planSetId,
      date_local: dateLocal,
      old_recipe_slug: oldSlug,
      new_recipe_slug: planResult.recipe.slug,
    },
  }).catch(console.error);

  // Reload and return
  const updatedPlanSet = await prisma.planSet.findUnique({
    where: { id: planSetId },
    include: {
      items: { orderBy: { dateLocal: 'asc' } },
      household: true,
    },
  });

  if (!updatedPlanSet) {
    throw new Error('Failed to reload plan set');
  }

  return buildPlanSetResponse(updatedPlanSet, updatedPlanSet.household);
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Plan Set
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confirm a plan set.
 *
 * @param planSetId - Plan set ID
 * @returns Updated plan set response
 */
export async function confirmPlanSet(planSetId: string): Promise<PlanResponse> {
  const planSet = await prisma.planSet.findUnique({
    where: { id: planSetId },
    include: {
      items: { orderBy: { dateLocal: 'asc' } },
      household: true,
    },
  });

  if (!planSet) {
    throw new Error(`PlanSet not found: ${planSetId}`);
  }

  // Update status
  await prisma.planSet.update({
    where: { id: planSetId },
    data: { status: 'confirmed' },
  });

  await prisma.planSetItem.updateMany({
    where: { planSetId },
    data: { status: 'confirmed' },
  });

  // Emit event
  emitEventV06({
    householdId: planSet.householdId,
    eventType: EventTypesV06.PLAN_SET_CONFIRMED,
    payload: {
      plan_set_id: planSetId,
    },
  }).catch(console.error);

  return buildPlanSetResponse(planSet, planSet.household);
}

// ─────────────────────────────────────────────────────────────────────────────
// Invalidate Plan Sets (for inventory changes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark all proposed plan sets for a household as overridden.
 *
 * @param householdId - Household ID
 * @param reason - Reason for invalidation
 */
export async function invalidatePlanSets(
  householdId: string,
  reason: string
): Promise<void> {
  const proposedPlanSets = await prisma.planSet.findMany({
    where: {
      householdId,
      status: 'proposed',
    },
  });

  for (const planSet of proposedPlanSets) {
    await prisma.planSet.update({
      where: { id: planSet.id },
      data: { status: 'overridden' },
    });

    emitEventV06({
      householdId,
      eventType: EventTypesV06.PLAN_SET_OVERRIDDEN,
      payload: {
        plan_set_id: planSet.id,
        reason,
      },
    }).catch(console.error);
  }
}
