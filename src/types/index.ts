import { z } from 'zod';

// API Request/Response schemas using Zod

export const CalendarBlockInputSchema = z.object({
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  title: z.string().optional(),
  source: z.enum(['manual', 'google', 'outlook']).default('manual'),
});

export const PlanTonightRequestSchema = z.object({
  household_id: z.string().uuid(),
  now_ts: z.string().datetime().optional(),
  calendar_blocks: z.array(CalendarBlockInputSchema).default([]),
});

export const CommitPlanRequestSchema = z.object({
  status: z.enum(['cooked', 'skipped', 'overridden']),
});

export const CreateInventoryItemRequestSchema = z.object({
  household_id: z.string().uuid(),
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']),
  expiration_date: z.string().date().optional(),
  opened: z.boolean().default(false),
  location: z.enum(['fridge', 'freezer', 'pantry']).default('fridge'),
});

export const UpdateInventoryItemRequestSchema = z.object({
  quantity: z.number().min(0).optional(),
  expiration_date: z.string().date().nullable().optional(),
  opened: z.boolean().optional(),
  location: z.enum(['fridge', 'freezer', 'pantry']).optional(),
  display_name: z.string().min(1).optional(),
});

// Types inferred from schemas
export type CalendarBlockInput = z.infer<typeof CalendarBlockInputSchema>;
export type PlanTonightRequest = z.infer<typeof PlanTonightRequestSchema>;
export type CommitPlanRequest = z.infer<typeof CommitPlanRequestSchema>;
export type CreateInventoryItemRequest = z.infer<typeof CreateInventoryItemRequestSchema>;
export type UpdateInventoryItemRequest = z.infer<typeof UpdateInventoryItemRequestSchema>;

// DPE Internal Types
export interface TimeInterval {
  start: Date;
  end: Date;
  minutes: number;
}

export interface InventorySnapshot {
  id: string;
  canonicalName: string;
  quantity: number;
  unit: string;
  expirationDate: Date | null;
  createdAt: Date;
}

export interface MissingIngredient {
  canonicalName: string;
  requiredQuantity: number;
  unit: string;
}

export interface UsagePlanItem {
  inventoryItemId: string;
  canonicalName: string;
  consumedQuantity: number;
  unit: string;
}

// Phase 2: Enhanced Reasoning Trace Types

export interface RecipeScores {
  waste: number;       // Higher = better (uses expiring items)
  grocery_penalty: number;  // Lower = better (fewer missing items)
  time_penalty: number;     // Lower = better (shorter recipes)
  final: number;       // Combined score (waste - grocery_penalty - time_penalty)
}

export interface EligibleRecipe {
  recipe: string;      // Recipe slug
  eligible: true;
  rejections: string[];  // Empty for eligible recipes
  scores: RecipeScores;
  missing_ingredients: string[];  // List of missing ingredient names
  uses_inventory: string[];       // List of inventory items used
}

export interface RejectedRecipe {
  recipe: string;      // Recipe slug
  eligible: false;
  reason: string;      // Why it was rejected
}

export interface CalendarConstraints {
  dinner_window: {
    start: string;
    end: string;
  };
  busy_blocks: Array<{
    start: string;
    end: string;
    title: string | null;
  }>;
  available_minutes: number;
}

export interface InventorySnapshotTrace {
  canonical_name: string;
  quantity: number;
  unit: string;
  expiration_date: string | null;
  urgency: number;  // 0-5, higher = expiring sooner
}

/**
 * Phase 2 Reasoning Trace - required structure per spec
 * This trace explains why a decision was made.
 */
export interface ReasoningTrace {
  version: string;
  generated_at: string;

  // Input state
  inventory_snapshot: InventorySnapshotTrace[];
  calendar_constraints: CalendarConstraints;

  // Decision process
  eligible_recipes: EligibleRecipe[];
  rejected_recipes: RejectedRecipe[];

  // Output
  winner: string;           // Recipe slug
  tie_breaker: string | null;  // What broke the tie, if any

  // Debug info
  scoring_details: {
    waste_weight: number;
    grocery_penalty_per_item: number;
    time_penalty_factor: number;
  };
}

// Legacy DPETrace for backwards compatibility
export interface DPETrace {
  version: string;
  nowTs: string;
  timezone: string;
  computedWindow: { start: string; end: string };
  calendarBlocksConsidered: Array<{
    startsAt: string;
    endsAt: string;
    source: string;
    title: string | null;
  }>;
  freeIntervals: Array<{ start: string; end: string; minutes: number }>;
  selectedInterval: { start: string; end: string; minutes: number } | null;
  inventorySnapshot: Array<{
    id: string;
    canonicalName: string;
    quantity: number;
    unit: string;
    expirationDate: string | null;
  }>;
  candidates: RecipeCandidate[];
  winner: { recipeSlug: string; finalScore: number } | null;
  warnings: string[];

  // Phase 2: Add reasoning trace
  reasoning_trace?: ReasoningTrace;
}

export interface RecipeCandidate {
  recipeId: string;
  recipeSlug: string;
  recipeName: string;
  totalTimeMinutes: number;
  eligible: boolean;
  ineligibilityReason?: string;
  missingRequired: MissingIngredient[];
  usagePlan: UsagePlanItem[];
  scores: {
    wasteScore: number;
    spendPenalty: number;
    timePenalty: number;
    final: number;
  };
}

// API Response Types
export interface PlanTonightResponse {
  plan_id: string;
  plan_date_local: string;
  feasible_window: {
    start: string;
    end: string;
  };
  recipe: {
    id: string;
    slug: string;
    name: string;
    total_time_minutes: number;
    instructions_md: string;
  };
  inventory_to_consume: Array<{
    inventory_item_id: string;
    canonical_name: string;
    consumed_quantity: number;
    unit: string;
  }>;
  grocery_addons: Array<{
    canonical_name: string;
    required_quantity: number;
    unit: string;
  }>;
  why: string[];

  // Phase 2: Include reasoning trace in response
  reasoning_trace: ReasoningTrace;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Error codes from spec
export const ErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  NO_FEASIBLE_TIME_WINDOW: 'NO_FEASIBLE_TIME_WINDOW',
  NO_ELIGIBLE_RECIPE: 'NO_ELIGIBLE_RECIPE',
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  INVALID_PLAN_STATUS: 'INVALID_PLAN_STATUS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
