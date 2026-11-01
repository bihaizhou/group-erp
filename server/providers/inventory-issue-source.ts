import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { insertStockRowIfMissing, lockStockRow } from './inventory-db.js';
import { inventoryError as fail, stockMicros } from './inventory-quantity.js';
import { randomUUID } from 'node:crypto';
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Acquire after sorted warehouse gates and before balance locks in every caller. */
export async function lockIssueFulfillment(
  c: DatabaseConnection,
  lineId: string,
): Promise<RepositoryRecord> {
  const line = await c.repository('materialIssueRequestLines').findOne({
    filter: { id: lineId },
  });
  if (!line || !line.skuId || !line.baseUnitId)
    return fail('STOCK_SOURCE_UNAVAILABLE');
  await insertStockRowIfMissing(c, 'stockIssueFulfillments', {
    id: line.id,
    issueRequestId: line.requestId,
    subjectId: line.subjectId,
    skuId: line.skuId,
    baseUnitId: line.baseUnitId,
    issuedQuantity: '0',
    returnedQuantity: '0',
    receivedQuantity: '0',
    revision: 1,
    nonce: randomUUID(),
  });
  return lockStockRow(c, 'stockIssueFulfillments', lineId);
}

/** Never substitute a current unreviewed line for the actual approved snapshot. */
export async function approvedIssueLine(
  c: DatabaseConnection,
  requestId: string,
  lineId: string,
  subjectId: string,
) {
  const head = await c.repository('materialIssueRequests').findOne({
    filter: { id: requestId, subjectId },
  });
  if (!head || head.status !== 'approved' || !head.approvedVersionId)
    return fail('STOCK_SOURCE_UNAVAILABLE');
  const version = await c.repository('supplyChainRequestVersions').findOne({
    filter: {
      id: text(head.approvedVersionId),
      kind: 'materialIssueRequest',
      issueRequestId: requestId,
      subjectId,
      contentVersion: Number(head.contentVersion),
    },
  });
  const payload = version?.payload as
      { lines?: RepositoryRecord[] } | undefined,
    frozen = payload?.lines?.find((line) => line.id === lineId),
    line = await c.repository('materialIssueRequestLines').findOne({
      filter: { id: lineId, requestId, subjectId, status: 'active' },
    });
  if (
    !line ||
    !frozen ||
    line.identificationStatus !== 'identified' ||
    [
      'skuId',
      'baseUnitId',
      'unitId',
      'unitRuleId',
      'baseQuantity',
      'requestedQuantity',
    ].some((field) => (line[field] ?? null) !== (frozen[field] ?? null)) ||
    stockMicros(text(frozen.baseQuantity)) <= 0n
  )
    return fail('STOCK_SOURCE_CHANGED');
  return { head, line, frozen };
}

/** Recompute the responsibility state from immutable issue/return facts. */
export async function refreshIssueFulfillment(
  c: DatabaseConnection,
  requestId: string,
) {
  const head = await c.repository('materialIssueRequests').findOne({
    filter: { id: requestId },
  });
  if (!head) return;
  const lines = await c.repository('materialIssueRequestLines').findMany({
      filter: { requestId, status: 'active' },
      limit: 10001,
    }),
    fulfillments = await c
      .repository('stockIssueFulfillments')
      .findMany({ filter: { issueRequestId: requestId }, limit: 10001 }),
    byLine = new Map(fulfillments.map((row) => [text(row.id), row]));
  let issuedTotal = 0n,
    allIssued = lines.length > 0,
    allReceived = lines.length > 0;
  for (const line of lines) {
    const requested = stockMicros(text(line.baseQuantity)),
      fulfillment = byLine.get(text(line.id)),
      issued = stockMicros(text(fulfillment?.issuedQuantity ?? '0')),
      received = stockMicros(text(fulfillment?.receivedQuantity ?? '0'));
    issuedTotal += issued;
    if (issued < requested) allIssued = false;
    if (received < issued) allReceived = false;
  }
  const status =
    issuedTotal === 0n
      ? 'open'
      : allIssued && allReceived
        ? 'received'
        : allIssued
          ? 'issued'
          : 'partial';
  const values: RepositoryRecord = { fulfillmentStatus: status };
  if (status !== 'open' && !head.issuedAt) {
    values.issuedAt = new Date();
    values.issuedBy = head.updatedBy ?? null;
  }
  if (status === 'received' && !head.receivedAt) {
    values.receivedAt = new Date();
    values.receivedBy = head.updatedBy ?? null;
  }
  await c
    .repository('materialIssueRequests')
    .updateOne({ filter: { id: requestId }, values });
}
