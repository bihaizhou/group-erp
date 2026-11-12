import { randomUUID } from 'node:crypto';
import { defineMigration } from '@nocobase/db';

/**
 * Before the grant ladder (visible/readonly/write) an absent field policy
 * meant writable; afterwards it means hidden. Existing permission sets keep
 * their old meaning through a sentinel row: while a set carries the sentinel
 * the effective policy falls back to writable for unlisted fields. The role
 * editor drops the sentinel on the next save, which converts the set to the
 * new model in one step.
 */
export default defineMigration({
  name: '202611120001_field_policy_legacy_default',
  async up(context) {
    const sets = await context
      .repository('authorizationPermissionSets')
      .findMany({
        limit: 2000,
      });
    for (const set of sets) {
      const raw = (set as { key?: unknown }).key;
      const key = typeof raw === 'string' ? raw : '';
      if (!key || key === 'root') continue;
      const exists = await context.repository('appFieldPolicies').exists({
        filter: {
          permissionSetKey: key,
          resource: '$default',
          field: 'legacy',
        },
      });
      if (exists) continue;
      await context.repository('appFieldPolicies').createOne({
        values: {
          id: randomUUID(),
          permissionSetKey: key,
          settingsId: null,
          resource: '$default',
          field: 'legacy',
          access: 'write',
          version: 1,
          createdBy: 'system',
          updatedBy: 'system',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  },
  async down(context) {
    await context.repository('appFieldPolicies').deleteOne({
      filter: { resource: '$default', field: 'legacy' },
    });
  },
});
