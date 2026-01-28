/**
 * Inventory Intelligence Module
 *
 * Provides intelligent parsing and expiry heuristics for inventory items.
 * All functions are pure and deterministic.
 */

import { addDays, format } from 'date-fns';
import {
  InventoryIntelligenceParseOutput,
  ExpiryHeuristicResult,
  IngredientCategory,
  QuantityConfidence,
} from '../../types';
import { canonicalizeIngredientName, validateUnit, validateLocation } from '../../utils/canonicalize';

// ─────────────────────────────────────────────────────────────────────────────
// Category Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps canonical ingredient names to their categories.
 * Used for expiry heuristics and grocery list organization.
 */
const CATEGORY_MAP: Record<string, IngredientCategory> = {
  // Proteins
  'salmon fillet': 'protein',
  'chicken breast': 'protein',
  'eggs': 'protein',
  'canned tuna': 'protein',

  // Dairy
  'butter': 'dairy',
  'shredded cheese': 'dairy',
  'milk': 'dairy',
  'cream': 'dairy',
  'yogurt': 'dairy',

  // Produce
  'tomato': 'produce',
  'onion': 'produce',
  'garlic': 'produce',
  'lemon': 'produce',
  'cucumber': 'produce',
  'lettuce': 'produce',
  'green onions': 'produce',
  'bell pepper': 'produce',
  'carrot': 'produce',
  'celery': 'produce',
  'mushrooms': 'produce',
  'spinach': 'produce',
  'broccoli': 'produce',
  'zucchini': 'produce',

  // Frozen
  'frozen peas': 'frozen',
  'frozen mixed vegetables': 'frozen',

  // Pantry
  'pasta': 'pantry',
  'cooked rice': 'pantry',
  'bread': 'pantry',
  'tortilla wraps': 'pantry',
  'canned tomatoes': 'pantry',
  'canned chickpeas': 'pantry',
  'canned black beans': 'pantry',
  'red lentils': 'pantry',
  'olive oil': 'pantry',
  'vegetable oil': 'pantry',
  'soy sauce': 'pantry',
  'vegetable broth': 'pantry',
  'mayonnaise': 'pantry',
  'dried basil': 'pantry',
  'salt': 'pantry',
  'pepper': 'pantry',
};

/**
 * Get the category for a canonical ingredient name.
 *
 * @param canonicalName - The canonical ingredient name
 * @returns The ingredient category
 */
export function getIngredientCategory(canonicalName: string): IngredientCategory {
  return CATEGORY_MAP[canonicalName] || 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expiry rule key format: category:location:opened
 */
interface ExpiryRule {
  rule_id: string;
  category: IngredientCategory;
  location: 'fridge' | 'freezer' | 'pantry';
  opened: boolean;
  expires_in_days: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Static expiry rules table.
 * These are conservative defaults based on food safety guidelines.
 */
const EXPIRY_RULES: ExpiryRule[] = [
  // Protein
  { rule_id: 'protein-fridge-closed', category: 'protein', location: 'fridge', opened: false, expires_in_days: 3, confidence: 'high' },
  { rule_id: 'protein-fridge-opened', category: 'protein', location: 'fridge', opened: true, expires_in_days: 2, confidence: 'high' },
  { rule_id: 'protein-freezer-closed', category: 'protein', location: 'freezer', opened: false, expires_in_days: 180, confidence: 'medium' },
  { rule_id: 'protein-freezer-opened', category: 'protein', location: 'freezer', opened: true, expires_in_days: 90, confidence: 'medium' },

  // Dairy
  { rule_id: 'dairy-fridge-closed', category: 'dairy', location: 'fridge', opened: false, expires_in_days: 14, confidence: 'medium' },
  { rule_id: 'dairy-fridge-opened', category: 'dairy', location: 'fridge', opened: true, expires_in_days: 7, confidence: 'medium' },
  { rule_id: 'dairy-freezer-closed', category: 'dairy', location: 'freezer', opened: false, expires_in_days: 90, confidence: 'low' },

  // Produce
  { rule_id: 'produce-fridge-closed', category: 'produce', location: 'fridge', opened: false, expires_in_days: 7, confidence: 'low' },
  { rule_id: 'produce-fridge-opened', category: 'produce', location: 'fridge', opened: true, expires_in_days: 3, confidence: 'low' },
  { rule_id: 'produce-pantry-closed', category: 'produce', location: 'pantry', opened: false, expires_in_days: 5, confidence: 'low' },

  // Frozen
  { rule_id: 'frozen-freezer-closed', category: 'frozen', location: 'freezer', opened: false, expires_in_days: 365, confidence: 'medium' },
  { rule_id: 'frozen-freezer-opened', category: 'frozen', location: 'freezer', opened: true, expires_in_days: 180, confidence: 'medium' },

  // Pantry
  { rule_id: 'pantry-pantry-closed', category: 'pantry', location: 'pantry', opened: false, expires_in_days: 365, confidence: 'low' },
  { rule_id: 'pantry-pantry-opened', category: 'pantry', location: 'pantry', opened: true, expires_in_days: 180, confidence: 'low' },
  { rule_id: 'pantry-fridge-closed', category: 'pantry', location: 'fridge', opened: false, expires_in_days: 30, confidence: 'low' },
  { rule_id: 'pantry-fridge-opened', category: 'pantry', location: 'fridge', opened: true, expires_in_days: 14, confidence: 'low' },
];

/**
 * Get expiry heuristic for an item based on category, location, and opened state.
 *
 * @param canonicalName - The canonical ingredient name
 * @param location - Storage location
 * @param opened - Whether the item has been opened
 * @returns Expiry heuristic result or null if no rule matches
 */
export function expiryHeuristic(
  canonicalName: string,
  location: 'fridge' | 'freezer' | 'pantry',
  opened: boolean
): ExpiryHeuristicResult | null {
  const category = getIngredientCategory(canonicalName);

  // Find matching rule
  const rule = EXPIRY_RULES.find(
    (r) => r.category === category && r.location === location && r.opened === opened
  );

  if (!rule) {
    // Try to find a fallback rule (same category and location, different opened state)
    const fallbackRule = EXPIRY_RULES.find(
      (r) => r.category === category && r.location === location
    );

    if (fallbackRule) {
      return {
        rule_id: fallbackRule.rule_id + '-fallback',
        confidence: 'low',
        expires_in_days: fallbackRule.expires_in_days,
      };
    }

    return null;
  }

  return {
    rule_id: rule.rule_id,
    confidence: rule.confidence,
    expires_in_days: rule.expires_in_days,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unit patterns for parsing natural language input.
 */
const UNIT_PATTERNS: Array<{ pattern: RegExp; unit: string; multiplier: number }> = [
  { pattern: /(\d+(?:\.\d+)?)\s*kg\b/i, unit: 'g', multiplier: 1000 },
  { pattern: /(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i, unit: 'g', multiplier: 1 },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:liters?|l)\b/i, unit: 'ml', multiplier: 1000 },
  { pattern: /(\d+(?:\.\d+)?)\s*ml\b/i, unit: 'ml', multiplier: 1 },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:pieces?|pcs?)\b/i, unit: 'pcs', multiplier: 1 },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:eggs?|slices?|fillets?)\b/i, unit: 'pcs', multiplier: 1 },
];

/**
 * Default quantities for common items when not specified.
 */
const DEFAULT_QUANTITIES: Record<string, { quantity: number; unit: string }> = {
  'salmon fillet': { quantity: 2, unit: 'pcs' },
  'chicken breast': { quantity: 500, unit: 'g' },
  'frozen peas': { quantity: 300, unit: 'g' },
  'eggs': { quantity: 6, unit: 'pcs' },
  'olive oil': { quantity: 500, unit: 'ml' },
  'butter': { quantity: 200, unit: 'g' },
  'bread': { quantity: 8, unit: 'pcs' },
  'tomato': { quantity: 4, unit: 'pcs' },
  'cooked rice': { quantity: 300, unit: 'g' },
  'pasta': { quantity: 500, unit: 'g' },
  'shredded cheese': { quantity: 200, unit: 'g' },
  'milk': { quantity: 1000, unit: 'ml' },
  'onion': { quantity: 3, unit: 'pcs' },
  'garlic': { quantity: 1, unit: 'pcs' },
  'canned tuna': { quantity: 200, unit: 'g' },
  'canned black beans': { quantity: 400, unit: 'g' },
  'canned chickpeas': { quantity: 400, unit: 'g' },
  'red lentils': { quantity: 300, unit: 'g' },
  'tortilla wraps': { quantity: 8, unit: 'pcs' },
  'frozen mixed vegetables': { quantity: 400, unit: 'g' },
  'vegetable broth': { quantity: 500, unit: 'ml' },
  'soy sauce': { quantity: 100, unit: 'ml' },
  'mayonnaise': { quantity: 200, unit: 'g' },
};

/**
 * Location inference based on item category and keywords.
 */
function inferLocation(
  canonicalName: string,
  rawText: string
): 'fridge' | 'freezer' | 'pantry' {
  // Check for explicit location keywords
  const lowerText = rawText.toLowerCase();
  if (lowerText.includes('freezer') || lowerText.includes('frozen')) {
    return 'freezer';
  }
  if (lowerText.includes('pantry') || lowerText.includes('cupboard') || lowerText.includes('cabinet')) {
    return 'pantry';
  }

  // Infer from category
  const category = getIngredientCategory(canonicalName);
  switch (category) {
    case 'frozen':
      return 'freezer';
    case 'pantry':
      return 'pantry';
    default:
      return 'fridge';
  }
}

/**
 * Extract quantity and unit from raw text.
 */
function extractQuantity(text: string): { quantity?: number; unit?: string; cleanText: string } {
  for (const { pattern, unit, multiplier } of UNIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const quantity = parseFloat(match[1]) * multiplier;
      const cleanText = text.replace(pattern, '').trim();
      return { quantity, unit, cleanText };
    }
  }
  return { cleanText: text };
}

/**
 * Clean and normalize raw item text.
 */
function cleanItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(some|a|an|the|my)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse raw inventory add text into structured output with intelligent defaults.
 *
 * @param rawText - Raw user input (e.g., "2 salmon fillets", "some eggs")
 * @param today - Optional date for expiry calculation (defaults to now)
 * @returns Parsed inventory item with all fields populated
 */
export function parseInventoryAdd(
  rawText: string,
  today: Date = new Date()
): InventoryIntelligenceParseOutput {
  // Extract quantity if present
  const { quantity: extractedQty, unit: extractedUnit, cleanText } = extractQuantity(rawText);
  const normalizedName = cleanItemText(cleanText);

  // Canonicalize the name
  const canonicalName = canonicalizeIngredientName(normalizedName);

  // Get defaults for this item
  const defaults = DEFAULT_QUANTITIES[canonicalName] || { quantity: 1, unit: 'pcs' };

  // Determine final quantity and confidence
  let quantity: number | null;
  let quantityConfidence: QuantityConfidence;
  let unit: string;

  if (extractedQty !== undefined && extractedUnit) {
    quantity = extractedQty;
    quantityConfidence = 'exact';
    unit = validateUnit(extractedUnit) || defaults.unit;
  } else if (extractedQty !== undefined) {
    quantity = extractedQty;
    quantityConfidence = 'exact';
    unit = defaults.unit;
  } else {
    quantity = defaults.quantity;
    quantityConfidence = 'estimate';
    unit = defaults.unit;
  }

  // Infer location
  const location = inferLocation(canonicalName, rawText);

  // Calculate expiry using heuristics
  const expiryResult = expiryHeuristic(canonicalName, location, false);

  let expirationDate: string | null = null;
  let expirationSource: 'user' | 'heuristic' | null = null;
  let expiryRuleId: string | null = null;
  let expiryConfidence: 'high' | 'medium' | 'low' | null = null;

  if (expiryResult) {
    const expiryDate = addDays(today, expiryResult.expires_in_days);
    expirationDate = format(expiryDate, 'yyyy-MM-dd');
    expirationSource = 'heuristic';
    expiryRuleId = expiryResult.rule_id;
    expiryConfidence = expiryResult.confidence;
  }

  // Generate display name (capitalize first letter of each word)
  const displayName = normalizedName
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    canonical_name: canonicalName,
    display_name: displayName,
    quantity,
    quantity_confidence: quantityConfidence,
    unit,
    location,
    expiration_date: expirationDate,
    expiration_source: expirationSource,
    expiry_rule_id: expiryRuleId,
    expiry_confidence: expiryConfidence,
  };
}

// Re-export types and constants for convenience
export { CATEGORY_MAP, EXPIRY_RULES, DEFAULT_QUANTITIES };
