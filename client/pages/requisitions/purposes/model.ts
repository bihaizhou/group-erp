import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useIssueQuery } from '../requests/hooks.js';
export interface Purpose {
  id: string;
  subjectId: string;
  code: string;
  name: string;
  description: string;
  company?: { id: string; code: string; name: string };
  status: 'active' | 'inactive';
  revision: number;
  lifecycleVersion: number;
  updatedAt: string;
}
export const purposeUi = (key: string) => `requisitions.purposes.${key}`;
export const usePurposeCan = (action: string) =>
  useCan({
    resource: { type: 'composite', id: 'requisitions.purposes' },
    action,
  });
export const usePurpose = (id?: string) =>
  useIssueQuery<{ data: Purpose }>(`purposes/${id}`, {}, !!id);
