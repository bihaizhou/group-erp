import { createContext, useContext } from 'react';
import type { OrgKind } from './model.js';
export const OrgContext = createContext<OrgKind>('subjects');
export function useOrgKind() {
  return useContext(OrgContext);
}
