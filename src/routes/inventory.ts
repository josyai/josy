import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';
import {
  CreateInventoryItemRequestSchema,
  UpdateInventoryItemRequestSchema,
} from '../types';
import { InvalidInputError } from '../utils/errors';

const router = Router();

// GET /v1/inventory?household_id=... - List inventory items
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const householdId = req.query.household_id;
    if (!householdId || typeof householdId !== 'string') {
      throw new InvalidInputError('household_id query parameter is required');
    }

    const items = await prisma.inventoryItem.findMany({
      where: {
        householdId,
        quantity: { gt: 0 },
      },
      orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({
      items: items.map((item) => ({
        id: item.id,
        canonical_name: item.canonicalName,
        display_name: item.displayName,
        quantity: Number(item.quantity),
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

    const item = await prisma.inventoryItem.create({
      data: {
        householdId: data.household_id,
        canonicalName: data.canonical_name,
        displayName: data.display_name,
        quantity: data.quantity,
        unit: data.unit,
        expirationDate: data.expiration_date ? new Date(data.expiration_date) : null,
        opened: data.opened,
        location: data.location,
      },
    });

    res.status(201).json({ id: item.id });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/inventory/items/:id - Update inventory item
router.patch('/items/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const data = UpdateInventoryItemRequestSchema.parse(req.body);

    const updateData: Record<string, unknown> = {};
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.expiration_date !== undefined) {
      updateData.expirationDate = data.expiration_date
        ? new Date(data.expiration_date)
        : null;
    }
    if (data.opened !== undefined) updateData.opened = data.opened;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.display_name !== undefined) updateData.displayName = data.display_name;

    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({
      id: item.id,
      canonical_name: item.canonicalName,
      display_name: item.displayName,
      quantity: Number(item.quantity),
      unit: item.unit,
      expiration_date: item.expirationDate
        ? item.expirationDate.toISOString().split('T')[0]
        : null,
      opened: item.opened,
      location: item.location,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/inventory/items/:id - Delete inventory item
router.delete('/items/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    await prisma.inventoryItem.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export { router as inventoryRoutes };
