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

// Quantity confidence levels
export const QuantityConfidenceEnum = z.enum(['exact', 'estimate', 'unknown']);
export type QuantityConfidence = z.infer<typeof QuantityConfidenceEnum>;

export const CreateInventoryItemRequestSchema = z.object({
  household_id: z.string().uuid(),
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  quantity: z.number().min(0).nullable().optional(),
  quantity_confidence: QuantityConfidenceEnum.default('exact'),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']),
  expiration_date: z.string().date().optional(),
  opened: z.boolean().default(false),
  location: z.enum(['fridge', 'freezer', 'pantry']).default('fridge'),
}).refine(
  (data) => {
    // If quantity_confidence is 'unknown', quantity must be null or undefined
    if (data.quantity_confidence === 'unknown') {
      return data.quantity === null || data.quantity === undefined;
    }
    // Otherwise, quantity must be provided and > 0
    return data.quantity !== null && data.quantity !== undefined && data.quantity > 0;
  },
  { message: 'quantity must be null for unknown confidence, positive number otherwise' }
);

export const UpdateInventoryItemRequestSchema = z.object({
  quantity: z.number().min(0).nullable().optional(),
  quantity_confidence: QuantityConfidenceEnum.optional(),
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
  quantity: number | null;
  quantityConfidence: QuantityConfidence;
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
  consumedQuantity: number | null; // null for unknown quantity items
  consumedUnknown: boolean;
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
  quantity: number | null;
  quantity_confidence: QuantityConfidence;
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
    quantity: number | null;
    quantityConfidence?: QuantityConfidence;
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
    consumed_quantity: number | null;
    consumed_unknown: boolean;
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

// ─────────────────────────────────────────────────────────────────────────────
// v0.5 Module Types
// ─────────────────────────────────────────────────────────────────────────────

// Inventory Intelligence Types
export interface InventoryIntelligenceParseOutput {
  canonical_name: string;
  display_name: string;
  quantity: number | null;
  quantity_confidence: QuantityConfidence;
  unit: string;
  location: 'fridge' | 'freezer' | 'pantry';
  expiration_date: string | null;  // ISO date string
  expiration_source: 'user' | 'heuristic' | null;
  expiry_rule_id: string | null;
  expiry_confidence: 'high' | 'medium' | 'low' | null;
}

export interface ExpiryHeuristicResult {
  rule_id: string;
  confidence: 'high' | 'medium' | 'low';
  expires_in_days: number;
}

export type IngredientCategory = 'protein' | 'dairy' | 'produce' | 'pantry' | 'frozen' | 'other';

// Grocery Normalization Types
export interface NormalizedGroceryItem {
  canonical_name: string;
  display_name: string;
  total_quantity: number;
  unit: string;
  category: IngredientCategory;
}

export interface NormalizedGroceryList {
  items: NormalizedGroceryItem[];
  summary: string;  // One-line human-readable summary
}

// Event Types
export const EventTypes = {
  PLAN_PROPOSED: 'plan_proposed',
  PLAN_CONFIRMED: 'plan_confirmed',
  PLAN_SWAPPED: 'plan_swapped',
  PLAN_COMMITTED: 'plan_committed',
  INVENTORY_ADDED: 'inventory_added',
  INVENTORY_USED: 'inventory_used',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

export interface EventPayload {
  [EventTypes.PLAN_PROPOSED]: { plan_id: string; recipe_slug: string };
  [EventTypes.PLAN_CONFIRMED]: { plan_id: string; recipe_slug: string };
  [EventTypes.PLAN_SWAPPED]: { plan_id: string; old_recipe_slug: string; new_recipe_slug: string };
  [EventTypes.PLAN_COMMITTED]: { plan_id: string; recipe_slug: string; status: 'cooked' | 'skipped' };
  [EventTypes.INVENTORY_ADDED]: { item_id: string; canonical_name: string; quantity: number | null; unit: string };
  [EventTypes.INVENTORY_USED]: { item_id: string; canonical_name: string; quantity_used: number | null };
}

export interface EmitEventOptions<T extends EventType> {
  householdId: string;
  eventType: T;
  payload: EventPayload[T];
}

export interface EmitEventResult {
  id: string;
  timestamp: string;
}

export interface GetEventsOptions {
  eventType?: EventType;
  since?: Date;
  limit?: number;
}

// Notification Types
export interface DinnerNotification {
  recipe_name: string;
  why_short: string;
  grocery_summary: string | null;
  plan_id: string;
  actions: {
    confirm: string;  // e.g., "Sounds good!"
    swap: string;     // e.g., "Something else"
  };
}

// Orchestrator Types
export interface OrchestratorTonightInput {
  household_id: string;
  now_ts?: string;  // ISO datetime string
  calendar_blocks?: CalendarBlockInput[];
}

export interface OrchestratorTonightOutput extends PlanTonightResponse {
  grocery_list_normalized: NormalizedGroceryList | null;
  assistant_message: string;  // WhatsApp-formatted message
}

// Enhanced Inventory Snapshot Trace (v0.5)
export interface InventorySnapshotTraceV05 extends InventorySnapshotTrace {
  expiration_source: 'user' | 'heuristic' | null;
  expiry_rule_id: string | null;
  expiry_confidence: 'high' | 'medium' | 'low' | null;
  expires_in_days: number | null;
}
