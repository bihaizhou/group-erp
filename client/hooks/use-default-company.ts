import { useEffect } from 'react';

import { readCompanyId } from '#lib/company-scope';

/**
 * Picks the company a company-scoped page opens in when the URL does not name
 * one: the account's home company, then the last explicit choice, then the
 * module's first authorised company. The header switcher remains the only
 * place to change it afterwards; pages never stop at a picker of their own.
 */
export function useDefaultCompany({
  subjectId,
  ready,
  companies,
  preferredId,
  exhaustive,
  onChange,
}: {
  subjectId: string;
  ready: boolean;
  companies: readonly { id: string }[];
  preferredId?: string | null;
  exhaustive: boolean;
  onChange: (id: string) => void;
}) {
  useEffect(() => {
    if (ready === false) return;
    if (subjectId && (!exhaustive || companies.some((c) => c.id === subjectId)))
      return;
    const remembered =
      typeof window === 'undefined' ? null : readCompanyId(window.localStorage);
    const candidate = [preferredId, remembered, companies[0]?.id].find(
      (id): id is string =>
        Boolean(id) && companies.some((company) => company.id === id),
    );
    if (candidate) onChange(candidate);
  }, [companies, exhaustive, onChange, preferredId, ready, subjectId]);
}
