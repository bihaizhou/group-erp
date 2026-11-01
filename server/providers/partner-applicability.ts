import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { MaterialPolicies } from './material-service.js';
import { ApiError } from '@nocobase/app-server/router';
import { materialIdFilter } from './material-filters.js';
import { z } from 'zod';
import {
  supplierMutation,
  supplierPage,
  supplierIdentityView,
} from './supplier-model.js';

const id = z.string().uuid();
const selections = z
  .array(id)
  .max(500)
  .transform((v) => [...new Set(v)].sort());
export const supplierApplicabilityInput = supplierMutation
  .extend({
    scopeMode: z.enum(['all', 'selected']),
    regionIds: selections,
    subjectIds: selections,
  })
  .superRefine((v, c) => {
    if (
      (v.scopeMode === 'all' && (v.regionIds.length || v.subjectIds.length)) ||
      (v.scopeMode === 'selected' &&
        !v.regionIds.length &&
        !v.subjectIds.length)
    )
      c.addIssue({
        code: 'custom',
        path: ['scopeMode'],
        message: 'Choose all companies, or at least one region or company.',
      });
  });
export const supplierApplicabilityView = z.object({
  id,
  partnerId: id,
  partnerRole: z.literal('supplier'),
  scopeMode: z.enum(['all', 'selected']),
  status: z.enum(['active', 'inactive']),
  revision: z.number(),
  regionIds: z.array(id),
  subjectIds: z.array(id),
});
export const supplierAvailabilityQuery = supplierPage.extend({
  subjectId: id,
  status: z.enum(['active', 'inactive']).optional(),
  orderBy: z
    .enum(['code', '-code', 'name', '-name', 'updatedAt', '-updatedAt'])
    .default('code'),
});
export const supplierSelectionInput = z.strictObject({
  subjectId: id,
  partnerId: id,
});
export const supplierSelectionView = z.object({
  subjectId: id,
  identity: supplierIdentityView,
  scopeMatch: z.enum(['all', 'region', 'company']),
  policyRevision: z.number(),
  companySettingRevision: z.number(),
});
export const supplierOverrideInput = z.strictObject({
  partnerId: id,
  subjectId: id,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(0),
  reason: z.string().trim().min(1).max(1000),
  notes: z.string().trim().max(2000).default(''),
  requestKey: id,
});
export const supplierAvailabilityView = z.object({
  partnerId: id,
  subjectId: id,
  identity: supplierIdentityView,
  scopeMatch: z.enum(['all', 'region', 'company']),
  supplierStatus: z.enum(['active', 'inactive']),
  companyStatus: z.enum(['active', 'inactive']),
  effectiveStatus: z.enum(['active', 'inactive']),
  settingId: id.nullable(),
  revision: z.number(),
  notes: z.string(),
  updatedAt: z.string(),
});
export const partnerPolicyColumns = [
  'id',
  'partnerId',
  'partnerRole',
  'scopeMode',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
];
export const partnerScopeColumns = {
  partnerRegionScopes: ['id', 'policyId', 'regionId'],
  partnerCompanyScopes: ['id', 'policyId', 'subjectId'],
};
const scalar = (v: unknown) => (typeof v === 'string' ? v : '');
export function partnerScopeRepo(
  c: DatabaseConnection,
  table: string,
  p: MaterialPolicies,
) {
  if (!p[table] || p[table].read === false)
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      domain: 'procurement',
      reason: 'SUPPLIER_FORBIDDEN',
      message: 'Supplier access is not allowed.',
    });
  return c.repository(table).withPolicy(p[table]);
}
function capacity(): never {
  throw new ApiError({
    status: 'FAILED_PRECONDITION',
    domain: 'procurement',
    reason: 'SUPPLIER_SCOPE_TOO_BROAD',
    message: 'Too many supplier scope candidates.',
  });
}
// Scope applicability is business eligibility, independent from the caller's
// company permissions. Never turn an all/region scope into a user grant.
export async function matchingPartnerPolicies(
  c: DatabaseConnection,
  subject: RepositoryRecord,
  p: MaterialPolicies,
  partnerId?: string,
  role: 'supplier' | 'customer' = 'supplier',
) {
  const regionIds: string[] = [];
  if (subject.type === 'company') {
    let regionId = scalar(subject.regionId);
    const seen = new Set<string>();
    while (regionId) {
      if (seen.has(regionId) || seen.size >= 500) return capacity();
      seen.add(regionId);
      const region = await partnerScopeRepo(c, 'orgRegions', p).findOne({
        filter: { id: regionId, status: 'active' },
      });
      if (!region) break;
      regionIds.push(regionId);
      regionId = scalar(region.parentId);
    }
  }
  const companyScopes = await partnerScopeRepo(
    c,
    'partnerCompanyScopes',
    p,
  ).findMany({ filter: { subjectId: scalar(subject.id) }, limit: 10001 });
  const regionScopes = regionIds.length
    ? await partnerScopeRepo(c, 'partnerRegionScopes', p).findMany({
        filter: (f) => materialIdFilter(f, 'regionId', regionIds),
        limit: 10001,
      })
    : [];
  if (companyScopes.length > 10000 || regionScopes.length > 10000)
    return capacity();
  const explicit = new Set(companyScopes.map((s) => scalar(s.policyId)));
  const regional = new Set(regionScopes.map((s) => scalar(s.policyId)));
  const ids = [...new Set([...explicit, ...regional])];
  const policies = await partnerScopeRepo(c, 'partnerRolePolicies', p).findMany(
    {
      filter: (f) =>
        f.and([
          f.string('partnerRole').eq(role),
          ...(partnerId ? [f.string('partnerId').eq(partnerId)] : []),
          f.or([
            ...(subject.type === 'company'
              ? [f.string('scopeMode').eq('all')]
              : []),
            materialIdFilter(f, 'id', ids),
          ]),
        ]),
      limit: 10001,
    },
  );
  if (policies.length > 10000) return capacity();
  return policies.map((policy) => ({
    policy,
    scopeMatch:
      policy.scopeMode === 'all'
        ? ('all' as const)
        : explicit.has(scalar(policy.id))
          ? ('company' as const)
          : ('region' as const),
  }));
}
