/**
 * DPE Scoring Constants
 *
 * These values control the recipe ranking algorithm.
 * See docs/dpe-rules-v0.md for the full decision tables.
 */

export const DPE_VERSION = 'v0.3';

export const SCORING = {
  /** Multiplier for urgency scores in waste calculation */
  WASTE_WEIGHT: 1,

  /** Penalty per missing ingredient (encourages inventory usage) */
  GROCERY_PENALTY_PER_ITEM: 10,

  /** Penalty per minute of cook time (encourages quicker recipes) */
  TIME_PENALTY_FACTOR: 0.2,
} as const;
