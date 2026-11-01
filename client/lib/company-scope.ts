/**
 * Business pages carry the company they are working in as `subjectId` in the
 * URL: the value survives deep links, back/forward and refreshes, and every
 * query already reads it from there. The shell only remembers the last choice
 * so switching modules does not ask for the same company again.
 */
export const COMPANY_QUERY_PARAM = 'subjectId';

export const COMPANY_STORAGE_KEY = 'group-erp.company-id';

const COMPANY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isCompanyId(value: string): boolean {
  return COMPANY_ID_PATTERN.test(value);
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** A stale or hand-edited value must not be replayed into every page URL. */
export function readCompanyId(storage: ReadableStorage): string | null {
  try {
    const value = storage.getItem(COMPANY_STORAGE_KEY);
    return value !== null && isCompanyId(value) ? value : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); remembering is optional.
    return null;
  }
}

export function writeCompanyId(
  storage: WritableStorage,
  companyId: string,
): void {
  if (!isCompanyId(companyId)) return;
  try {
    storage.setItem(COMPANY_STORAGE_KEY, companyId);
  } catch {
    // Same as above: the current page still works, only the memory is lost.
  }
}
