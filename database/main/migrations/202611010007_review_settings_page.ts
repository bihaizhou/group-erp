import { defineMigration } from '@nocobase/db';

const NEW_PAGE = 'review-settings';
const OLD_PAGES = [
  'procurement-settings',
  'requisitions-settings',
  'sales-settings',
  'warehouse-settings',
];

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

/** Roles that could open any of the four editors also open the combined page. */
export function withReviewSettingsGrant(grants: Grant[]): Grant[] {
  if (grants.some((grant) => grant.resource?.id === NEW_PAGE)) return grants;
  if (
    !grants.some(
      (grant) =>
        grant.resource?.type === 'page' &&
        OLD_PAGES.includes(grant.resource.id ?? ''),
    )
  )
    return grants;
  return [
    ...grants,
    {
      resource: { type: 'page', id: NEW_PAGE },
      actions: [{ action: 'access' }],
    },
  ];
}

function decode(grants: unknown): Grant[] {
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

export default defineMigration({
  name: '202611010007_review_settings_page',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        next = withReviewSettingsGrant(current);
      if (next === current) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      if (!current.some((grant) => grant.resource?.id === NEW_PAGE)) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: {
          grants: encode(
            row.grants,
            current.filter((grant) => grant.resource?.id !== NEW_PAGE),
          ),
          updatedAt: new Date(),
        },
      });
    }
  },
});
