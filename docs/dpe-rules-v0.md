# DPE Decision Rules v0.3

This document defines the deterministic rules used by the Josy Dinner Planning Engine (DPE).

## Overview

The DPE evaluates recipes against household constraints and inventory to recommend a dinner plan. All decisions are deterministic and explainable via the reasoning trace.

## Hard Constraints (Pass/Fail)

Recipes must pass ALL hard constraints to be eligible.

### 1. Equipment Availability

| Required Equipment | Household Has? | Eligible? |
|--------------------|----------------|-----------|
| oven               | hasOven=true   | yes       |
| oven               | hasOven=false  | no        |
| stovetop           | hasStovetop=true | yes     |
| stovetop           | hasStovetop=false | no     |
| blender            | hasBlender=true | yes      |
| blender            | hasBlender=false | no      |

**Rejection reason:** `Missing equipment: {list}`

### 2. Time Window

| free_interval_minutes | total_time | Eligible? |
|-----------------------|------------|-----------|
| interval >= total     | any        | yes       |
| interval < total      | any        | no        |

**Rejection reason:** `Insufficient time: requires {total} min, only {available} min available`

### 3. Inventory Expiration

| Item State             | Counts as "have"? | Notes                              |
|------------------------|-------------------|------------------------------------|
| expired (exp < today)  | no                | Excluded from availability         |
| exp today or later     | yes               | Eligible for allocation            |
| exp null               | yes               | urgency=0; consumed after known-expiry |

## Soft Ranking (Scoring Formula)

For eligible recipes, scores are computed as:

```
final_score = waste_score - grocery_penalty - time_penalty
```

### Score Components

| Component        | Formula                                    | Weight/Factor          |
|------------------|--------------------------------------------|-----------------------|
| waste_score      | Σ(urgency × fraction_used) × WASTE_WEIGHT  | WASTE_WEIGHT = 1      |
| grocery_penalty  | missing_ingredient_count × PENALTY_PER_ITEM | PENALTY_PER_ITEM = 10 |
| time_penalty     | total_time_minutes × TIME_FACTOR           | TIME_FACTOR = 0.2     |

### Urgency Calculation

| Days to Expiration | Urgency Score |
|--------------------|---------------|
| expired (< 0)      | -1 (excluded) |
| 0-1 days           | 5             |
| 2-3 days           | 3             |
| 4-7 days           | 1             |
| > 7 days           | 0             |
| null (unknown)     | 0             |

## Tie-Breakers (Deterministic Ordering)

When two recipes have equal final_score, tie-breakers are applied in order:

| Priority | Tie-Breaker              | Preferred Value |
|----------|--------------------------|-----------------|
| 1        | highest_final_score      | Higher wins     |
| 2        | lowest_missing_ingredients | Fewer wins    |
| 3        | highest_waste_score      | Higher wins     |
| 4        | shortest_cook_time       | Shorter wins    |
| 5        | alphabetical_slug        | A-Z order       |

The `tie_breaker` field in the reasoning trace indicates which rule determined the winner.

## Inventory Allocation Policy

When allocating inventory to a recipe:

### Allocation Ordering

| Priority | Rule                     | Behavior                |
|----------|--------------------------|-------------------------|
| 1        | Earliest expiration date | null dates sorted last  |
| 2        | Oldest created_at        | FIFO within same expiry |

### Partial Inventory Coverage

| Scenario                               | Behavior                                      |
|----------------------------------------|-----------------------------------------------|
| Recipe needs 500ml, inventory has 30ml | Allocate 30ml, add 470ml to grocery add-ons   |
| Recipe needs 500ml, inventory has 0ml  | Add 500ml to grocery add-ons                  |
| Recipe needs 500ml, inventory has 600ml | Allocate 500ml, 100ml remains               |

### Quantity Confidence Handling

| quantity_confidence | Behavior                                           |
|---------------------|----------------------------------------------------|
| exact               | Quantity trusted, normal allocation                |
| estimate            | Quantity usable, warning in trace if used          |
| unknown             | Treated as "present" but quantity=null             |

See [inventory-rules-v0.md](./inventory-rules-v0.md) for detailed unknown quantity policy.

## Error Responses

### NO_ELIGIBLE_RECIPE

Returned when all recipes fail hard constraints.

```json
{
  "error": {
    "code": "NO_ELIGIBLE_RECIPE",
    "message": "No eligible recipe fits the time window and equipment constraints.",
    "details": {
      "free_interval_minutes": 15,
      "totalCandidatesEvaluated": 8,
      "rejection_reasons": [
        { "reason": "time_window", "count": 6 },
        { "reason": "equipment", "count": 2 }
      ],
      "all_rejections": [
        { "recipe": "lentil-soup", "reason": "Insufficient time: requires 40 min, only 15 min available" }
      ]
    }
  }
}
```

### NO_FEASIBLE_TIME_WINDOW

Returned when calendar blocks cover the entire dinner window.

```json
{
  "error": {
    "code": "NO_FEASIBLE_TIME_WINDOW",
    "message": "No feasible time window available for cooking tonight.",
    "details": {
      "reason": "Calendar blocks cover entire dinner window"
    }
  }
}
```

## Reasoning Trace Structure

Every plan includes a `reasoning_trace` with:

- `version`: DPE version (e.g., "v0.3")
- `inventory_snapshot`: All items with urgency scores
- `calendar_constraints`: Dinner window and busy blocks
- `eligible_recipes`: Scored candidates with breakdown
- `rejected_recipes`: Failed candidates with reasons
- `winner`: Selected recipe slug
- `tie_breaker`: Which rule determined the winner (if applicable)
- `scoring_details`: Constants used in scoring

## Version History

| Version | Changes                                    |
|---------|-------------------------------------------|
| v0.1    | Initial implementation                     |
| v0.2    | Added Phase 2 reasoning trace              |
| v0.3    | Added quantity_confidence, enhanced errors |
