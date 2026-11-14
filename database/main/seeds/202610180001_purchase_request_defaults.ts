import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202610180001_purchase_request_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    // Installation snapshots: preserve administrator edits, assign no real accounts.
    const companyTables = [
      'purchaseRequestLines',
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
      'supplyChainAudit',
      'personnelEmployees',
      'personnelEmployments',
      'personnelAssignments',
      'orgUnits',
      'partnerSubjectSettings',
    ];
    const referenceTables = [
      'materialAttributeTemplates',
      'materialSkus',
      'materialNames',
      'measureUnits',
      'materialUnitRules',
      'materialReferences',
      'materialTags',
      'materialTagLinks',
      'businessPartners',
      'orgRegions',
      'orgPositions',
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
    ];
    for (const [key, title, resource, actions, own] of [
      [
        'procurement-requester',
        '本公司采购申请人',
        'procurement.requests',
        ['read', 'create', 'update', 'submit', 'withdraw', 'revise', 'cancel'],
        true,
      ],
      [
        'procurement-request-agent',
        '本公司采购经办',
        'procurement.requests',
        [
          'read',
          'create',
          'update',
          'submit',
          'withdraw',
          'revise',
          'cancel',
        ],
        // No delegation: the former agent role now has the requester's own-record scope.
        true,
      ],
      [
        'procurement-request-reviewer',
        '本公司采购审核',
        'procurement.requests',
        ['read', 'review'],
        false,
      ],
      [
        'procurement-review-configurator',
        '本公司采购审核配置',
        'procurement.settings',
        ['read', 'update'],
        false,
      ],
      [
        'procurement-review-recovery',
        '本公司采购审核交接',
        'procurement.requests',
        ['read', 'reassign'],
        false,
      ],
    ] as const) {
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key },
        })
      )
        continue;
      const scopes = {
        ...Object.fromEntries(
          companyTables
            .filter(
              (table) =>
                resource !== 'procurement.settings' ||
                [
                  'personnelEmployees',
                  'personnelEmployments',
                  'personnelAssignments',
                  'orgUnits',
                  'partnerSubjectSettings',
                ].includes(table),
            )
            .map((table) => [table, 'procurement.ownRequestCompany']),
        ),
        ...Object.fromEntries(
          referenceTables.map((table) => [table, 'allRecords']),
        ),
        ...(resource === 'procurement.requests'
          ? {
              purchaseRequests: own
                ? 'procurement.ownRequests'
                : 'procurement.ownRequestCompany',
            }
          : {}),
        orgSubjects: 'supplyChain.ownSubject',
      };
      const grants: Array<{
        resource: { type: string; id: string };
        actions: Array<{ action: string; policy: unknown }>;
      }> = [
        {
          resource: { type: 'composite', id: resource },
          actions: actions.map((action) => ({
            action,
            policy: { type: 'composite', scopes },
          })),
        },
      ];
      // Submitting a request with unmatched lines creates the governance task
      // inside the same transaction. Requesters therefore need the internal
      // source-write scope; it is not a separate screen-level capability.
      if (
        resource === 'procurement.requests' &&
        (key === 'procurement-requester' ||
          key === 'procurement-request-agent')
      )
        grants.push({
          resource: { type: 'composite', id: resource },
          actions: [
            {
              action: 'requestGovernance',
              policy: {
                type: 'composite',
                scopes: {
                  ...scopes,
                  materialRequests: 'procurement.ownRequestCompany',
                  materialRequestSources: 'procurement.ownRequestCompany',
                },
              },
            },
          ],
        });
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle(title),
          grants,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    // New page grants arrive with the actual pages. No empty navigation or reviewer defaults.
  },
});
