import { defineMigration } from '@nocobase/db';

const page = 'production-daily';

export const PRODUCTION_DAILY_SOURCES = [
  'production-schedules',
  'production-attendance',
  'production-shift-reports',
  'production-downtime',
  'production-overtime',
] as const;

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

function decode(grants: unknown): Grant[] {
  return typeof grants === 'string'
    ? (JSON.parse(grants) as Grant[])
    : structuredClone(grants as Grant[]);
}

function encode(original: unknown, grants: Grant[]): string | Grant[] {
  return typeof original === 'string' ? JSON.stringify(grants) : grants;
}

/** Give the daily page to roles that already reach any production data page. */
export function withProductionDailyGrant(grants: Grant[]): Grant[] {
  const ids = new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? ''),
  );
  if (ids.has(page)) return grants;
  if (!PRODUCTION_DAILY_SOURCES.some((source) => ids.has(source))) return grants;
  return [
    ...grants,
    { resource: { type: 'page', id: page }, actions: [{ action: 'access' }] },
  ];
}

export default defineMigration({
  name: '202611010010_production_daily_page',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      const next = withProductionDailyGrant(current);
      if (next === current) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      if (
        !current.some(
          (grant) =>
            grant.resource?.type === 'page' && grant.resource.id === page,
        )
      )
        continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: {
          grants: encode(
            row.grants,
            current.filter(
              (grant) =>
                !(grant.resource?.type === 'page' && grant.resource.id === page),
            ),
          ),
          updatedAt: new Date(),
        },
      });
    }
  },
});
