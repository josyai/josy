/**
 * DPE Equipment Checking
 *
 * Pure functions for validating household equipment against recipe requirements.
 */

export interface HouseholdEquipment {
  hasOven: boolean;
  hasStovetop: boolean;
  hasBlender: boolean;
}

export interface EquipmentCheckResult {
  ok: boolean;
  missing: string[];
}

/**
 * Check if household has required equipment for a recipe.
 *
 * This is a hard constraint - if equipment is missing, the recipe
 * is ineligible regardless of score.
 *
 * @param required - Array of required equipment names
 * @param household - Household equipment configuration
 * @returns Check result with missing equipment list
 */
export function checkEquipment(
  required: string[],
  household: HouseholdEquipment
): EquipmentCheckResult {
  const missing: string[] = [];

  for (const eq of required) {
    if (eq === 'oven' && !household.hasOven) missing.push('oven');
    if (eq === 'stovetop' && !household.hasStovetop) missing.push('stovetop');
    if (eq === 'blender' && !household.hasBlender) missing.push('blender');
  }

  return { ok: missing.length === 0, missing };
}
