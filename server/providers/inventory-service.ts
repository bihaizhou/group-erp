import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import {
  insertStockRowIfMissing,
  lockStockRow,
  lockDemandHeader,
} from './inventory-db.js';
import { InventoryReservations } from './inventory-reservations.js';
import { approvedTradeLine } from './inventory-trade-source.js';
import {
  prepareStockReversal,
  restoreStockReservations,
} from './inventory-reversal.js';
import {
  approvedIssueLine,
  lockIssueFulfillment,
  refreshIssueFulfillment,
} from './inventory-issue-source.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
  stockDelta,
  stockDeltaMicros,
  stockPrecision,
} from './inventory-quantity.js';

const id = z.string().uuid();
const inputSchema = z.strictObject({
  documentId: id,
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(0),
  actorId: z.string().min(1).max(200),
  requestKey: id,
  reason: z.string().trim().min(1).max(3000),
});
type PostingInput = z.infer<typeof inputSchema>;
export type StockEntry = {
  readonly lineId: string;
  readonly quality: 'qualified' | 'inspection' | 'frozen';
  readonly deltaQuantity: string;
} & (
  | { readonly warehouseId: string; readonly transferId?: never }
  | { readonly warehouseId?: never; readonly transferId: string }
);
export interface StockPostingResult {
  postingId: string;
  documentId: string;
  replayed: boolean;
}
/**
 * Business services supply real authorization/source validation and the official
 * lifecycle/audit effect. All callbacks use this exact transaction connection.
 * This port is internal: HTTP callers can never submit arbitrary ledger entries.
 */
export interface StockPostingPort {
  readonly postableStates?: readonly ('draft' | 'approved')[];
  authorize(
    c: DatabaseConnection,
    document: RepositoryRecord,
    lines: RepositoryRecord[],
    replay: boolean,
  ): Promise<void>;
  warehouseIds?(
    c: DatabaseConnection,
    document: RepositoryRecord,
  ): Promise<string[]>;
  prepare(
    c: DatabaseConnection,
    document: RepositoryRecord,
    lines: RepositoryRecord[],
  ): Promise<StockEntry[]>;
  posted(
    c: DatabaseConnection,
    document: RepositoryRecord,
    result: StockPostingResult,
  ): Promise<void>;
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');
export const stockDimensionKey = (
  subjectId: string,
  warehouseId: string,
  skuId: string,
  quality: string,
) => `${subjectId}:warehouse:${warehouseId}:${skuId}:${quality}`;
export const stockEntryDimensionKey = (
  subjectId: string,
  skuId: string,
  entry: StockEntry,
) =>
  entry.transferId
    ? `${subjectId}:transit:${entry.transferId}:${skuId}:${entry.quality}`
    : stockDimensionKey(subjectId, entry.warehouseId!, skuId, entry.quality);
export class InventoryService {
  readonly reservations: InventoryReservations;
  constructor(private readonly db: DatabaseManager) {
    this.reservations = new InventoryReservations(db, this);
  }
  post(
    input: PostingInput,
    port: StockPostingPort,
  ): Promise<StockPostingResult> {
    return this.db.transaction((c) => this.postInTransaction(c, input, port));
  }
  async lockWarehouses(
    c: DatabaseConnection,
    subjectId: string,
    warehouseIds: readonly string[],
    countId?: string,
  ): Promise<void> {
    for (const warehouseId of [...new Set(warehouseIds)].sort()) {
      // Insert-ignore plus a row update protects first initialization and later
      // quantity work across actual DB connections, including different workers.
      await insertStockRowIfMissing(c, 'warehouseStockGates', {
        id: warehouseId,
        subjectId,
        nonce: randomUUID(),
      });
      const gate = await lockStockRow(c, 'warehouseStockGates', warehouseId);
      if (gate.countId && gate.countId !== countId)
        return fail('STOCK_COUNT_FROZEN');
      if (
        gate.subjectId !== subjectId ||
        !(await c
          .repository('warehouses')
          .exists({ filter: { id: warehouseId, subjectId, status: 'active' } }))
      )
        return fail('STOCK_WAREHOUSE_UNAVAILABLE', 'warehouseId');
    }
  }
  private async current(c: DatabaseConnection, documentId: string) {
    const document = await c
      .repository('stockDocuments')
      .findOne({ filter: { id: documentId } });
    if (!document) return fail('STOCK_NOT_FOUND');
    const lines = await c.repository('stockDocumentLines').findMany({
      filter: { documentId, status: 'active' },
      sort: (s) => [s.field('lineNo').asc()],
      limit: 101,
    });
    if (!lines.length || lines.length > 100)
      return fail('STOCK_LINES_INVALID', 'lines');
    return { document, lines };
  }
  async postInTransaction(
    c: DatabaseConnection,
    raw: PostingInput,
    port: StockPostingPort,
  ): Promise<StockPostingResult> {
    const input = inputSchema.parse(raw),
      fingerprint = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
    let current = await this.current(c, input.documentId);
    await port.authorize(
      c,
      current.document,
      current.lines,
      !!(await c
        .repository('stockPostings')
        .exists({ filter: { documentId: input.documentId } })),
    );
    const warehouses = (await port.warehouseIds?.(c, current.document)) ?? [
      text(current.document.warehouseId),
    ];
    if (
      !warehouses.length ||
      warehouses.length > 2 ||
      !warehouses.includes(text(current.document.warehouseId))
    )
      return fail('STOCK_WAREHOUSE_UNAVAILABLE');
    await this.lockWarehouses(
      c,
      text(current.document.subjectId),
      warehouses,
      current.document.kind === 'countAdjustment'
        ? text(current.document.countId)
        : undefined,
    );
    await c.repository('stockDocuments').updateOne({
      filter: { id: input.documentId },
      values: { nonce: randomUUID() },
    });
    current = await this.current(c, input.documentId);
    const prior = await c
      .repository('stockPostings')
      .findOne({ filter: { documentId: input.documentId } });
    await port.authorize(c, current.document, current.lines, !!prior);
    const request = await c.repository('stockActionRequests').findOne({
      filter: { actorId: input.actorId, requestKey: input.requestKey },
    });
    if (
      request &&
      (request.fingerprint !== fingerprint ||
        request.documentId !== input.documentId ||
        request.action !== 'post')
    )
      return fail('STOCK_REQUEST_KEY_REUSED');
    if (prior) {
      if (request && request.postingId !== prior.id)
        return fail('STOCK_REQUEST_KEY_REUSED');
      if (!request) await this.remember(c, input, fingerprint, text(prior.id));
      return {
        postingId: text(prior.id),
        documentId: input.documentId,
        replayed: true,
      };
    }
    const { document, lines } = current;
    if (
      document.revision !== input.version ||
      document.lifecycleVersion !== input.lifecycleVersion
    )
      return fail('STOCK_VERSION_CONFLICT');
    if (
      !(port.postableStates ?? ['approved']).includes(
        text(document.status) as 'draft' | 'approved',
      )
    )
      return fail('STOCK_NOT_APPROVED');
    const entries = await port.prepare(c, document, lines);
    if (entries.length > 200) return fail('STOCK_LINES_INVALID');
    const modes = new Map<string, string>();
    for (const line of lines) {
      const sku = await c
          .repository('materialSkus')
          .findOne({ filter: { id: text(line.skuId) } }),
        unit = await c
          .repository('measureUnits')
          .findOne({ filter: { id: text(line.baseUnitId) } });
      if (
        !sku ||
        !unit ||
        sku.status !== 'active' ||
        unit.status !== 'active' ||
        sku.baseUnitId !== line.baseUnitId ||
        stockMicros(text(line.baseQuantity)) <= 0n
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      const admission = await c.repository('materialSubjectSettings').findOne({
        filter: {
          skuId: text(line.skuId),
          subjectId: text(document.subjectId),
          status: 'active',
        },
      });
      if (
        !admission ||
        (document.kind === 'purchaseReceipt' && !admission.canPurchase) ||
        (document.kind === 'salesShipment' && !admission.canSell)
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      if (
        sku.managementMode !== 'stock' &&
        (!['purchaseReceipt', 'purchaseReturn', 'reversal'].includes(
          text(document.kind),
        ) ||
          sku.managementMode !== 'nonStock')
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      stockPrecision(
        stockMicros(text(line.baseQuantity)),
        Number(unit.precision),
      );
      modes.set(text(line.id), text(sku.managementMode));
    }
    const reversal = await prepareStockReversal(c, document, lines, entries);
    if (entries.some((entry) => entry.transferId)) {
      const transfer = await c.repository('stockTransfers').findOne({
        filter: {
          id: text(document.transferId),
          subjectId: text(document.subjectId),
          status: 'approved',
        },
      });
      if (
        !transfer ||
        !warehouses.includes(text(transfer.warehouseId)) ||
        !warehouses.includes(text(transfer.destinationWarehouseId))
      )
        return fail('STOCK_SOURCE_UNAVAILABLE');
    }
    const byLine = new Map(lines.map((line) => [text(line.id), line]));
    const grouped = new Map<
      string,
      { line: RepositoryRecord; entries: StockEntry[] }
    >();
    for (const entry of entries) {
      const line = byLine.get(entry.lineId);
      if (
        !line ||
        modes.get(entry.lineId) !== 'stock' ||
        line.subjectId !== document.subjectId ||
        (entry.transferId
          ? entry.transferId !== document.transferId
          : !warehouses.includes(entry.warehouseId!)) ||
        !['qualified', 'inspection', 'frozen'].includes(entry.quality)
      )
        return fail('STOCK_LINES_INVALID');
      const delta = stockDeltaMicros(entry.deltaQuantity);
      if (
        !delta ||
        (delta < 0n ? -delta : delta) !== stockMicros(text(line.baseQuantity))
      )
        return fail('STOCK_QUANTITY_INVALID', `lines.${entry.lineId}.quantity`);
      const group = grouped.get(entry.lineId) ?? { line, entries: [] };
      group.entries.push(entry);
      grouped.set(entry.lineId, group);
    }
    if (
      grouped.size !==
      [...modes.values()].filter((mode) => mode === 'stock').length
    )
      return fail('STOCK_LINES_INVALID');
    const issueChanges = new Map<
      string,
      { row: RepositoryRecord; amount: bigint; limit: bigint }
    >();
    const salesChanges = new Map<
      string,
      { row: RepositoryRecord; amount: bigint; limit: bigint }
    >();
    if (document.kind === 'salesShipment') {
      await lockDemandHeader(c, 'salesOrders', text(document.salesOrderId));
      for (const line of [...lines].sort((a, b) =>
        text(a.salesOrderLineId).localeCompare(text(b.salesOrderLineId)),
      )) {
        const lineId = text(line.salesOrderLineId),
          row = await lockStockRow(c, 'salesOrderLines', lineId),
          source = await approvedTradeLine(
            c,
            'salesOrders',
            text(document.salesOrderId),
            lineId,
            text(document.subjectId),
          ),
          lineEntries = grouped.get(text(line.id))!.entries,
          previous = salesChanges.get(lineId),
          amount =
            (previous?.amount ?? 0n) + stockMicros(text(line.baseQuantity));
        if (
          line.salesOrderId !== document.salesOrderId ||
          source.head.warehouseId !== document.warehouseId ||
          source.line.skuId !== line.skuId ||
          source.line.baseUnitId !== line.baseUnitId ||
          lineEntries.length !== 1 ||
          lineEntries[0].quality !== 'qualified' ||
          stockDeltaMicros(lineEntries[0].deltaQuantity) >= 0n
        )
          return fail('STOCK_SOURCE_CHANGED');
        salesChanges.set(lineId, {
          row,
          amount,
          limit:
            stockMicros(text(source.frozen.baseQuantity)) +
            stockMicros(text(row.replacementQuantity)) -
            stockMicros(text(row.closedQuantity)),
        });
      }
    }
    if (document.kind === 'issue') {
      await lockDemandHeader(
        c,
        'materialIssueRequests',
        text(document.issueRequestId),
      );
      for (const line of [...lines].sort((a, b) =>
        text(a.issueRequestLineId).localeCompare(text(b.issueRequestLineId)),
      )) {
        const lineId = text(line.issueRequestLineId),
          row = await lockIssueFulfillment(c, lineId),
          source = await approvedIssueLine(
            c,
            text(document.issueRequestId),
            lineId,
            text(document.subjectId),
          ),
          lineEntries = grouped.get(text(line.id))!.entries,
          amount = stockMicros(text(line.baseQuantity));
        if (
          line.issueRequestId !== document.issueRequestId ||
          line.skuId !== source.line.skuId ||
          line.baseUnitId !== source.line.baseUnitId ||
          lineEntries.length !== 1 ||
          stockDeltaMicros(lineEntries[0].deltaQuantity) >= 0n ||
          lineEntries[0].quality !== 'qualified'
        )
          return fail('STOCK_SOURCE_CHANGED');
        const change = issueChanges.get(lineId) ?? {
          row,
          amount: 0n,
          limit: stockMicros(text(source.frozen.baseQuantity)),
        };
        change.amount += amount;
        if (
          stockMicros(text(row.issuedQuantity)) + change.amount >
          stockMicros(text(source.frozen.baseQuantity))
        )
          return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
        issueChanges.set(lineId, change);
      }
    }
    for (const { line, entries: lineEntries } of grouped.values()) {
      if (
        lineEntries.length > 2 ||
        (lineEntries.length === 2 &&
          (stockEntryDimensionKey(
            text(document.subjectId),
            text(line.skuId),
            lineEntries[0],
          ) ===
            stockEntryDimensionKey(
              text(document.subjectId),
              text(line.skuId),
              lineEntries[1],
            ) ||
            lineEntries.reduce(
              (sum, entry) => sum + stockDeltaMicros(entry.deltaQuantity),
              0n,
            ) !== 0n))
      )
        return fail('STOCK_LINES_INVALID');
    }
    const dimensions = new Map<
      string,
      {
        warehouseId: string | null;
        transferId: string | null;
        skuId: string;
        baseUnitId: string;
        quality: string;
      }
    >();
    for (const entry of entries) {
      const line = byLine.get(entry.lineId)!;
      const key = stockEntryDimensionKey(
        text(document.subjectId),
        text(line.skuId),
        entry,
      );
      dimensions.set(key, {
        warehouseId: entry.warehouseId ?? null,
        transferId: entry.transferId ?? null,
        skuId: text(line.skuId),
        baseUnitId: text(line.baseUnitId),
        quality: entry.quality,
      });
    }
    const balances = new Map<string, RepositoryRecord>();
    for (const [dimensionKey, dimension] of [...dimensions].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      await insertStockRowIfMissing(
        c,
        'stockBalances',
        {
          id: randomUUID(),
          dimensionKey,
          subjectId: document.subjectId,
          ...dimension,
          quantity: '0',
          reservedQuantity: '0',
          revision: 1,
          nonce: randomUUID(),
          updatedAt: new Date(),
        },
        ['dimensionKey'],
      );
      const row = await c
        .repository('stockBalances')
        .findOne({ filter: { dimensionKey } });
      if (!row) return fail('STOCK_NOT_FOUND');
      const balance = await lockStockRow(c, 'stockBalances', text(row.id));
      if (balance.baseUnitId !== dimension.baseUnitId)
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      balances.set(dimensionKey, balance);
    }
    const changes = new Map<string, { delta: bigint; consumed: bigint }>();
    const consumptions: {
      lineId: string;
      balanceId: string;
      reservationId: string;
      quantity: string;
    }[] = [];
    for (const entry of entries) {
      const line = byLine.get(entry.lineId)!,
        key = stockEntryDimensionKey(
          text(document.subjectId),
          text(line.skuId),
          entry,
        ),
        balance = balances.get(key)!;
      const delta = stockDeltaMicros(entry.deltaQuantity),
        change = changes.get(key) ?? { delta: 0n, consumed: 0n };
      change.delta += delta;
      if (
        delta < 0n &&
        ['issue', 'salesShipment'].includes(text(document.kind))
      ) {
        const sales = document.kind === 'salesShipment';
        if (
          sales
            ? document.salesOrderId !== line.salesOrderId
            : document.issueRequestId !== line.issueRequestId
        )
          return fail('STOCK_SOURCE_UNAVAILABLE');
        const consumed = await this.consumeReservations(
          c,
          balance,
          line,
          -delta,
          sales,
        );
        change.consumed += consumed.quantity;
        consumptions.push(
          ...consumed.rows.map((row) => ({
            ...row,
            lineId: entry.lineId,
            balanceId: text(balance.id),
          })),
        );
      }
      changes.set(key, change);
    }
    const restored = await restoreStockReservations(
      c,
      reversal,
      balances,
      changes,
    );
    for (const [lineId, change] of issueChanges) {
      const reservations = await c.repository('stockReservations').findMany({
        filter: { issueRequestLineId: lineId },
        limit: 1001,
      });
      if (reservations.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
      const held = reservations.reduce(
        (sum, row) => sum + stockMicros(text(row.remainingQuantity)),
        0n,
      );
      if (
        stockMicros(text(change.row.issuedQuantity)) + change.amount + held >
        change.limit
      )
        return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
    }
    for (const [lineId, change] of salesChanges) {
      const reservations = await c.repository('stockReservations').findMany({
        filter: { sourceKind: 'sales', salesOrderLineId: lineId },
        limit: 1001,
      });
      if (reservations.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
      const held = reservations.reduce(
        (sum, row) => sum + stockMicros(text(row.remainingQuantity)),
        0n,
      );
      if (
        stockMicros(text(change.row.fulfilledQuantity)) + change.amount + held >
        change.limit
      )
        return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
    }
    for (const [key, change] of changes) {
      const row = balances.get(key)!,
        quantity = stockMicros(text(row.quantity)) + change.delta,
        reserved = stockMicros(text(row.reservedQuantity)) - change.consumed;
      if (quantity < 0n) return fail('STOCK_INSUFFICIENT');
      if (reserved < 0n) return fail('STOCK_RESERVATION_INVALID');
      if (quantity < reserved) return fail('STOCK_RESERVED_BY_OTHER');
      await c.repository('stockBalances').updateOne({
        filter: { id: text(row.id), revision: Number(row.revision) },
        values: {
          quantity: stockQuantity(quantity),
          reservedQuantity: stockQuantity(reserved),
          revision: Number(row.revision) + 1,
          updatedAt: new Date(),
        },
      });
    }
    for (const [lineId, change] of issueChanges) {
      await c.repository('stockIssueFulfillments').updateOne({
        filter: { id: lineId, revision: Number(change.row.revision) },
        values: {
          issuedQuantity: stockQuantity(
            stockMicros(text(change.row.issuedQuantity)) + change.amount,
          ),
          revision: Number(change.row.revision) + 1,
        },
      });
    }
    const postingId = randomUUID(),
      createdAt = new Date();
    await c.repository('stockPostings').createOne({
      values: {
        id: postingId,
        documentId: input.documentId,
        subjectId: document.subjectId,
        reversesPostingId: reversal?.originalPostingId ?? null,
        fingerprint,
        actorId: input.actorId,
        reason: input.reason,
        createdAt,
      },
    });
    for (const [index, entry] of entries.entries()) {
      const line = byLine.get(entry.lineId)!,
        key = stockEntryDimensionKey(
          text(document.subjectId),
          text(line.skuId),
          entry,
        );
      await c.repository('stockMovements').createOne({
        values: {
          id: randomUUID(),
          postingId,
          documentId: input.documentId,
          documentLineId: entry.lineId,
          subjectId: document.subjectId,
          warehouseId: entry.warehouseId ?? null,
          transferId: entry.transferId ?? null,
          dimensionKey: key,
          skuId: line.skuId,
          baseUnitId: line.baseUnitId,
          balanceId: balances.get(key)!.id,
          ordinal: index + 1,
          quality: entry.quality,
          deltaQuantity: stockDelta(stockDeltaMicros(entry.deltaQuantity)),
          createdAt,
        },
      });
    }
    for (const consumption of consumptions) {
      await c.repository('stockReservationConsumptions').createOne({
        values: {
          id: randomUUID(),
          postingId,
          documentId: input.documentId,
          documentLineId: consumption.lineId,
          reservationId: consumption.reservationId,
          balanceId: consumption.balanceId,
          subjectId: document.subjectId,
          quantity: consumption.quantity,
          createdAt,
        },
      });
    }
    for (const row of restored)
      await c.repository('stockReservationConsumptions').createOne({
        values: {
          ...row,
          postingId,
          documentId: input.documentId,
          createdAt,
        },
      });
    const issueIds = new Set<string>();
    if (document.issueRequestId) issueIds.add(text(document.issueRequestId));
    if (document.originalDocumentId) {
      const original = await c.repository('stockDocuments').findOne({
        filter: { id: text(document.originalDocumentId) },
      });
      if (original?.issueRequestId) issueIds.add(text(original.issueRequestId));
    }
    await this.remember(c, input, fingerprint, postingId);
    const result = { postingId, documentId: input.documentId, replayed: false };
    await port.posted(c, document, result);
    for (const id of issueIds) await refreshIssueFulfillment(c, id);
    return result;
  }
  private async remember(
    c: DatabaseConnection,
    input: PostingInput,
    fingerprint: string,
    postingId: string,
  ) {
    try {
      await c.repository('stockActionRequests').createOne({
        values: {
          id: randomUUID(),
          actorId: input.actorId,
          requestKey: input.requestKey,
          action: 'post',
          documentId: input.documentId,
          postingId,
          reservationId: null,
          fingerprint,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      let cause: unknown = error;
      for (
        let depth = 0;
        depth < 4 && cause && typeof cause === 'object';
        depth++
      ) {
        if (
          'code' in cause &&
          ['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(String(cause.code))
        )
          return fail('STOCK_REQUEST_KEY_REUSED');
        cause = 'cause' in cause ? cause.cause : undefined;
      }
      throw error;
    }
  }
  private async consumeReservations(
    c: DatabaseConnection,
    balance: RepositoryRecord,
    line: RepositoryRecord,
    amount: bigint,
    sales: boolean,
  ): Promise<{
    quantity: bigint;
    rows: { reservationId: string; quantity: string }[];
  }> {
    const rows = await c.repository('stockReservations').findMany({
      filter: {
        balanceId: text(balance.id),
        ...(sales
          ? {
              sourceKind: 'sales',
              salesOrderId: text(line.salesOrderId),
              salesOrderLineId: text(line.salesOrderLineId),
            }
          : {
              sourceKind: 'issue',
              issueRequestLineId: text(line.issueRequestLineId),
              issueRequestId: text(line.issueRequestId),
            }),
      },
      sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
      limit: 1001,
    });
    if (rows.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
    let remaining = amount;
    const consumed: { reservationId: string; quantity: string }[] = [];
    for (const row of rows) {
      const available = stockMicros(text(row.remainingQuantity)),
        used = available < remaining ? available : remaining;
      if (!used) continue;
      await c.repository('stockReservations').updateOne({
        filter: { id: text(row.id), revision: Number(row.revision) },
        values: {
          remainingQuantity: stockQuantity(available - used),
          consumedQuantity: stockQuantity(
            stockMicros(text(row.consumedQuantity)) + used,
          ),
          revision: Number(row.revision) + 1,
          updatedAt: new Date(),
        },
      });
      consumed.push({
        reservationId: text(row.id),
        quantity: stockQuantity(used),
      });
      remaining -= used;
      if (!remaining) break;
    }
    return { quantity: amount - remaining, rows: consumed };
  }
}
