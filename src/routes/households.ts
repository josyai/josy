import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../models/prisma';

const router = Router();

const CreateHouseholdSchema = z.object({
  timezone: z.string().min(1),
  dinner_earliest_local: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  dinner_latest_local: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
  has_oven: z.boolean().default(true),
  has_stovetop: z.boolean().default(true),
  has_blender: z.boolean().default(false),
});

// POST /v1/households - Create a household
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateHouseholdSchema.parse(req.body);

    const household = await prisma.household.create({
      data: {
        timezone: data.timezone,
        dinnerEarliestLocal: data.dinner_earliest_local,
        dinnerLatestLocal: data.dinner_latest_local,
        hasOven: data.has_oven,
        hasStovetop: data.has_stovetop,
        hasBlender: data.has_blender,
      },
    });

    res.status(201).json({
      id: household.id,
      timezone: household.timezone,
      dinner_earliest_local: household.dinnerEarliestLocal,
      dinner_latest_local: household.dinnerLatestLocal,
      has_oven: household.hasOven,
      has_stovetop: household.hasStovetop,
      has_blender: household.hasBlender,
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/households/:id - Get a household
router.get('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const household = await prisma.household.findUnique({
      where: { id: req.params.id },
    });

    if (!household) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Household not found' },
      });
    }

    res.json({
      id: household.id,
      timezone: household.timezone,
      dinner_earliest_local: household.dinnerEarliestLocal,
      dinner_latest_local: household.dinnerLatestLocal,
      has_oven: household.hasOven,
      has_stovetop: household.hasStovetop,
      has_blender: household.hasBlender,
    });
  } catch (err) {
    next(err);
  }
});

export { router as householdRoutes };
