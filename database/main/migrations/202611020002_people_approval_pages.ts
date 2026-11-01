import { defineMigration } from '@nocobase/db';

const CHANGE_PAGE = 'people-changes',
  APPROVAL_PAGE = 'people-approvals',
  SETTINGS_PAGE = 'people-approval-settings';

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: { action: string }[];
};

function pageIds(grants: Grant[]): Set<string> {
  return new Set(
    grants
      .filter((grant) => grant.resource?.type === 'page')
      .map((grant) => grant.resource?.id ?? '')
      .filter(Boolean),
  );
}

/**
 * Gives the approval pages to the roles that already handle personnel changes:
 * every role that can open 人事办理 can open 待我审批, and the personnel
 * maintainer configures the approval chains. Roles created by the seed get the
 * same grants, so an existing installation and a fresh one end up alike.
 */
export function withPeopleApprovalGrants(
  grants: Grant[],
  key: string,
): Grant[] {
  const ids = pageIds(grants);
  if (!ids.has(CHANGE_PAGE)) return grants;
  const additions: Grant[] = [];
  if (!ids.has(APPROVAL_PAGE))
    additions.push({
      resource: { type: 'page', id: APPROVAL_PAGE },
      actions: [{ action: 'access' }],
    });
  if (key === 'personnel-maintainer' && !ids.has(SETTINGS_PAGE))
    additions.push({
      resource: { type: 'page', id: SETTINGS_PAGE },
      actions: [{ action: 'access' }],
    });
  return additions.length ? [...grants, ...additions] : grants;
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
  name: '202611020002_people_approval_pages',
  transaction: true,
  async up(context) {
    const sets = context.repository('authorizationPermissionSets'),
      rows = await sets.findMany();
    for (const row of rows) {
      const current = decode(row.grants),
        key = typeof row.key === 'string' ? row.key : '',
        next = withPeopleApprovalGrants(current, key);
      if (next === current) continue;
      await sets.updateOne({
        filter: { key },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
  async down(context) {
    const sets = context.repository('authorizationPermissionSets');
    for (const row of await sets.findMany()) {
      const current = decode(row.grants),
        key = typeof row.key === 'string' ? row.key : '',
        next = current.filter(
          (grant) =>
            grant.resource?.type !== 'page' ||
            ![APPROVAL_PAGE, SETTINGS_PAGE].includes(grant.resource.id ?? ''),
        );
      if (next.length === current.length) continue;
      await sets.updateOne({
        filter: { key },
        values: { grants: encode(row.grants, next), updatedAt: new Date() },
      });
    }
  },
});
