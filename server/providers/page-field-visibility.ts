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

export interface PageFieldVisibilityRow {
  resource: string;
  field: string;
  visible: boolean;
}

export type PageFieldVisibilityMode = 'independent' | 'inherit' | 'override';

export interface PageFieldVisibilityConfig {
  mode: PageFieldVisibilityMode;
  configured: boolean;
  inheritedFrom?: string;
  fields: PageFieldVisibilityRow[];
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const toRows = (
  rows: readonly Record<string, unknown>[],
): PageFieldVisibilityRow[] =>
  rows
    .map((row) => ({
      resource: asText(row.resource),
      field: asText(row.field),
      visible: row.visible !== false,
    }))
    .filter((row) => row.resource && row.field);

async function rowsFor(
  database: DatabaseManager,
  permissionSetKey: string,
  pageKey: string,
): Promise<PageFieldVisibilityRow[]> {
  const rows = await database.repository('appPageFieldVisibilities').findMany({
    filter: (filter) =>
      filter.and([
        filter.string('permissionSetKey').eq(permissionSetKey),
        filter.string('pageKey').eq(pageKey),
      ]),
    limit: 500,
    sort: (sort) => [sort.field('resource').asc(), sort.field('field').asc()],
  });
  return toRows(rows);
}

export async function pageFieldVisibilitiesFor(
  database: DatabaseManager,
  permissionSetKey: string,
  pageKey: string,
): Promise<{ configured: boolean; fields: PageFieldVisibility[] }> {
  const fields = await rowsFor(database, permissionSetKey, pageKey);
  return { configured: fields.length > 0, fields };
}

export function resolvePageFieldVisibility(
  own: readonly PageFieldVisibilityRow[],
  inherited: readonly PageFieldVisibilityRow[],
  fallbackPageKey?: string,
): PageFieldVisibilityConfig {
  if (!fallbackPageKey) {
    return {
      mode: 'independent',
      configured: own.length > 0,
      fields: [...own],
    };
  }
  if (own.length > 0) {
    return { mode: 'override', configured: true, fields: [...own] };
  }
  return {
    mode: 'inherit',
    configured: inherited.length > 0,
    inheritedFrom: fallbackPageKey,
    fields: [...inherited],
  };
}

/**
 * The effective configuration for one role. An edit page with no rows of its
 * own follows its create page; once it has rows it is an explicit override.
 */
export async function pageFieldVisibilityConfig(
  database: DatabaseManager,
  permissionSetKey: string,
  pageKey: string,
  fallbackPageKey?: string,
): Promise<PageFieldVisibilityConfig> {
  const own = await rowsFor(database, permissionSetKey, pageKey);
  const inherited = fallbackPageKey
    ? await rowsFor(database, permissionSetKey, fallbackPageKey)
    : [];
  return resolvePageFieldVisibility(own, inherited, fallbackPageKey);
}

/**
 * Merge the rows of every set the account holds. A field stays visible when
 * any set shows it; visibility is a presentation union, not an intersection.
 * Each set resolves its own inherit/override chain before the union.
 */
export function mergePageFieldVisibility(
  rows: readonly PageFieldVisibilityRow[],
  configured = rows.length > 0,
): {
  configured: boolean;
  visible: string[];
  fields: PageFieldVisibilityRow[];
} {
  const merged = new Map<string, PageFieldVisibilityRow>();
  for (const row of rows) {
    const key = `${row.resource}.${row.field}`;
    const current = merged.get(key);
    merged.set(
      key,
      current
        ? { ...current, visible: current.visible || row.visible }
        : { ...row },
    );
  }
  const fields = [...merged.values()];
  return {
    configured,
    visible: fields
      .filter((row) => row.visible)
      .map((row) => `${row.resource}.${row.field}`),
    fields,
  };
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
  fallbackPageKey?: string,
): Promise<{
  configured: boolean;
  visible: string[];
  fields: PageFieldVisibilityRow[];
}> {
  const userId = principal.type === 'user' ? principal.id : undefined;
  if (!userId) {
    return { configured: false, visible: [], fields: [] };
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
  if (!sets.size || sets.has('root'))
    return { configured: false, visible: [], fields: [] };

  const rows: PageFieldVisibilityRow[] = [];
  for (const permissionSetKey of sets) {
    const own = await rowsFor(database, permissionSetKey, pageKey);
    if (own.length > 0) {
      rows.push(...own);
      continue;
    }
    if (fallbackPageKey) {
      rows.push(
        ...(await rowsFor(database, permissionSetKey, fallbackPageKey)),
      );
    }
  }
  return mergePageFieldVisibility(rows);
}
