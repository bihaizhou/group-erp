import type { ReactNode } from 'react';
import { PartnerContext } from './partner-domain.js';
export function PartnerProvider({
  role,
  children,
}: {
  role: 'supplier' | 'customer';
  children: ReactNode;
}) {
  return <PartnerContext value={role}>{children}</PartnerContext>;
}
