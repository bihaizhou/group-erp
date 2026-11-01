import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { inventoryError as fail, stockMicros } from './inventory-quantity.js';
import { executionText as text } from './execution-access.js';

/** Called with the real demand header locked, after edits but before commit. */
export async function guardDemandExecution(
  c: DatabaseConnection,
  kind: 'issue' | 'purchase',
  id: string,
  previous: RepositoryRecord[],
) {
  const table =
      kind === 'issue' ? 'materialIssueRequestLines' : 'purchaseRequestLines',
    current = await c
      .repository(table)
      .findMany({ filter: { requestId: id, status: 'active' }, limit: 101 });
  for (const old of previous) {
    let committed: bigint;
    if (kind === 'issue') {
      const fulfillment = await c
        .repository('stockIssueFulfillments')
        .findOne({ filter: { id: text(old.id) } });
      committed = fulfillment
        ? stockMicros(text(fulfillment.issuedQuantity))
        : 0n;
      const reservations = await c.repository('stockReservations').findMany({
        filter: { issueRequestLineId: text(old.id) },
        limit: 1001,
      });
      if (reservations.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
      committed += reservations.reduce(
        (sum, row) => sum + stockMicros(text(row.remainingQuantity)),
        0n,
      );
    } else {
      const allocations = await c.repository('purchaseAllocations').findMany({
        filter: { requestLineId: text(old.id), status: 'active' },
        limit: 10001,
      });
      if (allocations.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
      committed = allocations.reduce(
        (sum, row) => sum + stockMicros(text(row.baseQuantity)),
        0n,
      );
    }
    if (!committed) continue;
    const next = current.find((row) => row.id === old.id);
    if (
      !next ||
      [
        'skuId',
        'baseUnitId',
        'unitId',
        'unitRuleId',
        'numeratorSnapshot',
        'denominatorSnapshot',
      ].some((key) => (old[key] ?? null) !== (next[key] ?? null))
    )
      return fail(
        'STOCK_EXECUTED_LINE_FROZEN',
        `lines.${text(old.id)}.selection`,
      );
    if (stockMicros(text(next.baseQuantity)) < committed)
      return fail(
        'STOCK_QUANTITY_BELOW_FULFILLED',
        `lines.${text(old.id)}.quantity`,
      );
  }
}
export async function guardIssueReservations(
  c: DatabaseConnection,
  id: string,
) {
  const reservations = await c
    .repository('stockReservations')
    .findMany({ filter: { issueRequestId: id }, limit: 1001 });
  if (reservations.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
  if (reservations.some((row) => stockMicros(text(row.remainingQuantity)) > 0n))
    return fail('STOCK_RESERVATIONS_ACTIVE');
}
