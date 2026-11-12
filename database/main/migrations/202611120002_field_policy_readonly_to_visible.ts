import { defineMigration } from '@nocobase/db';

/**
 * The three-rung ladder (visible/readonly/write) collapses to two rungs
 * (visible/write): visible and readonly had identical enforcement and the
 * editor no longer offers a readonly column. Existing readonly rows keep
 * their meaning by becoming visible.
 */
export default defineMigration({
  name: '202611120002_field_policy_readonly_to_visible',
  async up(context) {
    const rows = await context.repository('appFieldPolicies').findMany({
      filter: { access: 'readonly' },
      limit: 2000,
    });
    for (const row of rows) {
      await context.repository('appFieldPolicies').updateOne({
        filter: { id: (row as { id?: unknown }).id as string },
        values: {
          access: 'visible',
          version: Number((row as { version?: unknown }).version ?? 1) + 1,
          updatedAt: new Date(),
        },
      });
    }
  },
  async down(context) {
    const rows = await context.repository('appFieldPolicies').findMany({
      filter: { access: 'visible' },
      limit: 2000,
    });
    for (const row of rows) {
      await context.repository('appFieldPolicies').updateOne({
        filter: { id: (row as { id?: unknown }).id as string },
        values: { access: 'readonly' },
      });
    }
  },
});
