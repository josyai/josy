/**
 * Intent Detection Module
 *
 * Simple, deterministic intent matching for WhatsApp messages.
 * No NLP required - just keyword/pattern matching.
 */

export type Intent =
  | { type: 'PLAN_TONIGHT' }
  | { type: 'PLAN_NEXT'; days: number }
  | { type: 'SWAP_DAY'; day?: string }
  | { type: 'CONFIRM_PLAN' }
  | { type: 'EXPLAIN_LAST_PLAN' }
  | { type: 'INVENTORY_ADD'; item: string; quantity?: number; unit?: string }
  | { type: 'INVENTORY_USED'; item: string }
  | { type: 'UNKNOWN'; raw: string };

/**
 * Common unit mappings for natural language
 */
const UNIT_PATTERNS: Array<{ pattern: RegExp; unit: string; multiplier: number }> = [
  { pattern: /(\d+)\s*kg/i, unit: 'g', multiplier: 1000 },
  { pattern: /(\d+)\s*g(?:rams?)?/i, unit: 'g', multiplier: 1 },
  { pattern: /(\d+)\s*(?:liters?|l)\b/i, unit: 'ml', multiplier: 1000 },
  { pattern: /(\d+)\s*ml/i, unit: 'ml', multiplier: 1 },
  { pattern: /(\d+)\s*(?:pieces?|pcs?)\b/i, unit: 'pcs', multiplier: 1 },
  { pattern: /(\d+)\s*(?:eggs?|slices?|fillets?)\b/i, unit: 'pcs', multiplier: 1 },
];

/**
 * Default quantities and units for common items when not specified
 */
const DEFAULT_QUANTITIES: Record<string, { quantity: number; unit: string }> = {
  // These map to canonical names after canonicalization
  // Units must match recipe requirements!
  'salmon': { quantity: 2, unit: 'pcs' },
  'salmon fillet': { quantity: 2, unit: 'pcs' },
  'fresh salmon': { quantity: 2, unit: 'pcs' },
  'chicken': { quantity: 500, unit: 'g' },
  'chicken breast': { quantity: 500, unit: 'g' },
  'frozen peas': { quantity: 300, unit: 'g' },
  'peas': { quantity: 300, unit: 'g' },
  'eggs': { quantity: 6, unit: 'pcs' },
  'egg': { quantity: 6, unit: 'pcs' },
  'olive oil': { quantity: 500, unit: 'ml' },
  'butter': { quantity: 200, unit: 'g' },
  'bread': { quantity: 8, unit: 'pcs' },
  'toast': { quantity: 4, unit: 'pcs' },
  'tomato': { quantity: 4, unit: 'pcs' },
  'tomatoes': { quantity: 4, unit: 'pcs' },
  'rice': { quantity: 500, unit: 'g' },
  'cooked rice': { quantity: 300, unit: 'g' },
  'pasta': { quantity: 500, unit: 'g' },
  'cheese': { quantity: 200, unit: 'g' },
  'shredded cheese': { quantity: 200, unit: 'g' },
  'milk': { quantity: 1000, unit: 'ml' },
  'onion': { quantity: 3, unit: 'pcs' },
  'onions': { quantity: 3, unit: 'pcs' },
  'garlic': { quantity: 1, unit: 'pcs' },
  'tuna': { quantity: 200, unit: 'g' },
  'canned tuna': { quantity: 200, unit: 'g' },
  'beans': { quantity: 400, unit: 'g' },
  'canned black beans': { quantity: 400, unit: 'g' },
  'chickpeas': { quantity: 400, unit: 'g' },
  'canned chickpeas': { quantity: 400, unit: 'g' },
  'lentils': { quantity: 300, unit: 'g' },
  'red lentils': { quantity: 300, unit: 'g' },
  'tortillas': { quantity: 8, unit: 'pcs' },
  'tortilla wraps': { quantity: 8, unit: 'pcs' },
  'frozen vegetables': { quantity: 400, unit: 'g' },
  'frozen veg': { quantity: 400, unit: 'g' },
  'frozen mixed vegetables': { quantity: 400, unit: 'g' },
  'vegetable broth': { quantity: 500, unit: 'ml' },
  'soy sauce': { quantity: 100, unit: 'ml' },
  'mayonnaise': { quantity: 200, unit: 'g' },
};

/**
 * Extract quantity and unit from message text
 */
function extractQuantity(text: string): { quantity?: number; unit?: string; cleanText: string } {
  for (const { pattern, unit, multiplier } of UNIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const quantity = parseInt(match[1], 10) * multiplier;
      const cleanText = text.replace(pattern, '').trim();
      return { quantity, unit, cleanText };
    }
  }
  return { cleanText: text };
}

/**
 * Clean and normalize item name
 */
function normalizeItemName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(some|a|an|the|my)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect intent from user message
 */
export function detectIntent(message: string): Intent {
  const text = message.trim().toLowerCase();

  // v0.6: Check for confirm intent
  if (
    text === 'confirm' ||
    text === 'yes' ||
    text === 'ok' ||
    text === 'sounds good' ||
    text === 'looks good' ||
    text.startsWith('yes ') ||
    text.includes('confirm the plan') ||
    text.includes('that works')
  ) {
    return { type: 'CONFIRM_PLAN' };
  }

  // v0.6: Check for swap intent
  const swapPatterns = [
    /^swap\s+(.+)/i,
    /^change\s+(.+)/i,
    /^different\s+(?:meal\s+)?(?:for\s+)?(.+)/i,
    /^something else(?:\s+(?:for\s+)?(.+))?/i,
  ];

  for (const pattern of swapPatterns) {
    const match = text.match(pattern);
    if (match) {
      const day = match[1]?.trim() || undefined;
      return { type: 'SWAP_DAY', day };
    }
  }

  // v0.6: Check for multi-day plan intent
  const multiDayPatterns = [
    /plan (?:the )?next (\d+) (?:days?|dinners?)/i,
    /(?:next|plan) (\d+) (?:days?|dinners?)/i,
    /plan (?:for )?(?:the )?week/i,
    /weekly plan/i,
    /what(?:'s| is) for (?:the )?(?:next|this) (\d+) days/i,
  ];

  for (const pattern of multiDayPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Default to 7 for "week" patterns, otherwise use the number
      const days = match[1] ? parseInt(match[1], 10) : 7;
      return { type: 'PLAN_NEXT', days: Math.min(days, 14) }; // Cap at 14 days
    }
  }

  // Check for dinner/plan intent (single day - tonight)
  if (
    text.includes('dinner') ||
    text.includes("what's for") ||
    text.includes('what should i') ||
    text.includes('what can i') ||
    text.includes('plan tonight') ||
    text.includes('tonight') && text.includes('eat')
  ) {
    return { type: 'PLAN_TONIGHT' };
  }

  // Check for explanation intent
  if (
    text === 'why' ||
    text === 'why?' ||
    text.startsWith('why ') ||
    text.includes('why this') ||
    text.includes('why that') ||
    text.includes('explain') ||
    text.includes('reasoning')
  ) {
    return { type: 'EXPLAIN_LAST_PLAN' };
  }

  // Check for "used" intent (inventory deduction)
  const usedPatterns = [
    /^i used (.+)/i,
    /^used (.+)/i,
    /^finished (.+)/i,
    /^ran out of (.+)/i,
    /^out of (.+)/i,
  ];

  for (const pattern of usedPatterns) {
    const match = text.match(pattern);
    if (match) {
      const item = normalizeItemName(match[1]);
      return { type: 'INVENTORY_USED', item };
    }
  }

  // Check for inventory add intent
  const addPatterns = [
    /^(?:i )?(?:bought|got|picked up|have|added?) (.+)/i,
    /^add (.+)/i,
    /^(?:i )?just (?:bought|got) (.+)/i,
    /^(?:there'?s|got) (.+) (?:in the fridge|in fridge|at home)/i,
  ];

  for (const pattern of addPatterns) {
    const match = text.match(pattern);
    if (match) {
      const rawItem = match[1];
      const { quantity, unit, cleanText } = extractQuantity(rawItem);
      const item = normalizeItemName(cleanText);

      // Get defaults if not specified
      const defaults = DEFAULT_QUANTITIES[item] || { quantity: 1, unit: 'pcs' };

      return {
        type: 'INVENTORY_ADD',
        item,
        quantity: quantity ?? defaults.quantity,
        unit: unit ?? defaults.unit,
      };
    }
  }

  // If message looks like just an ingredient name, treat as add
  const singleItem = normalizeItemName(text);
  if (DEFAULT_QUANTITIES[singleItem]) {
    const defaults = DEFAULT_QUANTITIES[singleItem];
    return {
      type: 'INVENTORY_ADD',
      item: singleItem,
      quantity: defaults.quantity,
      unit: defaults.unit,
    };
  }

  return { type: 'UNKNOWN', raw: message };
}
