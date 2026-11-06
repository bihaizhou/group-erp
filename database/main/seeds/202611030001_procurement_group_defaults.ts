import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

const groupTables = [
  'materialRequestSources',
  'materialRequests',
  'materialAttributeTemplates',
  'materialSkus',
  'materialNames',
  'measureUnits',
  'materialUnitRules',
  'materialReferences',
  'materialTags',
  'materialTagLinks',
  'orgSubjects',
  'materialSubjectSettings',
  'orgRegions',
  'orgUnits',
  'orgPositions',
  'personnelEmployees',
  'personnelEmployments',
  'personnelAssignments',
  'businessPartners',
  'partnerSubjectSettings',
  'partnerRolePolicies',
  'partnerRegionScopes',
  'partnerCompanyScopes',
  'purchaseRequests',
  'purchaseRequestLines',
  'supplyChainRequestVersions',
  'supplyChainReviewTasks',
  'supplyChainAudit',
];

export default defineSeed({
  name: '202611030001_procurement_group_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const key = 'procurement-group-purchaser';
    if (
      await repository('authorizationPermissionSets').exists({
        filter: { key },
      })
    )
      return;
    await repository('authorizationPermissionSets').createOne({
      values: {
        id: key,
        key,
        title: encodeAuthorizationTitle('集团采购'),
        grants: [
          {
            resource: { type: 'page', id: 'procurement-requests' },
            actions: [{ action: 'access' }],
          },
          {
            resource: { type: 'composite', id: 'procurement.requests' },
            actions: ['read', 'readAll', 'review', 'merge'].map((action) => ({
              action,
              policy: {
                type: 'composite',
                scopes: Object.fromEntries(
                  groupTables.map((table) => [table, 'allRecords']),
                ),
              },
            })),
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  },
});
