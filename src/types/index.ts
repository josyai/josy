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

// ─────────────────────────────────────────────────────────────────────────────
// v0.6 Planning Horizon Types
// ─────────────────────────────────────────────────────────────────────────────

// Horizon Modes
export const HorizonModes = {
  NEXT_MEAL: 'NEXT_MEAL',
  NEXT_N_DINNERS: 'NEXT_N_DINNERS',
  DATE_RANGE: 'DATE_RANGE',
} as const;

export type HorizonMode = typeof HorizonModes[keyof typeof HorizonModes];

// Horizon Schema
export const HorizonSchema = z.object({
  mode: z.enum(['NEXT_MEAL', 'NEXT_N_DINNERS', 'DATE_RANGE']),
  n_dinners: z.number().int().min(1).max(7).optional(),
  start_date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (data) => {
    if (data.mode === 'NEXT_N_DINNERS') {
      return data.n_dinners !== undefined && data.n_dinners >= 1 && data.n_dinners <= 7;
    }
    if (data.mode === 'DATE_RANGE') {
      return data.start_date_local !== undefined && data.end_date_local !== undefined;
    }
    return true;
  },
  { message: 'Invalid horizon configuration for the specified mode' }
);

export type Horizon = z.infer<typeof HorizonSchema>;

// Intent Override for a specific day
export const IntentOverrideSchema = z.object({
  date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  must_include: z.array(z.string()).optional(),
  must_exclude: z.array(z.string()).optional(),
  preferred_recipe_tags: z.array(z.string()).optional(),
  preferred_recipe_slugs: z.array(z.string()).optional(),
});

export type IntentOverride = z.infer<typeof IntentOverrideSchema>;

// Plan Options
export const PlanOptionsSchema = z.object({
  exclude_recipe_slugs: z.array(z.string()).optional(),
  variety_window_days: z.number().int().min(3).max(10).default(7),
  stability_band_pct: z.number().min(0).max(50).default(10),
  force_recompute: z.boolean().default(false),
});

export type PlanOptions = z.infer<typeof PlanOptionsSchema>;

// POST /v1/plan Request Schema
export const PlanRequestSchema = z.object({
  household_id: z.string().uuid(),
  now_ts: z.string().datetime().optional(),
  calendar_blocks: z.array(CalendarBlockInputSchema).default([]),
  horizon: HorizonSchema,
  intent_overrides: z.array(IntentOverrideSchema).default([]),
  options: PlanOptionsSchema.optional(),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;

// Per-Day Plan Response
export interface PlanDayResponse {
  date_local: string;
  meal_slot: 'DINNER';
  plan_id: string;
  recipe: {
    slug: string;
    name: string;
    total_time_minutes: number;
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
  grocery_list_normalized: NormalizedGroceryList | null;
  assistant_message: string;
  reasoning_trace: ReasoningTrace;
}

// Variety Penalty Info for trace
export interface VarietyPenaltyApplied {
  ingredient: string;
  last_consumed_date: string;
  days_since: number;
  penalty_points: number;
  reason: string;
}

// Stability Decision for trace
export interface StabilityDecision {
  date_local: string;
  kept_recipe: string | null;
  new_best_recipe: string;
  decision: 'kept' | 'changed';
  reason: string;
  old_score: number | null;
  new_score: number;
  within_band: boolean;
}

// Dependency Change for trace
export interface DependencyChange {
  date_local: string;
  reason: string;
  old_recipe: string;
  new_recipe: string;
}

// PlanSet Reasoning Trace
export interface PlanSetReasoningTrace {
  inputs_summary: {
    horizon: Horizon;
    intent_overrides_count: number;
    inventory_item_count: number;
    calendar_blocks_count: number;
  };
  recent_consumption_summary: {
    days_looked_back: number;
    meals_found: number;
    ingredients_consumed: string[];
  };
  variety_penalties_applied: Record<string, VarietyPenaltyApplied[]>; // keyed by date_local
  stability_decisions: StabilityDecision[];
  dependency_changes: DependencyChange[];
  per_day: Record<string, ReasoningTrace>; // keyed by date_local
}

// POST /v1/plan Response
export interface PlanResponse {
  plan_set_id: string;
  horizon: Horizon;
  days: PlanDayResponse[];
  grocery_list_normalized: NormalizedGroceryList | null;
  assistant_message: string;
  reasoning_trace: PlanSetReasoningTrace;
}

// Swap Request
export const SwapRequestSchema = z.object({
  date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exclude_recipe_slugs: z.array(z.string()).optional(),
});

export type SwapRequest = z.infer<typeof SwapRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// v0.6 Extended Event Types
// ─────────────────────────────────────────────────────────────────────────────

export const EventTypesV06 = {
  ...EventTypes,
  PLAN_SET_PROPOSED: 'plan_set_proposed',
  PLAN_SET_CONFIRMED: 'plan_set_confirmed',
  PLAN_SET_OVERRIDDEN: 'plan_set_overridden',
  PLAN_SET_ITEM_SWAPPED: 'plan_set_item_swapped',
  CONSUMPTION_LOGGED: 'consumption_logged',
} as const;

export type EventTypeV06 = typeof EventTypesV06[keyof typeof EventTypesV06];

export interface EventPayloadV06 extends EventPayload {
  [EventTypesV06.PLAN_SET_PROPOSED]: { plan_set_id: string; horizon: Horizon; recipe_slugs: string[] };
  [EventTypesV06.PLAN_SET_CONFIRMED]: { plan_set_id: string };
  [EventTypesV06.PLAN_SET_OVERRIDDEN]: { plan_set_id: string; reason: string };
  [EventTypesV06.PLAN_SET_ITEM_SWAPPED]: { plan_set_id: string; date_local: string; old_recipe_slug: string; new_recipe_slug: string };
  [EventTypesV06.CONSUMPTION_LOGGED]: { plan_id: string; recipe_slug: string; date_local: string; ingredients_used: string[]; tags: string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.6 Variety Model Types
// ─────────────────────────────────────────────────────────────────────────────

export type VarietyCategory = 'pantry_legumes' | 'proteins' | 'produce' | 'other';

export interface VarietyRule {
  category: VarietyCategory;
  ingredients: string[];
  avoid_repeat_days: number;
  penalty_per_occurrence: number;
}

export interface ConsumptionRecord {
  date_local: string;
  recipe_slug: string;
  ingredients_used: string[];
  tags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.6 DPE Extension Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalScoringPenalty {
  recipe_slug: string;
  penalty_points: number;
  reason: string;
}

export interface DPEPlanOptions {
  exclude_recipe_slugs?: string[];
  external_penalties?: ExternalScoringPenalty[];
  must_include_ingredients?: string[];
  must_exclude_ingredients?: string[];
  preferred_recipe_slugs?: string[];
  preferred_recipe_tags?: string[];
}

// Extended RecipeScores for v0.6
export interface RecipeScoresV06 extends RecipeScores {
  variety_penalty: number;
  intent_boost: number;
  external_penalty: number;
}

// Extended EligibleRecipe for v0.6
export interface EligibleRecipeV06 extends Omit<EligibleRecipe, 'scores'> {
  scores: RecipeScoresV06;
  variety_penalties: VarietyPenaltyApplied[];
  intent_match: boolean;
}
