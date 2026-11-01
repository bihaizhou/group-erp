import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202610180003_issue_request_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    // Installation snapshots: preserve administrator edits, assign no real accounts.
    const companyTables = [
      'materialIssueRequestLines',
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
      'supplyChainAudit',
      'personnelEmployees',
      'personnelEmployments',
      'personnelAssignments',
      'orgUnits',
      'materialIssuePurposes',
      'materialSubjectSettings',
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
      'orgRegions',
      'orgPositions',
    ];
    for (const [key, title, resource, actions, own] of [
      [
        'requisitions-requester',
        '本公司领用申请人',
        'requisitions.requests',
        ['read', 'create', 'update', 'submit', 'withdraw', 'revise', 'cancel'],
        true,
      ],
      [
        'requisitions-request-agent',
        '本公司领用代办',
        'requisitions.requests',
        [
          'read',
          'create',
          'update',
          'submit',
          'withdraw',
          'revise',
          'cancel',
          'delegate',
        ],
        false,
      ],
      [
        'requisitions-request-reviewer',
        '本公司领用审核',
        'requisitions.requests',
        ['read', 'review'],
        false,
      ],
      [
        'requisitions-review-configurator',
        '本公司领用审核配置',
        'requisitions.settings',
        ['read', 'update'],
        false,
      ],
      [
        'requisitions-review-recovery',
        '本公司领用审核交接',
        'requisitions.requests',
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
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle(title),
          grants: [
            {
              resource: {
                type: 'page',
                id:
                  resource === 'requisitions.settings'
                    ? 'requisitions-settings'
                    : 'requisitions-requests',
              },
              actions: [{ action: 'access' }],
            },
            {
              resource: { type: 'composite', id: resource },
              actions: actions.map((action) => ({
                action,
                policy: {
                  type: 'composite',
                  scopes: {
                    ...Object.fromEntries(
                      companyTables
                        .filter(
                          (table) =>
                            resource !== 'requisitions.settings' ||
                            [
                              'personnelEmployees',
                              'personnelEmployments',
                              'personnelAssignments',
                              'orgUnits',
                              'materialIssuePurposes',
                              'materialSubjectSettings',
                            ].includes(table),
                        )
                        .map((table) => [
                          table,
                          'requisitions.ownRequestCompany',
                        ]),
                    ),
                    ...Object.fromEntries(
                      referenceTables.map((table) => [table, 'allRecords']),
                    ),
                    ...(resource === 'requisitions.requests'
                      ? {
                          materialIssueRequests: own
                            ? 'requisitions.ownRequests'
                            : 'requisitions.ownRequestCompany',
                        }
                      : {}),
                    orgSubjects: 'supplyChain.ownSubject',
                  },
                },
              })),
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const key = 'requisitions-purpose-maintainer';
    if (
      !(await repository('authorizationPermissionSets').exists({
        filter: { key },
      }))
    )
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle('本公司领用用途维护'),
          grants: [
            {
              resource: { type: 'page', id: 'requisitions-purposes' },
              actions: [{ action: 'access' }],
            },
            {
              resource: { type: 'composite', id: 'requisitions.purposes' },
              actions: [
                'read',
                'create',
                'update',
                'activate',
                'deactivate',
              ].map((action) => ({
                action,
                policy: {
                  type: 'composite',
                  scopes: {
                    orgSubjects: 'supplyChain.ownSubject',
                    materialIssuePurposes: 'requisitions.ownRequestCompany',
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
