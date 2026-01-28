/**
 * Events Module
 *
 * Handles event logging for auditing and analytics.
 * Events are fire-and-forget - failures don't block main operations.
 *
 * All writes go to the EventLog table.
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../models/prisma';
import type { Prisma } from '@prisma/client';
import {
  EventType,
  EventTypes,
  EventPayload,
  EmitEventOptions,
  EmitEventResult,
  GetEventsOptions,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Core Event Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a generic event to the event log.
 * This is fire-and-forget - errors are logged but don't throw.
 *
 * @param options - Event options including householdId, eventType, and payload
 * @returns Event ID and timestamp
 */
export async function emitEvent<T extends EventType>(
  options: EmitEventOptions<T>
): Promise<EmitEventResult> {
  const { householdId, eventType, payload } = options;
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  try {
    await prisma.eventLog.create({
      data: {
        id,
        householdId,
        eventType,
        payload: payload as object,
      },
    });
  } catch (error) {
    // Fire-and-forget: log error but don't throw
    console.error(`[Events] Failed to emit ${eventType} event:`, error);
  }

  return { id, timestamp };
}

/**
 * Get events for a household with optional filtering.
 *
 * @param householdId - Household to query events for
 * @param options - Optional filters (eventType, since, limit)
 * @returns Array of events
 */
export async function getEvents(
  householdId: string,
  options: GetEventsOptions = {}
): Promise<Array<{ id: string; eventType: string; payload: unknown; createdAt: Date }>> {
  const { eventType, since, limit = 100 } = options;

  const events = await prisma.eventLog.findMany({
    where: {
      householdId,
      ...(eventType && { eventType }),
      ...(since && { createdAt: { gte: since } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return events.map((e: { id: string; eventType: string; payload: unknown; createdAt: Date }) => ({
    id: e.id,
    eventType: e.eventType,
    payload: e.payload,
    createdAt: e.createdAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions for Specific Event Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a plan_proposed event.
 */
export function emitPlanProposed(
  householdId: string,
  planId: string,
  recipeSlug: string
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.PLAN_PROPOSED,
    payload: { plan_id: planId, recipe_slug: recipeSlug },
  });
}

/**
 * Emit a plan_confirmed event.
 */
export function emitPlanConfirmed(
  householdId: string,
  planId: string,
  recipeSlug: string
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.PLAN_CONFIRMED,
    payload: { plan_id: planId, recipe_slug: recipeSlug },
  });
}

/**
 * Emit a plan_swapped event.
 */
export function emitPlanSwapped(
  householdId: string,
  planId: string,
  oldRecipeSlug: string,
  newRecipeSlug: string
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.PLAN_SWAPPED,
    payload: { plan_id: planId, old_recipe_slug: oldRecipeSlug, new_recipe_slug: newRecipeSlug },
  });
}

/**
 * Emit a plan_committed event.
 */
export function emitPlanCommitted(
  householdId: string,
  planId: string,
  recipeSlug: string,
  status: 'cooked' | 'skipped'
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.PLAN_COMMITTED,
    payload: { plan_id: planId, recipe_slug: recipeSlug, status },
  });
}

/**
 * Emit an inventory_added event.
 */
export function emitInventoryAdded(
  householdId: string,
  itemId: string,
  canonicalName: string,
  quantity: number | null,
  unit: string
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.INVENTORY_ADDED,
    payload: { item_id: itemId, canonical_name: canonicalName, quantity, unit },
  });
}

/**
 * Emit an inventory_used event.
 */
export function emitInventoryUsed(
  householdId: string,
  itemId: string,
  canonicalName: string,
  quantityUsed: number | null
): Promise<EmitEventResult> {
  return emitEvent({
    householdId,
    eventType: EventTypes.INVENTORY_USED,
    payload: { item_id: itemId, canonical_name: canonicalName, quantity_used: quantityUsed },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Preference Snapshots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a preference snapshot for a household.
 * Useful for tracking preference changes over time.
 *
 * @param householdId - Household ID
 * @param snapshotData - Preferences data to snapshot
 * @returns Snapshot ID
 */
export async function savePreferenceSnapshot(
  householdId: string,
  snapshotData: Record<string, unknown>
): Promise<string> {
  const snapshot = await prisma.preferenceSnapshot.create({
    data: {
      householdId,
      snapshotJson: snapshotData as Prisma.InputJsonValue,
    },
  });

  return snapshot.id;
}

/**
 * Get the latest preference snapshot for a household.
 *
 * @param householdId - Household ID
 * @returns Latest snapshot or null
 */
export async function getLatestPreferenceSnapshot(
  householdId: string
): Promise<{ id: string; snapshotJson: unknown; createdAt: Date } | null> {
  const snapshot = await prisma.preferenceSnapshot.findFirst({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
  });

  if (!snapshot) return null;

  return {
    id: snapshot.id,
    snapshotJson: snapshot.snapshotJson,
    createdAt: snapshot.createdAt,
  };
}

// Re-export types
export { EventTypes };
