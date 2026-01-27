/**
 * Deterministic ingredient name canonicalization.
 * No ML, no fuzzy matching - just explicit rules.
 *
 * This module is shared between:
 * - Inventory creation/update
 * - Recipe ingredient matching in DPE
 */

// Synonym map: variant -> canonical name
// All keys and values must be lowercase
const SYNONYMS: Record<string, string> = {
  // Vegetables
  'peas': 'frozen peas',
  'frozen pea': 'frozen peas',
  'green peas': 'frozen peas',
  'tomatoes': 'tomato',
  'cherry tomatoes': 'tomato',
  'roma tomatoes': 'tomato',
  'onions': 'onion',
  'yellow onion': 'onion',
  'white onion': 'onion',
  'red onion': 'onion',
  'garlic cloves': 'garlic',
  'garlic clove': 'garlic',
  'cucumbers': 'cucumber',
  'lettuce leaves': 'lettuce',
  'romaine lettuce': 'lettuce',
  'iceberg lettuce': 'lettuce',

  // Proteins
  'chicken breasts': 'chicken breast',
  'chicken thighs': 'chicken breast',
  'salmon fillets': 'salmon fillet',
  'salmon filet': 'salmon fillet',
  'salmon filets': 'salmon fillet',
  'eggs': 'eggs',
  'egg': 'eggs',
  'canned tuna fish': 'canned tuna',
  'tuna': 'canned tuna',
  'tuna fish': 'canned tuna',

  // Grains & Pasta
  'spaghetti': 'pasta',
  'penne': 'pasta',
  'fusilli': 'pasta',
  'macaroni': 'pasta',
  'rice': 'cooked rice',
  'white rice': 'cooked rice',
  'jasmine rice': 'cooked rice',
  'basmati rice': 'cooked rice',
  'bread slices': 'bread',
  'toast': 'bread',
  'sliced bread': 'bread',
  'tortillas': 'tortilla wraps',
  'flour tortillas': 'tortilla wraps',
  'wraps': 'tortilla wraps',

  // Canned goods
  'diced tomatoes': 'canned tomatoes',
  'crushed tomatoes': 'canned tomatoes',
  'tomato sauce': 'canned tomatoes',
  'tinned tomatoes': 'canned tomatoes',
  'chickpeas': 'canned chickpeas',
  'garbanzo beans': 'canned chickpeas',
  'black beans': 'canned black beans',
  'lentils': 'red lentils',

  // Dairy & Fats
  'olive oil extra virgin': 'olive oil',
  'evoo': 'olive oil',
  'cooking oil': 'vegetable oil',
  'canola oil': 'vegetable oil',
  'sunflower oil': 'vegetable oil',
  'unsalted butter': 'butter',
  'salted butter': 'butter',
  'cheese': 'shredded cheese',
  'cheddar': 'shredded cheese',
  'mozzarella': 'shredded cheese',
  'mayo': 'mayonnaise',

  // Condiments & Seasonings
  'soy': 'soy sauce',
  'dried herbs': 'dried basil',
  'basil': 'dried basil',
  'stock': 'vegetable broth',
  'veggie broth': 'vegetable broth',
  'chicken broth': 'vegetable broth',
  'broth': 'vegetable broth',

  // Frozen
  'mixed vegetables': 'frozen mixed vegetables',
  'frozen vegetables': 'frozen mixed vegetables',
  'frozen veggies': 'frozen mixed vegetables',
  'mixed veggies': 'frozen mixed vegetables',
  'frozen mixed veggies': 'frozen mixed vegetables',

  // Misc
  'scallions': 'green onions',
  'spring onions': 'green onions',
  'lemons': 'lemon',
};

// Valid units for inventory and recipes
export const VALID_UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
export type ValidUnit = typeof VALID_UNITS[number];

// Valid locations for inventory
export const VALID_LOCATIONS = ['fridge', 'freezer', 'pantry'] as const;
export type ValidLocation = typeof VALID_LOCATIONS[number];

/**
 * Canonicalize an ingredient name.
 * - Lowercase
 * - Trim whitespace
 * - Apply synonym mapping
 *
 * @param name - Raw ingredient name from user input
 * @returns Canonical name for matching against recipes
 */
export function canonicalizeIngredientName(name: string): string {
  // Step 1: Lowercase and trim
  const normalized = name.toLowerCase().trim();

  // Step 2: Apply synonym mapping
  if (SYNONYMS[normalized]) {
    return SYNONYMS[normalized];
  }

  // Step 3: Return normalized name if no synonym found
  return normalized;
}

/**
 * Validate and normalize a unit string.
 *
 * @param unit - Raw unit string
 * @returns Validated unit or null if invalid
 */
export function validateUnit(unit: string): ValidUnit | null {
  const normalized = unit.toLowerCase().trim();

  // Map common variants
  const unitMap: Record<string, ValidUnit> = {
    'g': 'g',
    'gram': 'g',
    'grams': 'g',
    'kg': 'kg',
    'kilogram': 'kg',
    'kilograms': 'kg',
    'ml': 'ml',
    'milliliter': 'ml',
    'milliliters': 'ml',
    'l': 'l',
    'liter': 'l',
    'liters': 'l',
    'litre': 'l',
    'litres': 'l',
    'pcs': 'pcs',
    'pc': 'pcs',
    'piece': 'pcs',
    'pieces': 'pcs',
    'count': 'pcs',
    'unit': 'pcs',
    'units': 'pcs',
  };

  return unitMap[normalized] || null;
}

/**
 * Validate and normalize a location string.
 *
 * @param location - Raw location string
 * @returns Validated location or default 'fridge'
 */
export function validateLocation(location: string): ValidLocation {
  const normalized = location.toLowerCase().trim();

  if (VALID_LOCATIONS.includes(normalized as ValidLocation)) {
    return normalized as ValidLocation;
  }

  // Default to fridge
  return 'fridge';
}

/**
 * Clamp a quantity to be non-negative.
 *
 * @param quantity - Raw quantity value
 * @returns Clamped quantity >= 0
 */
export function clampQuantity(quantity: number): number {
  return Math.max(0, quantity);
}
