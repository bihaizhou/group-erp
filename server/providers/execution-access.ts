import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { MaterialPolicies } from './material-service.js';
import { inventoryError as fail } from './inventory-quantity.js';

export const executionJson = (
  value: unknown,
): import('@nocobase/lifecycle').JsonObject =>
  JSON.parse(JSON.stringify(value)) as import('@nocobase/lifecycle').JsonObject;
export const executionText = (value: unknown) =>
  typeof value === 'string' ? value : '';
export function executionRepo(
  c: DatabaseConnection,
  table: string,
  policies: MaterialPolicies,
) {
  const policy = policies[table];
  if (!policy || policy.read === false) return fail('STOCK_FORBIDDEN');
  return c.repository(table).withPolicy(policy);
}
export async function executionWrite(
  c: DatabaseConnection,
  table: string,
  values: RepositoryRecord,
  policies: MaterialPolicies,
  operation: 'create' | 'update',
  id?: string,
) {
  const policy = policies[table];
  if (!policy || !policy[operation] || policy.read === false)
    return fail('STOCK_FORBIDDEN');
  const repo = c.repository(table).withPolicy(policy),
    result = await repo.validateMutation(
      operation === 'create'
        ? { operation: 'createOne', values }
        : { operation: 'updateOne', filter: { id }, values },
    );
  if (!result.valid) return fail('STOCK_FORBIDDEN');
  const node = policy[operation];
  if (
    id &&
    node !== true &&
    !(await c
      .repository(table)
      .withPolicy({ ...policy, read: { scope: node.scope, fields: ['id'] } })
      .exists({ filter: { id } }))
  )
    return fail('STOCK_FORBIDDEN');
}
export async function executionCompany(
  c: DatabaseConnection,
  subjectId: string,
  policies: MaterialPolicies,
  active = true,
) {
  const company = await executionRepo(c, 'orgSubjects', policies).findOne({
    filter: { id: subjectId, ...(active ? { status: 'active' } : {}) },
  });
  if (!company) return fail('STOCK_COMPANY_UNAVAILABLE', 'subjectId');
  return company;
}
export async function executionActor(
  c: DatabaseConnection,
  users: UserAdministrationService,
  actorId: string,
) {
  const actor = await users.withConnection(c).get(actorId);
  if (!actor || actor.kind !== 'person' || actor.disabledAt)
    return fail('STOCK_FORBIDDEN');
  return actor;
}
