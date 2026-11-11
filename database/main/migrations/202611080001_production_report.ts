import { defineMigration } from '@nocobase/db';

const page = 'production-report';
const retired = ['production-daily', 'production-attendance'];

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

const isPage = (grant: Grant, id: string) =>
  grant.resource?.type === 'page' && grant.resource.id === id;

/** Roles that saw the retired entry pages keep seeing the single report page. */
function readProduction(grants: Grant[]): boolean {
  return retired.some((id) => grants.some((grant) => isPage(grant, id)));
}

/** Roles that may manage production data are the roles that fill a shift. */
function managesProduction(grants: Grant[]): boolean {
  return grants.some(
    (grant) =>
      grant.resource?.type === 'settings' &&
      grant.resource.id === 'production' &&
      (grant.actions ?? []).some((action) => action.action === 'manage'),
  );
}

/** Drop the retired entry pages and grant the single report page instead. */
export function withProductionReportGrant(grants: Grant[]): Grant[] {
  const addPage = readProduction(grants) || managesProduction(grants);
  const next = grants.filter(
    (grant) => !retired.some((id) => isPage(grant, id)),
  );
  if (!addPage || next.some((grant) => isPage(grant, page))) return next;
  return [
    ...next,
    { resource: { type: 'page', id: page }, actions: [{ action: 'access' }] },
  ];
}

export default defineMigration({
  name: '202611080001_production_report',
  transaction: true,
  async up(context) {
    const { builder } = context;
    await builder.alterCollection('prdShiftReports', (c) => {
      c.string('enteredBy', { length: 200, nullable: true });
      c.string('enteredByPositionId', { length: 36, nullable: true });
      c.string('sourceChannel', {
        length: 16,
        nullable: false,
        defaultValue: 'manual',
      });
    });
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      const next = withProductionReportGrant(current);
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const { builder } = context;
    await builder.alterCollection('prdShiftReports', (c) => {
      c.dropField('sourceChannel');
      c.dropField('enteredByPositionId');
      c.dropField('enteredBy');
    });
    const sets = context.repository('authorizationPermissionSets');
    const rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants);
      const hadReport = current.some((grant) => isPage(grant, page));
      const next = current.filter((grant) => !isPage(grant, page));
      if (hadReport && !next.some((g) => isPage(g, 'production-daily'))) {
        next.push({
          resource: { type: 'page', id: 'production-daily' },
          actions: [{ action: 'access' }],
        });
      }
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      await sets.updateOne({
        filter: { key: row.key as string },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
});
