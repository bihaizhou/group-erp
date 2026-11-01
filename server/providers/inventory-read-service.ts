import { businessDate } from './business-date.js';
import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  RepositoryRecord,
  FilterBuilder,
} from '@nocobase/db';
import type { LifecycleActor } from '@nocobase/lifecycle';
import { z } from 'zod';
import type { ExecutionRecords } from './execution-records.js';
import type { InventoryService } from './inventory-service.js';
import type { MaterialPolicies } from './material-service.js';
import {
  inventoryQuery,
  inventoryReservationInput,
  inventoryReleaseInput,
} from './execution-model.js';
import {
  executionActor,
  executionCompany,
  executionRepo as repo,
  executionText as text,
  executionJson as json,
} from './execution-access.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
  stockDelta,
  stockDeltaMicros,
} from './inventory-quantity.js';
import { materialIdFilter } from './material-filters.js';

type Query = z.infer<typeof inventoryQuery>;
export class InventoryReadService {
  constructor(
    readonly records: ExecutionRecords,
    private readonly inventory: InventoryService,
  ) {}
  private async scope(c: DatabaseConnection, q: Query, p: MaterialPolicies) {
    await executionCompany(c, q.subjectId, p, false);
    const warehouses = await repo(c, 'warehouses', p).findMany({
        filter: {
          subjectId: q.subjectId,
          ...(q.warehouseId ? { id: q.warehouseId } : {}),
        },
        limit: 10001,
      }),
      transfers = await repo(c, 'stockTransfers', p).findMany({
        filter: {
          subjectId: q.subjectId,
          ...(q.transferId ? { id: q.transferId } : {}),
        },
        limit: 10001,
      });
    if (warehouses.length > 10000 || transfers.length > 10000)
      return fail('STOCK_REFERENCE_TOO_BROAD');
    if (q.warehouseId && !warehouses.some((row) => row.id === q.warehouseId))
      return fail('STOCK_FORBIDDEN');
    if (q.transferId && !transfers.some((row) => row.id === q.transferId))
      return fail('STOCK_FORBIDDEN');
    return {
      warehouses,
      transfers: transfers.filter(
        (row) =>
          !q.warehouseId ||
          row.warehouseId === q.warehouseId ||
          row.destinationWarehouseId === q.warehouseId,
      ),
    };
  }
  private async balances(q: Query, p: MaterialPolicies) {
    const c = this.records.db.connection(),
      scope = await this.scope(c, q, p),
      scoped = repo(c, 'stockBalances', p),
      filter = (f: FilterBuilder) =>
        f.and([
          f.string('subjectId').eq(q.subjectId),
          f.or([
            ...(q.transferId
              ? []
              : [
                  materialIdFilter(
                    f,
                    'warehouseId',
                    scope.warehouses.map((row) => text(row.id)),
                  ),
                ]),
            ...(q.warehouseId && !q.transferId
              ? []
              : [
                  materialIdFilter(
                    f,
                    'transferId',
                    scope.transfers.map((row) => text(row.id)),
                  ),
                ]),
          ]),
          ...(q.skuId ? [f.string('skuId').eq(q.skuId)] : []),
          ...(q.quality ? [f.string('quality').eq(q.quality)] : []),
        ]),
      rows = await scoped.findMany({ filter, limit: 10001 });
    if (rows.length > 10000) return fail('STOCK_QUERY_TOO_BROAD');
    const values = [];
    for (const row of rows) {
      if (
        [
          'id',
          'subjectId',
          'skuId',
          'baseUnitId',
          'quality',
          'quantity',
          'reservedQuantity',
        ].some((key) => !(key in row))
      )
        return fail('STOCK_FORBIDDEN');
      const material = await repo(c, 'materialSkus', p).findOne({
          filter: { id: text(row.skuId) },
        }),
        unit = await repo(c, 'measureUnits', p).findOne({
          filter: { id: text(row.baseUnitId) },
        });
      if (
        !material ||
        typeof material.code !== 'string' ||
        typeof material.name !== 'string' ||
        !unit ||
        typeof unit.name !== 'string'
      )
        return fail('STOCK_FORBIDDEN');
      const haystack = [
        material.code,
        material.name,
        text(material.specification),
      ]
        .join(' ')
        .toLocaleLowerCase();
      if (q.q && !haystack.includes(q.q.toLocaleLowerCase())) continue;
      values.push({
        ...row,
        id: text(row.id),
        quantity: text(row.quantity),
        reservedQuantity: text(row.reservedQuantity),
        available:
          row.quality === 'qualified' && row.warehouseId
            ? stockQuantity(
                stockMicros(text(row.quantity)) -
                  stockMicros(text(row.reservedQuantity)),
              )
            : '0',
        material: {
          id: material.id,
          code: material.code,
          name: material.name,
          specification: material.specification ?? '',
          baseUnitName: unit.name,
        },
        warehouse: scope.warehouses.find((item) => item.id === row.warehouseId)
          ? {
              id: row.warehouseId,
              name: scope.warehouses.find(
                (item) => item.id === row.warehouseId,
              )!.name,
            }
          : null,
        transfer: scope.transfers.find((item) => item.id === row.transferId)
          ? {
              id: row.transferId,
              code: scope.transfers.find((item) => item.id === row.transferId)!
                .code,
            }
          : null,
      });
    }
    const field = q.orderBy.replace(/^-/u, ''),
      direction = q.orderBy.startsWith('-') ? -1 : 1;
    values.sort((a, b) => {
      let cmp: number;
      if (field === 'code')
        cmp = text(a.material.code).localeCompare(text(b.material.code));
      else {
        const left = stockMicros(
            text(a[field as 'quantity' | 'reservedQuantity' | 'available']),
          ),
          right = stockMicros(
            text(b[field as 'quantity' | 'reservedQuantity' | 'available']),
          );
        cmp = left < right ? -1 : left > right ? 1 : 0;
      }
      return cmp * direction || text(a.id).localeCompare(text(b.id));
    });
    return { c, values };
  }
  async list(q: Query, p: MaterialPolicies) {
    const { values } = await this.balances(q, p);
    return {
      data: values
        .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
        .map(json),
      meta: { page: q.page, pageSize: q.pageSize, total: values.length },
    };
  }
  async reconcile(q: Query, p: MaterialPolicies) {
    const { c, values } = await this.balances(q, p),
      data = [];
    for (const row of values.slice(
      (q.page - 1) * q.pageSize,
      q.page * q.pageSize,
    )) {
      const movements = await repo(c, 'stockMovements', p).findMany({
          filter: { balanceId: text(row.id), subjectId: q.subjectId },
          limit: 100001,
        }),
        reservations = await repo(c, 'stockReservations', p).findMany({
          filter: { balanceId: text(row.id), subjectId: q.subjectId },
          limit: 10001,
        });
      if (movements.length > 100000 || reservations.length > 10000)
        return fail('STOCK_QUERY_TOO_BROAD');
      if (
        movements.length !==
          (await c.repository('stockMovements').count({
            filter: { balanceId: text(row.id), subjectId: q.subjectId },
          })) ||
        reservations.length !==
          (await c.repository('stockReservations').count({
            filter: { balanceId: text(row.id), subjectId: q.subjectId },
          })) ||
        movements.some((item) => typeof item.deltaQuantity !== 'string') ||
        reservations.some((item) => typeof item.remainingQuantity !== 'string')
      )
        return fail('STOCK_FORBIDDEN');
      const ledger = movements.reduce(
          (sum, item) => sum + stockDeltaMicros(text(item.deltaQuantity)),
          0n,
        ),
        held = reservations.reduce(
          (sum, item) => sum + stockMicros(text(item.remainingQuantity)),
          0n,
        );
      data.push(
        json({
          ...row,
          ledgerQuantity: stockDelta(ledger),
          reservationQuantity: stockQuantity(held),
          consistent:
            ledger === stockMicros(text(row.quantity)) &&
            held === stockMicros(text(row.reservedQuantity)),
        }),
      );
    }
    return {
      data,
      meta: { page: q.page, pageSize: q.pageSize, total: values.length },
    };
  }
  async balance(id: string, p: MaterialPolicies) {
    const raw = await repo(
      this.records.db.connection(),
      'stockBalances',
      p,
    ).findOne({ filter: { id } });
    if (!raw || !raw.subjectId || !raw.skuId || !raw.quality)
      return fail('STOCK_NOT_FOUND');
    const { values } = await this.balances(
        inventoryQuery.parse({
          subjectId: raw.subjectId,
          skuId: raw.skuId,
          quality: raw.quality,
          ...(raw.warehouseId
            ? { warehouseId: raw.warehouseId }
            : { transferId: raw.transferId }),
        }),
        p,
      ),
      value = values.find((row) => row.id === id);
    if (!value) return fail('STOCK_NOT_FOUND');
    return json(value);
  }
  async reservation(id: string, p: MaterialPolicies) {
    const row = await repo(
      this.records.db.connection(),
      'stockReservations',
      p,
    ).findOne({ filter: { id } });
    if (
      !row ||
      typeof row.subjectId !== 'string' ||
      typeof row.warehouseId !== 'string'
    )
      return fail('STOCK_NOT_FOUND');
    const data = await this.facts(
      'stockReservations',
      {
        ...inventoryQuery.parse({
          subjectId: row.subjectId,
          warehouseId: row.warehouseId,
        }),
        reservationId: id,
        orderBy: '-createdAt',
      },
      p,
    );
    return data.data[0] ?? fail('STOCK_NOT_FOUND');
  }
  async facts(
    table: 'stockMovements' | 'stockReservations',
    q: Omit<Query, 'orderBy'> & {
      orderBy: string;
      from?: string;
      to?: string;
      documentId?: string;
      balanceId?: string;
      reservationId?: string;
    },
    p: MaterialPolicies,
  ) {
    const c = this.records.db.connection(),
      scope = await this.scope(c, { ...q, orderBy: 'code' }, p),
      scoped = repo(c, table, p),
      allowed =
        table === 'stockMovements'
          ? ['occurredAt', 'deltaQuantity']
          : ['createdAt', 'remainingQuantity'],
      field = q.orderBy.replace(/^-/u, '');
    if (!allowed.includes(field)) return fail('STOCK_SORT_INVALID', 'orderBy');
    if (q.balanceId) {
      const balance = await this.balance(q.balanceId, p);
      if (balance.subjectId !== q.subjectId) return fail('STOCK_NOT_FOUND');
    }
    const filter = (f: FilterBuilder) =>
        f.and([
          f.string('subjectId').eq(q.subjectId),
          f.or([
            ...(q.transferId
              ? []
              : [
                  materialIdFilter(
                    f,
                    'warehouseId',
                    scope.warehouses.map((row) => text(row.id)),
                  ),
                ]),
            ...(table === 'stockMovements' && (!q.warehouseId || q.transferId)
              ? [
                  materialIdFilter(
                    f,
                    'transferId',
                    scope.transfers.map((row) => text(row.id)),
                  ),
                ]
              : []),
          ]),
          ...(q.skuId ? [f.string('skuId').eq(q.skuId)] : []),
          ...(q.quality ? [f.string('quality').eq(q.quality)] : []),
          ...(q.documentId && table === 'stockMovements'
            ? [f.string('documentId').eq(q.documentId)]
            : []),
          ...(q.balanceId ? [f.string('balanceId').eq(q.balanceId)] : []),
          ...(q.reservationId ? [f.string('id').eq(q.reservationId)] : []),
        ]),
      rows = await scoped.findMany({ filter, limit: 100001 });
    if (rows.length > 100000) return fail('STOCK_QUERY_TOO_BROAD');
    const lookup = async (name: string, ids: string[], optional = false) => {
        const result = new Map<string, RepositoryRecord>();
        if (optional && (!p[name] || p[name].read === false)) return result;
        const unique = [...new Set(ids.filter(Boolean))];
        for (let index = 0; index < unique.length; index += 250)
          for (const row of await repo(c, name, p).findMany({
            filter: (f) =>
              materialIdFilter(f, 'id', unique.slice(index, index + 250)),
            limit: 250,
          }))
            result.set(text(row.id), row);
        return result;
      },
      materials = await lookup(
        'materialSkus',
        rows.map((row) => text(row.skuId)),
      ),
      reservationBalances = await lookup(
        'stockBalances',
        table === 'stockReservations'
          ? rows.map((row) => text(row.balanceId))
          : [],
      ),
      units = await lookup(
        'measureUnits',
        rows.map(
          (row) =>
            text(row.baseUnitId) ||
            text(reservationBalances.get(text(row.balanceId))?.baseUnitId),
        ),
      ),
      documents = await lookup(
        'stockDocuments',
        table === 'stockMovements'
          ? rows.map((row) => text(row.documentId))
          : [],
        true,
      ),
      issues = await lookup(
        'materialIssueRequests',
        table === 'stockReservations'
          ? rows.map((row) => text(row.issueRequestId))
          : [],
        true,
      ),
      sales = await lookup(
        'salesOrders',
        table === 'stockReservations'
          ? rows.map((row) => text(row.salesOrderId))
          : [],
        true,
      ),
      data = [];
    for (const row of rows) {
      const material = materials.get(text(row.skuId)),
        unit = units.get(
          text(row.baseUnitId) ||
            text(reservationBalances.get(text(row.balanceId))?.baseUnitId),
        );
      if (
        !material ||
        typeof material.code !== 'string' ||
        typeof material.name !== 'string' ||
        !unit ||
        typeof unit.name !== 'string'
      )
        return fail('STOCK_FORBIDDEN');
      const source =
          table === 'stockMovements'
            ? documents.get(text(row.documentId))
            : row.sourceKind === 'sales'
              ? sales.get(text(row.salesOrderId))
              : issues.get(text(row.issueRequestId)),
        warehouse = scope.warehouses.find(
          (value) => value.id === row.warehouseId,
        ),
        transfer = scope.transfers.find((value) => value.id === row.transferId),
        at =
          row.createdAt instanceof Date
            ? row.createdAt
            : new Date(text(row.createdAt)),
        date = businessDate(this.records.timeZone, at);
      if ((q.from && date < q.from) || (q.to && date > q.to)) continue;
      if (
        q.q &&
        ![
          material.code,
          material.name,
          text(material.specification),
          source ? text(source.code) : '',
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(q.q.toLocaleLowerCase())
      )
        continue;
      data.push(
        json({
          ...row,
          baseUnitId: unit.id,
          sourceRestricted: !source,
          source:
            source && typeof source.code === 'string'
              ? {
                  id: source.id,
                  code: source.code,
                  kind: source.kind ?? row.sourceKind,
                }
              : null,
          material: {
            id: material.id,
            code: material.code,
            name: material.name,
            specification: material.specification ?? '',
            baseUnitName: unit.name,
          },
          warehouse: warehouse
            ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
            : null,
          transfer: transfer ? { id: transfer.id, code: transfer.code } : null,
        }),
      );
    }
    data.sort((a, b) => {
      let comparison: number;
      if (field === 'occurredAt' || field === 'createdAt')
        comparison = text(a.createdAt).localeCompare(text(b.createdAt));
      else {
        const left =
            field === 'deltaQuantity'
              ? stockDeltaMicros(text(a[field]))
              : stockMicros(text(a[field])),
          right =
            field === 'deltaQuantity'
              ? stockDeltaMicros(text(b[field]))
              : stockMicros(text(b[field]));
        comparison = left < right ? -1 : left > right ? 1 : 0;
      }
      return (
        comparison * (q.orderBy.startsWith('-') ? -1 : 1) ||
        text(a.id).localeCompare(text(b.id))
      );
    });
    return {
      data: data.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: data.length,
        businessDate: businessDate(this.records.timeZone),
      },
    };
  }
  private async authorizeReservation(
    c: DatabaseConnection,
    source: RepositoryRecord,
    actor: LifecycleActor,
    p: MaterialPolicies,
    action: 'reserve' | 'release',
  ) {
    await executionActor(c, this.records.users, actor.id);
    await executionCompany(c, text(source.subjectId), p, action === 'reserve');
    if (
      !(await repo(c, 'warehouses', p).exists({
        filter: {
          id: text(source.warehouseId),
          subjectId: text(source.subjectId),
        },
      }))
    )
      return fail('STOCK_FORBIDDEN');
    const sales = source.sourceKind === 'sales',
      id = text(sales ? source.salesOrderId : source.issueRequestId),
      lineId = text(
        sales ? source.salesOrderLineId : source.issueRequestLineId,
      ),
      table = sales ? 'salesOrders' : 'materialIssueRequests',
      lineTable = sales ? 'salesOrderLines' : 'materialIssueRequestLines';
    if (
      !(await repo(c, table, p).exists({
        filter: { id, subjectId: text(source.subjectId) },
      })) ||
      !(await repo(c, lineTable, p).exists({
        filter: {
          id: lineId,
          [sales ? 'orderId' : 'requestId']: id,
          subjectId: text(source.subjectId),
        },
      }))
    )
      return fail('STOCK_FORBIDDEN');
    if (
      action === 'release' &&
      !(await repo(c, 'stockReservations', p).exists({
        filter: { id: text(source.id) },
      }))
    )
      return fail('STOCK_FORBIDDEN');
  }
  private changed(actor: LifecycleActor) {
    return async (
      c: DatabaseConnection,
      row: RepositoryRecord,
      operation: 'reserve' | 'release',
      quantity: string,
    ) => {
      await c.repository('supplyChainAudit').createOne({
        values: {
          id: randomUUID(),
          kind: 'stockReservations',
          recordId: row.id,
          subjectId: row.subjectId,
          actorId: actor.id,
          operation,
          reason: text(row.reason),
          beforeValue: null,
          afterValue: json({
            reservationId: row.id,
            warehouseId: row.warehouseId,
            sourceKind: row.sourceKind,
            issueRequestId: row.issueRequestId ?? null,
            salesOrderId: row.salesOrderId ?? null,
            quantity,
          }),
          createdAt: new Date(),
        },
      });
    };
  }
  async reserve(
    raw: z.infer<typeof inventoryReservationInput>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = inventoryReservationInput.parse(raw),
      sales = input.sourceKind === 'sales',
      c = this.records.db.connection(),
      table = sales ? 'salesOrders' : 'materialIssueRequests',
      head = await repo(c, table, p).findOne({
        filter: { id: input.sourceId },
      });
    if (!head || typeof head.subjectId !== 'string')
      return fail('STOCK_NOT_FOUND');
    const source = {
      ...head,
      sourceKind: input.sourceKind,
      warehouseId: input.warehouseId,
      ...(sales
        ? { salesOrderId: input.sourceId, salesOrderLineId: input.sourceLineId }
        : {
            issueRequestId: input.sourceId,
            issueRequestLineId: input.sourceLineId,
          }),
    };
    await this.authorizeReservation(c, source, actor, p, 'reserve');
    return this.inventory.reservations.reserve(
      {
        reservationId: input.reservationId,
        subjectId: head.subjectId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        version: input.version,
        lifecycleVersion: input.lifecycleVersion,
        reason: input.reason,
        requestKey: input.requestKey,
        actorId: actor.id,
        ...(sales
          ? {
              sourceKind: 'sales',
              salesOrderId: input.sourceId,
              salesOrderLineId: input.sourceLineId,
            }
          : {
              sourceKind: 'issue',
              issueRequestId: input.sourceId,
              issueRequestLineId: input.sourceLineId,
            }),
      },
      {
        authorize: (tx, current, action) =>
          this.authorizeReservation(
            tx,
            action === 'reserve'
              ? { ...source, ...current, warehouseId: input.warehouseId }
              : current,
            actor,
            p,
            action,
          ),
        changed: (tx, row, operation, amount) =>
          this.changed(actor)(
            tx,
            { ...row, reason: input.reason },
            operation,
            amount,
          ),
      },
    );
  }
  release(
    id: string,
    raw: z.infer<typeof inventoryReleaseInput>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = inventoryReleaseInput.parse(raw);
    return this.inventory.reservations.release(
      { ...input, reservationId: id, actorId: actor.id },
      {
        authorize: (c, row, action) =>
          this.authorizeReservation(c, row, actor, p, action),
        changed: (tx, row, operation, amount) =>
          this.changed(actor)(
            tx,
            { ...row, reason: input.reason },
            operation,
            amount,
          ),
      },
    );
  }
}
