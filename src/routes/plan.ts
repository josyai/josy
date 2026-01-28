import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import { PlanTonightRequestSchema, CommitPlanRequestSchema } from '../types';
import { orchestrateTonight } from '../services/orchestrator';
import { PlanNotFoundError, InvalidPlanStatusError } from '../utils/errors';

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
router.post('/:planId/commit', async (req: Request<{ planId: string }>, res: Response, next: NextFunction) => {
  try {
    const planId = req.params.planId;
    const data = CommitPlanRequestSchema.parse(req.body);

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      include: { consumptions: true },
    });

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    if (plan.status !== 'proposed') {
      throw new InvalidPlanStatusError(plan.status, data.status);
    }

    // If status is "cooked", apply inventory deductions
    if (data.status === 'cooked') {
      const warnings: string[] = [];

      for (const consumption of plan.consumptions) {
        const item = await prisma.inventoryItem.findUnique({
          where: { id: consumption.inventoryItemId },
        });

        if (item) {
          // Handle unknown quantity items - set assumedDepleted instead of decrementing
          if (consumption.consumedUnknown || consumption.consumedQuantity === null) {
            await prisma.inventoryItem.update({
              where: { id: consumption.inventoryItemId },
              data: { assumedDepleted: true, opened: true },
            });
            warnings.push(
              `UNKNOWN_QTY_CONSUMED: ${item.canonicalName} marked as assumed depleted`
            );
            continue;
          }

          // Handle estimate quantities - log warning
          if (item.quantityConfidence === 'estimate') {
            warnings.push(
              `ESTIMATE_QTY_USED: ${item.canonicalName} (${item.quantity}${item.unit} estimate) - actual may vary`
            );
          }

          // Normal quantity deduction
          const currentQty = item.quantity !== null ? Number(item.quantity) : 0;
          const toConsume = Number(consumption.consumedQuantity);
          let newQty = currentQty - toConsume;

          if (newQty < 0) {
            warnings.push(
              `INVENTORY_DRIFT_CLAMPED: ${item.canonicalName} clamped from ${newQty} to 0`
            );
            newQty = 0;
          }

          await prisma.inventoryItem.update({
            where: { id: consumption.inventoryItemId },
            data: { quantity: newQty },
          });
        }
      }

      // Update DPE trace with warnings if any
      if (warnings.length > 0) {
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
      } else {
        await prisma.plan.update({
          where: { id: planId },
          data: { status: data.status },
        });
      }
    } else {
      // Just update status for skipped/overridden
      await prisma.plan.update({
        where: { id: planId },
        data: { status: data.status },
      });
    }

    res.json({ plan_id: planId, status: data.status });
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

export { router as planRoutes };
