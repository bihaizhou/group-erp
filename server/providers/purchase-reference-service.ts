import type {
  DatabaseConnection,
  RepositoryFilter,
  RepositoryRecord,
} from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';
import type { MaterialPolicies } from './material-service.js';
import { businessDate } from './business-date.js';
import { materialIdFilter } from './material-filters.js';

const id = z.string().uuid();
export const purchaseReferenceQuery = z.discriminatedUnion('domain', [
  z.strictObject({
    domain: z.literal('organization'),
    kind: z.enum(['subjects', 'units', 'positions', 'regions']),
    id,
  }),
  z.strictObject({
    domain: z.literal('people'),
    kind: z.enum(['employees', 'changes']),
    id,
  }),
  z.strictObject({
    domain: z.literal('materials'),
    kind: z.enum([
      'names',
      'templates',
      'skus',
      'units',
      'unitRules',
      'subjectSettings',
    ]),
    id,
  }),
  z
    .strictObject({
      domain: z.literal('suppliers'),
      kind: z.enum(['identity', 'applicability', 'company']),
      id,
      subjectId: id.optional(),
    })
    .superRefine((v, c) => {
      if ((v.kind === 'company') !== Boolean(v.subjectId))
        c.addIssue({
          code: 'custom',
          path: ['subjectId'],
          message: 'Company context is required only for company references.',
        });
    }),
]);
export type PurchaseReferenceTarget = z.infer<typeof purchaseReferenceQuery>;
const referenceItem = z.object({
  id,
  code: z.string(),
  status: z.enum(['draft', 'pending', 'approved']),
});
export const purchaseReferenceView = z.discriminatedUnion('visibility', [
  z.strictObject({
    visibility: z.literal('authorized'),
    total: z.number().int().nonnegative(),
    items: z.array(referenceItem).max(5),
    hasMore: z.boolean(),
  }),
  z.strictObject({
    visibility: z.literal('restricted'),
    items: z.array(z.never()).length(0),
    hasMore: z.literal(false),
  }),
]);
const restricted = () => ({
  visibility: 'restricted' as const,
  items: [],
  hasMore: false,
});
class RestrictedReference extends Error {}
const unavailable = () => {
  throw new ApiError({
    status: 'NOT_FOUND',
    reason: 'PURCHASE_REFERENCE_TARGET_UNAVAILABLE',
    domain: 'procurement',
    message: 'Reference target is unavailable.',
  });
};
const tooBroad = () => {
  throw new ApiError({
    status: 'FAILED_PRECONDITION',
    httpStatus: 400,
    reason: 'PURCHASE_REFERENCE_TOO_BROAD',
    domain: 'procurement',
    message: 'Reference impact exceeds the supported bound.',
  });
};
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const allowed = (
  policies: MaterialPolicies,
  table: string,
  columns: readonly string[],
) => {
  const read = policies[table]?.read;
  if (!read) return false;
  if (read === true) return true;
  const fields = read.fields;
  return Array.isArray(fields) && columns.every((key) => fields.includes(key));
};

/** Called while holding orgMutationLock. Integrity checks deliberately see all
 * dependencies; only the opaque business refusal crosses a permission boundary. */
export async function hasOpenPurchaseOrganizationReferences(
  c: DatabaseConnection,
  kind: 'subjects' | 'units',
  targetId: string,
) {
  return c.repository('purchaseRequests').exists({
    filter: (f) =>
      f.and([
        f
          .string(kind === 'subjects' ? 'subjectId' : 'requestingUnitId')
          .eq(targetId),
        f.or(
          ['draft', 'pending', 'approved'].map((status) =>
            f.string('status').eq(status),
          ),
        ),
      ]),
  });
}

export async function purchaseReferenceImpact(
  c: DatabaseConnection,
  target: PurchaseReferenceTarget,
  ownerPolicies: MaterialPolicies | undefined,
  purchasePolicies: MaterialPolicies | undefined,
  timeZone: string,
) {
  const ownerTables: Record<string, string> = {
    'organization.subjects': 'orgSubjects',
    'organization.units': 'orgUnits',
    'organization.positions': 'orgPositions',
    'organization.regions': 'orgRegions',
    'people.employees': 'personnelEmployees',
    'people.changes': 'personnelChanges',
    'materials.names': 'materialNames',
    'materials.templates': 'materialAttributeTemplates',
    'materials.skus': 'materialSkus',
    'materials.units': 'measureUnits',
    'materials.unitRules': 'materialUnitRules',
    'materials.subjectSettings': 'materialSubjectSettings',
    'suppliers.identity': 'businessPartners',
    'suppliers.applicability': 'businessPartners',
    'suppliers.company': 'businessPartners',
  };
  const table = ownerTables[`${target.domain}.${target.kind}`];
  // Authorization of the original domain happens in the route before this read.
  // Its row policy is still essential when a caller guesses another company's ID.
  const owner = c.repository(table);
  const ownerPolicy = ownerPolicies?.[table];
  if (ownerPolicies && !allowed(ownerPolicies, table, ['id']))
    return unavailable();
  const record = await (
    ownerPolicy ? owner.withPolicy(ownerPolicy) : owner
  ).findOne({ filter: { id: target.id } });
  if (!record) return unavailable();
  const joinColumns =
    target.domain === 'people' && target.kind === 'changes'
      ? ['personId']
      : target.domain === 'materials' && target.kind === 'subjectSettings'
        ? ['skuId', 'subjectId']
        : [];
  if (
    !purchasePolicies ||
    (ownerPolicies && !allowed(ownerPolicies, table, joinColumns))
  )
    return restricted();
  const p = purchasePolicies;
  const rows = async (
    name: string,
    columns: string[],
    filter?: RepositoryFilter<RepositoryRecord>,
  ) => {
    if (!allowed(p, name, columns)) throw new RestrictedReference();
    const result = await c
      .repository(name)
      .withPolicy(p[name])
      .findMany({
        select: (s) => s.fields(...columns),
        ...(filter ? { filter } : {}),
        limit: 10001,
      });
    if (result.length > 10000) return tooBroad();
    return result;
  };
  const headColumns = ['id', 'code', 'status'];
  if (target.domain === 'suppliers')
    headColumns.push(
      'suggestedSupplierId',
      ...(target.kind === 'company' ? ['subjectId'] : []),
    );
  if (
    target.domain === 'people' ||
    (target.domain === 'organization' &&
      ['units', 'positions'].includes(target.kind))
  )
    headColumns.push('requesterEmployeeId');
  if (target.domain === 'organization') {
    if (target.kind === 'subjects' || target.kind === 'regions')
      headColumns.push('subjectId');
    if (target.kind === 'units') headColumns.push('requestingUnitId');
    if (target.kind === 'regions') headColumns.push('suggestedSupplierId');
  }
  try {
    const heads = await rows('purchaseRequests', headColumns, (f) =>
      f.or(
        ['draft', 'pending', 'approved'].map((status) =>
          f.string('status').eq(status),
        ),
      ),
    );
    const matches = new Set<string>();
    const addHeads = (test: (row: RepositoryRecord) => boolean) => {
      for (const row of heads) if (test(row)) matches.add(str(row.id));
    };
    const people = async (personIds: string[]) => {
      if (!personIds.length) return;
      addHeads((head) => personIds.includes(str(head.requesterEmployeeId)));
      const employees = await rows(
        'personnelEmployees',
        ['id', 'accountId'],
        (f) => materialIdFilter(f, 'id', personIds),
      );
      const accounts = new Set(
        employees.map((row) => str(row.accountId)).filter(Boolean),
      );
      if (!accounts.size) return;
      const tasks = await rows(
        'supplyChainReviewTasks',
        ['id', 'requestId', 'candidates', 'status'],
        { status: 'pending' },
      );
      for (const task of tasks)
        if (
          Array.isArray(task.candidates) &&
          task.candidates.some(
            (value) => typeof value === 'string' && accounts.has(value),
          )
        )
          matches.add(str(task.requestId));
    };
    const lines = async (test: (row: RepositoryRecord) => boolean) => {
      const values = await rows(
        'purchaseRequestLines',
        [
          'id',
          'requestId',
          'subjectId',
          'status',
          'materialNameId',
          'skuId',
          'requestedUnitId',
          'unitId',
          'baseUnitId',
          'unitRuleId',
        ],
        (f) => f.string('status').ne('cancelled'),
      );
      for (const value of values)
        if (test(value)) matches.add(str(value.requestId));
    };
    if (target.domain === 'suppliers') {
      addHeads(
        (head) =>
          head.suggestedSupplierId === target.id &&
          (target.kind !== 'company' || head.subjectId === target.subjectId),
      );
    } else if (target.domain === 'people') {
      const personId =
        target.kind === 'employees' ? target.id : str(record.personId);
      await people(personId ? [personId] : []);
    } else if (target.domain === 'organization') {
      if (target.kind === 'subjects')
        addHeads((head) => head.subjectId === target.id);
      if (target.kind === 'units' || target.kind === 'positions') {
        if (target.kind === 'units')
          addHeads((head) => head.requestingUnitId === target.id);
        const positions =
          target.kind === 'positions'
            ? [target.id]
            : (
                await rows('orgPositions', ['id', 'unitId'], {
                  unitId: target.id,
                })
              ).map((row) => str(row.id));
        if (positions.length) {
          const assignments = await rows(
            'personnelAssignments',
            ['id', 'personId', 'positionId', 'status', 'data'],
            (f) =>
              f.and([
                materialIdFilter(f, 'positionId', positions),
                f.string('status').eq('active'),
              ]),
          );
          const today = businessDate(timeZone);
          await people(
            assignments
              .filter((row) => {
                const data = row.data as {
                  startDate?: string;
                  endDate?: string | null;
                };
                return Boolean(
                  data?.startDate &&
                  data.startDate <= today &&
                  (!data.endDate || data.endDate > today),
                );
              })
              .map((row) => str(row.personId)),
          );
        }
      }
      if (target.kind === 'regions') {
        const regions = await rows('orgRegions', ['id', 'parentId']);
        const descendants = new Set([target.id]);
        for (let previous = -1; previous !== descendants.size;) {
          previous = descendants.size;
          for (const region of regions)
            if (descendants.has(str(region.parentId)))
              descendants.add(str(region.id));
        }
        const companies = await rows('orgSubjects', ['id', 'regionId']);
        const ids = new Set(
          companies
            .filter((row) => descendants.has(str(row.regionId)))
            .map((row) => str(row.id)),
        );
        addHeads(
          (head) =>
            ids.has(str(head.subjectId)) && Boolean(head.suggestedSupplierId),
        );
      }
    } else {
      if (target.kind === 'templates') {
        const names = new Set(
          (
            await rows('materialNames', ['id', 'templateId'], {
              templateId: target.id,
            })
          ).map((row) => str(row.id)),
        );
        await lines((line) => names.has(str(line.materialNameId)));
      } else {
        await lines((line) =>
          target.kind === 'subjectSettings'
            ? line.skuId === record.skuId && line.subjectId === record.subjectId
            : (target.kind === 'units'
                ? ['requestedUnitId', 'unitId', 'baseUnitId']
                : [
                    target.kind === 'names'
                      ? 'materialNameId'
                      : target.kind === 'skus'
                        ? 'skuId'
                        : 'unitRuleId',
                  ]
              ).some((field) => line[field] === target.id),
        );
      }
    }
    const visible = heads
      .filter((head) => matches.has(str(head.id)))
      .sort((a, b) => str(a.code).localeCompare(str(b.code)));
    return purchaseReferenceView.parse({
      visibility: 'authorized',
      total: visible.length,
      hasMore: visible.length > 5,
      items: visible
        .slice(0, 5)
        .map(({ id, code, status }) => ({ id, code, status })),
    });
  } catch (error) {
    if (error instanceof RestrictedReference) return restricted();
    throw error;
  }
}
