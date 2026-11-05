import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { MaterialPolicies } from './material-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import type { WarehouseContent } from './execution-model.js';
import {
  executionRepo as repo,
  executionText as text,
  executionJson as json,
} from './execution-access.js';
import { approvedIssueLine } from './inventory-issue-source.js';
import { approvedTradeLine } from './inventory-trade-source.js';
import {
  exactBaseQuantity,
  referenceBaseQuantity,
  type MaterialSelectionInput,
} from './supply-chain-model.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
} from './inventory-quantity.js';

const sourceFields = [
  'skuId',
  'baseUnitId',
  'unitId',
  'unitRuleId',
  'numeratorSnapshot',
  'denominatorSnapshot',
  'conversionModeSnapshot',
  'variancePercentSnapshot',
  'materialSnapshot',
  'commercialSnapshot',
  'sourceSnapshot',
];
const fromSource = (source: RepositoryRecord) => ({
  ...Object.fromEntries(sourceFields.map((key) => [key, source[key] ?? null])),
  // Rows from before reference conversions existed, and lines whose source has
  // no conversion (transfers, counts), are exact by definition.
  conversionModeSnapshot: text(source.conversionModeSnapshot) || 'exact',
});
async function converted(
  c: DatabaseConnection,
  source: RepositoryRecord,
  quantity: string,
) {
  const unit = await c
      .repository('measureUnits')
      .findOne({ filter: { id: text(source.unitId) } }),
    base = await c
      .repository('measureUnits')
      .findOne({ filter: { id: text(source.baseUnitId) } });
  if (!unit || !base) return fail('STOCK_MATERIAL_UNAVAILABLE');
  return exactBaseQuantity(
    quantity,
    text(source.numeratorSnapshot),
    text(source.denominatorSnapshot),
    Number(unit.precision),
    Number(base.precision),
  );
}
async function countedBase(
  c: DatabaseConnection,
  source: RepositoryRecord,
  baseQuantity: string,
  quantity: string,
) {
  const unit = await c
      .repository('measureUnits')
      .findOne({ filter: { id: text(source.unitId) } }),
    base = await c
      .repository('measureUnits')
      .findOne({ filter: { id: text(source.baseUnitId) } });
  if (!unit || !base) return fail('STOCK_MATERIAL_UNAVAILABLE');
  return referenceBaseQuantity(
    baseQuantity,
    quantity,
    text(source.numeratorSnapshot),
    text(source.denominatorSnapshot),
    Number(unit.precision),
    Number(base.precision),
    text(source.variancePercentSnapshot) || '3',
  );
}
async function baseOnly(
  c: DatabaseConnection,
  source: RepositoryRecord,
  quantity: string,
) {
  const base = await c
    .repository('measureUnits')
    .findOne({ filter: { id: text(source.baseUnitId) } });
  if (!base) return fail('STOCK_MATERIAL_UNAVAILABLE');
  return exactBaseQuantity(
    quantity,
    '1',
    '1',
    Number(base.precision),
    Number(base.precision),
  );
}
async function sourceVisible(
  c: DatabaseConnection,
  table: string,
  id: string,
  subjectId: string,
  p: MaterialPolicies,
) {
  if (!(await repo(c, table, p).exists({ filter: { id, subjectId } })))
    return fail('STOCK_SOURCE_UNAVAILABLE');
}
export async function warehouseSourceLines(
  c: DatabaseConnection,
  content: WarehouseContent,
  p: MaterialPolicies,
  materials: SupplyChainMaterialService,
  existing: RepositoryRecord[] = [],
  preview = false,
) {
  const values: RepositoryRecord[] = [],
    derived: RepositoryRecord = {};
  if (content.kind === 'reversal') {
    await sourceVisible(
      c,
      'stockDocuments',
      content.originalDocumentId,
      content.subjectId,
      p,
    );
    const original = await c.repository('stockDocuments').findOne({
        filter: {
          id: content.originalDocumentId,
          subjectId: content.subjectId,
          status: 'posted',
        },
      }),
      posting = await c.repository('stockPostings').findOne({
        filter: {
          id: content.originalPostingId,
          documentId: content.originalDocumentId,
          subjectId: content.subjectId,
        },
      });
    if (
      !original ||
      !posting ||
      original.kind === 'reversal' ||
      original.warehouseId !== content.warehouseId
    )
      return fail('STOCK_REVERSE_SOURCE_UNAVAILABLE');
    if (
      await c
        .repository('stockPostings')
        .exists({ filter: { reversesPostingId: content.originalPostingId } })
    )
      return fail('STOCK_ALREADY_REVERSED');
    const lines = await repo(c, 'stockDocumentLines', p).findMany({
      filter: {
        documentId: content.originalDocumentId,
        subjectId: content.subjectId,
        status: 'active',
      },
      sort: (s) => [s.field('lineNo').asc()],
      limit: 101,
    });
    if (
      !lines.length ||
      lines.length > 100 ||
      lines.length !==
        (await c.repository('stockDocumentLines').count({
          filter: {
            documentId: content.originalDocumentId,
            status: 'active',
          },
        }))
    )
      return fail('STOCK_FORBIDDEN');
    for (const [index, line] of lines.entries()) {
      if (
        !line.skuId ||
        !line.baseUnitId ||
        !line.quantity ||
        !line.baseQuantity ||
        !line.materialSnapshot
      )
        return fail('STOCK_FORBIDDEN');
      const stored = await c.repository('stockDocumentLines').findOne({
        filter: {
          id: text(line.id),
          documentId: content.originalDocumentId,
          subjectId: content.subjectId,
        },
      });
      if (!stored) return fail('STOCK_SOURCE_UNAVAILABLE');
      values.push({
        ...fromSource(stored),
        id:
          existing.find((row) => row.originalLineId === line.id)?.id ??
          randomUUID(),
        lineNo: index + 1,
        status: 'active',
        revision: 1,
        originalDocumentId: content.originalDocumentId,
        originalLineId: line.id,
        sourceSnapshot: json({
          kind: 'stockDocuments',
          id: original.id,
          code: original.code,
          versionId: original.approvedVersionId ?? null,
          lineId: line.id,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
        }),
        quantity: line.quantity,
        baseQuantity: line.baseQuantity,
        quality: line.quality,
        notes: '',
        condition: '',
        rejectedQuantity: '0',
        returnedQuantity: '0',
        replenishmentRequested: false,
        selectionInput: { originalLineId: line.id },
        issueRequestId: null,
        issueRequestLineId: null,
        purchaseOrderId: null,
        purchaseOrderLineId: null,
        salesOrderId: null,
        salesOrderLineId: null,
        transferId: null,
        transferLineId: null,
        sourceBalanceId: null,
        targetQuality: null,
      });
    }
    derived.transferId = original.transferId ?? null;
    return { lines: values, derived };
  }
  for (const [index, input] of content.lines.entries()) {
    const raw = input as unknown as RepositoryRecord,
      id = text(raw.id),
      quantity = text(raw.quantity),
      base: RepositoryRecord = {
        id,
        lineNo: index + 1,
        status: 'active',
        revision: 1,
        quality: 'qualified',
        notes: text(raw.notes),
        condition: text(raw.condition),
        rejectedQuantity: raw.rejectedQuantity ?? '0',
        baseRejectedQuantity: '0',
        returnedQuantity: '0',
        replenishmentRequested: raw.replenishmentRequested ?? false,
        issueRequestId: null,
        issueRequestLineId: null,
        purchaseOrderId: null,
        purchaseOrderLineId: null,
        salesOrderId: null,
        salesOrderLineId: null,
        transferId: null,
        transferLineId: null,
        originalDocumentId: null,
        originalLineId: null,
        sourceBalanceId: null,
        targetQuality: null,
        selectionInput: json(input),
      };
    if ('selection' in raw) {
      const selection = raw.selection as MaterialSelectionInput;
      if (
        selection.kind !== 'known' ||
        selection.subjectId !== content.subjectId
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE', `lines.${id}.selection`);
      const resolved = await (
        preview
          ? materials.previewSelectionInTransaction.bind(materials)
          : materials.resolveSelectionInTransaction.bind(materials)
      )(c, 'warehouse', selection, p);
      if (
        resolved.identificationStatus !== 'identified' ||
        resolved.managementModeSnapshot !== 'stock'
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      Object.assign(base, fromSource(resolved as unknown as RepositoryRecord), {
        quantity: resolved.requestedQuantity,
        baseQuantity: resolved.baseQuantity,
        quality: raw.quality,
      });
    } else if (content.kind === 'issue') {
      await sourceVisible(
        c,
        'materialIssueRequests',
        content.issueRequestId,
        content.subjectId,
        p,
      );
      await sourceVisible(
        c,
        'materialIssueRequestLines',
        text(raw.issueRequestLineId),
        content.subjectId,
        p,
      );
      const source = await approvedIssueLine(
        c,
        content.issueRequestId,
        text(raw.issueRequestLineId),
        content.subjectId,
      );
      Object.assign(base, fromSource(source.frozen), {
        quantity,
        baseQuantity: await converted(c, source.frozen, quantity),
        issueRequestId: content.issueRequestId,
        issueRequestLineId: raw.issueRequestLineId,
        sourceSnapshot: json({
          kind: 'materialIssueRequests',
          id: source.head.id,
          code: source.head.code,
          versionId: source.head.approvedVersionId,
          lineId: source.frozen.id,
          baseQuantity: source.frozen.baseQuantity,
          quantity: source.frozen.quantity ?? source.frozen.requestedQuantity,
        }),
      });
    } else if (
      content.kind === 'purchaseReceipt' ||
      content.kind === 'salesShipment'
    ) {
      const purchase = content.kind === 'purchaseReceipt',
        parent = purchase ? content.purchaseOrderId : content.salesOrderId,
        lineId = text(
          raw[purchase ? 'purchaseOrderLineId' : 'salesOrderLineId'],
        ),
        kind = purchase ? 'purchaseOrders' : 'salesOrders';
      await sourceVisible(c, kind, parent, content.subjectId, p);
      await sourceVisible(
        c,
        purchase ? 'purchaseOrderLines' : 'salesOrderLines',
        lineId,
        content.subjectId,
        p,
      );
      const source = await approvedTradeLine(
        c,
        kind,
        parent,
        lineId,
        content.subjectId,
      );
      if (source.head.warehouseId !== content.warehouseId)
        return fail('STOCK_SOURCE_WAREHOUSE_CHANGED', 'warehouseId');
      const reference =
          text(source.frozen.conversionModeSnapshot) === 'reference',
        rejectedQuantity = purchase ? text(raw.rejectedQuantity ?? '0') : '0';
      let receivedBase: string, baseRejectedQuantity: string;
      if (reference) {
        // The measured tonne never posts. The counted sheet quantity is the
        // stock fact and the tolerance checks it against the ordered ratio.
        if (rejectedQuantity !== '0')
          return fail(
            'STOCK_REFERENCE_REJECTION_UNSUPPORTED',
            'rejectedQuantity',
          );
        if (!raw.baseQuantity)
          return fail('SUPPLY_REFERENCE_QUANTITY_REQUIRED', 'baseQuantity');
        receivedBase = await countedBase(
          c,
          source.frozen,
          text(raw.baseQuantity),
          quantity,
        );
        baseRejectedQuantity = '0';
      } else {
        if (raw.baseQuantity)
          return fail('STOCK_BASE_QUANTITY_INVALID', 'baseQuantity');
        receivedBase = await converted(c, source.frozen, quantity);
        baseRejectedQuantity =
          rejectedQuantity === '0'
            ? '0'
            : await converted(c, source.frozen, rejectedQuantity);
      }
      if (stockMicros(baseRejectedQuantity) > stockMicros(receivedBase))
        return fail('STOCK_REJECTED_EXCEEDED', 'rejectedQuantity');
      const baseQuantity = stockQuantity(
        stockMicros(receivedBase) - stockMicros(baseRejectedQuantity),
      );
      Object.assign(base, fromSource(source.frozen), {
        quantity,
        baseQuantity,
        baseRejectedQuantity,
        [purchase ? 'purchaseOrderId' : 'salesOrderId']: parent,
        [purchase ? 'purchaseOrderLineId' : 'salesOrderLineId']: lineId,
        quality: purchase ? raw.quality : 'qualified',
        sourceSnapshot: json({
          kind,
          id: source.head.id,
          code: source.head.code,
          versionId: source.head.approvedVersionId,
          lineId: source.frozen.id,
          baseQuantity: source.frozen.baseQuantity,
          quantity: source.frozen.quantity ?? source.frozen.requestedQuantity,
        }),
        commercialSnapshot: {
          unitPrice: source.frozen.unitPrice ?? null,
          currency: source.head.currency,
          orderVersionId: source.head.approvedVersionId,
        },
      });
    } else if (
      content.kind === 'transferDispatch' ||
      content.kind === 'transferReceipt' ||
      content.kind === 'transferDiscrepancy'
    ) {
      await sourceVisible(
        c,
        'stockTransfers',
        content.transferId,
        content.subjectId,
        p,
      );
      await sourceVisible(
        c,
        'stockTransferLines',
        text(raw.transferLineId),
        content.subjectId,
        p,
      );
      const source = await approvedTradeLine(
          c,
          'stockTransfers',
          content.transferId,
          text(raw.transferLineId),
          content.subjectId,
        ),
        expected =
          content.kind === 'transferReceipt'
            ? source.head.destinationWarehouseId
            : source.head.warehouseId;
      if (
        content.kind === 'transferDiscrepancy'
          ? ![
              source.head.warehouseId,
              source.head.destinationWarehouseId,
            ].includes(content.warehouseId)
          : expected !== content.warehouseId
      )
        return fail('STOCK_SOURCE_WAREHOUSE_CHANGED', 'warehouseId');
      Object.assign(base, fromSource(source.frozen), {
        quantity,
        baseQuantity: await converted(c, source.frozen, quantity),
        transferId: content.transferId,
        transferLineId: raw.transferLineId,
        quality: source.frozen.quality,
        sourceSnapshot: json({
          kind: 'stockTransfers',
          id: source.head.id,
          code: source.head.code,
          versionId: source.head.approvedVersionId,
          lineId: source.frozen.id,
          baseQuantity: source.frozen.baseQuantity,
          quantity: source.frozen.quantity ?? source.frozen.requestedQuantity,
        }),
      });
    } else if (
      content.kind === 'purchaseReturn' ||
      content.kind === 'salesReturn' ||
      content.kind === 'issueReturn'
    ) {
      await sourceVisible(
        c,
        'stockDocuments',
        content.originalDocumentId,
        content.subjectId,
        p,
      );
      const expected = {
          purchaseReturn: 'purchaseReceipt',
          salesReturn: 'salesShipment',
          issueReturn: 'issue',
        }[content.kind],
        original = await c.repository('stockDocuments').findOne({
          filter: {
            id: content.originalDocumentId,
            subjectId: content.subjectId,
            status: 'posted',
            kind: expected,
          },
        }),
        originalPosting = await c.repository('stockPostings').findOne({
          filter: {
            documentId: content.originalDocumentId,
            subjectId: content.subjectId,
          },
        }),
        line = await repo(c, 'stockDocumentLines', p).findOne({
          filter: {
            id: text(raw.originalLineId),
            documentId: content.originalDocumentId,
            subjectId: content.subjectId,
            status: 'active',
          },
        });
      if (
        !original ||
        !originalPosting ||
        !line ||
        (await c
          .repository('stockPostings')
          .exists({ filter: { reversesPostingId: text(originalPosting.id) } }))
      )
        return fail('STOCK_SOURCE_UNAVAILABLE');
      if (
        !line.skuId ||
        !line.baseUnitId ||
        !line.unitId ||
        !line.numeratorSnapshot ||
        !line.denominatorSnapshot
      )
        return fail('STOCK_FORBIDDEN');
      const stored = await c.repository('stockDocumentLines').findOne({
        filter: {
          id: text(line.id),
          documentId: content.originalDocumentId,
          subjectId: content.subjectId,
        },
      });
      if (!stored) return fail('STOCK_SOURCE_UNAVAILABLE');
      // A reference receipt returned by count is denominated in the stock unit;
      // there is no weighing step and therefore nothing to convert.
      const reference = text(stored.conversionModeSnapshot) === 'reference',
        snapshot = (stored.materialSnapshot ?? {}) as Record<string, unknown>,
        baseQuantity = reference
          ? await baseOnly(c, line, quantity)
          : await converted(c, line, quantity);
      Object.assign(base, fromSource(stored), {
        quantity,
        baseQuantity,
        ...(reference
          ? {
              unitId: text(line.baseUnitId),
              unitRuleId: null,
              numeratorSnapshot: '1',
              denominatorSnapshot: '1',
              materialSnapshot: {
                ...snapshot,
                unitName: snapshot.baseUnitName,
              },
            }
          : {}),
        originalDocumentId: content.originalDocumentId,
        originalLineId: line.id,
        sourceSnapshot: json({
          kind: 'stockDocuments',
          id: original.id,
          code: original.code,
          versionId: original.approvedVersionId ?? null,
          lineId: line.id,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
        }),
        quality: content.kind === 'salesReturn' ? 'inspection' : raw.quality,
        issueRequestId: line.issueRequestId ?? null,
        issueRequestLineId: line.issueRequestLineId ?? null,
        purchaseOrderId: line.purchaseOrderId ?? null,
        purchaseOrderLineId: line.purchaseOrderLineId ?? null,
        salesOrderId: line.salesOrderId ?? null,
        salesOrderLineId: line.salesOrderLineId ?? null,
      });
      Object.assign(derived, {
        issueRequestId: original.issueRequestId ?? null,
        purchaseOrderId: original.purchaseOrderId ?? null,
        salesOrderId: original.salesOrderId ?? null,
      });
    } else if (content.kind === 'qualityTransfer') {
      const source = await repo(c, 'stockBalances', p).findOne({
        filter: {
          id: text(raw.sourceBalanceId),
          subjectId: content.subjectId,
          warehouseId: content.warehouseId,
        },
      });
      if (
        !source ||
        !source.skuId ||
        !source.baseUnitId ||
        !source.quality ||
        source.quality === raw.targetQuality
      )
        return fail(
          'STOCK_QUALITY_SOURCE_INVALID',
          `lines.${id}.sourceBalanceId`,
        );
      const sku = await repo(c, 'materialSkus', p).findOne({
          filter: { id: text(source.skuId) },
        }),
        unit = await repo(c, 'measureUnits', p).findOne({
          filter: { id: text(source.baseUnitId) },
        });
      if (!sku || !unit) return fail('STOCK_MATERIAL_UNAVAILABLE');
      Object.assign(base, {
        skuId: source.skuId,
        baseUnitId: source.baseUnitId,
        unitId: source.baseUnitId,
        unitRuleId: null,
        numeratorSnapshot: '1',
        denominatorSnapshot: '1',
        quantity,
        baseQuantity: quantity,
        materialSnapshot: {
          code: sku.code,
          name: sku.name,
          baseUnitName: unit.name,
          unitName: unit.name,
        },
        quality: source.quality,
        sourceBalanceId: source.id,
        targetQuality: raw.targetQuality,
      });
    } else return fail('STOCK_KIND_INVALID');
    if (stockMicros(text(base.baseQuantity)) <= 0n)
      return fail('STOCK_QUANTITY_INVALID', `lines.${id}.quantity`);
    values.push(base);
  }
  return { lines: values, derived };
}
