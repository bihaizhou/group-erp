/**
 * Re-export of the shared business-timezone date helpers so the operations
 * pages keep their existing `#hooks/business-date` import path. The
 * authoritative implementation lives in client/lib/business-date.ts.
 */
export {
  businessTimeZone,
  businessDate,
  businessClock,
  businessDateTime,
  businessDateTimeInput,
  businessInstant,
} from '../lib/business-date';

import { businessDate } from '../lib/business-date';

/** Business month (YYYY-MM) in the business timezone. */
export function businessMonth(at: Date = new Date()): string {
  return businessDate(at).slice(0, 7);
}
