import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import {
  CreateInventoryItemRequestSchema,
  UpdateInventoryItemRequestSchema,
} from '../types';
import { InvalidInputError } from '../utils/errors';
import {
  canonicalizeIngredientName,
  validateUnit,
  validateLocation,
  clampQuantity,
} from '../utils/canonicalize';
import { startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const router = Router();

/**
 * Mark any existing "proposed" plans for today as "overridden".
 * This ensures that the next /plan/tonight call recomputes fresh.
 *
 * Re-plan is pull-based (v0.1): we don't auto-recompute,
 * we just invalidate existing proposals.
 */
async function invalidateProposedPlans(householdId: string): Promise<number> {
  // Get household timezone
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { timezone: true },
  });

  if (!household) return 0;

  // Compute "today" in household timezone
  const now = new Date();
  const nowInTz = toZonedTime(now, household.timezone);
  const todayLocal = startOfDay(nowInTz);

  // Mark proposed plans for today as overridden
  const result = await prisma.plan.updateMany({
    where: {
      householdId,
      status: 'proposed',
      planDateLocal: todayLocal,
    },
    data: {
      status: 'overridden',
    },
  });

  return result.count;
}

// GET /v1/inventory?household_id=... - List inventory items
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const householdId = req.query.household_id;
    if (!householdId || typeof householdId !== 'string') {
      throw new InvalidInputError('household_id query parameter is required');
    }

    // Include items with quantity > 0 OR unknown confidence (which have null quantity)
    const items = await prisma.inventoryItem.findMany({
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

    res.json({
      items: items.map((item) => ({
        id: item.id,
        canonical_name: item.canonicalName,
        display_name: item.displayName,
        quantity: item.quantity !== null ? Number(item.quantity) : null,
        quantity_confidence: item.quantityConfidence,
        unit: item.unit,
        expiration_date: item.expirationDate
          ? item.expirationDate.toISOString().split('T')[0]
          : null,
        opened: item.opened,
        location: item.location,
        created_at: item.createdAt.toISOString(),
        updated_at: item.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/inventory/items - Create inventory item
router.post('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateInventoryItemRequestSchema.parse(req.body);

    // Normalize inputs
    const canonicalName = canonicalizeIngredientName(data.canonical_name);
    const displayName = data.display_name.trim();
    const unit = validateUnit(data.unit);
    const location = validateLocation(data.location);
    const quantityConfidence = data.quantity_confidence;

    // Handle quantity based on confidence level
    let quantity: number | null = null;
    if (quantityConfidence === 'unknown') {
      quantity = null;
    } else if (data.quantity !== null && data.quantity !== undefined) {
      quantity = clampQuantity(data.quantity);
    }

    if (!unit) {
      throw new InvalidInputError(`Invalid unit: ${data.unit}. Valid units: g, kg, ml, l, pcs`);
    }

    const item = await prisma.inventoryItem.create({
      data: {
        householdId: data.household_id,
        canonicalName,
        displayName,
        quantity,
        quantityConfidence,
        unit,
        expirationDate: data.expiration_date ? new Date(data.expiration_date) : null,
        opened: data.opened,
        location,
      },
    });

    // Invalidate any proposed plans for today (re-plan trigger)
    const invalidatedCount = await invalidateProposedPlans(data.household_id);

    res.status(201).json({
      id: item.id,
      canonical_name: item.canonicalName,
      display_name: item.displayName,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      quantity_confidence: item.quantityConfidence,
      unit: item.unit,
      plans_invalidated: invalidatedCount,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /v1/inventory/items - Upsert inventory item (merge if exists)
// Merge keys: household_id + canonical_name + unit
// Merge behavior:
// - exact + exact -> exact (sum quantities)
// - any estimate -> estimate
// - unknown stays unknown unless numeric arrives
router.put('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateInventoryItemRequestSchema.parse(req.body);

    // Normalize inputs
    const canonicalName = canonicalizeIngredientName(data.canonical_name);
    const displayName = data.display_name.trim();
    const unit = validateUnit(data.unit);
    const location = validateLocation(data.location);
    const quantityConfidence = data.quantity_confidence;

    if (!unit) {
      throw new InvalidInputError(`Invalid unit: ${data.unit}. Valid units: g, kg, ml, l, pcs`);
    }

    // Handle quantity based on confidence level
    let inputQuantity: number | null = null;
    if (quantityConfidence === 'unknown') {
      inputQuantity = null;
    } else if (data.quantity !== null && data.quantity !== undefined) {
      inputQuantity = clampQuantity(data.quantity);
    }

    // Check for existing item with same household + canonical_name + unit
    const existing = await prisma.inventoryItem.findFirst({
      where: {
        householdId: data.household_id,
        canonicalName,
        unit,
        assumedDepleted: false,
      },
    });

    let item;
    let merged = false;

    if (existing) {
      // Merge logic
      merged = true;
      const existingQty = existing.quantity !== null ? Number(existing.quantity) : 0;
      const newQty = existingQty + (inputQuantity || 0);

      // Determine merged confidence:
      // - If either is unknown and numeric arrives, upgrade to estimate
      // - If both exact, stay exact
      // - Otherwise estimate
      let mergedConfidence: string;
      if (existing.quantityConfidence === 'unknown' && inputQuantity !== null) {
        mergedConfidence = 'estimate';
      } else if (quantityConfidence === 'unknown') {
        mergedConfidence = existing.quantityConfidence;
      } else if (existing.quantityConfidence === 'exact' && quantityConfidence === 'exact') {
        mergedConfidence = 'exact';
      } else {
        mergedConfidence = 'estimate';
      }

      // Pick earlier expiration date if both present
      let mergedExpiration = existing.expirationDate;
      if (data.expiration_date) {
        const newExpiration = new Date(data.expiration_date);
        if (!mergedExpiration || newExpiration < mergedExpiration) {
          mergedExpiration = newExpiration;
        }
      }

      item = await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: newQty,
          quantityConfidence: mergedConfidence,
          expirationDate: mergedExpiration,
          displayName, // Update display name to latest
          assumedDepleted: false,
        },
      });
    } else {
      // Create new item
      item = await prisma.inventoryItem.create({
        data: {
          householdId: data.household_id,
          canonicalName,
          displayName,
          quantity: inputQuantity,
          quantityConfidence,
          unit,
          expirationDate: data.expiration_date ? new Date(data.expiration_date) : null,
          opened: data.opened,
          location,
        },
      });
    }

    // Invalidate any proposed plans for today (re-plan trigger)
    const invalidatedCount = await invalidateProposedPlans(data.household_id);

    res.status(merged ? 200 : 201).json({
      id: item.id,
      canonical_name: item.canonicalName,
      display_name: item.displayName,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      quantity_confidence: item.quantityConfidence,
      unit: item.unit,
      merged,
      plans_invalidated: invalidatedCount,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/inventory/items/:id - Update inventory item
router.patch('/items/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const data = UpdateInventoryItemRequestSchema.parse(req.body);

    // First, get the existing item to know the household_id
    const existingItem = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });

    if (!existingItem) {
      throw new InvalidInputError('Inventory item not found');
    }

    // Build update data with normalization
    const updateData: Record<string, unknown> = {};

    // Handle quantity_confidence first as it affects quantity handling
    if (data.quantity_confidence !== undefined) {
      updateData.quantityConfidence = data.quantity_confidence;
      // If setting to unknown, also clear the quantity
      if (data.quantity_confidence === 'unknown') {
        updateData.quantity = null;
      }
    }

    if (data.quantity !== undefined) {
      // If quantity is null, set it to null; otherwise clamp it
      if (data.quantity === null) {
        updateData.quantity = null;
      } else {
        updateData.quantity = clampQuantity(data.quantity);
      }
    }

    if (data.expiration_date !== undefined) {
      updateData.expirationDate = data.expiration_date
        ? new Date(data.expiration_date)
        : null;
    }

    if (data.opened !== undefined) {
      updateData.opened = data.opened;
    }

    if (data.location !== undefined) {
      updateData.location = validateLocation(data.location);
    }

    if (data.display_name !== undefined) {
      updateData.displayName = data.display_name.trim();
    }

    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Invalidate any proposed plans for today (re-plan trigger)
    const invalidatedCount = await invalidateProposedPlans(existingItem.householdId);

    res.json({
      id: item.id,
      canonical_name: item.canonicalName,
      display_name: item.displayName,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      quantity_confidence: item.quantityConfidence,
      unit: item.unit,
      expiration_date: item.expirationDate
        ? item.expirationDate.toISOString().split('T')[0]
        : null,
      opened: item.opened,
      location: item.location,
      plans_invalidated: invalidatedCount,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/inventory/items/:id - Delete inventory item
router.delete('/items/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    // Get the item first to know the household_id
    const existingItem = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });

    if (!existingItem) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Inventory item not found' },
      });
    }

    await prisma.inventoryItem.delete({
      where: { id: req.params.id },
    });

    // Invalidate any proposed plans for today (re-plan trigger)
    await invalidateProposedPlans(existingItem.householdId);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRoutes };
