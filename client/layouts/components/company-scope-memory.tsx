import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { COMPANY_QUERY_PARAM, readCompanyId, writeCompanyId } from '#lib/company-scope';
import { useCompanyScopeEndpoint } from '../../company/company-route-scope.js';

/**
 * Keeps the company chosen on one module for the next one.
 *
 * The URL stays the source of truth, so a deep link or a refresh keeps working;
 * this only fills in a missing `subjectId` from the last explicit choice. An
 * empty `subjectId` is an explicit "not chosen" and is left alone.
 */
export function CompanyScopeMemory(): null {
  const { pathname } = useLocation();
  const endpoint = useCompanyScopeEndpoint(pathname);
  const [params, setParams] = useSearchParams();
  const hasCompanyParam = params.has(COMPANY_QUERY_PARAM);
  const companyId = params.get(COMPANY_QUERY_PARAM);

  useEffect(() => {
    if (!endpoint) return;
    if (hasCompanyParam) {
      if (companyId) writeCompanyId(window.localStorage, companyId);
      return;
    }
    const remembered = readCompanyId(window.localStorage);
    if (!remembered) return;
    const next = new URLSearchParams(params);
    next.set(COMPANY_QUERY_PARAM, remembered);
    setParams(next, { replace: true });
  }, [companyId, endpoint, hasCompanyParam, params, pathname, setParams]);

  return null;
}
