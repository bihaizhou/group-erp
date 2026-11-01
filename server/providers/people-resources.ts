import { businessDate } from './business-date.js';
import {
  defineCompositeResource,
  defineRecordAccess,
  type CompositeResource,
} from '@nocobase/authorization/core';
import {
  condition,
  defineDatabasePermission,
} from '@nocobase/app-plugin-authorization/server';
import { peopleKinds, peopleTables, type PeopleKind } from './people-model.js';
import type { DatabaseManager } from '@nocobase/db';

export const peopleColumns = [
  'id',
  'code',
  'name',
  'status',
  'subjectId',
  'personId',
  'positionId',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'data',
  'snapshot',
  'grade',
  'accountId',
  'photoId',
  'createdAt',
  'updatedAt',
];
export const peopleDependencies: Record<PeopleKind, PeopleKind[]> = {
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
export const orgReadColumns: Record<string, string[]> = {
  orgSubjects: [
    'id',
    'code',
    'name',
    'status',
    'sectorId',
    'regionId',
    'parentId',
  ],
  orgUnits: [
    'id',
    'code',
    'name',
    'status',
    'subjectId',
    'parentId',
    'leaderPositionId',
  ],
  orgPositions: ['id', 'code', 'name', 'status', 'unitId', 'reportsToId'],
};
export const companyAccess = defineRecordAccess('people.companies', (a) =>
  a
    .title({ key: 'people.companyScope', ns: 'group-erp' })
    .collections(
      ...Object.values(peopleTables),
      'peopleAudit',
      'personnelPrivate',
    )
    .params<{ subjectIds: string[] }>({
      type: 'object',
      properties: { subjectIds: { type: 'array', items: { type: 'string' } } },
      required: ['subjectIds'],
    })
    .resolver(({ params }) =>
      Array.isArray(params?.subjectIds) &&
      params.subjectIds.length > 0 &&
      params.subjectIds.length <= 500
        ? {
            kind: 'group',
            logic: 'or',
            items: params.subjectIds.map((id) =>
              condition('subjectId', '$eq', id),
            ),
          }
        : false,
    ),
);

export function ownCompanyAccess(
  database: DatabaseManager,
  timeZone = 'Asia/Shanghai',
) {
  return defineRecordAccess('people.ownCompany', (a) =>
    a
      .title({ key: 'people.ownCompanyScope', ns: 'group-erp' })
      .collections(
        ...Object.values(peopleTables),
        'peopleAudit',
        'personnelPrivate',
      )
      .resolver(async ({ principal }) => {
        if (principal.type !== 'user') return false;
        const person = await database
          .repository('personnelEmployees')
          .findOne({ filter: { accountId: principal.id, status: 'active' } });
        if (
          !person ||
          typeof person.id !== 'string' ||
          typeof person.subjectId !== 'string' ||
          !person.subjectId
        )
          return false;
        const employments = await database
          .repository('personnelEmployments')
          .findMany({
            filter: { personId: person.id, subjectId: person.subjectId },
            limit: 10001,
          });
        if (employments.length > 10000) return false;
        const today = businessDate(timeZone);
        const employed = employments.some((row) => {
          const data = row.data as {
            startDate: string;
            endDate: string | null;
          };
          return (
            data.startDate <= today && (!data.endDate || data.endDate > today)
          );
        });
        return employed
          ? condition('subjectId', '$eq', person.subjectId)
          : false;
      }),
  );
}

export const peopleResources = Object.fromEntries(
  peopleKinds.map((kind) => {
    const resource: CompositeResource = {
      name: `people.${kind}`,
      title: { key: `people.${kind}`, ns: 'group-erp' },
      actions: [],
    };
    const actions = [
      ...['read', 'update', 'review'],
      ...(kind === 'workforcePlans' ? ['companyConfirm'] : []),
    ].map((action) => {
      const parts = [];
      const base = defineDatabasePermission((p) =>
        p.collection(peopleTables[kind]).read(peopleColumns),
      );
      parts.push(
        (action === 'read' ? base : base.create('*').update('*'))
          .bind(kind)
          .build(),
      );
      for (const dep of peopleDependencies[kind]) {
        const read = defineDatabasePermission((p) =>
          p.collection(peopleTables[dep]).read(peopleColumns),
        );
        parts.push(
          (kind === 'changes' && action !== 'read'
            ? read.create('*').update('*')
            : read
          )
            .bind(dep)
            .build(),
        );
      }
      for (const [table, fields] of Object.entries(orgReadColumns))
        parts.push(
          defineDatabasePermission((p) => p.collection(table).read(fields))
            .bind(table)
            .build(),
        );
      return {
        name: action,
        title: { key: `people.${action}`, ns: 'group-erp' },
        grants: parts.flatMap((p) => p.grants),
        dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
      };
    });
    return [kind, { ...resource, actions }];
  }),
) as unknown as Record<PeopleKind, CompositeResource>;
export const peopleAuditResource = defineCompositeResource(
  'people.history',
  (r) =>
    r.title({ key: 'people.history', ns: 'group-erp' }).action('read', (a) =>
      a.grant(
        'history',
        defineDatabasePermission((p) =>
          p
            .collection('peopleAudit')
            .read([
              'id',
              'kind',
              'recordId',
              'recordName',
              'subjectId',
              'personId',
              'operation',
              'actorId',
              'actorName',
              'reason',
              'beforeValue',
              'afterValue',
              'createdAt',
            ]),
        ),
      ),
    ),
);
