import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { StockEntry } from './inventory-service.js';
import { executionText as text } from './execution-access.js';
import {
  inventoryError as fail,
  stockMicros,
  stockDelta,
  stockDeltaMicros,
  stockQuantity,
} from './inventory-quantity.js';
import { lockDemandHeader, lockStockRow } from './inventory-db.js';
import { approvedTradeLine } from './inventory-trade-source.js';
import {
  lockIssueFulfillment,
  refreshIssueFulfillment,
} from './inventory-issue-source.js';

type CacheTable =
  | 'purchaseOrderLines'
  | 'salesOrderLines'
  | 'stockTransferLines'
  | 'stockDocumentLines'
  | 'stockIssueFulfillments';
interface Cache {
  table: CacheTable;
  row: RepositoryRecord;
  values: Map<string, bigint>;
}
/** All source locks precede balance locks; effects use the caller's exact transaction. */
export async function warehousePosting(
  c: DatabaseConnection,
  head: RepositoryRecord,
  lines: RepositoryRecord[],
) {
  const caches = new Map<string, Cache>(),
    sourceHeads = new Map<
      string,
      {
        table:
          | 'purchaseOrders'
          | 'salesOrders'
          | 'stockTransfers'
          | 'materialIssueRequests';
        id: string;
      }
    >(),
    sourceRows = new Map<string, { table: CacheTable; id: string }>(),
    affectedIssues = new Set<string>(),
    originalHeaders = new Map<string, RepositoryRecord>();
  const addHead = (
      table:
        | 'purchaseOrders'
        | 'salesOrders'
        | 'stockTransfers'
        | 'materialIssueRequests',
      id: unknown,
    ) => {
      if (id) sourceHeads.set(`${table}:${text(id)}`, { table, id: text(id) });
    },
    addRow = (table: CacheTable, id: unknown) => {
      if (id) sourceRows.set(`${table}:${text(id)}`, { table, id: text(id) });
    },
    owner = (row: RepositoryRecord) => {
      addHead('purchaseOrders', row.purchaseOrderId);
      addHead('salesOrders', row.salesOrderId);
      addHead('stockTransfers', row.transferId);
      addHead('materialIssueRequests', row.issueRequestId);
      if (row.issueRequestId) affectedIssues.add(text(row.issueRequestId));
      addRow('purchaseOrderLines', row.purchaseOrderLineId);
      addRow('salesOrderLines', row.salesOrderLineId);
      addRow('stockTransferLines', row.transferLineId);
      addRow('stockIssueFulfillments', row.issueRequestLineId);
    };
  let original: RepositoryRecord | null | undefined = null,
    originalLines: RepositoryRecord[] = [];
  if (head.originalDocumentId) {
    original = await c.repository('stockDocuments').findOne({
      filter: {
        id: text(head.originalDocumentId),
        subjectId: text(head.subjectId),
        status: 'posted',
      },
    });
    if (!original) return fail('STOCK_SOURCE_UNAVAILABLE');
    originalHeaders.set(text(original.id), original);
    originalLines = await c.repository('stockDocumentLines').findMany({
      filter: { documentId: text(original.id), status: 'active' },
      limit: 101,
    });
    if (originalLines.length > 100) return fail('STOCK_LINES_INVALID');
    for (const row of originalLines) {
      owner(row);
      addRow('stockDocumentLines', row.id);
      if (head.kind === 'reversal' && row.originalDocumentId) {
        const parent = await c.repository('stockDocuments').findOne({
          filter: {
            id: text(row.originalDocumentId),
            subjectId: text(head.subjectId),
            status: 'posted',
          },
        });
        if (!parent) return fail('STOCK_SOURCE_UNAVAILABLE');
        originalHeaders.set(text(parent.id), parent);
        addRow('stockDocumentLines', row.originalLineId);
      }
    }
  }
  for (const row of lines) owner(row);
  if (head.issueRequestId)
    addHead('materialIssueRequests', head.issueRequestId);
  for (const [id] of [...originalHeaders].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    await c
      .repository('stockDocuments')
      .updateOne({ filter: { id }, values: { nonce: randomUUID() } });
  for (const [id] of originalHeaders) {
    const posting = await c
      .repository('stockPostings')
      .findOne({ filter: { documentId: id, subjectId: text(head.subjectId) } });
    if (
      !posting ||
      (await c
        .repository('stockPostings')
        .exists({ filter: { reversesPostingId: text(posting.id) } }))
    )
      return fail('STOCK_SOURCE_UNAVAILABLE');
  }
  for (const [, row] of [...sourceHeads].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (row.table === 'materialIssueRequests')
      await lockDemandHeader(c, row.table, row.id);
    else
      await c
        .repository(row.table)
        .updateOne({ filter: { id: row.id }, values: { nonce: randomUUID() } });
  }
  for (const [key, source] of [...sourceRows].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const row =
      source.table === 'stockIssueFulfillments'
        ? await lockIssueFulfillment(c, source.id)
        : await lockStockRow(c, source.table, source.id);
    if (row.subjectId !== head.subjectId)
      return fail('STOCK_SOURCE_UNAVAILABLE');
    caches.set(key, { table: source.table, row, values: new Map() });
  }
  const cache = (table: CacheTable, id: unknown) =>
      caches.get(`${table}:${text(id)}`) ?? fail('STOCK_SOURCE_UNAVAILABLE'),
    value = (row: Cache, field: string) =>
      row.values.get(field) ?? stockMicros(text(row.row[field])),
    adjust = (
      table: CacheTable,
      id: unknown,
      field: string,
      amount: bigint,
    ) => {
      const row = cache(table, id);
      row.values.set(field, value(row, field) + amount);
    },
    quantity = (row: RepositoryRecord) => stockMicros(text(row.baseQuantity)),
    sourceReturn = (row: RepositoryRecord, amount: bigint) => {
      if (row.purchaseOrderLineId) {
        adjust(
          'purchaseOrderLines',
          row.purchaseOrderLineId,
          'returnedQuantity',
          amount,
        );
        if (row.replenishmentRequested)
          adjust(
            'purchaseOrderLines',
            row.purchaseOrderLineId,
            'replacementQuantity',
            amount,
          );
      } else if (row.salesOrderLineId)
        adjust(
          'salesOrderLines',
          row.salesOrderLineId,
          'returnedQuantity',
          amount,
        );
      else if (row.issueRequestLineId)
        adjust(
          'stockIssueFulfillments',
          row.issueRequestLineId,
          'returnedQuantity',
          amount,
        );
      else return fail('STOCK_SOURCE_UNAVAILABLE');
    };
  const entries: StockEntry[] = [],
    warehouseId = text(head.warehouseId),
    entry = (
      line: RepositoryRecord,
      delta: bigint,
      quality = text(line.quality),
      transferId?: string,
    ) => {
      if (!['qualified', 'inspection', 'frozen'].includes(quality))
        return fail('STOCK_QUALITY_SOURCE_INVALID');
      const base = {
        lineId: text(line.id),
        quality: quality as StockEntry['quality'],
        deltaQuantity: stockDelta(delta),
      };
      entries.push(
        transferId ? { ...base, transferId } : { ...base, warehouseId },
      );
    },
    physical = async (line: RepositoryRecord) => {
      const sku = await c
        .repository('materialSkus')
        .findOne({ filter: { id: text(line.skuId) } });
      if (!sku) return fail('STOCK_MATERIAL_UNAVAILABLE');
      return sku.managementMode === 'stock';
    };
  if (head.kind === 'reversal') {
    if (!original) return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
    const movements = await c.repository('stockMovements').findMany({
      filter: {
        postingId: text(head.originalPostingId),
        documentId: text(original.id),
      },
      limit: 201,
    });
    if (movements.length > 200) return fail('STOCK_LINES_INVALID');
    for (const movement of movements) {
      const line = lines.find(
        (row) => row.originalLineId === movement.documentLineId,
      );
      if (!line) return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
      const base = {
        lineId: text(line.id),
        quality: movement.quality as StockEntry['quality'],
        deltaQuantity: stockDelta(
          -stockDeltaMicros(text(movement.deltaQuantity)),
        ),
      };
      entries.push(
        movement.transferId
          ? { ...base, transferId: text(movement.transferId) }
          : { ...base, warehouseId: text(movement.warehouseId) },
      );
    }
    for (const row of originalLines) {
      const amount = quantity(row);
      if (row.issueRequestId) affectedIssues.add(text(row.issueRequestId));
      if (
        ['purchaseReceipt', 'salesShipment', 'issue'].includes(
          text(original.kind),
        ) &&
        value(cache('stockDocumentLines', row.id), 'returnedQuantity') > 0n
      )
        return fail('STOCK_REVERSE_DEPENDENCIES');
      if (original.kind === 'purchaseReceipt')
        adjust(
          'purchaseOrderLines',
          row.purchaseOrderLineId,
          'fulfilledQuantity',
          -amount,
        );
      else if (original.kind === 'salesShipment')
        adjust(
          'salesOrderLines',
          row.salesOrderLineId,
          'fulfilledQuantity',
          -amount,
        );
      else if (original.kind === 'issue')
        adjust(
          'stockIssueFulfillments',
          row.issueRequestLineId,
          'issuedQuantity',
          -amount,
        );
      else if (
        ['purchaseReturn', 'salesReturn', 'issueReturn'].includes(
          text(original.kind),
        )
      ) {
        adjust(
          'stockDocumentLines',
          row.originalLineId,
          'returnedQuantity',
          -amount,
        );
        sourceReturn(row, -amount);
      } else if (original.kind === 'transferDispatch')
        adjust(
          'stockTransferLines',
          row.transferLineId,
          'dispatchedQuantity',
          -amount,
        );
      else if (original.kind === 'transferReceipt')
        adjust(
          'stockTransferLines',
          row.transferLineId,
          'receivedQuantity',
          -amount,
        );
      else if (original.kind === 'transferDiscrepancy')
        adjust(
          'stockTransferLines',
          row.transferLineId,
          'discrepancyQuantity',
          -amount,
        );
    }
  } else
    for (const line of lines) {
      const amount = quantity(line),
        isStock = await physical(line);
      if (head.kind === 'purchaseReceipt' || head.kind === 'salesShipment') {
        const purchase = head.kind === 'purchaseReceipt',
          table = purchase ? 'purchaseOrderLines' : 'salesOrderLines',
          id = purchase ? line.purchaseOrderLineId : line.salesOrderLineId;
        await approvedTradeLine(
          c,
          purchase ? 'purchaseOrders' : 'salesOrders',
          text(purchase ? head.purchaseOrderId : head.salesOrderId),
          text(id),
          text(head.subjectId),
        );
        adjust(table, id, 'fulfilledQuantity', amount);
        if (isStock) entry(line, purchase ? amount : -amount);
      } else if (head.kind === 'issue') {
        if (!isStock) return fail('STOCK_MATERIAL_UNAVAILABLE');
        entry(line, -amount);
      } else if (head.kind === 'productionReceipt' || head.kind === 'initial') {
        if (!isStock) return fail('STOCK_MATERIAL_UNAVAILABLE');
        entry(line, amount);
      } else if (head.kind === 'productionIssue' || head.kind === 'loss') {
        if (!isStock) return fail('STOCK_MATERIAL_UNAVAILABLE');
        entry(line, -amount);
      } else if (
        ['purchaseReturn', 'salesReturn', 'issueReturn'].includes(
          text(head.kind),
        )
      ) {
        const prior = cache('stockDocumentLines', line.originalLineId).row;
        if (prior.skuId !== line.skuId || prior.baseUnitId !== line.baseUnitId)
          return fail('STOCK_SOURCE_CHANGED');
        adjust(
          'stockDocumentLines',
          line.originalLineId,
          'returnedQuantity',
          amount,
        );
        sourceReturn(line, amount);
        if (isStock)
          entry(line, head.kind === 'purchaseReturn' ? -amount : amount);
      } else if (
        head.kind === 'transferDispatch' ||
        head.kind === 'transferReceipt' ||
        head.kind === 'transferDiscrepancy'
      ) {
        if (!isStock) return fail('STOCK_MATERIAL_UNAVAILABLE');
        const source = await approvedTradeLine(
          c,
          'stockTransfers',
          text(head.transferId),
          text(line.transferLineId),
          text(head.subjectId),
        );
        if (
          source.line.skuId !== line.skuId ||
          source.line.baseUnitId !== line.baseUnitId
        )
          return fail('STOCK_SOURCE_CHANGED');
        if (head.kind === 'transferDispatch') {
          adjust(
            'stockTransferLines',
            line.transferLineId,
            'dispatchedQuantity',
            amount,
          );
          entry(line, -amount);
          entry(line, amount, text(line.quality), text(head.transferId));
        } else if (head.kind === 'transferReceipt') {
          adjust(
            'stockTransferLines',
            line.transferLineId,
            'receivedQuantity',
            amount,
          );
          entry(line, -amount, text(line.quality), text(head.transferId));
          entry(line, amount);
        } else {
          adjust(
            'stockTransferLines',
            line.transferLineId,
            'discrepancyQuantity',
            amount,
          );
          entry(line, -amount, text(line.quality), text(head.transferId));
        }
      } else if (head.kind === 'qualityTransfer') {
        if (!isStock || line.quality === line.targetQuality)
          return fail('STOCK_QUALITY_SOURCE_INVALID');
        entry(line, -amount);
        entry(line, amount, text(line.targetQuality));
      } else if (head.kind === 'countAdjustment') {
        const source = await c.repository('stockCountLines').findOne({
          filter: {
            id: text(
              (line.selectionInput as { countLineId?: string } | null)
                ?.countLineId,
            ),
            countId: text(head.countId),
            subjectId: text(head.subjectId),
          },
        });
        if (
          !source ||
          source.actualQuantity === null ||
          source.skuId !== line.skuId ||
          source.quality !== line.quality ||
          source.warehouseId !== head.warehouseId
        )
          return fail('STOCK_COUNT_SOURCE_CHANGED');
        const delta =
          stockMicros(text(source.actualQuantity)) -
          stockMicros(text(source.baselineQuantity));
        if ((delta < 0n ? -delta : delta) !== amount)
          return fail('STOCK_COUNT_SOURCE_CHANGED');
        entry(line, delta);
      } else return fail('STOCK_KIND_INVALID');
    }
  for (const item of caches.values()) {
    if (!item.values.size) continue;
    for (const amount of item.values.values()) stockQuantity(amount);
    if (
      item.table === 'purchaseOrderLines' ||
      item.table === 'salesOrderLines'
    ) {
      if (
        value(item, 'returnedQuantity') > value(item, 'fulfilledQuantity') ||
        value(item, 'fulfilledQuantity') + value(item, 'closedQuantity') >
          stockMicros(text(item.row.baseQuantity)) +
            value(item, 'replacementQuantity')
      )
        return fail(
          head.kind === 'reversal'
            ? 'STOCK_REVERSE_DEPENDENCIES'
            : 'STOCK_SOURCE_REMAINING_EXCEEDED',
        );
    } else if (item.table === 'stockTransferLines') {
      if (
        value(item, 'dispatchedQuantity') >
          stockMicros(text(item.row.baseQuantity)) ||
        value(item, 'receivedQuantity') + value(item, 'discrepancyQuantity') >
          value(item, 'dispatchedQuantity')
      )
        return fail(
          head.kind === 'reversal'
            ? 'STOCK_REVERSE_DEPENDENCIES'
            : 'STOCK_SOURCE_REMAINING_EXCEEDED',
        );
    } else if (item.table === 'stockDocumentLines') {
      if (
        value(item, 'returnedQuantity') >
        stockMicros(text(item.row.baseQuantity))
      )
        return fail('STOCK_RETURN_REMAINING_EXCEEDED');
    } else if (
      item.table === 'stockIssueFulfillments' &&
      value(item, 'returnedQuantity') > value(item, 'issuedQuantity')
    )
      return fail('STOCK_REVERSE_DEPENDENCIES');
  }
  return {
    entries,
    apply: async () => {
      for (const item of caches.values())
        if (item.values.size)
          await c.repository(item.table).updateOne({
            filter: {
              id: text(item.row.id),
              revision: Number(item.row.revision),
            },
            values: {
              ...Object.fromEntries(
                [...item.values].map(([field, amount]) => [
                  field,
                  stockQuantity(amount),
                ]),
              ),
              revision: Number(item.row.revision) + 1,
            },
          });
      for (const id of affectedIssues) await refreshIssueFulfillment(c, id);
      if (head.kind === 'initial') {
        const reference = text(head.initializationReference);
        if (!reference) return fail('STOCK_INITIALIZATION_REFERENCE_REQUIRED');
        const prior = await c.repository('stockInitializations').findOne({
          filter: { subjectId: text(head.subjectId), warehouseId, reference },
        });
        if (prior && prior.documentId !== head.id)
          return fail('STOCK_INITIALIZATION_EXISTS');
        if (!prior)
          await c.repository('stockInitializations').createOne({
            values: {
              id: randomUUID(),
              documentId: head.id,
              subjectId: head.subjectId,
              warehouseId,
              reference,
              createdAt: new Date(),
            },
          });
      }
    },
  };
}
