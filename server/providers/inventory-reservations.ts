import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import type { InventoryService } from './inventory-service.js';
import { lockStockRow, lockDemandHeader } from './inventory-db.js';
import { approvedTradeLine } from './inventory-trade-source.js';
import {
  approvedIssueLine,
  lockIssueFulfillment,
} from './inventory-issue-source.js';
import {
  inventoryError as fail,
  stockMicros,
  stockPrecision,
  stockQuantity,
} from './inventory-quantity.js';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const common = z.strictObject({
  reservationId: z.string().uuid(),
  actorId: z.string().min(1).max(200),
  requestKey: z.string().uuid(),
  reason: z.string().trim().min(1).max(3000),
});
const reserveBase = common.extend({
  subjectId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.string(),
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(0),
});
const reserveSchema = z.union([
  reserveBase.extend({
    sourceKind: z.literal('issue').default('issue'),
    issueRequestId: z.string().uuid(),
    issueRequestLineId: z.string().uuid(),
  }),
  reserveBase.extend({
    sourceKind: z.literal('sales'),
    salesOrderId: z.string().uuid(),
    salesOrderLineId: z.string().uuid(),
  }),
]);
const releaseSchema = common.extend({
  version: z.number().int().min(1),
  quantity: z.string(),
});
export type StockReserveInput = z.input<typeof reserveSchema>;
export type StockReleaseInput = z.infer<typeof releaseSchema>;
export interface StockReservationPort {
  /** Recheck actual source/reservation scope and active actor, including replays. */
  authorize(
    c: DatabaseConnection,
    source: RepositoryRecord,
    action: 'reserve' | 'release',
    replay: boolean,
  ): Promise<void>;
  changed(
    c: DatabaseConnection,
    reservation: RepositoryRecord,
    action: 'reserve' | 'release',
    quantity: string,
  ): Promise<void>;
}
export interface StockReservationResult {
  reservationId: string;
  replayed: boolean;
}
const digest = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Internal InventoryService collaborator; never registered as a direct CRUD API. */
export class InventoryReservations {
  constructor(
    private readonly db: DatabaseManager,
    private readonly inventory: InventoryService,
  ) {}
  reserve(input: StockReserveInput, port: StockReservationPort) {
    return this.db.transaction((c) =>
      this.reserveInTransaction(c, input, port),
    );
  }
  release(input: StockReleaseInput, port: StockReservationPort) {
    return this.db.transaction((c) =>
      this.releaseInTransaction(c, input, port),
    );
  }
  private async replay(
    c: DatabaseConnection,
    input: z.infer<typeof common>,
    action: string,
    fingerprint: string,
  ) {
    const row = await c.repository('stockActionRequests').findOne({
      filter: { actorId: input.actorId, requestKey: input.requestKey },
    });
    if (
      row &&
      (row.action !== action ||
        row.reservationId !== input.reservationId ||
        row.fingerprint !== fingerprint)
    )
      return fail('STOCK_REQUEST_KEY_REUSED');
    return !!row;
  }
  private async remember(
    c: DatabaseConnection,
    input: z.infer<typeof common>,
    action: string,
    fingerprint: string,
  ) {
    try {
      await c.repository('stockActionRequests').createOne({
        values: {
          id: randomUUID(),
          actorId: input.actorId,
          requestKey: input.requestKey,
          action,
          documentId: null,
          postingId: null,
          reservationId: input.reservationId,
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
  async reserveInTransaction(
    c: DatabaseConnection,
    raw: StockReserveInput,
    port: StockReservationPort,
  ): Promise<StockReservationResult> {
    const input = reserveSchema.parse(raw),
      fingerprint = digest(input),
      amount = stockMicros(input.quantity);
    if (amount <= 0n) return fail('STOCK_QUANTITY_INVALID', 'quantity');
    const sales = input.sourceKind === 'sales',
      owner = sales
        ? {
            sourceKind: 'sales',
            salesOrderId: input.salesOrderId,
            salesOrderLineId: input.salesOrderLineId,
          }
        : {
            sourceKind: 'issue',
            issueRequestId: input.issueRequestId,
            issueRequestLineId: input.issueRequestLineId,
          },
      parentId = sales ? input.salesOrderId : input.issueRequestId,
      lineId = sales ? input.salesOrderLineId : input.issueRequestLineId,
      readSource = () =>
        sales
          ? approvedTradeLine(
              c,
              'salesOrders',
              parentId,
              lineId,
              input.subjectId,
            )
          : approvedIssueLine(c, parentId, lineId, input.subjectId);
    const readHead = () =>
      c
        .repository(sales ? 'salesOrders' : 'materialIssueRequests')
        .findOne({ filter: { id: parentId, subjectId: input.subjectId } });
    let head = await readHead();
    if (!head) return fail('STOCK_SOURCE_UNAVAILABLE');
    await port.authorize(c, head, 'reserve', false);
    await this.inventory.lockWarehouses(c, input.subjectId, [
      input.warehouseId,
    ]);
    await lockDemandHeader(
      c,
      sales ? 'salesOrders' : 'materialIssueRequests',
      parentId,
    );
    const fulfilled = sales
      ? await lockStockRow(c, 'salesOrderLines', lineId)
      : await lockIssueFulfillment(c, lineId);
    head = await readHead();
    if (!head) return fail('STOCK_SOURCE_UNAVAILABLE');
    const prior = await c
      .repository('stockReservations')
      .findOne({ filter: { id: input.reservationId } });
    await port.authorize(c, head, 'reserve', !!prior);
    const replay = await this.replay(c, input, 'reserve', fingerprint);
    if (prior) {
      if (
        prior.subjectId !== input.subjectId ||
        prior.warehouseId !== input.warehouseId ||
        Object.entries(owner).some(([key, value]) => prior[key] !== value) ||
        prior.createdBy !== input.actorId ||
        stockMicros(text(prior.quantity)) !== amount
      )
        return fail('STOCK_RESERVATION_ID_REUSED');
      if (!replay) await this.remember(c, input, 'reserve', fingerprint);
      return { reservationId: input.reservationId, replayed: true };
    }
    if (replay) return fail('STOCK_RESERVATION_NOT_FOUND');
    const source = await readSource();
    if (sales && source.head.warehouseId !== input.warehouseId)
      return fail('STOCK_SOURCE_UNAVAILABLE');
    if (
      source.head.revision !== input.version ||
      source.head.lifecycleVersion !== input.lifecycleVersion
    )
      return fail('STOCK_VERSION_CONFLICT');
    const rows = await c.repository('stockReservations').findMany({
      filter: owner,
      limit: 1001,
    });
    if (rows.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
    const held = rows.reduce(
      (sum, row) => sum + stockMicros(text(row.remainingQuantity)),
      0n,
    );
    if (
      held +
        amount +
        stockMicros(
          text(sales ? fulfilled.fulfilledQuantity : fulfilled.issuedQuantity),
        ) >
      stockMicros(text(source.frozen.baseQuantity)) +
        (sales
          ? stockMicros(text(fulfilled.replacementQuantity)) -
            stockMicros(text(fulfilled.closedQuantity))
          : 0n)
    )
      return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
    const unit = await c
      .repository('measureUnits')
      .findOne({ filter: { id: text(source.line.baseUnitId) } });
    if (!unit) return fail('STOCK_MATERIAL_UNAVAILABLE');
    stockPrecision(amount, Number(unit.precision));
    const dimension = await c.repository('stockBalances').findOne({
      filter: {
        subjectId: input.subjectId,
        warehouseId: input.warehouseId,
        skuId: text(source.line.skuId),
        quality: 'qualified',
      },
    });
    if (!dimension) return fail('STOCK_INSUFFICIENT');
    const balance = await lockStockRow(c, 'stockBalances', text(dimension.id));
    if (
      stockMicros(text(balance.quantity)) -
        stockMicros(text(balance.reservedQuantity)) <
      amount
    )
      return fail('STOCK_INSUFFICIENT');
    const reservation: RepositoryRecord = {
      id: input.reservationId,
      balanceId: balance.id,
      subjectId: input.subjectId,
      warehouseId: input.warehouseId,
      skuId: source.line.skuId,
      quality: 'qualified',
      ...owner,
      quantity: stockQuantity(amount),
      consumedQuantity: '0',
      releasedQuantity: '0',
      remainingQuantity: stockQuantity(amount),
      revision: 1,
      createdBy: input.actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await c.repository('stockReservations').createOne({ values: reservation });
    await c.repository('stockBalances').updateOne({
      filter: { id: text(balance.id), revision: Number(balance.revision) },
      values: {
        reservedQuantity: stockQuantity(
          stockMicros(text(balance.reservedQuantity)) + amount,
        ),
        revision: Number(balance.revision) + 1,
        updatedAt: new Date(),
      },
    });
    await this.remember(c, input, 'reserve', fingerprint);
    await port.changed(c, reservation, 'reserve', stockQuantity(amount));
    return { reservationId: input.reservationId, replayed: false };
  }
  async releaseInTransaction(
    c: DatabaseConnection,
    raw: StockReleaseInput,
    port: StockReservationPort,
  ): Promise<StockReservationResult> {
    const input = releaseSchema.parse(raw),
      fingerprint = digest(input),
      amount = stockMicros(input.quantity);
    if (amount <= 0n) return fail('STOCK_QUANTITY_INVALID', 'quantity');
    let row = await c
      .repository('stockReservations')
      .findOne({ filter: { id: input.reservationId } });
    if (!row) return fail('STOCK_RESERVATION_NOT_FOUND');
    await port.authorize(c, row, 'release', false);
    await this.inventory.lockWarehouses(c, text(row.subjectId), [
      text(row.warehouseId),
    ]);
    const sales = row.sourceKind === 'sales';
    await lockDemandHeader(
      c,
      sales ? 'salesOrders' : 'materialIssueRequests',
      text(sales ? row.salesOrderId : row.issueRequestId),
    );
    if (sales)
      await lockStockRow(c, 'salesOrderLines', text(row.salesOrderLineId));
    else await lockIssueFulfillment(c, text(row.issueRequestLineId));
    row = await c
      .repository('stockReservations')
      .findOne({ filter: { id: input.reservationId } });
    if (!row) return fail('STOCK_RESERVATION_NOT_FOUND');
    const replay = await this.replay(c, input, 'release', fingerprint);
    await port.authorize(c, row, 'release', replay);
    if (replay) return { reservationId: input.reservationId, replayed: true };
    if (row.revision !== input.version) return fail('STOCK_VERSION_CONFLICT');
    if (amount > stockMicros(text(row.remainingQuantity)))
      return fail('STOCK_RESERVATION_REMAINING_EXCEEDED');
    const balance = await lockStockRow(c, 'stockBalances', text(row.balanceId)),
      reserved = stockMicros(text(balance.reservedQuantity)) - amount;
    if (reserved < 0n) return fail('STOCK_RESERVATION_INVALID');
    const values = {
      remainingQuantity: stockQuantity(
        stockMicros(text(row.remainingQuantity)) - amount,
      ),
      releasedQuantity: stockQuantity(
        stockMicros(text(row.releasedQuantity)) + amount,
      ),
      revision: Number(row.revision) + 1,
      updatedAt: new Date(),
    };
    await c.repository('stockReservations').updateOne({
      filter: { id: input.reservationId, revision: input.version },
      values,
    });
    await c.repository('stockBalances').updateOne({
      filter: { id: text(balance.id), revision: Number(balance.revision) },
      values: {
        reservedQuantity: stockQuantity(reserved),
        revision: Number(balance.revision) + 1,
        updatedAt: new Date(),
      },
    });
    await this.remember(c, input, 'release', fingerprint);
    await port.changed(
      c,
      { ...row, ...values },
      'release',
      stockQuantity(amount),
    );
    return { reservationId: input.reservationId, replayed: false };
  }
}
