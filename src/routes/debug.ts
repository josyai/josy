/**
 * Debug Routes v0.7
 *
 * Read-only debug endpoints for observability.
 * Protected by DEBUG_ROUTES=1 environment variable.
 *
 * Routes:
 * - GET /v1/debug/plan_set/:id - Full PlanSet with items and traces
 * - GET /v1/debug/events - Recent EventLog rows
 * - GET /v1/debug/inventory - Current inventory snapshot
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Check DEBUG_ROUTES flag
// ─────────────────────────────────────────────────────────────────────────────

function checkDebugEnabled(req: Request, res: Response, next: NextFunction) {
  if (process.env.DEBUG_ROUTES !== '1') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}

// Apply to all routes in this router
router.use(checkDebugEnabled);

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/debug/plan_set/:id
// ─────────────────────────────────────────────────────────────────────────────

router.get('/plan_set/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const planSet = await prisma.planSet.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { dateLocal: 'asc' },
        },
        household: {
          select: {
            id: true,
            timezone: true,
            dinnerEarliestLocal: true,
            dinnerLatestLocal: true,
          },
        },
      },
    });

    if (!planSet) {
      res.status(404).json({ error: 'PlanSet not found' });
      return;
    }

    // Sanitize: don't expose any secrets (there aren't any in this model, but good practice)
    const response = {
      id: planSet.id,
      householdId: planSet.householdId,
      status: planSet.status,
      stableKey: planSet.stableKey,
      horizonJson: planSet.horizonJson,
      traceJson: planSet.traceJson,
      createdAt: planSet.createdAt,
      updatedAt: planSet.updatedAt,
      items: planSet.items.map((item) => ({
        id: item.id,
        dateLocal: item.dateLocal,
        mealSlot: item.mealSlot,
        planId: item.planId,
        recipeSlug: item.recipeSlug,
        status: item.status,
        traceJson: item.traceJson,
        createdAt: item.createdAt,
      })),
      household: planSet.household,
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/debug/events
// ─────────────────────────────────────────────────────────────────────────────

router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { household_id, limit = '50', event_type } = req.query;

    if (!household_id || typeof household_id !== 'string') {
      res.status(400).json({ error: 'household_id query parameter is required' });
      return;
    }

    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);

    const events = await prisma.eventLog.findMany({
      where: {
        householdId: household_id,
        ...(event_type && typeof event_type === 'string' ? { eventType: event_type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
    });

    // Sanitize: remove any potentially sensitive data from payloads
    const sanitizedEvents = events.map((event) => ({
      id: event.id,
      householdId: event.householdId,
      eventType: event.eventType,
      payload: sanitizePayload(event.payload as Record<string, unknown>),
      createdAt: event.createdAt,
    }));

    res.json({
      events: sanitizedEvents,
      count: sanitizedEvents.length,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/debug/inventory
// ─────────────────────────────────────────────────────────────────────────────

router.get('/inventory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { household_id } = req.query;

    if (!household_id || typeof household_id !== 'string') {
      res.status(400).json({ error: 'household_id query parameter is required' });
      return;
    }

    const items = await prisma.inventoryItem.findMany({
      where: {
        householdId: household_id,
      },
      orderBy: [
        { expirationDate: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const response = {
      householdId: household_id,
      itemCount: items.length,
      activeCount: items.filter((i) => !i.assumedDepleted && (i.quantity === null || Number(i.quantity) > 0)).length,
      items: items.map((item) => ({
        id: item.id,
        canonicalName: item.canonicalName,
        displayName: item.displayName,
        quantity: item.quantity !== null ? Number(item.quantity) : null,
        quantityConfidence: item.quantityConfidence,
        unit: item.unit,
        expirationDate: item.expirationDate,
        expirationSource: item.expirationSource,
        opened: item.opened,
        location: item.location,
        assumedDepleted: item.assumedDepleted,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Sanitize payload (remove any secrets)
// ─────────────────────────────────────────────────────────────────────────────

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['token', 'secret', 'password', 'key', 'api_key', 'apiKey'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizePayload(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export { router as debugRoutes };
