import { defineSeed, type SeedContext } from '@nocobase/db';

const page = 'production-overtime';
const keys = [
  'production-manager',
  'production-lead',
  'production-group-viewer',
  'production-system-admin',
];
const approvers = new Set(['production-manager', 'production-system-admin']);

export default defineSeed({
  name: '202610310001_production_overtime_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const key of keys) {
      const set = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!set) continue;
      const grants = Array.isArray(set.grants) ? (set.grants as never[]) : [];
      let changed = false;
      const hasPage = grants.some(
        (grant) =>
          (grant as { resource?: { type?: string; id?: string } }).resource
            ?.type === 'page' &&
          (grant as { resource?: { type?: string; id?: string } }).resource
            ?.id === page,
      );
      const next = hasPage
        ? grants
        : [
            ...grants,
            {
              resource: { type: 'page', id: page },
              actions: [{ action: 'access' }],
            },
          ];
      if (!hasPage) changed = true;
      if (approvers.has(key)) {
        const settingsGrant = next.find(
          (grant) =>
            (grant as { resource?: { type?: string; id?: string } }).resource
              ?.type === 'settings' &&
            (grant as { resource?: { type?: string; id?: string } }).resource
              ?.id === 'production',
        ) as
          | { actions?: { action?: string }[]; [key: string]: unknown }
          | undefined;
        if (settingsGrant) {
          const actions = Array.isArray(settingsGrant.actions)
            ? settingsGrant.actions
            : [];
          if (!actions.some((action) => action.action === 'approve')) {
            settingsGrant.actions = [...actions, { action: 'approve' }];
            changed = true;
          }
        }
      }
      if (!changed) continue;
      await repository('authorizationPermissionSets').updateOne({
        filter: { key },
        values: { grants: next, updatedAt: new Date() } as never,
      });
    }
  },
});
