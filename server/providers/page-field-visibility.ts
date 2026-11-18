import { randomUUID } from 'node:crypto';
import type { DatabaseManager } from '@nocobase/db';

import {
  fieldPoliciesFor,
  type FieldAccess,
  type FieldPolicyView,
} from './field-access.js';

/**
 * Per-page field permissions. One row = one field on one page of one
 * permission set; three states live on it:
 *   visible=false            -> hidden on the page (and redacted server-side)
 *   visible=true, writable=false -> readonly (writes rejected server-side)
 *   visible=true, writable=true  -> editable
 */
export interface PageFieldVisibility {
  resource: string;
  field: string;
  visible: boolean;
  writable: boolean;
}

export interface PageFieldVisibilityRow {
  resource: string;
  field: string;
  visible: boolean;
  writable: boolean;
}

export type PageFieldVisibilityMode = 'independent' | 'inherit' | 'override';

export interface PageFieldVisibilityConfig {
  mode: PageFieldVisibilityMode;
  configured: boolean;
  inheritedFrom?: string;
  fields: PageFieldVisibilityRow[];
}


/**
 * Some records have two edit entries that render the same form: one opened
 * from the list (`-list-edit`, or plain `-edit` on older modules) and one
 * nested under the detail route (`-detail-edit`, or plain `-edit`). They are
 * the same page to the user, so they share one page key and one set of field
 * permissions. Mirrors client/pages/settings/page-keys.ts — keep in sync.
 */
export function canonicalPageKey(pageKey: string): string {
  return pageKey
    .replace(/-list-edit(?=-|$)/u, '-edit')
    .replace(/-detail-edit(?=-|$)/u, '-edit')
    .replace(/-copy(?=-|$)/u, '-new');
}

/** The canonical key plus the legacy entry keys whose rows still apply. */
export function pageKeyVariants(pageKey: string): readonly string[] {
  const canonical = canonicalPageKey(pageKey);
  const aliases: string[] = [canonical];
  // Rows saved while "copy" had its own entry still apply to the create page.
  const copyAlias = canonical.replace(/-new(?=-|$)/u, '-copy');
  if (copyAlias !== canonical) aliases.push(copyAlias);
  if (!canonical.endsWith('-edit')) return aliases;
  const base = canonical.slice(0, -'-edit'.length);
  return [...aliases, `${base}-list-edit`, `${base}-detail-edit`];
}

/** Merge rows of the entry aliases; the most restrictive row wins. */
function mergeRowsByField(
  rows: readonly PageFieldVisibilityRow[],
): PageFieldVisibilityRow[] {
  const merged = new Map<string, PageFieldVisibilityRow>();
  for (const row of rows) {
    const key = `${row.resource}.${row.field}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...row });
      continue;
    }
    const visible = previous.visible && row.visible;
    merged.set(key, {
      resource: row.resource,
      field: row.field,
      visible,
      writable: visible && previous.writable && row.writable,
    });
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.resource.localeCompare(b.resource) || a.field.localeCompare(b.field),
  );
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const toRow = (row: Record<string, unknown>): PageFieldVisibilityRow => ({
  resource: asText(row.resource),
  field: asText(row.field),
  visible: row.visible !== false,
  writable: row.writable !== false,
});

async function rowsFor(
  database: DatabaseManager,
  permissionSetKey: string,
  pageKey: string,
): Promise<PageFieldVisibilityRow[]> {
  // Read the entry aliases too: rows saved before the list/detail entries
  // were merged still have to apply to the shared page.
  const batches = await Promise.all(
    pageKeyVariants(pageKey).map((variant) =>
      database.repository('appPageFieldVisibilities').findMany({
        filter: (filter) =>
          filter.and([
            filter.string('permissionSetKey').eq(permissionSetKey),
            filter.string('pageKey').eq(variant),
          ]),
        limit: 500,
        sort: (sort) => [
          sort.field('resource').asc(),
          sort.field('field').asc(),
        ],
      }),
    ),
  );
  return mergeRowsByField(
    batches
      .flat()
      .map((row) => toRow(row))
      .filter((row) => row.resource && row.field),
  );
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
 * any set shows it and writable when any set allows writing; visibility is a
 * presentation union, not an intersection. Each set resolves its own
 * inherit/override chain before the union.
 */
export function mergePageFieldVisibility(
  rows: readonly PageFieldVisibilityRow[],
  configured = rows.length > 0,
): {
  configured: boolean;
  visible: string[];
  writable: string[];
  fields: PageFieldVisibilityRow[];
} {
  const merged = new Map<string, PageFieldVisibilityRow>();
  for (const row of rows) {
    const key = `${row.resource}.${row.field}`;
    const current = merged.get(key);
    merged.set(
      key,
      current
        ? {
            ...current,
            visible: current.visible || row.visible,
            writable: current.writable || row.writable,
          }
        : { ...row },
    );
  }
  const fields = [...merged.values()];
  return {
    configured,
    visible: fields
      .filter((row) => row.visible)
      .map((row) => `${row.resource}.${row.field}`),
    writable: fields
      .filter((row) => row.visible && row.writable)
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
  writable: string[];
  fields: PageFieldVisibilityRow[];
}> {
  const userId = principal.type === 'user' ? principal.id : undefined;
  if (!userId) {
    return { configured: false, visible: [], writable: [], fields: [] };
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
    return { configured: false, visible: [], writable: [], fields: [] };

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

/**
 * The page a first-appearing page copies its initial settings from: edit,
 * detail and material-line pages start from the create page's settings, and
 * pages created under the create page follow it as well. Mirrors
 * `pageFieldVisibilityInheritedFrom` in
 * client/pages/settings/page-field-visibility-fallback.ts — keep in sync.
 */
export function pageFieldVisibilityFallbackFor(
  pageKey: string,
): string | undefined {
  let current = pageKey;
  const steps = [
    (key: string) => key.replace(/-detail-edit$/u, '-new'),
    (key: string) => key.replace(/-list-edit$/u, '-new'),
    (key: string) => key.replace(/-edit$/u, '-new'),
    (key: string) => key.replace(/-detail$/u, '-new'),
    (key: string) => key.replace(/-materials$/u, ''),
    (key: string) =>
      key.includes('-new-') ? key.replace(/-new-.+$/u, '-new') : key,
  ];
  // A suffix can hide behind another one ('-list-edit-materials' strips to
  // '-list-edit' first), so repeat the steps until nothing changes.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const step of steps) {
      const next = step(current);
      if (next !== current) {
        current = next;
        changed = true;
        if (current.endsWith('-new')) return current;
      }
    }
    if (!changed) break;
  }
  return current === pageKey ? undefined : current;
}

/**
 * Field policies a request made from one page must respect. A configured page
 * overlays its own rows onto the account's resource-level policies: hidden
 * stays hidden, readonly stays readonly, editable stays editable. Fields the
 * page does not list keep the resource-level value, and an unconfigured page
 * is exactly the resource-level policy (the legacy behavior). Pages without
 * their own rows start from their create page's rows so enforcement matches
 * what the editor shows as their initial values.
 *
 * Unrestricted principals (no user id, root set) return [] — no restrictions —
 * exactly like `fieldPoliciesFor`.
 */
export async function pageFieldPoliciesFor(
  database: DatabaseManager,
  principal: { type?: string; id?: string },
  pageKey: string,
  fallbackPageKey?: string,
): Promise<FieldPolicyView[]> {
  if (principal.type !== 'user' || !principal.id) return [];
  const key = canonicalPageKey(pageKey);
  const base = await fieldPoliciesFor(database, principal);
  const effective = await effectivePageFieldVisibility(
    database,
    principal,
    key,
    fallbackPageKey
      ? canonicalPageKey(fallbackPageKey)
      : pageFieldVisibilityFallbackFor(key),
  );
  if (!effective.configured) return base;
  const merged = new Map<string, FieldPolicyView>();
  for (const policy of base) {
    merged.set(`${policy.resource}.${policy.field}`, policy);
  }
  for (const row of effective.fields) {
    const access: FieldAccess = !row.visible
      ? 'hidden'
      : row.writable
        ? 'write'
        : 'visible';
    merged.set(`${row.resource}.${row.field}`, {
      resource: row.resource,
      field: row.field,
      access,
    });
  }
  return [...merged.values()];
}

/**
 * The pageKey a request is enforced under. Some endpoints serve more than one
 * page variant (a PATCH can come from the list edit form and the detail edit
 * form, each with its own page permissions). The client sends the page it is
 * on in the `x-page-key` header; the value is only honored when it names one
 * of the pages this endpoint serves, so a caller cannot claim an arbitrary
 * page to lift a restriction.
 */
export function pageKeyForRequest(
  c: { req: { header: (name: string) => string | undefined } },
  fallback: string,
  ...alternatives: string[]
): string {
  const claimed = c.req.header('x-page-key');
  const allowed = [fallback, ...alternatives].map(canonicalPageKey);
  if (claimed && allowed.includes(canonicalPageKey(claimed))) {
    return canonicalPageKey(claimed);
  }
  return canonicalPageKey(fallback);
}

/**
 * Re-derive the resource-level field policies of one permission set as the
 * union of its page rows, keeping the legacy `appFieldPolicies` layer
 * coherent for consumers that still read it (the `/field-policies/effective`
 * endpoint and legacy clients):
 *   writable on any page  -> write
 *   visible on any page   -> visible
 *   hidden on every page  -> no policy
 * The set's model is preserved: a ladder set keeps `$default.model` (absent
 * policy means hidden), while a legacy set keeps its `$default.legacy` marker
 * (absent policy keeps the field available), so saving one page does not
 * silently hide fields on every page that has no rows yet.
 */
export async function rebuildFieldPoliciesFromPages(
  database: DatabaseManager,
  permissionSetKey: string,
  userId: string,
): Promise<void> {
  const rows = await database.repository('appPageFieldVisibilities').findMany({
    filter: (filter) =>
      filter.string('permissionSetKey').eq(permissionSetKey),
    limit: 5000,
  });
  const merged = new Map<
    string,
    { resource: string; field: string; access: FieldAccess }
  >();
  for (const row of rows) {
    const resource = asText(row.resource);
    const field = asText(row.field);
    if (!resource || !field) continue;
    const visible = row.visible !== false;
    if (!visible) continue;
    const writable = row.writable !== false;
    const key = `${resource}.${field}`;
    const current = merged.get(key);
    const access: FieldAccess = writable ? 'write' : 'visible';
    if (!current || access === 'write') {
      merged.set(key, { resource, field, access });
    }
  }
  const policies = [...merged.values()];
  const existing = await database.repository('appFieldPolicies').findMany({
    filter: (filter) =>
      filter.string('permissionSetKey').eq(permissionSetKey),
    limit: 5000,
  });
  const ladderModel = existing.some(
    (row) =>
      asText(row.resource) === '$default' && asText(row.field) === 'model',
  );
  const items = [
    ...policies,
    ladderModel
      ? ({ resource: '$default', field: 'model', access: 'visible' } as const)
      : ({ resource: '$default', field: 'legacy', access: 'visible' } as const),
  ];
  const nextKeys = new Set(
    items.map((item) => `${item.resource}.${item.field}`),
  );
  for (const row of existing) {
    const key = `${asText(row.resource)}.${asText(row.field)}`;
    if (!nextKeys.has(key)) {
      await database
        .repository('appFieldPolicies')
        .deleteOne({ filter: { id: asText(row.id) } });
    }
  }
  for (const item of items) {
    const current = existing.find(
      (row) =>
        asText(row.resource) === item.resource &&
        asText(row.field) === item.field,
    );
    if (current && current.access === item.access) continue;
    if (current) {
      await database.repository('appFieldPolicies').updateOne({
        filter: { id: asText(current.id) },
        values: {
          access: item.access,
          version: Number(current.version ?? 1) + 1,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
    } else {
      await database.repository('appFieldPolicies').createOne({
        values: {
          id: randomUUID(),
          permissionSetKey,
          settingsId: null,
          resource: item.resource,
          field: item.field,
          access: item.access,
          version: 1,
          createdBy: userId,
          updatedBy: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  }
}
