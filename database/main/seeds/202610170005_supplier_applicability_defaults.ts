import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202610170005_supplier_applicability_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const sets = await repository('authorizationPermissionSets').findMany({
      limit: 10001,
    });
    if (sets.length > 10000)
      throw new Error(
        'Too many permission sets for the supplier scope upgrade.',
      );
    // Add dependencies to existing supported actions without changing their
    // company/audit scopes, granting the new action, or assigning any users.
    for (const set of sets) {
      const grants = (
        typeof set.grants === 'string'
          ? JSON.parse(set.grants)
          : JSON.parse(JSON.stringify(set.grants))
      ) as Array<{
        resource?: { type?: string; id?: string };
        actions?: Array<{
          action: string;
          policy?: { type?: string; scopes?: Record<string, unknown> };
        }>;
      }>;
      let changed = false;
      for (const grant of grants)
        if (
          grant.resource?.type === 'composite' &&
          grant.resource.id === 'procurement.suppliers'
        ) {
          for (const action of grant.actions ?? [])
            if (action.policy?.type === 'composite' && action.policy.scopes) {
              for (const table of [
                'partnerRolePolicies',
                'partnerRegionScopes',
                'partnerCompanyScopes',
                'orgRegions',
              ]) {
                if (!(table in action.policy.scopes)) {
                  action.policy.scopes[table] = 'allRecords';
                  changed = true;
                }
              }
            }
        }
      if (changed)
        await repository('authorizationPermissionSets').updateOne({
          filter: { id: typeof set.id === 'string' ? set.id : '' },
          values: {
            grants:
              typeof set.grants === 'string' ? JSON.stringify(grants) : grants,
            updatedAt: new Date(),
          },
        });
    }
    const key = 'procurement-supplier-scope-manager';
    if (
      !(await repository('authorizationPermissionSets').exists({
        filter: { key },
      }))
    )
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle('供应商适用范围及全局启停维护'),
          grants: [
            {
              resource: { type: 'composite', id: 'procurement.suppliers' },
              actions: [
                {
                  action: 'configureApplicability',
                  policy: {
                    type: 'composite',
                    scopes: {
                      businessPartners: 'allRecords',
                      partnerSubjectSettings: 'allRecords',
                      supplyChainAudit: 'allRecords',
                      orgSubjects: 'allRecords',
                      orgRegions: 'allRecords',
                      partnerRolePolicies: 'allRecords',
                      partnerRegionScopes: 'allRecords',
                      partnerCompanyScopes: 'allRecords',
                    },
                  },
                },
              ],
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
  },
});
