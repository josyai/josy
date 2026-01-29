/**
 * Conversation Adapter
 *
 * Maps user intents to existing backend endpoints.
 * Tracks session state (last plan ID) per phone number.
 *
 * This is the thin layer between WhatsApp and the DPE.
 */

import { prisma } from '../models/prisma';
import { detectIntent, Intent } from './intent';
import {
  formatExplanation,
  formatDinnerReason,
  formatGrocerySummary,
  formatAddConfirmation,
  formatUsedConfirmation,
  formatUnknownResponse,
} from './explainer';
import { planTonight } from './dpe';
import { canonicalizeIngredientName, validateUnit } from '../utils/canonicalize';
import { ReasoningTrace } from '../types';
import { AppError } from '../utils/errors';
import { buildErrorMessage } from './messaging';

export interface ConversationResponse {
  message: string;
  success: boolean;
}

/**
 * Get or create a chat session for a phone number.
 * Creates a demo household if one doesn't exist.
 */
async function getOrCreateSession(phoneNumber: string): Promise<{
  sessionId: string;
  householdId: string;
  lastPlanId: string | null;
}> {
  // Try to find existing session
  let session = await prisma.chatSession.findUnique({
    where: { phoneNumber },
  });

  if (session) {
    return {
      sessionId: session.id,
      householdId: session.householdId,
      lastPlanId: session.lastPlanId,
    };
  }

  // Create new household for this phone number
  const household = await prisma.household.create({
    data: {
      timezone: 'America/New_York', // Default for demo
    },
  });

  // Create session
  session = await prisma.chatSession.create({
    data: {
      phoneNumber,
      householdId: household.id,
    },
  });

  return {
    sessionId: session.id,
    householdId: session.householdId,
    lastPlanId: session.lastPlanId,
  };
}

/**
 * Update the last plan ID for a session
 */
async function updateLastPlan(phoneNumber: string, planId: string): Promise<void> {
  await prisma.chatSession.update({
    where: { phoneNumber },
    data: { lastPlanId: planId },
  });
}

/**
 * Handle PLAN_TONIGHT intent
 */
async function handlePlanTonight(householdId: string, phoneNumber: string): Promise<ConversationResponse> {
  try {
    const result = await planTonight(householdId, new Date(), []);

    // Update session with new plan ID
    await updateLastPlan(phoneNumber, result.plan_id);

    // Format response
    const recipeName = result.recipe.name;
    const reason = formatDinnerReason(result.reasoning_trace);
    const grocerySummary = formatGrocerySummary(result.grocery_addons);

    let message = `Tonight you should make ${recipeName}. ${reason}`;
    if (grocerySummary) {
      message += `\n\n${grocerySummary}`;
    }

    return { message, success: true };
  } catch (error) {
    // Use AppError.code for reliable error matching
    if (error instanceof AppError) {
      if (error.code === 'NO_FEASIBLE_TIME_WINDOW') {
        return {
          message: "It's too late for dinner tonight! Try again tomorrow.",
          success: false,
        };
      }

      if (error.code === 'NO_ELIGIBLE_RECIPE') {
        return {
          message: "I couldn't find a recipe that fits your schedule. Try adding some ingredients first!",
          success: false,
        };
      }
    }

    console.error('Plan error:', error);
    // v0.7: Use messaging module for error messages
    return {
      message: buildErrorMessage('INTERNAL'),
      success: false,
    };
  }
}

/**
 * Handle EXPLAIN_LAST_PLAN intent
 */
async function handleExplain(lastPlanId: string | null): Promise<ConversationResponse> {
  if (!lastPlanId) {
    return {
      message: 'Ask me "What\'s for dinner?" first, then I can explain why!',
      success: false,
    };
  }

  const plan = await prisma.plan.findUnique({
    where: { id: lastPlanId },
  });

  if (!plan) {
    return {
      message: 'I don\'t have a recent dinner suggestion to explain. Ask me "What\'s for dinner?" first!',
      success: false,
    };
  }

  const trace = plan.dpeTraceJson as unknown as { reasoning_trace: ReasoningTrace };
  const explanation = formatExplanation(trace.reasoning_trace);

  return { message: explanation, success: true };
}

/**
 * Handle INVENTORY_ADD intent
 */
async function handleInventoryAdd(
  householdId: string,
  item: string,
  quantity?: number,
  unit?: string
): Promise<ConversationResponse> {
  try {
    const canonicalName = canonicalizeIngredientName(item);
    const validUnit = validateUnit(unit || 'pcs') || 'pcs';

    // Check if item already exists
    const existing = await prisma.inventoryItem.findFirst({
      where: {
        householdId,
        canonicalName,
        assumedDepleted: false,
        OR: [
          { quantity: { gt: 0 } },
          { quantityConfidence: 'unknown' },
        ],
      },
    });

    if (existing) {
      // Update existing item (add to quantity)
      const currentQty = existing.quantity ? Number(existing.quantity) : 0;
      const newQty = currentQty + (quantity || 0);

      await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: newQty,
          quantityConfidence: 'estimate', // Adding to existing makes it an estimate
          assumedDepleted: false,
        },
      });
    } else {
      // Create new item
      await prisma.inventoryItem.create({
        data: {
          householdId,
          canonicalName,
          displayName: item,
          quantity: quantity || null,
          quantityConfidence: quantity ? 'estimate' : 'unknown',
          unit: validUnit,
          location: inferLocation(canonicalName),
        },
      });
    }

    // Invalidate any proposed plans
    await invalidateProposedPlans(householdId);

    return {
      message: formatAddConfirmation(item, quantity, unit),
      success: true,
    };
  } catch (error) {
    console.error('Inventory add error:', error);
    return {
      message: `I couldn't add ${item}. Please try again.`,
      success: false,
    };
  }
}

/**
 * Handle INVENTORY_USED intent
 */
async function handleInventoryUsed(
  householdId: string,
  item: string
): Promise<ConversationResponse> {
  try {
    const canonicalName = canonicalizeIngredientName(item);

    // Find the item
    const existing = await prisma.inventoryItem.findFirst({
      where: {
        householdId,
        canonicalName,
        assumedDepleted: false,
      },
    });

    if (!existing) {
      return {
        message: `I don't have ${item} in your inventory.`,
        success: false,
      };
    }

    // Mark as depleted
    await prisma.inventoryItem.update({
      where: { id: existing.id },
      data: { assumedDepleted: true },
    });

    // Invalidate any proposed plans
    await invalidateProposedPlans(householdId);

    return {
      message: formatUsedConfirmation(item),
      success: true,
    };
  } catch (error) {
    console.error('Inventory used error:', error);
    return {
      message: `I couldn't update ${item}. Please try again.`,
      success: false,
    };
  }
}

/**
 * Invalidate proposed plans for a household (triggers re-plan)
 */
async function invalidateProposedPlans(householdId: string): Promise<void> {
  const { startOfDay } = await import('date-fns');
  const { toZonedTime } = await import('date-fns-tz');

  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { timezone: true },
  });

  if (!household) return;

  const now = new Date();
  const nowInTz = toZonedTime(now, household.timezone);
  const todayLocal = startOfDay(nowInTz);

  await prisma.plan.updateMany({
    where: {
      householdId,
      status: 'proposed',
      planDateLocal: todayLocal,
    },
    data: { status: 'overridden' },
  });
}

/**
 * Infer storage location from ingredient name
 */
function inferLocation(canonicalName: string): string {
  const freezerItems = ['frozen peas', 'frozen vegetables', 'frozen veg', 'ice cream'];
  const pantryItems = ['olive oil', 'rice', 'pasta', 'bread', 'flour', 'sugar', 'beans', 'lentils', 'chickpeas', 'tuna', 'tortillas'];

  if (freezerItems.some((item) => canonicalName.includes(item))) {
    return 'freezer';
  }
  if (pantryItems.some((item) => canonicalName.includes(item))) {
    return 'pantry';
  }
  return 'fridge';
}

/**
 * Main conversation handler - processes a message and returns a response
 */
export async function handleMessage(
  phoneNumber: string,
  message: string
): Promise<ConversationResponse> {
  // Get or create session
  const session = await getOrCreateSession(phoneNumber);

  // Detect intent
  const intent = detectIntent(message);

  // Route to handler
  switch (intent.type) {
    case 'PLAN_TONIGHT':
      return handlePlanTonight(session.householdId, phoneNumber);

    case 'EXPLAIN_LAST_PLAN':
      return handleExplain(session.lastPlanId);

    case 'INVENTORY_ADD':
      return handleInventoryAdd(
        session.householdId,
        intent.item,
        intent.quantity,
        intent.unit
      );

    case 'INVENTORY_USED':
      return handleInventoryUsed(session.householdId, intent.item);

    // v0.6: Multi-day planning intents
    case 'PLAN_NEXT':
      return {
        message: `Planning ${intent.days} days of dinners is available via the API (POST /v1/plan with horizon). WhatsApp support coming soon!`,
        success: true,
      };

    case 'SWAP_DAY':
      // v0.7: Use normalized day if available
      const dayDisplay = intent.dayNormalized || intent.day;
      return {
        message: dayDisplay
          ? `Swapping ${dayDisplay}'s dinner is available via the API. WhatsApp support coming soon!`
          : buildErrorMessage('INVALID_DAY'),
        success: !!dayDisplay,
      };

    case 'CONFIRM_PLAN':
      // v0.7: Check if there's an active plan to confirm
      if (!session.lastPlanId) {
        return {
          message: buildErrorMessage('NO_ACTIVE_PLAN'),
          success: false,
        };
      }
      return {
        message: `Plan confirmed! Confirming multi-day plans is available via the API (POST /v1/plan_set/:id/confirm).`,
        success: true,
      };

    case 'UNKNOWN':
      return {
        message: formatUnknownResponse(),
        success: false,
      };
  }
}
