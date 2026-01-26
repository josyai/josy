import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import { PlanTonightRequestSchema, CommitPlanRequestSchema } from '../types';
import { planTonight } from '../services/dpe';
import { PlanNotFoundError, InvalidPlanStatusError } from '../utils/errors';

const router = Router();

// POST /v1/plan/tonight - Generate a dinner plan for tonight
router.post('/tonight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = PlanTonightRequestSchema.parse(req.body);
    const nowTs = data.now_ts ? new Date(data.now_ts) : new Date();

    const result = await planTonight(data.household_id, nowTs, data.calendar_blocks);
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
          const currentQty = Number(item.quantity);
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
