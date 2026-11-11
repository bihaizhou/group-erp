import { useCan } from '@nocobase/app-plugin-authorization/client';

/**
 * Reads a module's settings permissions once, so a page can decide what the
 * current account may see and do. The settings resource is the same one the
 * server routes authorize against (warehouse, sales, hse, operations, ...).
 */
export function useSettingsAccess(settingsId: string) {
  const manage = useCan({
    resource: { type: 'settings', id: settingsId },
    action: 'manage',
  });
  const approve = useCan({
    resource: { type: 'settings', id: settingsId },
    action: 'approve',
  });
  return {
    canManage: Boolean(manage.can),
    canApprove: Boolean(approve.can),
    pending: manage.isPending || approve.isPending,
  };
}
