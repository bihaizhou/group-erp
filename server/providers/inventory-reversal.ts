import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { StockEntry } from './inventory-service.js';
import { executionText as text } from './execution-access.js';
import {
  inventoryError as fail,
  stockDelta,
  stockDeltaMicros,
  stockMicros,
  stockQuantity,
} from './inventory-quantity.js';
import { lockDemandHeader, lockStockRow } from './inventory-db.js';
import {
  lockIssueFulfillment,
  approvedIssueLine,
} from './inventory-issue-source.js';
import { approvedTradeLine } from './inventory-trade-source.js';

interface Restoration {
  original: RepositoryRecord;
  reservation: RepositoryRecord;
  lineId: string;
  active: boolean;
}
export interface StockReversalPlan {
  originalPostingId: string;
  restorations: Restoration[];
}
const key = (
  lineId: string,
  entry: {
    warehouseId?: unknown;
    transferId?: unknown;
    quality: unknown;
    deltaQuantity: unknown;
  },
) =>
  JSON.stringify([
    lineId,
    text(entry.warehouseId),
    text(entry.transferId),
    entry.quality,
    stockDelta(stockDeltaMicros(text(entry.deltaQuantity))),
  ]);
export async function prepareStockReversal(
  c: DatabaseConnection,
  head: RepositoryRecord,
  lines: RepositoryRecord[],
  entries: StockEntry[],
): Promise<StockReversalPlan | null> {
  if (head.kind !== 'reversal') return null;
  const posting = await c.repository('stockPostings').findOne({
      filter: {
        id: text(head.originalPostingId),
        documentId: text(head.originalDocumentId),
        subjectId: text(head.subjectId),
      },
    }),
    original = await c.repository('stockDocuments').findOne({
      filter: {
        id: text(head.originalDocumentId),
        subjectId: text(head.subjectId),
        status: 'posted',
      },
    });
  if (!posting || !original || original.kind === 'reversal')
    return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
  if (
    await c
      .repository('stockPostings')
      .exists({ filter: { reversesPostingId: text(posting.id) } })
  )
    return fail('STOCK_ALREADY_REVERSED');
  const movements = await c
      .repository('stockMovements')
      .findMany({ filter: { postingId: text(posting.id) }, limit: 201 }),
    originalLines = await c.repository('stockDocumentLines').findMany({
      filter: { documentId: text(original.id), status: 'active' },
      limit: 101,
    }),
    mapped = new Map<string, RepositoryRecord>();
  if (
    movements.length > 200 ||
    originalLines.length > 100 ||
    originalLines.length !== lines.length
  )
    return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
  for (const line of lines) {
    const prior = originalLines.find((row) => row.id === line.originalLineId);
    if (
      !prior ||
      line.originalDocumentId !== original.id ||
      mapped.has(text(prior.id)) ||
      [
        'skuId',
        'baseUnitId',
        'baseQuantity',
        'unitId',
        'unitRuleId',
        'quantity',
        'numeratorSnapshot',
        'denominatorSnapshot',
      ].some((field) => (line[field] ?? null) !== (prior[field] ?? null))
    )
      return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
    mapped.set(text(prior.id), line);
  }
  const expected = movements
      .map((row) =>
        key(text(mapped.get(text(row.documentLineId))?.id), {
          ...row,
          quality: row.quality,
          deltaQuantity: stockDelta(-stockDeltaMicros(text(row.deltaQuantity))),
        }),
      )
      .sort(),
    actual = entries.map((entry) => key(entry.lineId, entry)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
  const consumed = await c.repository('stockReservationConsumptions').findMany({
    filter: { postingId: text(posting.id), kind: 'consume' },
    limit: 10001,
  });
  if (consumed.length > 10000) return fail('STOCK_RESERVATION_LIMIT');
  const owners = new Map<string, RepositoryRecord>(),
    reservations = new Map<string, RepositoryRecord>();
  for (const row of consumed) {
    const reservation = await c.repository('stockReservations').findOne({
      filter: {
        id: text(row.reservationId),
        subjectId: text(head.subjectId),
        balanceId: text(row.balanceId),
      },
    });
    if (!reservation) return fail('STOCK_REVERSE_DEPENDENCIES');
    reservations.set(text(reservation.id), reservation);
    owners.set(
      `${text(reservation.sourceKind)}:${text(reservation.issueRequestId ?? reservation.salesOrderId)}:${text(reservation.issueRequestLineId ?? reservation.salesOrderLineId)}`,
      reservation,
    );
  }
  const active = new Map<string, boolean>();
  for (const [owner, reservation] of [...owners].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (reservation.sourceKind === 'issue') {
      await lockDemandHeader(
        c,
        'materialIssueRequests',
        text(reservation.issueRequestId),
      );
      await lockIssueFulfillment(c, text(reservation.issueRequestLineId));
      const parent = await c.repository('materialIssueRequests').findOne({
        filter: {
          id: text(reservation.issueRequestId),
          subjectId: text(head.subjectId),
        },
      });
      if (parent?.status === 'approved') {
        const source = await approvedIssueLine(
          c,
          text(parent.id),
          text(reservation.issueRequestLineId),
          text(head.subjectId),
        );
        active.set(owner, source.line.skuId === reservation.skuId);
      } else active.set(owner, false);
    } else if (reservation.sourceKind === 'sales') {
      await c.repository('salesOrders').updateOne({
        filter: { id: text(reservation.salesOrderId) },
        values: { nonce: randomUUID() },
      });
      await lockStockRow(
        c,
        'salesOrderLines',
        text(reservation.salesOrderLineId),
      );
      const parent = await c.repository('salesOrders').findOne({
        filter: {
          id: text(reservation.salesOrderId),
          subjectId: text(head.subjectId),
        },
      });
      if (parent?.status === 'approved') {
        const source = await approvedTradeLine(
          c,
          'salesOrders',
          text(parent.id),
          text(reservation.salesOrderLineId),
          text(head.subjectId),
        );
        active.set(owner, source.line.skuId === reservation.skuId);
      } else active.set(owner, false);
    } else return fail('STOCK_RESERVATION_INVALID');
  }
  return {
    originalPostingId: text(posting.id),
    restorations: consumed.map((original) => {
      const reservation = reservations.get(text(original.reservationId))!;
      const owner = `${text(reservation.sourceKind)}:${text(reservation.issueRequestId ?? reservation.salesOrderId)}:${text(reservation.issueRequestLineId ?? reservation.salesOrderLineId)}`;
      return {
        original,
        reservation,
        lineId: text(mapped.get(text(original.documentLineId))?.id),
        active: active.get(owner) ?? false,
      };
    }),
  };
}
export async function restoreStockReservations(
  c: DatabaseConnection,
  plan: StockReversalPlan | null,
  balances: Map<string, RepositoryRecord>,
  changes: Map<string, { delta: bigint; consumed: bigint }>,
) {
  const restored: RepositoryRecord[] = [];
  if (!plan) return restored;
  for (const item of plan.restorations) {
    const row = await c
        .repository('stockReservations')
        .findOne({ filter: { id: text(item.original.reservationId) } }),
      quantity = stockMicros(text(item.original.quantity)),
      balanceEntry = [...balances].find(
        ([, balance]) => balance.id === item.original.balanceId,
      );
    if (
      !row ||
      !balanceEntry ||
      !item.lineId ||
      row.subjectId !== item.original.subjectId ||
      stockMicros(text(row.consumedQuantity)) < quantity
    )
      return fail('STOCK_REVERSE_DEPENDENCIES');
    const [dimensionKey] = balanceEntry,
      change = changes.get(dimensionKey);
    if (!change || change.delta < quantity)
      return fail('STOCK_REVERSE_DEPENDENCIES');
    const values = {
      consumedQuantity: stockQuantity(
        stockMicros(text(row.consumedQuantity)) - quantity,
      ),
      remainingQuantity: stockQuantity(
        stockMicros(text(row.remainingQuantity)) +
          (item.active ? quantity : 0n),
      ),
      releasedQuantity: stockQuantity(
        stockMicros(text(row.releasedQuantity)) + (item.active ? 0n : quantity),
      ),
      revision: Number(row.revision) + 1,
      updatedAt: new Date(),
    };
    await c.repository('stockReservations').updateOne({
      filter: { id: text(row.id), revision: Number(row.revision) },
      values,
    });
    if (item.active) change.consumed -= quantity;
    restored.push({
      id: randomUUID(),
      documentLineId: item.lineId,
      reservationId: row.id,
      balanceId: row.balanceId,
      subjectId: row.subjectId,
      quantity: stockQuantity(quantity),
      kind: 'restore',
      originalConsumptionId: item.original.id,
      restoredActive: item.active,
    });
  }
  return restored;
}
