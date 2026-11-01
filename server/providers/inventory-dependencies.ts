import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { insertStockRowIfMissing, lockStockRow } from './inventory-db.js';
import { executionText as text } from './execution-access.js';
import { inventoryError as fail, stockMicros } from './inventory-quantity.js';
import { materialIdFilter } from './material-filters.js';

/** Metadata callers already hold org → supply → material coordination locks.
 * Quantity writers only take warehouse/source/dimension rows, in that order. */
export async function guardInventoryMaterial(
  c: DatabaseConnection,
  kind: string,
  record: Readonly<Record<string, unknown>>,
) {
  if (
    ![
      'warehouses',
      'skus',
      'subjectSettings',
      'unitRules',
      'units',
      'names',
      'templates',
    ].includes(kind)
  )
    return;
  const warehouses = await c.repository('warehouses').findMany({
    filter:
      kind === 'warehouses'
        ? { id: text(record.id) }
        : kind === 'subjectSettings'
          ? { subjectId: text(record.subjectId) }
          : undefined,
    limit: 10001,
    sort: (s) => [s.field('id').asc()],
  });
  if (warehouses.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
  for (const warehouse of warehouses) {
    await insertStockRowIfMissing(c, 'warehouseStockGates', {
      id: warehouse.id,
      subjectId: warehouse.subjectId,
      nonce: randomUUID(),
    });
    const gate = await lockStockRow(
      c,
      'warehouseStockGates',
      text(warehouse.id),
    );
    if (gate.countId) return fail('STOCK_COUNT_FROZEN');
  }
  let skuIds: string[] | undefined;
  if (['skus', 'subjectSettings', 'unitRules'].includes(kind))
    skuIds = [text(kind === 'skus' ? record.id : record.skuId)];
  if (['names', 'templates'].includes(kind)) {
    const names =
      kind === 'names'
        ? [record]
        : await c.repository('materialNames').findMany({
            filter: { templateId: text(record.id) },
            limit: 10001,
          });
    if (names.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    const skus = await c.repository('materialSkus').findMany({
      filter: (f) =>
        materialIdFilter(
          f,
          'materialNameId',
          names.map((row) => text(row.id)),
        ),
      limit: 10001,
    });
    if (skus.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    skuIds = skus.map((row) => text(row.id));
  }
  const relevant = (row: RepositoryRecord) =>
    (kind !== 'warehouses' ||
      row.warehouseId === record.id ||
      row.destinationWarehouseId === record.id) &&
    (kind !== 'subjectSettings' || row.subjectId === record.subjectId) &&
    (!skuIds || skuIds.includes(text(row.skuId))) &&
    (kind !== 'units' ||
      row.unitId === record.id ||
      row.baseUnitId === record.id) &&
    (kind !== 'unitRules' || row.unitRuleId === record.id);
  const balances = await c.repository('stockBalances').findMany({
    filter:
      kind === 'warehouses'
        ? { warehouseId: text(record.id) }
        : kind === 'subjectSettings'
          ? { subjectId: text(record.subjectId) }
          : undefined,
    limit: 100001,
  });
  if (balances.length > 100000) return fail('STOCK_REFERENCE_TOO_BROAD');
  for (const row of balances)
    if (
      (!skuIds || skuIds.includes(text(row.skuId))) &&
      (kind !== 'units' || row.baseUnitId === record.id) &&
      (stockMicros(text(row.quantity)) > 0n ||
        stockMicros(text(row.reservedQuantity)) > 0n)
    )
      return fail('STOCK_MASTER_IN_USE');
  for (const [headTable, lineTable, parent] of [
    ['purchaseOrders', 'purchaseOrderLines', 'orderId'],
    ['salesOrders', 'salesOrderLines', 'orderId'],
    ['stockTransfers', 'stockTransferLines', 'transferId'],
    ['stockDocuments', 'stockDocumentLines', 'documentId'],
  ] as const) {
    const heads = await c.repository(headTable).findMany({
      filter: (f) =>
        f.and([
          f.string('status').ne('cancelled'),
          ...(headTable === 'stockDocuments'
            ? [f.string('status').ne('posted')]
            : []),
        ]),
      limit: 10001,
    });
    if (heads.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    for (const head of heads) {
      if (
        kind === 'warehouses' &&
        head.warehouseId !== record.id &&
        head.destinationWarehouseId !== record.id
      )
        continue;
      if (kind === 'subjectSettings' && head.subjectId !== record.subjectId)
        continue;
      const lines = await c.repository(lineTable).findMany({
        filter: { [parent]: text(head.id), status: 'active' },
        limit: 101,
      });
      for (const line of lines) {
        if (
          !relevant({
            ...head,
            ...line,
            warehouseId: head.warehouseId,
            destinationWarehouseId: head.destinationWarehouseId,
          })
        )
          continue;
        const open =
          head.status !== 'approved' ||
          headTable === 'stockDocuments' ||
          (headTable === 'stockTransfers'
            ? stockMicros(text(line.dispatchedQuantity)) <
                stockMicros(text(line.baseQuantity)) ||
              stockMicros(text(line.receivedQuantity)) +
                stockMicros(text(line.discrepancyQuantity)) <
                stockMicros(text(line.dispatchedQuantity))
            : stockMicros(text(line.fulfilledQuantity)) +
                stockMicros(text(line.closedQuantity)) <
              stockMicros(text(line.baseQuantity)) +
                stockMicros(text(line.replacementQuantity)));
        if (open) return fail('STOCK_MASTER_IN_USE');
      }
    }
  }
  // Requests that are fully executed/allocated remain readable history. A company
  // admission is not inventory: ending it stays allowed, and request submission
  // revalidates the admission instead of freezing material master data forever.
  if (kind !== 'warehouses' && kind !== 'subjectSettings')
    for (const [heads, lines, issue] of [
      ['materialIssueRequests', 'materialIssueRequestLines', true],
      ['purchaseRequests', 'purchaseRequestLines', false],
    ] as const) {
      const rows = await c
        .repository(lines)
        .findMany({ filter: { status: 'active' }, limit: 10001 });
      if (rows.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
      for (const row of rows) {
        if (!relevant(row)) continue;
        const head = await c
          .repository(heads)
          .findOne({ filter: { id: text(row.requestId) } });
        if (!head || head.status === 'cancelled') continue;
        if (head.status !== 'approved') return fail('STOCK_MASTER_IN_USE');
        let used: bigint;
        if (issue) {
          const fulfilled = await c
            .repository('stockIssueFulfillments')
            .findOne({ filter: { id: text(row.id) } });
          used = fulfilled ? stockMicros(text(fulfilled.issuedQuantity)) : 0n;
        } else {
          const allocations = await c
            .repository('purchaseAllocations')
            .findMany({
              filter: { requestLineId: text(row.id), status: 'active' },
              limit: 10001,
            });
          if (allocations.length > 10000)
            return fail('STOCK_REFERENCE_TOO_BROAD');
          used = allocations.reduce(
            (sum, item) => sum + stockMicros(text(item.baseQuantity)),
            0n,
          );
        }
        if (!row.baseQuantity || used < stockMicros(text(row.baseQuantity)))
          return fail('STOCK_MASTER_IN_USE');
      }
    }
}

export async function hasOpenTradePartner(
  c: DatabaseConnection,
  partnerId: string,
  role?: 'supplier' | 'customer',
  subjectId?: string,
) {
  for (const table of role === 'supplier'
    ? ['purchaseOrders']
    : role === 'customer'
      ? ['salesOrders']
      : ['purchaseOrders', 'salesOrders']) {
    const heads = await c.repository(table).findMany({
      filter: (f) =>
        f.and([
          f.string('partnerId').eq(partnerId),
          f.string('status').ne('cancelled'),
          ...(subjectId ? [f.string('subjectId').eq(subjectId)] : []),
        ]),
      limit: 10001,
    });
    if (heads.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    for (const head of heads) {
      if (head.status !== 'approved') return true;
      const lines = await c
        .repository(
          table === 'purchaseOrders' ? 'purchaseOrderLines' : 'salesOrderLines',
        )
        .findMany({
          filter: { orderId: text(head.id), status: 'active' },
          limit: 101,
        });
      if (
        lines.some(
          (line) =>
            stockMicros(text(line.fulfilledQuantity)) +
              stockMicros(text(line.closedQuantity)) <
            stockMicros(text(line.baseQuantity)) +
              stockMicros(text(line.replacementQuantity)),
        )
      )
        return true;
    }
  }
  return false;
}
export async function guardTradeScope(
  c: DatabaseConnection,
  partnerId: string,
  role: 'supplier' | 'customer',
  proposal: {
    scopeMode: 'all' | 'selected';
    subjectIds: string[];
    regionIds: string[];
  },
) {
  if (proposal.scopeMode === 'all') return;
  const heads = await c
    .repository(role === 'supplier' ? 'purchaseOrders' : 'salesOrders')
    .findMany({
      filter: (f) =>
        f.and([
          f.string('partnerId').eq(partnerId),
          f.string('status').ne('cancelled'),
        ]),
      limit: 10001,
    });
  if (heads.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
  for (const subjectId of new Set(heads.map((row) => text(row.subjectId)))) {
    if (proposal.subjectIds.includes(subjectId)) continue;
    const company = await c
        .repository('orgSubjects')
        .findOne({ filter: { id: subjectId } }),
      seen = new Set<string>();
    let regionId = company?.type === 'company' ? text(company.regionId) : '',
      matched = false;
    while (regionId) {
      if (seen.has(regionId) || seen.size >= 500)
        return fail('STOCK_REFERENCE_TOO_BROAD');
      seen.add(regionId);
      const region = await c
        .repository('orgRegions')
        .findOne({ filter: { id: regionId, status: 'active' } });
      if (!region) break;
      if (proposal.regionIds.includes(regionId)) {
        matched = true;
        break;
      }
      regionId = text(region.parentId);
    }
    if (!matched && (await hasOpenTradePartner(c, partnerId, role, subjectId)))
      return fail('STOCK_MASTER_IN_USE');
  }
}
