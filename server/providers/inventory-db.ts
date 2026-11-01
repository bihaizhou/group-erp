import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { inventoryError } from './inventory-quantity.js';

type StockLockTable =
  | 'warehouseStockGates'
  | 'stockBalances'
  | 'stockIssueFulfillments'
  | 'purchaseAllocationGates'
  | 'purchaseOrderLines'
  | 'salesOrderLines'
  | 'stockDocumentLines'
  | 'stockTransferLines';
function column(c: DatabaseConnection, table: string, field: string): string {
  const compiled = c.query.selectFrom(table).select(field).compile();
  const match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(
    compiled.sql,
  );
  if (
    !match ||
    compiled.parameters.length ||
    !/^(?:"[^"]+"|`[^`]+`)$/u.test(match[1])
  )
    throw new Error('Cannot resolve inventory conflict column');
  return match[1];
}
/**
 * QueryAdapter has no insert-ignore operation. Use its naming and compiled
 * parameterized INSERT, adding only the same PostgreSQL/SQLite conflict clause.
 * Updating an existing balance through upsertOne would overwrite its quantity.
 */
export async function insertStockRowIfMissing(
  c: DatabaseConnection,
  table: StockLockTable,
  values: RepositoryRecord,
  conflictFields: readonly string[] = ['id'],
): Promise<void> {
  if (!['postgres', 'sqlite'].includes(c.dialect))
    throw new Error('Unsupported inventory dialect');
  const insert = c.query.insertInto(table).values(values).compile();
  const target = conflictFields
    .map((field) => column(c, table, field))
    .join(',');
  const client = await c.client<{
    raw(sql: string, bindings: readonly unknown[]): Promise<unknown>;
  }>();
  await client.raw(
    `${insert.sql} ON CONFLICT (${target}) DO NOTHING`,
    insert.parameters,
  );
}
/** Same-transaction database row lock; never a process mutex or org global lock. */
export async function lockStockRow(
  c: DatabaseConnection,
  table: StockLockTable,
  id: string,
): Promise<RepositoryRecord> {
  await c
    .repository(table)
    .updateOne({ filter: { id }, values: { nonce: randomUUID() } });
  return (
    (await c.repository(table).findOne({ filter: { id } })) ??
    inventoryError('STOCK_NOT_FOUND')
  );
}
/** Query has no FOR UPDATE/reference SET; this binds the ID and changes no data. */
export async function lockDemandHeader(
  c: DatabaseConnection,
  table: 'materialIssueRequests' | 'purchaseRequests' | 'salesOrders',
  id: string,
): Promise<void> {
  const compiled = c.query.selectFrom(table).select('revision').compile(),
    match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(compiled.sql),
    valid = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
  if (
    !match ||
    compiled.parameters.length ||
    !valid.test(match[1]) ||
    !valid.test(match[2])
  )
    throw new Error('Cannot resolve demand lock identifiers');
  const client = await c.client<{
    raw(sql: string, values: readonly unknown[]): Promise<unknown>;
  }>();
  // Always acquire this before fulfillment rows, matching demand edits.
  await client.raw(
    `UPDATE ${match[2]} SET ${match[1]}=${match[1]} WHERE ${column(c, table, 'id')}=?`,
    [id],
  );
}
