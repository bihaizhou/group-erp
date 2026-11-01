import { defineSeed, type SeedContext } from '@nocobase/db';
export default defineSeed({
  name: '202610180002_purchase_request_page_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const key of [
      'procurement-requester',
      'procurement-request-agent',
      'procurement-request-reviewer',
      'procurement-review-configurator',
      'procurement-review-recovery',
    ]) {
      const row = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!row) continue;
      const grants = (
        typeof row.grants === 'string'
          ? JSON.parse(row.grants)
          : structuredClone(row.grants)
      ) as {
        resource?: { type?: string; id?: string };
        actions?: { action: string }[];
      }[];
      const page =
        key === 'procurement-review-configurator'
          ? 'procurement-settings'
          : 'procurement-requests';
      // Preserve existing page grants, actions, scopes and customized titles; assign no accounts.
      if (
        grants.some(
          (g) => g.resource?.type === 'page' && g.resource.id === page,
        )
      )
        continue;
      grants.push({
        resource: { type: 'page', id: page },
        actions: [{ action: 'access' }],
      });
      await repository('authorizationPermissionSets').updateOne({
        filter: { key },
        values: {
          grants:
            typeof row.grants === 'string' ? JSON.stringify(grants) : grants,
          updatedAt: new Date(),
        },
      });
    }
  },
});
