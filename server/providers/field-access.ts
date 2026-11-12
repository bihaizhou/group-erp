import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseManager } from '@nocobase/db';
import { fieldCatalog, type FieldCatalogEntry } from './field-catalog.js';

/**
 * Grant ladder: hidden ⊂ visible ⊂ readonly ⊂ write. `visible` and
 * `readonly` are interchangeable for enforcement (both block writes and
 * both show the field); the ladder only exists so admins see a natural
 * checkbox cascade in the editor. `hidden` never leaves the server: the
 * absence of a policy means hidden under the new model.
 */
export type FieldAccess = 'hidden' | 'visible' | 'readonly' | 'write';

export interface FieldPolicyView {
  resource: string;
  field: string;
  access: FieldAccess;
}

export interface FieldAccessPrincipal {
  type?: string;
  id?: string;
}

const precedence: Record<FieldAccess, number> = {
  hidden: 0,
  visible: 1,
  readonly: 1,
  write: 2,
};

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const isAccess = (value: unknown): value is FieldAccess =>
  value === 'hidden' ||
  value === 'visible' ||
  value === 'readonly' ||
  value === 'write';

/**
 * Model markers. Every permission set starts out legacy: an absent policy
 * means writable (default allow). The first explicit save of field policies
 * writes a `$default.model` marker row, switching the set to the ladder model
 * where an absent policy means hidden (deny by default). The `$default.legacy`
 * row is written by the migration for pre-existing sets and only pins the
 * editor's initial display; it is removed by the first explicit save.
 */
const SENTINEL_RESOURCE = '$default';
const MODEL_FIELD = 'model';

const catalogCache = new WeakMap<
  DatabaseManager,
  Promise<FieldCatalogEntry[]>
>();
const catalogFor = (
  database: DatabaseManager,
): Promise<FieldCatalogEntry[]> => {
  let cached = catalogCache.get(database);
  if (!cached) {
    cached = fieldCatalog(database);
    catalogCache.set(database, cached);
  }
  return cached;
};

/**
 * Effective field access for one account: every policy that belongs to one of
 * its permission sets, merged most-permissive-wins. Fields without a policy
 * stay writable (default allow) unless at least one of the account's sets has
 * switched to the ladder model, in which case every catalog field without a
 * policy becomes hidden (deny by default).
 */
export async function fieldPoliciesFor(
  database: DatabaseManager,
  principal: FieldAccessPrincipal,
): Promise<FieldPolicyView[]> {
  if (principal.type !== 'user' || !principal.id) return [];
  const userId = principal.id;
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
  if (!sets.size || sets.has('root')) return [];
  const policies = await database.repository('appFieldPolicies').findMany({
    filter: (filter) =>
      filter.or(
        [...sets].map((key) => filter.string('permissionSetKey').eq(key)),
      ),
    limit: 2000,
  });
  let ladderModel = false;
  const merged = new Map<string, FieldPolicyView>();
  for (const row of policies) {
    const access = row.access;
    if (!isAccess(access)) continue;
    const resource = asText(row.resource);
    const field = asText(row.field);
    if (!resource || !field) continue;
    if (resource === SENTINEL_RESOURCE) {
      if (field === MODEL_FIELD) {
        ladderModel = true;
      }
      continue;
    }
    const key = `${resource}.${field}`;
    const current = merged.get(key);
    if (!current || precedence[access] > precedence[current.access]) {
      merged.set(key, { resource, field, access });
    }
  }
  if (!ladderModel) return [...merged.values()];
  // Ladder model: every catalog field is hidden unless explicitly granted.
  const catalog = await catalogFor(database);
  for (const entry of catalog) {
    for (const item of entry.fields) {
      const key = `${entry.resource}.${item.field}`;
      if (!merged.has(key)) {
        merged.set(key, {
          resource: entry.resource,
          field: item.field,
          access: 'hidden',
        });
      }
    }
  }
  return [...merged.values()];
}

export function accessFor(
  policies: readonly FieldPolicyView[],
  resource: string,
  field: string,
): FieldAccess {
  const found = policies.find(
    (policy) => policy.resource === resource && policy.field === field,
  );
  return found?.access ?? 'write';
}

/**
 * Drop hidden fields from rows before they leave the server. Callers pass the
 * resource id the rows belong to; other policies (readonly/write) do not
 * change a read response.
 */
export function redactRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  policies: readonly FieldPolicyView[],
  resource: string,
): T[] {
  const hidden = new Set(
    policies
      .filter((policy) => policy.resource === resource)
      .filter((policy) => policy.access === 'hidden')
      .map((policy) => policy.field),
  );
  if (!hidden.size) return [...rows];
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of hidden) delete copy[field];
    return copy;
  });
}

/** Same rule for a single record; returns the record unchanged when visible. */
export function redactRecord<T extends Record<string, unknown>>(
  row: T,
  policies: readonly FieldPolicyView[],
  resource: string,
): T {
  return redactRows([row], policies, resource)[0];
}

/**
 * Reject writes to fields the caller may not change. Routes call this with the
 * fields actually present in a patch so an update cannot smuggle a read-only
 * column past the UI.
 */
export function assertFieldsWritable(
  policies: readonly FieldPolicyView[],
  resource: string,
  fields: Iterable<string>,
): void {
  for (const field of fields) {
    if (accessFor(policies, resource, field) === 'write') continue;
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      domain: 'authorization',
      reason: 'FIELD_NOT_WRITABLE',
      message: `Field ${field} is not writable for this account`,
    });
  }
}
