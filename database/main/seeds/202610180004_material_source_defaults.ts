import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
export default defineSeed({
  name: '202610180004_material_source_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    // New supplemental templates. Do not rewrite administrators' existing A2.2 grants.
    const common = [
      'materialRequestSources',
      'materialRequests',
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
      'supplyChainAudit',
      'personnelEmployees',
      'personnelEmployments',
      'personnelAssignments',
      'orgUnits',
      'materialSubjectSettings',
    ];
    const references = [
      'materialAttributeTemplates',
      'materialSkus',
      'materialNames',
      'measureUnits',
      'materialUnitRules',
      'materialReferences',
      'materialTags',
      'materialTagLinks',
      'orgRegions',
      'orgPositions',
    ];
    for (const [domain, head, line, page] of [
      [
        'procurement',
        'purchaseRequests',
        'purchaseRequestLines',
        'procurement-requests',
      ],
      [
        'requisitions',
        'materialIssueRequests',
        'materialIssueRequestLines',
        'requisitions-requests',
      ],
    ] as const)
      for (const own of [true, false]) {
        const key = `${domain}-source-${own ? 'requester' : 'agent'}`;
        if (
          await repository('authorizationPermissionSets').exists({
            filter: { key },
          })
        )
          continue;
        const company =
          domain === 'procurement'
            ? 'procurement.ownRequestCompany'
            : 'requisitions.ownRequestCompany';
        const scopes = {
          ...Object.fromEntries(
            [
              ...common,
              line,
              ...(domain === 'requisitions'
                ? ['materialIssuePurposes']
                : ['partnerSubjectSettings']),
            ].map((table) => [table, company]),
          ),
          ...Object.fromEntries(
            references.map((table) => [table, 'allRecords']),
          ),
          orgSubjects: 'supplyChain.ownSubject',
          [head]: own ? `${domain}.ownRequests` : company,
          ...(domain === 'procurement'
            ? Object.fromEntries(
                [
                  'businessPartners',
                  'partnerRolePolicies',
                  'partnerRegionScopes',
                  'partnerCompanyScopes',
                ].map((table) => [table, 'allRecords']),
              )
            : {}),
        };
        await repository('authorizationPermissionSets').createOne({
          values: {
            id: key,
            key,
            title: encodeAuthorizationTitle(
              `${domain === 'procurement' ? '采购' : '领用'}物料治理${own ? '本人办理' : '授权代办'}`,
            ),
            grants: [
              {
                resource: { type: 'page', id: page },
                actions: [{ action: 'access' }],
              },
              {
                resource: { type: 'composite', id: `${domain}.requests` },
                actions: [
                  'read',
                  'requestGovernance',
                  'confirmMaterial',
                  'rejectMaterial',
                  'takeOverSource',
                ].map((action) => ({
                  action,
                  policy: { type: 'composite', scopes },
                })),
              },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    const key = 'materials-source-handler';
    if (
      !(await repository('authorizationPermissionSets').exists({
        filter: { key },
      }))
    )
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle('本公司物料治理来源办理'),
          grants: [
            {
              resource: { type: 'composite', id: 'materials.sources' },
              actions: ['read', 'resolve'].map((action) => ({
                action,
                policy: {
                  type: 'composite',
                  scopes: {
                    materialRequestSources: 'materials.ownCompany',
                    materialRequests: 'materials.ownCompany',
                  },
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
