import type { DatabaseManager } from '@nocobase/db';

/**
 * Page-level field visibility only decides whether a form renders a field.
 * It deliberately does not touch `appFieldPolicies`: hiding an input must
 * never be used as a substitute for server-side field redaction.
 */
export interface PageFieldVisibility {
  resource: string;
  field: string;
  visible: boolean;
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export async function pageFieldVisibilitiesFor(
  database: DatabaseManager,
  permissionSetKey: string,
  pageKey: string,
): Promise<{ configured: boolean; fields: PageFieldVisibility[] }> {
  const rows = await database.repository('appPageFieldVisibilities').findMany({
    filter: (filter) =>
      filter.and([
        filter.string('permissionSetKey').eq(permissionSetKey),
        filter.string('pageKey').eq(pageKey),
      ]),
    limit: 500,
    sort: (sort) => [sort.field('resource').asc(), sort.field('field').asc()],
  });
  return {
    configured: rows.length > 0,
    fields: rows
      .map((row) => ({
        resource: asText(row.resource),
        field: asText(row.field),
        visible: row.visible !== false,
      }))
      .filter((row) => row.resource && row.field),
  };
}

export interface PageFieldVisibilityRow {
  resource: string;
  field: string;
  visible: boolean;
}

/**
 * Merge the rows of every set the account holds. A field stays visible when
 * any set shows it; visibility is a presentation union, not an intersection.
 */
export function mergePageFieldVisibility(
  rows: readonly PageFieldVisibilityRow[],
  configured = rows.length > 0,
): { configured: boolean; visible: string[] } {
  const visible = new Set<string>();
  for (const row of rows) {
    if (row.visible) visible.add(`${row.resource}.${row.field}`);
  }
  return { configured, visible: [...visible] };
}

/**
 * One account can carry several permission sets. A field is visible if any
 * set shows it; a page with no row at all is unconfigured and keeps the
 * default (render everything the page already renders).
 */
export async function effectivePageFieldVisibility(
  database: DatabaseManager,
  principal: { type?: string; id?: string },
  pageKey: string,
): Promise<{ configured: boolean; visible: string[] }> {
  const userId = principal.type === 'user' ? principal.id : undefined;
  if (!userId) {
    return { configured: false, visible: [] };
  }
  const assignments = await database
    .repository('authorizationPermissionSetAssignments')
    .findMany({
      filter: (filter) =>
        filter.and([
          filter.string('subjectType').eq('user'),
          filter.string('subjectId').eq(userId),
        ]),
      limit: 200,
    });
  const sets = new Set(
    assignments.map((row) => asText(row.permissionSetKey)).filter(Boolean),
  );
  sets.delete('');
  if (!sets.size || sets.has('root')) return { configured: false, visible: [] };
  const rows = await database.repository('appPageFieldVisibilities').findMany({
    filter: (filter) =>
      filter.and([
        filter.string('pageKey').eq(pageKey),
        filter.or(
          [...sets].map((key) => filter.string('permissionSetKey').eq(key)),
        ),
      ]),
    limit: 2000,
  });
  return mergePageFieldVisibility(
    rows
      .map((row) => ({
        resource: asText(row.resource),
        field: asText(row.field),
        visible: row.visible !== false,
      }))
      .filter((row) => row.resource && row.field),
  );
}
