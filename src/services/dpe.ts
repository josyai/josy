/**
 * DPE (Deterministic Planning Engine)
 *
 * Re-exports from the modular DPE implementation.
 * See src/services/dpe/ for the full implementation.
 */

export {
  planTonight,
  planTonightWithOptions,
  DPE_VERSION,
  SCORING,
  computeUrgency,
  checkEquipment,
} from './dpe/index';

export type { DPEOptionsV06 } from './dpe/index';
