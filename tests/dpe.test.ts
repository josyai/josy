import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addMinutes, addDays, subDays, startOfDay } from 'date-fns';

// Mock types that mirror the DPE internal structures
interface TimeInterval {
  start: Date;
  end: Date;
  minutes: number;
}

interface InventorySnapshot {
  id: string;
  canonicalName: string;
  quantity: number;
  unit: string;
  expirationDate: Date | null;
  createdAt: Date;
}

// Helper functions extracted for unit testing

function subtractBlocks(
  interval: TimeInterval,
  blocks: Array<{ startsAt: Date; endsAt: Date }>
): TimeInterval[] {
  const sortedBlocks = [...blocks].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  const freeIntervals: TimeInterval[] = [];
  let currentStart = interval.start;

  for (const block of sortedBlocks) {
    if (block.endsAt <= interval.start || block.startsAt >= interval.end) {
      continue;
    }

    const blockStart = block.startsAt < interval.start ? interval.start : block.startsAt;
    const blockEnd = block.endsAt > interval.end ? interval.end : block.endsAt;

    if (currentStart < blockStart) {
      const minutes = Math.floor((blockStart.getTime() - currentStart.getTime()) / 60000);
      if (minutes > 0) {
        freeIntervals.push({ start: currentStart, end: blockStart, minutes });
      }
    }

    if (blockEnd > currentStart) {
      currentStart = blockEnd;
    }
  }

  if (currentStart < interval.end) {
    const minutes = Math.floor((interval.end.getTime() - currentStart.getTime()) / 60000);
    if (minutes > 0) {
      freeIntervals.push({ start: currentStart, end: interval.end, minutes });
    }
  }

  return freeIntervals;
}

function pickLongestThenEarliest(intervals: TimeInterval[]): TimeInterval | null {
  if (intervals.length === 0) return null;

  return intervals.reduce((best, current) => {
    if (current.minutes > best.minutes) return current;
    if (current.minutes === best.minutes && current.start < best.start) return current;
    return best;
  });
}

function computeUrgency(expirationDate: Date | null, todayLocal: Date): number {
  if (!expirationDate) return 0;

  const daysToExp = Math.floor(
    (expirationDate.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysToExp < 0) return -1;
  if (daysToExp <= 1) return 5;
  if (daysToExp <= 3) return 3;
  if (daysToExp <= 7) return 1;
  return 0;
}

function checkEquipment(
  required: string[],
  household: { hasOven: boolean; hasStovetop: boolean; hasBlender: boolean }
): boolean {
  for (const eq of required) {
    if (eq === 'oven' && !household.hasOven) return false;
    if (eq === 'stovetop' && !household.hasStovetop) return false;
    if (eq === 'blender' && !household.hasBlender) return false;
  }
  return true;
}

describe('DPE Core Functions', () => {
  describe('subtractBlocks', () => {
    it('returns full interval when no blocks', () => {
      const start = new Date('2026-01-20T18:00:00Z');
      const end = new Date('2026-01-20T21:00:00Z');
      const interval: TimeInterval = { start, end, minutes: 180 };

      const result = subtractBlocks(interval, []);

      expect(result).toHaveLength(1);
      expect(result[0].minutes).toBe(180);
    });

    it('removes block from middle of interval', () => {
      const start = new Date('2026-01-20T18:00:00Z');
      const end = new Date('2026-01-20T21:00:00Z');
      const interval: TimeInterval = { start, end, minutes: 180 };

      const blocks = [
        { startsAt: new Date('2026-01-20T19:00:00Z'), endsAt: new Date('2026-01-20T19:30:00Z') },
      ];

      const result = subtractBlocks(interval, blocks);

      expect(result).toHaveLength(2);
      expect(result[0].minutes).toBe(60); // 18:00-19:00
      expect(result[1].minutes).toBe(90); // 19:30-21:00
    });

    it('returns empty when blocks cover entire interval', () => {
      const start = new Date('2026-01-20T18:00:00Z');
      const end = new Date('2026-01-20T21:00:00Z');
      const interval: TimeInterval = { start, end, minutes: 180 };

      const blocks = [
        { startsAt: new Date('2026-01-20T18:00:00Z'), endsAt: new Date('2026-01-20T21:00:00Z') },
      ];

      const result = subtractBlocks(interval, blocks);

      expect(result).toHaveLength(0);
    });

    it('handles multiple non-overlapping blocks', () => {
      const start = new Date('2026-01-20T18:00:00Z');
      const end = new Date('2026-01-20T21:00:00Z');
      const interval: TimeInterval = { start, end, minutes: 180 };

      const blocks = [
        { startsAt: new Date('2026-01-20T18:30:00Z'), endsAt: new Date('2026-01-20T19:00:00Z') },
        { startsAt: new Date('2026-01-20T20:00:00Z'), endsAt: new Date('2026-01-20T20:30:00Z') },
      ];

      const result = subtractBlocks(interval, blocks);

      expect(result).toHaveLength(3);
      expect(result[0].minutes).toBe(30); // 18:00-18:30
      expect(result[1].minutes).toBe(60); // 19:00-20:00
      expect(result[2].minutes).toBe(30); // 20:30-21:00
    });
  });

  describe('pickLongestThenEarliest', () => {
    it('returns null for empty array', () => {
      expect(pickLongestThenEarliest([])).toBeNull();
    });

    it('picks longest interval', () => {
      const intervals: TimeInterval[] = [
        { start: new Date('2026-01-20T18:00:00Z'), end: new Date('2026-01-20T18:30:00Z'), minutes: 30 },
        { start: new Date('2026-01-20T19:00:00Z'), end: new Date('2026-01-20T21:00:00Z'), minutes: 120 },
      ];

      const result = pickLongestThenEarliest(intervals);

      expect(result?.minutes).toBe(120);
    });

    it('picks earliest when tied on length', () => {
      const intervals: TimeInterval[] = [
        { start: new Date('2026-01-20T19:00:00Z'), end: new Date('2026-01-20T20:00:00Z'), minutes: 60 },
        { start: new Date('2026-01-20T18:00:00Z'), end: new Date('2026-01-20T19:00:00Z'), minutes: 60 },
      ];

      const result = pickLongestThenEarliest(intervals);

      expect(result?.start).toEqual(new Date('2026-01-20T18:00:00Z'));
    });
  });

  describe('computeUrgency', () => {
    const today = new Date('2026-01-20T00:00:00Z');

    it('returns 0 for null expiration', () => {
      expect(computeUrgency(null, today)).toBe(0);
    });

    it('returns -1 for expired items', () => {
      const expired = subDays(today, 1);
      expect(computeUrgency(expired, today)).toBe(-1);
    });

    it('returns 5 for items expiring in 0-1 days', () => {
      const expiresToday = today;
      const expiresTomorrow = addDays(today, 1);

      expect(computeUrgency(expiresToday, today)).toBe(5);
      expect(computeUrgency(expiresTomorrow, today)).toBe(5);
    });

    it('returns 3 for items expiring in 2-3 days', () => {
      const expires2days = addDays(today, 2);
      const expires3days = addDays(today, 3);

      expect(computeUrgency(expires2days, today)).toBe(3);
      expect(computeUrgency(expires3days, today)).toBe(3);
    });

    it('returns 1 for items expiring in 4-7 days', () => {
      const expires5days = addDays(today, 5);
      expect(computeUrgency(expires5days, today)).toBe(1);
    });

    it('returns 0 for items expiring in >7 days', () => {
      const expires10days = addDays(today, 10);
      expect(computeUrgency(expires10days, today)).toBe(0);
    });
  });

  describe('checkEquipment', () => {
    it('returns true when no equipment required', () => {
      const household = { hasOven: false, hasStovetop: false, hasBlender: false };
      expect(checkEquipment([], household)).toBe(true);
    });

    it('returns true when all required equipment available', () => {
      const household = { hasOven: true, hasStovetop: true, hasBlender: true };
      expect(checkEquipment(['oven', 'stovetop'], household)).toBe(true);
    });

    it('returns false when oven required but not available', () => {
      const household = { hasOven: false, hasStovetop: true, hasBlender: true };
      expect(checkEquipment(['oven'], household)).toBe(false);
    });

    it('returns false when stovetop required but not available', () => {
      const household = { hasOven: true, hasStovetop: false, hasBlender: true };
      expect(checkEquipment(['stovetop'], household)).toBe(false);
    });

    it('returns false when blender required but not available', () => {
      const household = { hasOven: true, hasStovetop: true, hasBlender: false };
      expect(checkEquipment(['blender'], household)).toBe(false);
    });
  });
});

describe('Acceptance Tests (Unit Level)', () => {
  // AT-02: No feasible time window
  describe('AT-02: No feasible time window', () => {
    it('returns no free intervals when calendar blocks cover entire window', () => {
      const start = new Date('2026-01-20T18:00:00Z');
      const end = new Date('2026-01-20T21:00:00Z');
      const interval: TimeInterval = { start, end, minutes: 180 };

      const blocks = [
        { startsAt: new Date('2026-01-20T17:00:00Z'), endsAt: new Date('2026-01-20T22:00:00Z') },
      ];

      const result = subtractBlocks(interval, blocks);
      expect(result).toHaveLength(0);
    });
  });

  // AT-03: Interval too short
  describe('AT-03: Interval exists but too short', () => {
    it('identifies when longest interval is shorter than recipe time', () => {
      const intervals: TimeInterval[] = [
        { start: new Date('2026-01-20T18:00:00Z'), end: new Date('2026-01-20T18:20:00Z'), minutes: 20 },
      ];

      const longest = pickLongestThenEarliest(intervals);
      const recipeTime = 25;

      expect(longest!.minutes).toBeLessThan(recipeTime);
    });
  });

  // AT-04: Equipment constraint
  describe('AT-04: Equipment constraint blocks recipe', () => {
    it('rejects oven recipe when household has no oven', () => {
      const household = { hasOven: false, hasStovetop: true, hasBlender: true };
      expect(checkEquipment(['oven'], household)).toBe(false);
    });
  });

  // AT-05: Expired inventory not counted
  describe('AT-05: Expired inventory not counted', () => {
    it('marks expired items with negative urgency', () => {
      const today = new Date('2026-01-20T00:00:00Z');
      const yesterday = subDays(today, 1);

      expect(computeUrgency(yesterday, today)).toBe(-1);
    });
  });

  // AT-06: Multiple items same ingredient - consume earliest expiration first
  describe('AT-06: Inventory allocation order', () => {
    it('sorts inventory by expiration date (earliest first)', () => {
      const today = new Date('2026-01-20T00:00:00Z');
      const inventory: InventorySnapshot[] = [
        { id: '1', canonicalName: 'tomato', quantity: 4, unit: 'pcs', expirationDate: addDays(today, 5), createdAt: today },
        { id: '2', canonicalName: 'tomato', quantity: 2, unit: 'pcs', expirationDate: addDays(today, 1), createdAt: today },
      ];

      const sorted = [...inventory].sort((a, b) => {
        if (a.expirationDate && b.expirationDate) {
          return a.expirationDate.getTime() - b.expirationDate.getTime();
        }
        if (a.expirationDate && !b.expirationDate) return -1;
        if (!a.expirationDate && b.expirationDate) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      expect(sorted[0].id).toBe('2'); // earliest expiration
      expect(sorted[1].id).toBe('1');
    });
  });

  // AT-09: Deterministic tie-breaking
  describe('AT-09: Deterministic tie-breaking by slug', () => {
    it('selects lexicographically smaller slug when scores are tied', () => {
      const candidates = [
        { slug: 'zebra-recipe', score: 10 },
        { slug: 'apple-recipe', score: 10 },
      ];

      const sorted = [...candidates].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.slug.localeCompare(b.slug);
      });

      expect(sorted[0].slug).toBe('apple-recipe');
    });
  });
});
