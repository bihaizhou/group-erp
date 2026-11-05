import { createContext, useContext } from 'react';

/**
 * The company a page is currently scoped to. It is resolved by the route's
 * CompanyGate from the URL, so a page never has to ask the user again.
 */
export interface CompanyScopeValue {
  readonly id: string;
  readonly code?: string;
  readonly name?: string;
}

export const CompanyScopeContext = createContext<CompanyScopeValue | null>(
  null,
);

export function useCurrentCompany(): CompanyScopeValue | null {
  return useContext(CompanyScopeContext);
}
