import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import {
  PlanTonightRequestSchema,
  CommitPlanRequestSchema,
  PlanRequestSchema,
} from '../types';
import { orchestrateTonight } from '../services/orchestrator';
import {
  computePlanSet,
  swapDay,
  confirmPlanSet,
} from '../services/replanning';
import { emitConsumptionLogged } from '../services/events';
import { PlanNotFoundError, InvalidPlanStatusError, InvalidInputError } from '../utils/errors';

const router = Router();

// POST /v1/plan/tonight - Generate a dinner plan for tonight
// Now uses orchestrateTonight for enhanced response with grocery_list_normalized and assistant_message
router.post('/tonight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = PlanTonightRequestSchema.parse(req.body);

    const result = await orchestrateTonight({
      household_id: data.household_id,
      now_ts: data.now_ts,
      calendar_blocks: data.calendar_blocks,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /v1/plan/:planId/commit - Commit a plan (mark as cooked/skipped)
// v0.6.1: Now always emits consumption_logged when status is 'cooked'
router.post('/:planId/commit', async (req: Request<{ planId: string }>, res: Response, next: NextFunction) => {
  try {
    const planId = req.params.planId;
    const data = CommitPlanRequestSchema.parse(req.body);

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      include: {
        consumptions: { include: { inventoryItem: true } },
        selectedRecipe: true,
      },
    });

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    if (plan.status !== 'proposed' && plan.status !== 'confirmed') {
      throw new InvalidPlanStatusError(plan.status, data.status);
    }

    const warnings: string[] = [];
    const ingredientsUsed: string[] = [];

    // If status is "cooked", apply inventory deductions
    if (data.status === 'cooked') {
      for (const consumption of plan.consumptions) {
        ingredientsUsed.push(consumption.inventoryItem.canonicalName);

        // Handle unknown quantity items - set assumedDepleted instead of decrementing
        if (consumption.consumedUnknown || consumption.consumedQuantity === null) {
          await prisma.inventoryItem.update({
            where: { id: consumption.inventoryItemId },
            data: { assumedDepleted: true, opened: true },
          });
          warnings.push(
            `UNKNOWN_QTY_CONSUMED: ${consumption.inventoryItem.canonicalName} marked as assumed depleted`
          );
          continue;
        }

        // Handle estimate quantities - log warning
        if (consumption.inventoryItem.quantityConfidence === 'estimate') {
          warnings.push(
            `ESTIMATE_QTY_USED: ${consumption.inventoryItem.canonicalName} (${consumption.inventoryItem.quantity}${consumption.inventoryItem.unit} estimate) - actual may vary`
          );
        }

        // Normal quantity deduction
        const currentQty = consumption.inventoryItem.quantity !== null
          ? Number(consumption.inventoryItem.quantity)
          : 0;
        const toConsume = Number(consumption.consumedQuantity);
        let newQty = currentQty - toConsume;

        if (newQty < 0) {
          warnings.push(
            `INVENTORY_DRIFT_CLAMPED: ${consumption.inventoryItem.canonicalName} clamped from ${newQty} to 0`
          );
          newQty = 0;
        }

        await prisma.inventoryItem.update({
          where: { id: consumption.inventoryItemId },
          data: { quantity: newQty },
        });
      }

      // v0.6.1: Always emit consumption_logged event for variety tracking
      const planDateLocal = plan.planDateLocal.toISOString().split('T')[0];
      const recipeTags = Array.isArray(plan.selectedRecipe.tags)
        ? plan.selectedRecipe.tags as string[]
        : [];

      emitConsumptionLogged(
        plan.householdId,
        planDateLocal,
        plan.selectedRecipe.slug,
        ingredientsUsed,
        recipeTags
      ).catch((err) => {
        console.error('[Plan Commit] Failed to emit consumption_logged:', err);
      });
    }

    // Update plan status and DPE trace
    const existingTrace = plan.dpeTraceJson as Record<string, unknown>;
    const existingWarnings = (existingTrace.warnings as string[]) || [];

    const updatedTrace = warnings.length > 0
      ? { ...existingTrace, warnings: [...existingWarnings, ...warnings] }
      : existingTrace;

    await prisma.plan.update({
      where: { id: planId },
      data: {
        status: data.status,
        dpeTraceJson: updatedTrace as object,
      },
    });

    res.json({
      plan_id: planId,
      status: data.status,
      ingredients_consumed: ingredientsUsed,
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/plan/:planId/trace - Get DPE trace for debugging
router.get('/:planId/trace', async (req: Request<{ planId: string }>, res: Response, next: NextFunction) => {
  try {
    const planId = req.params.planId;

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    res.json(plan.dpeTraceJson);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// v0.6 Routes: Multi-Day Planning with Horizons
// ─────────────────────────────────────────────────────────────────────────────

// POST /v1/plan - Create a multi-day plan set
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = PlanRequestSchema.parse(req.body);

    const result = await computePlanSet(data);

    res.status(result.isExisting ? 200 : 201).json(result.response);
  } catch (err) {
    next(err);
  }
});

// POST /v1/plan_set/:planSetId/confirm - Confirm a plan set
router.post('/plan_set/:planSetId/confirm', async (req: Request<{ planSetId: string }>, res: Response, next: NextFunction) => {
  try {
    const planSetId = req.params.planSetId;

    const result = await confirmPlanSet(planSetId);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /v1/plan_set/:planSetId/swap - Swap a day in a plan set
router.post('/plan_set/:planSetId/swap', async (req: Request<{ planSetId: string }>, res: Response, next: NextFunction) => {
  try {
    const planSetId = req.params.planSetId;
    const { date_local, exclude_recipe_slugs = [] } = req.body;

    if (!date_local) {
      throw new InvalidInputError('date_local is required for swap', { planSetId });
    }

    const result = await swapDay(planSetId, date_local, exclude_recipe_slugs);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /v1/plan/:planId/commit - Extended commit with consumption_logged event
// Note: This overrides the previous commit route with v0.6 event emission
router.post('/:planId/commit/v2', async (req: Request<{ planId: string }>, res: Response, next: NextFunction) => {
  try {
    const planId = req.params.planId;
    const data = CommitPlanRequestSchema.parse(req.body);

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      include: {
        consumptions: { include: { inventoryItem: true } },
        selectedRecipe: true,
      },
    });

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    if (plan.status !== 'proposed' && plan.status !== 'confirmed') {
      throw new InvalidPlanStatusError(plan.status, data.status);
    }

    const warnings: string[] = [];
    const ingredientsUsed: string[] = [];

    // If status is "cooked", apply inventory deductions
    if (data.status === 'cooked') {
      for (const consumption of plan.consumptions) {
        ingredientsUsed.push(consumption.inventoryItem.canonicalName);

        // Handle unknown quantity items
        if (consumption.consumedUnknown || consumption.consumedQuantity === null) {
          await prisma.inventoryItem.update({
            where: { id: consumption.inventoryItemId },
            data: { assumedDepleted: true, opened: true },
          });
          warnings.push(
            `UNKNOWN_QTY_CONSUMED: ${consumption.inventoryItem.canonicalName} marked as assumed depleted`
          );
          continue;
        }

        // Handle estimate quantities
        if (consumption.inventoryItem.quantityConfidence === 'estimate') {
          warnings.push(
            `ESTIMATE_QTY_USED: ${consumption.inventoryItem.canonicalName} (${consumption.inventoryItem.quantity}${consumption.inventoryItem.unit} estimate)`
          );
        }

        // Normal quantity deduction
        const currentQty = consumption.inventoryItem.quantity !== null
          ? Number(consumption.inventoryItem.quantity)
          : 0;
        const toConsume = Number(consumption.consumedQuantity);
        let newQty = currentQty - toConsume;

        if (newQty < 0) {
          warnings.push(
            `INVENTORY_DRIFT_CLAMPED: ${consumption.inventoryItem.canonicalName} clamped from ${newQty} to 0`
          );
          newQty = 0;
        }

        await prisma.inventoryItem.update({
          where: { id: consumption.inventoryItemId },
          data: { quantity: newQty },
        });
      }

      // Emit consumption_logged event for variety tracking (v0.6)
      const planDateLocal = plan.planDateLocal.toISOString().split('T')[0];
      const recipeTags = Array.isArray(plan.selectedRecipe.tags)
        ? plan.selectedRecipe.tags
        : [];

      emitConsumptionLogged(
        plan.householdId,
        planDateLocal,
        plan.selectedRecipe.slug,
        ingredientsUsed,
        recipeTags as string[]
      ).catch((err) => {
        console.error('[Plan Commit] Failed to emit consumption_logged:', err);
      });
    }

    // Update plan status
    const existingTrace = plan.dpeTraceJson as Record<string, unknown>;
    const existingWarnings = (existingTrace.warnings as string[]) || [];

    await prisma.plan.update({
      where: { id: planId },
      data: {
        status: data.status,
        dpeTraceJson: {
          ...existingTrace,
          warnings: [...existingWarnings, ...warnings],
        },
      },
    });

    res.json({
      plan_id: planId,
      status: data.status,
      ingredients_consumed: ingredientsUsed,
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

export { router as planRoutes };
