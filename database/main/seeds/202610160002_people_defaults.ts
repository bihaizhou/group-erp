import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
const peopleKinds = [
  'employees',
  'employments',
  'assignments',
  'changes',
  'dimensions',
  'models',
  'profiles',
  'evaluations',
  'developmentPlans',
  'workforcePlans',
];
const personnelKinds = ['employees', 'employments', 'assignments', 'changes'];
const peopleDependencies: Record<string, string[]> = {
  employees: [],
  employments: ['employees'],
  assignments: ['employees'],
  changes: ['employees', 'employments', 'assignments'],
  dimensions: [],
  models: ['dimensions'],
  profiles: [
    'employees',
    'employments',
    'assignments',
    'dimensions',
    'models',
    'evaluations',
    'developmentPlans',
    'workforcePlans',
  ],
  evaluations: ['employees', 'assignments', 'dimensions', 'models', 'profiles'],
  developmentPlans: ['employees', 'profiles'],
  workforcePlans: ['employees', 'assignments'],
};
const orgReadColumns = { orgSubjects: [], orgUnits: [], orgPositions: [] };

export default defineSeed({
  name: '202610160002_people_defaults',
  transaction: true,
  async run(context) {
    const repository = context.repository.bind(context);
    const roles = [
      {
        key: 'company-personnel-reader',
        title: '公司人事查看',
        kinds: personnelKinds,
        actions: ['read'],
      },
      {
        key: 'company-personnel-maintainer',
        title: '公司人事办理',
        kinds: personnelKinds,
        actions: ['read', 'update'],
      },
      {
        key: 'company-workforce-reviewer',
        title: '公司用人计划确认',
        kinds: ['workforcePlans'],
        actions: ['read', 'companyConfirm'],
      },
      {
        key: 'personnel-reader',
        title: '人事查看',
        kinds: personnelKinds,
        actions: ['read'],
      },
      {
        key: 'personnel-maintainer',
        title: '人事办理',
        kinds: personnelKinds,
        actions: ['read', 'update'],
      },
      {
        key: 'personnel-reviewer',
        title: '人事复核',
        kinds: personnelKinds,
        actions: ['read', 'review'],
      },
      {
        key: 'human-resources-reader',
        title: '集团人力资源查看',
        kinds: peopleKinds.filter((k) => !personnelKinds.includes(k)),
        actions: ['read'],
      },
      {
        key: 'human-resources-maintainer',
        title: '集团人才与规划维护',
        kinds: peopleKinds.filter((k) => !personnelKinds.includes(k)),
        actions: ['read', 'update'],
      },
      {
        key: 'human-resources-reviewer',
        title: '集团人才与规划复核',
        kinds: peopleKinds.filter((k) => !personnelKinds.includes(k)),
        actions: ['read', 'review'],
      },
    ];
    for (const role of roles) {
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key: role.key },
        })
      )
        continue;
      const grants: unknown[] = role.kinds.flatMap((kind) => [
        {
          resource: { type: 'page', id: `people-${kind}` },
          actions: [{ action: 'access' }],
        },
        {
          resource: { type: 'composite', id: `people.${kind}` },
          actions: role.actions.map((action) => ({
            action,
            policy: {
              type: 'composite',
              scopes: Object.fromEntries(
                [
                  kind,
                  ...peopleDependencies[kind],
                  ...Object.keys(orgReadColumns),
                ].map((key) => [
                  key,
                  role.key.startsWith('company-') && !key.startsWith('org')
                    ? 'people.ownCompany'
                    : 'allRecords',
                ]),
              ),
            },
          })),
        },
      ]);
      if (role.key.startsWith('human-resources'))
        grants.push({
          resource: { type: 'page', id: 'people-overview' },
          actions: [{ action: 'access' }],
        });
      if (role.kinds.includes('changes'))
        grants.push({
          resource: { type: 'page', id: 'people-approvals' },
          actions: [{ action: 'access' }],
        });
      if (role.key === 'personnel-maintainer')
        grants.push({
          resource: { type: 'page', id: 'people-approval-settings' },
          actions: [{ action: 'access' }],
        });
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: role.key,
          key: role.key,
          title: encodeAuthorizationTitle(role.title),
          grants,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    for (const [key, title, resource, action] of [
      [
        'personnel-sensitive-reader',
        '人事联系方式查看',
        'personnel.sensitive',
        'read',
      ],
      [
        'personnel-sensitive-maintainer',
        '人事联系方式维护',
        'personnel.sensitive',
        'update',
      ],
    ]) {
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
              resource: { type: 'settings', id: resource },
              actions: [{ action }],
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    for (const [key, title, grants] of [
      [
        'personnel-account-binder',
        '人员与账号关联管理',
        [
          {
            resource: { type: 'settings', id: 'personnel.accountBinding' },
            actions: [{ action: 'read' }, { action: 'update' }],
          },
        ],
      ],
      [
        'people-auditor',
        '人事与人才审计查看',
        [
          {
            resource: { type: 'page', id: 'people-history' },
            actions: [{ action: 'access' }],
          },
          {
            resource: { type: 'composite', id: 'people.history' },
            actions: [
              {
                action: 'read',
                policy: {
                  type: 'composite',
                  scopes: { history: 'allRecords' },
                },
              },
            ],
          },
        ],
      ],
    ] as const) {
      if (
        !(await repository('authorizationPermissionSets').exists({
          filter: { key },
        }))
      )
        await repository('authorizationPermissionSets').createOne({
          values: {
            id: key,
            key,
            title: encodeAuthorizationTitle(title),
            grants: [...grants],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
    // No business examples and no automatic assignments. Existing administrator choices remain intact.
  },
});
