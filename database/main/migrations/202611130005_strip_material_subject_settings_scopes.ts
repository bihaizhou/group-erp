import { defineMigration } from '@nocobase/db';

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: Array<{ action?: string; policy?: unknown }>;
};

/**
 * 公司物料设置 (materialSubjectSettings / materials.subjectSettings) is removed.
 * Two kinds of stale data remain in permission sets seeded before the removal:
 * 1. a whole composite grant for `materials.subjectSettings` (the kind itself), and
 * 2. a `materialSubjectSettings` scope key inside other composite grant policies
 *    (e.g. warehouse-transfer-operator/reviewer).
 * The runtime no longer registers either, so `reportStoredGrants` throws in
 * development. Strip both so the authorization provider can start.
 */
function stripMaterialSubjectSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMaterialSubjectSettings);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'materialSubjectSettings') continue;
      next[key] = stripMaterialSubjectSettings(val);
    }
    return next;
  }
  return value;
}

function cleanGrants(grants: Grant[]): Grant[] {
  return grants
    .filter(
      (grant) =>
        !(
          grant.resource?.type === 'composite' &&
          grant.resource.id === 'materials.subjectSettings'
        ),
    )
    .filter(
      // Legacy page grants seeded by 202610170001 via page(kind):
      // warehouse-material-subjectSettings(-new/-edit/...). The runtime no
      // longer registers the pages, so the grants are stale data.
      (grant) =>
        !(
          grant.resource?.type === 'page' &&
          typeof grant.resource?.id === 'string' &&
          grant.resource.id.startsWith('warehouse-material-subjectSettings')
        ),
    )
    .map((grant) => stripMaterialSubjectSettings(grant) as Grant);
}

function decode(grants: unknown): Grant[] {
  if (grants == null) return [];
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

export default defineMigration({
  name: '202611130005_strip_material_subject_settings_scopes',
  // The stripped grants describe a feature that is permanently removed;
  // rollback restores the pre-migration database backup instead.
  irreversible: true,
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        next = cleanGrants(current);
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
});
