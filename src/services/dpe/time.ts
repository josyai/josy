/**
 * DPE Time Utilities
 *
 * Pure functions for time window calculations.
 * All functions are deterministic with no side effects.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { differenceInMinutes, startOfDay } from 'date-fns';
import { TimeInterval } from '../../types';

/**
 * Parse a time string (HH:MM) into hours and minutes
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Create a Date object for a specific time on a given day in a timezone
 */
export function createTimeOnDate(
  date: Date,
  timeStr: string,
  timezone: string
): Date {
  const { hours, minutes } = parseTimeString(timeStr);
  const zonedDate = toZonedTime(date, timezone);
  const dayStart = startOfDay(zonedDate);
  const localTime = new Date(dayStart);
  localTime.setHours(hours, minutes, 0, 0);
  return fromZonedTime(localTime, timezone);
}

/**
 * Subtract calendar blocks from a time interval to get free intervals.
 *
 * This is a key DPE function that computes available cooking time
 * by removing busy periods from the dinner window.
 *
 * @param interval - The full dinner window
 * @param blocks - Calendar blocks (meetings, events, etc.)
 * @returns Array of free intervals with duration in minutes
 */
export function subtractBlocks(
  interval: TimeInterval,
  blocks: Array<{ startsAt: Date; endsAt: Date }>
): TimeInterval[] {
  const sortedBlocks = [...blocks].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  const freeIntervals: TimeInterval[] = [];
  let currentStart = interval.start;

  for (const block of sortedBlocks) {
    // Skip blocks completely outside the interval
    if (block.endsAt <= interval.start || block.startsAt >= interval.end) {
      continue;
    }

    const blockStart = block.startsAt < interval.start ? interval.start : block.startsAt;
    const blockEnd = block.endsAt > interval.end ? interval.end : block.endsAt;

    // Add free interval before this block
    if (currentStart < blockStart) {
      const minutes = differenceInMinutes(blockStart, currentStart);
      if (minutes > 0) {
        freeIntervals.push({ start: currentStart, end: blockStart, minutes });
      }
    }

    // Move past this block
    if (blockEnd > currentStart) {
      currentStart = blockEnd;
    }
  }

  // Add remaining free interval after last block
  if (currentStart < interval.end) {
    const minutes = differenceInMinutes(interval.end, currentStart);
    if (minutes > 0) {
      freeIntervals.push({ start: currentStart, end: interval.end, minutes });
    }
  }

  return freeIntervals;
}

/**
 * Pick the best interval for cooking.
 *
 * Tie-breaker order:
 * 1. Longest duration (maximize cooking time)
 * 2. Earliest start (prefer cooking earlier)
 *
 * @param intervals - Available free intervals
 * @returns The best interval, or null if none available
 */
export function pickLongestThenEarliest(intervals: TimeInterval[]): TimeInterval | null {
  if (intervals.length === 0) return null;

  return intervals.reduce((best, current) => {
    if (current.minutes > best.minutes) return current;
    if (current.minutes === best.minutes && current.start < best.start) return current;
    return best;
  });
}
