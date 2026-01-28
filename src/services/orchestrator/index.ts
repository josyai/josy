/**
 * Orchestrator Module
 *
 * Main coordination layer for the /plan/tonight endpoint.
 * Combines DPE planning with grocery normalization, notifications, and events.
 *
 * Sequence:
 * 1. Parse inputs (now_ts, calendar_blocks)
 * 2. Call planTonight()
 * 3. Call normalizeGroceryAddons()
 * 4. Call buildDinnerNotification() + formatForWhatsApp()
 * 5. Emit plan_proposed event (fire-and-forget)
 * 6. Return enhanced response
 */

import { parseISO } from 'date-fns';
import {
  OrchestratorTonightInput,
  OrchestratorTonightOutput,
  CalendarBlockInput,
} from '../../types';
import { planTonight } from '../dpe';
import { normalizeGroceryAddons } from '../grocery';
import { buildDinnerNotification, formatForWhatsApp } from '../notifications';
import { emitPlanProposed } from '../events';

// ─────────────────────────────────────────────────────────────────────────────
// Main Orchestrator Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrate the complete "tonight" planning flow.
 *
 * This is the main entry point that combines:
 * - DPE planning (core algorithm)
 * - Grocery normalization (deduped, categorized list)
 * - Notification building (user-facing message)
 * - Event logging (analytics/audit)
 *
 * @param input - Orchestrator input with household_id, now_ts, calendar_blocks
 * @returns Enhanced response with grocery_list_normalized and assistant_message
 */
export async function orchestrateTonight(
  input: OrchestratorTonightInput
): Promise<OrchestratorTonightOutput> {
  // Step 1: Parse inputs
  const nowTs = input.now_ts ? parseISO(input.now_ts) : new Date();
  const calendarBlocks: CalendarBlockInput[] = input.calendar_blocks || [];

  // Step 2: Call DPE planTonight
  const planResult = await planTonight(input.household_id, nowTs, calendarBlocks);

  // Step 3: Normalize grocery add-ons
  const groceryListNormalized = planResult.grocery_addons.length > 0
    ? normalizeGroceryAddons(planResult.grocery_addons)
    : null;

  // Step 4: Build notification and format for WhatsApp
  const notification = buildDinnerNotification(
    planResult.recipe.name,
    planResult.reasoning_trace,
    groceryListNormalized,
    planResult.plan_id
  );
  const assistantMessage = formatForWhatsApp(notification);

  // Step 5: Emit plan_proposed event (fire-and-forget)
  // Don't await - let it run in background
  emitPlanProposed(
    input.household_id,
    planResult.plan_id,
    planResult.recipe.slug
  ).catch((err) => {
    console.error('[Orchestrator] Failed to emit plan_proposed event:', err);
  });

  // Step 6: Build and return enhanced response
  const output: OrchestratorTonightOutput = {
    ...planResult,
    grocery_list_normalized: groceryListNormalized,
    assistant_message: assistantMessage,
  };

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  skipEvents?: boolean;  // For testing - skip event emission
}

/**
 * Orchestrate tonight with additional options.
 * Primarily for testing purposes.
 */
export async function orchestrateTonightWithOptions(
  input: OrchestratorTonightInput,
  options: OrchestratorOptions = {}
): Promise<OrchestratorTonightOutput> {
  const nowTs = input.now_ts ? parseISO(input.now_ts) : new Date();
  const calendarBlocks: CalendarBlockInput[] = input.calendar_blocks || [];

  const planResult = await planTonight(input.household_id, nowTs, calendarBlocks);

  const groceryListNormalized = planResult.grocery_addons.length > 0
    ? normalizeGroceryAddons(planResult.grocery_addons)
    : null;

  const notification = buildDinnerNotification(
    planResult.recipe.name,
    planResult.reasoning_trace,
    groceryListNormalized,
    planResult.plan_id
  );
  const assistantMessage = formatForWhatsApp(notification);

  // Optionally skip event emission
  if (!options.skipEvents) {
    emitPlanProposed(
      input.household_id,
      planResult.plan_id,
      planResult.recipe.slug
    ).catch((err) => {
      console.error('[Orchestrator] Failed to emit plan_proposed event:', err);
    });
  }

  return {
    ...planResult,
    grocery_list_normalized: groceryListNormalized,
    assistant_message: assistantMessage,
  };
}
