import { ApiError } from '@nocobase/app-server/router';
import type { DatabaseManager } from '@nocobase/db';

export type FieldAccess = 'hidden' | 'readonly' | 'write';

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
  readonly: 1,
  write: 2,
};

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const isAccess = (value: unknown): value is FieldAccess =>
  value === 'hidden' || value === 'readonly' || value === 'write';

/**
 * Effective field access for one account: every policy that belongs to one of
 * its permission sets, merged most-permissive-wins. Fields without a policy
 * stay writable, so pages that never opt in behave exactly as before.
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
  if (!sets.size) return [];
  const policies = await database.repository('appFieldPolicies').findMany({
    filter: (filter) =>
      filter.or(
        [...sets].map((key) => filter.string('permissionSetKey').eq(key)),
      ),
    limit: 2000,
  });
  const merged = new Map<string, FieldPolicyView>();
  for (const row of policies) {
    const access = row.access;
    if (!isAccess(access)) continue;
    const resource = asText(row.resource);
    const field = asText(row.field);
    if (!resource || !field) continue;
    const key = `${resource}.${field}`;
    const current = merged.get(key);
    if (!current || precedence[access] > precedence[current.access]) {
      merged.set(key, { resource, field, access });
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
