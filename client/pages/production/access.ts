import { useCan } from '@nocobase/app-plugin-authorization/client';

const productionSettings = { type: 'settings', id: 'production' } as const;

/**
 * Effective production capabilities for the signed-in account.
 *
 * The server still authorizes every request; these flags only keep the page
 * honest about what the account can do, so a reader never sees a button that
 * would be rejected.
 */
export function useProductionAccess() {
  const manage = useCan({ resource: productionSettings, action: 'manage' });
  const approve = useCan({ resource: productionSettings, action: 'approve' });
  const readAll = useCan({ resource: productionSettings, action: 'readAll' });
  return {
    canManage: manage.can,
    canApprove: approve.can,
    canReadAll: readAll.can,
    pending: manage.isPending || approve.isPending,
  };
}
