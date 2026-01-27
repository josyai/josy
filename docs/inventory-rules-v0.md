# Inventory Rules v0.3

This document defines the deterministic rules for inventory management in Josy.

## Quantity Confidence Model

Inventory items have a `quantity_confidence` field indicating how reliable the quantity value is.

### Confidence Levels

| Level     | quantity field | Description                           |
|-----------|----------------|---------------------------------------|
| exact     | numeric (> 0)  | Precise measurement (e.g., 500g)      |
| estimate  | numeric (> 0)  | Rough estimate (e.g., "about half")   |
| unknown   | null           | Present but unquantified              |

### Database Schema

```sql
ALTER TABLE inventory_items
ADD COLUMN quantity_confidence VARCHAR(10) DEFAULT 'exact'
CHECK (quantity_confidence IN ('exact', 'estimate', 'unknown'));

-- If quantity_confidence = 'unknown', quantity must be null
-- If quantity_confidence != 'unknown', quantity must be > 0
```

## Unknown Quantity Policy

**Selected Policy: Option 1 - Unknown counts as "present" but not quantifiable**

This policy was chosen to avoid overbuying at the grocery store.

### Behavior for Unknown Quantity Items

| Scenario                          | DPE Behavior                                          |
|-----------------------------------|-------------------------------------------------------|
| Ingredient availability check     | Item counts as "present" (passes presence check)      |
| Quantity allocation               | No quantity allocated (cannot consume what's unknown) |
| Grocery add-ons                   | NOT added to grocery list (item exists)               |
| Plan consumption records          | Marked with `consumed_unknown=true`                   |
| Commit/depletion                  | No numeric decrement (quantity stays null)            |

### Rationale

- **Pros:** Avoids buying duplicates of items you already have
- **Cons:** May result in insufficient quantities if item is nearly empty
- **Mitigation:** Users can update `quantity_confidence` to `exact` after checking

### Example Flow

1. User adds "olive oil" with `quantity_confidence=unknown`
2. Recipe needs 30ml olive oil
3. DPE sees olive oil is present → ingredient is "covered"
4. No grocery add-on created for olive oil
5. Consumption record shows `consumed_unknown=true`
6. After commit, olive oil remains in inventory (quantity still null)

## Allocation Ordering

When multiple inventory items match an ingredient:

| Priority | Rule                          | Behavior                        |
|----------|-------------------------------|---------------------------------|
| 1        | Earliest expiration date      | Items expiring sooner used first |
| 2        | Null expiration dates         | Sorted last (after dated items) |
| 3        | Oldest created_at             | FIFO within same expiry date    |

### Confidence-Based Ordering

Within the same expiration date:

| Priority | Confidence Level | Rationale                           |
|----------|------------------|-------------------------------------|
| 1        | exact            | Use precise quantities first        |
| 2        | estimate         | Use estimates second                |
| 3        | unknown          | Use last (can't measure depletion)  |

## Depletion Rules

### On Plan Commit (status = 'cooked')

| quantity_confidence | Depletion Behavior                                |
|---------------------|---------------------------------------------------|
| exact               | Decrement by consumed_quantity                    |
| estimate            | Decrement by consumed_quantity, log warning       |
| unknown             | No decrement, set `assumed_depleted=true`         |

### Warnings in Trace

When estimate quantities are used:

```json
{
  "warnings": [
    "Used estimated quantity for 'olive oil' (500ml estimate) - actual may vary"
  ]
}
```

## Validation Rules

### On Inventory Create/Update

| Rule                                              | Error if violated           |
|---------------------------------------------------|-----------------------------|
| unit must be one of: g, kg, ml, l, pcs            | INVALID_INPUT              |
| if quantity_confidence=unknown, quantity must be null | INVALID_INPUT          |
| if quantity_confidence!=unknown, quantity must be > 0 | INVALID_INPUT          |
| canonical_name must pass canonicalization         | Always normalized           |

### Zod Schema

```typescript
const InventoryItemSchema = z.object({
  household_id: z.string().uuid(),
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  quantity: z.number().positive().nullable(),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']),
  quantity_confidence: z.enum(['exact', 'estimate', 'unknown']).default('exact'),
  expiration_date: z.string().date().optional(),
  opened: z.boolean().default(false),
  location: z.enum(['fridge', 'freezer', 'pantry']).default('fridge'),
}).refine(
  (data) => {
    if (data.quantity_confidence === 'unknown') {
      return data.quantity === null;
    }
    return data.quantity !== null && data.quantity > 0;
  },
  { message: 'quantity must be null for unknown confidence, positive otherwise' }
);
```

## Item Lifecycle

### States

```
[added] → [active] → [consumed] → [depleted]
                  ↘ [expired] → [removed]
```

### Transitions

| From     | To        | Trigger                              |
|----------|-----------|--------------------------------------|
| added    | active    | quantity > 0 or quantity_confidence=unknown |
| active   | consumed  | Plan commit with consumption         |
| consumed | depleted  | quantity reaches 0                   |
| active   | expired   | expiration_date < today              |
| expired  | removed   | Manual removal or auto-cleanup       |

## API Response Format

### Inventory Item Response

```json
{
  "id": "uuid",
  "canonical_name": "olive oil",
  "display_name": "Extra Virgin Olive Oil",
  "quantity": 500,
  "quantity_confidence": "exact",
  "unit": "ml",
  "expiration_date": "2026-03-15",
  "opened": false,
  "location": "pantry",
  "created_at": "2026-01-26T10:00:00Z",
  "updated_at": "2026-01-26T10:00:00Z"
}
```

### Unknown Quantity Item

```json
{
  "id": "uuid",
  "canonical_name": "olive oil",
  "display_name": "Some Olive Oil",
  "quantity": null,
  "quantity_confidence": "unknown",
  "unit": "ml",
  "expiration_date": null,
  "opened": true,
  "location": "pantry"
}
```

## Version History

| Version | Changes                                    |
|---------|-------------------------------------------|
| v0.1    | Basic quantity tracking                    |
| v0.2    | Added canonicalization on write            |
| v0.3    | Added quantity_confidence model            |
