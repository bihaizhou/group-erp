import { randomUuid } from '#lib/random-id';
export const executionPages = [
  {
    kind: 'purchaseOrders',
    base: '/functions/procurement/orders',
    api: 'procurement/orders',
    resource: 'procurement.orders',
    page: 'procurement-orders',
  },
  {
    kind: 'salesOrders',
    base: '/functions/sales/orders',
    api: 'sales/orders',
    resource: 'sales.orders',
    page: 'sales-orders',
  },
  {
    kind: 'inbounds',
    base: '/functions/warehouse/inbounds',
    api: 'warehouse/documents',
    resource: 'warehouse.documents',
    page: 'warehouse-inbounds',
  },
  {
    kind: 'outbounds',
    base: '/functions/warehouse/outbounds',
    api: 'warehouse/documents',
    resource: 'warehouse.documents',
    page: 'warehouse-outbounds',
  },
  {
    kind: 'stockTransfers',
    base: '/functions/warehouse/transfers',
    api: 'warehouse/transfers',
    resource: 'warehouse.transfers',
    page: 'warehouse-transfers',
  },
  {
    kind: 'stockCounts',
    base: '/functions/warehouse/counts',
    api: 'warehouse/counts',
    resource: 'warehouse.counts',
    page: 'warehouse-counts',
  },
] as const;
export type ExecutionPage = (typeof executionPages)[number];
export const pageFor = (pathname: string) => {
  const child = /\/(receipts|shipments|documents)\/(?!new(?:\/|$))[^/]+/u.exec(
    pathname,
  );
  if (child)
    return executionPages.find(
      (page) =>
        page.kind === (child[1] === 'shipments' ? 'outbounds' : 'inbounds'),
    )!;
  return executionPages.find(
    (page) => pathname === page.base || pathname.startsWith(`${page.base}/`),
  )!;
};
export const isOrder = (page: ExecutionPage) =>
  page.kind === 'purchaseOrders' || page.kind === 'salesOrders';
export const isWarehouse = (page: ExecutionPage) =>
  page.kind === 'inbounds' || page.kind === 'outbounds';
export const inboundKinds = [
  'purchaseReceipt',
  'productionReceipt',
  'salesReturn',
  'issueReturn',
  'transferReceipt',
  'initial',
  'qualityTransfer',
] as const;
export const outboundKinds = [
  'salesShipment',
  'purchaseReturn',
  'issue',
  'productionIssue',
  'transferDispatch',
  'loss',
] as const;
export type DocumentKind =
  | (typeof inboundKinds)[number]
  | (typeof outboundKinds)[number]
  | 'qualityTransfer'
  | 'transferDiscrepancy'
  | 'reversal'
  | 'countAdjustment';
export const sourceField: Partial<Record<DocumentKind, string>> = {
  purchaseReceipt: 'purchaseOrderId',
  salesShipment: 'salesOrderId',
  issue: 'issueRequestId',
  purchaseReturn: 'originalDocumentId',
  salesReturn: 'originalDocumentId',
  issueReturn: 'originalDocumentId',
  transferDispatch: 'transferId',
  transferReceipt: 'transferId',
  transferDiscrepancy: 'transferId',
  reversal: 'originalDocumentId',
};
export const sourceLineField: Partial<Record<DocumentKind, string>> = {
  purchaseReceipt: 'purchaseOrderLineId',
  salesShipment: 'salesOrderLineId',
  issue: 'issueRequestLineId',
  purchaseReturn: 'originalLineId',
  salesReturn: 'originalLineId',
  issueReturn: 'originalLineId',
  transferDispatch: 'transferLineId',
  transferReceipt: 'transferLineId',
  transferDiscrepancy: 'transferLineId',
  qualityTransfer: 'sourceBalanceId',
};
export interface Choice {
  id: string;
  code?: string;
  name?: string;
  availability?: string;
}
export interface Page<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    businessDate?: string;
  };
}
export interface Selection {
  kind: 'known';
  subjectId: string;
  skuId: string;
  unitId: string;
  unitRuleId?: string;
  quantity: string;
  baseQuantity?: string;
}
export interface Snapshot {
  code?: string;
  name?: string;
  standardName?: string;
  unitName?: string;
  baseUnitName?: string;
  specification?: string;
  attributeValues?: Record<string, string>;
}
export interface Allocation {
  requestId: string;
  requestLineId: string;
  requestVersionId: string;
  baseQuantity: string;
}
export interface InputLine {
  id: string;
  selection?: Selection;
  quantity?: string;
  baseQuantity?: string;
  notes: string;
  quality?: 'qualified' | 'inspection' | 'frozen';
  targetQuality?: 'qualified' | 'inspection' | 'frozen';
  condition?: string;
  rejectedQuantity?: string;
  replenishmentRequested?: boolean;
  unitPrice?: string | null;
  allocations?: Allocation[];
  purchaseOrderLineId?: string;
  salesOrderLineId?: string;
  issueRequestLineId?: string;
  transferLineId?: string;
  originalLineId?: string;
  sourceBalanceId?: string;
  skuId?: string;
  actualQuantity?: string | null;
  reason?: string;
}
export interface StoredLine extends InputLine {
  skuId: string;
  baseUnitId: string;
  unitId: string;
  unitRuleId?: string;
  quantity: string;
  baseQuantity: string;
  conversionModeSnapshot?: 'exact' | 'reference' | null;
  variancePercentSnapshot?: string | null;
  amount?: string | null;
  materialSnapshot: Snapshot;
  selectionInput: InputLine;
  fulfilledQuantity?: string;
  returnedQuantity?: string;
  replacementQuantity?: string;
  closedQuantity?: string;
  dispatchedQuantity?: string;
  receivedQuantity?: string;
  discrepancyQuantity?: string;
  baselineQuantity?: string;
  actualQuantity?: string | null;
  sourceSnapshot?: {
    kind: string;
    id: string;
    code: string;
    versionId: string;
    baseQuantity?: string;
    quantity?: string;
  };
  revision: number;
}
export interface ExecutionRecord {
  id: string;
  code: string;
  subjectId: string;
  warehouseId: string;
  kind?: DocumentKind;
  destinationWarehouseId?: string;
  partnerId?: string;
  currency?: string;
  totalAmount?: string | null;
  sourceChannel?: 'manual' | 'import' | 'api' | 'device';
  deliveryOn?: string | null;
  deliveryTerms?: string;
  occurredOn: string;
  reason: string;
  notes: string;
  status:
    'draft' | 'counting' | 'pending' | 'approved' | 'posted' | 'cancelled';
  revision: number;
  lifecycleVersion: number;
  contentVersion: number;
  updatedAt: string;
  baselineAt?: string | null;
  purchaseOrderId?: string;
  salesOrderId?: string;
  issueRequestId?: string;
  transferId?: string;
  originalDocumentId?: string;
  originalPostingId?: string;
  initializationReference?: string;
  productionEvidence?: ProductionEvidence;
  lossEvidence?: string;
  inspectionEvidence?: string;
  evidence?: string;
  lines: StoredLine[];
  linesRestricted?: boolean;
  review?: ReviewContext;
  allocations?: {
    restricted: boolean;
    items: {
      id: string;
      orderLineId: string;
      status: string;
      baseQuantity: string;
      source: {
        id: string;
        code: string;
        versionId: string;
        lineId: string;
        baseQuantity: string;
        materialSnapshot: Snapshot;
      };
    }[];
  };
  display: {
    company: Choice | null;
    warehouse: Choice | null;
    destinationWarehouse: Choice | null;
    partner: Choice | null;
    issueRequest?: {
      id: string;
      code: string;
      fulfillmentStatus: string | null;
    } | null;
    recipient?: Choice | null;
  };
}
export interface ReviewContext {
  restricted: boolean;
  tasks?: {
    id: string;
    round: number;
    status: string;
    createdAt?: string | null;
    decidedAt?: string | null;
    reason?: string;
    reviewers: { id: string; name: string | null }[];
    parameterSnapshot?: {
      revision?: number | null;
      references: {
        group: number;
        type: 'position' | 'user';
        name: string | null;
        code: string | null;
      }[];
    } | null;
  }[];
}
const amount = (value: string | undefined) => {
  if (value === undefined || !/^(0|[1-9]\d*)(\.\d{1,6})?$/u.test(value))
    return undefined;
  const [w, f = ''] = value.split('.');
  return BigInt(w) * 1000000n + BigInt(f.padEnd(6, '0'));
};
const decimal = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 1000000n}.${String(absolute % 1000000n).padStart(6, '0')}`
    .replace(/0+$/u, '')
    .replace(/\.$/u, '');
};
/** Read-only facts are computed for this one SKU line, never across materials. */
export function lineFacts(line: StoredLine) {
  const planned = amount(line.baseQuantity),
    fulfilled = amount(line.fulfilledQuantity),
    returned = amount(line.returnedQuantity),
    replacement = amount(line.replacementQuantity),
    closed = amount(line.closedQuantity),
    dispatched = amount(line.dispatchedQuantity),
    received = amount(line.receivedQuantity),
    discrepancy = amount(line.discrepancyQuantity);
  return {
    net:
      fulfilled !== undefined && returned !== undefined
        ? decimal(fulfilled - returned)
        : undefined,
    remaining:
      planned !== undefined &&
      fulfilled !== undefined &&
      replacement !== undefined &&
      closed !== undefined
        ? decimal(planned + replacement - fulfilled - closed)
        : undefined,
    transferRemaining:
      planned !== undefined &&
      received !== undefined &&
      discrepancy !== undefined
        ? decimal(planned - received - discrepancy)
        : undefined,
    transit:
      dispatched !== undefined &&
      received !== undefined &&
      discrepancy !== undefined
        ? decimal(dispatched - received - discrepancy)
        : undefined,
  };
}
export function quantityDifference(
  actual: string | null | undefined,
  baseline: string | undefined,
) {
  const a = amount(actual ?? undefined),
    b = amount(baseline);
  return a !== undefined && b !== undefined ? decimal(a - b) : undefined;
}
export interface ProductionEvidence {
  reference: string;
  title: string;
  description: string;
  occurredOn: string;
}
export interface Draft {
  subjectId: string;
  warehouseId: string;
  destinationWarehouseId: string;
  partnerId: string;
  occurredOn: string;
  currency: string;
  deliveryOn: string;
  deliveryTerms: string;
  reason: string;
  notes: string;
  kind: DocumentKind;
  sourceId: string;
  originalPostingId: string;
  initializationReference: string;
  productionEvidence: ProductionEvidence;
  lossEvidence: string;
  inspectionEvidence: string;
  evidence: string;
  lines: InputLine[];
}
export interface Capability {
  visible: boolean;
  enabled: boolean;
  reason?: string | null;
}
export interface Capabilities {
  recordRevision: number;
  lifecycleVersion: number;
  actions: Record<string, Capability>;
}
export interface SourceLine {
  id: string;
  skuId: string;
  baseUnitId: string;
  unitId: string;
  unitRuleId?: string | null;
  quantity: string;
  baseQuantity: string;
  conversionMode?: 'exact' | 'reference';
  variancePercent?: string | null;
  remainingQuantity: string;
  materialSnapshot: Snapshot;
  quality: 'qualified' | 'inspection' | 'frozen';
}
export interface Source extends Choice {
  subjectId: string;
  warehouseId: string;
  destinationWarehouseId?: string | null;
  status: string;
  revision: number;
  lifecycleVersion: number;
  versionId?: string;
  postingId?: string;
  lines: SourceLine[];
  available?: boolean;
}
export const newLine = (subjectId: string): InputLine => ({
  id: randomUuid(),
  selection: { kind: 'known', subjectId, skuId: '', unitId: '', quantity: '' },
  notes: '',
  unitPrice: null,
  allocations: [],
  quality: 'qualified',
});
export const blankDraft = (subjectId = '', date = ''): Draft => ({
  subjectId,
  warehouseId: '',
  destinationWarehouseId: '',
  partnerId: '',
  occurredOn: date,
  currency: 'CNY',
  deliveryOn: '',
  deliveryTerms: '',
  reason: '',
  notes: '',
  kind: 'purchaseReceipt',
  sourceId: '',
  originalPostingId: '',
  initializationReference: '',
  productionEvidence: {
    reference: '',
    title: '',
    description: '',
    occurredOn: date,
  },
  lossEvidence: '',
  inspectionEvidence: '',
  evidence: '',
  lines: [],
});
export function recordDraft(row: ExecutionRecord): Draft {
  const value = {
    ...blankDraft(row.subjectId, row.occurredOn),
    ...Object.fromEntries(
      [
        'warehouseId',
        'destinationWarehouseId',
        'partnerId',
        'currency',
        'deliveryOn',
        'deliveryTerms',
        'reason',
        'notes',
        'kind',
        'originalPostingId',
        'initializationReference',
        'productionEvidence',
        'lossEvidence',
        'inspectionEvidence',
        'evidence',
      ]
        .filter((key) => row[key as keyof ExecutionRecord] != null)
        .map((key) => [key, row[key as keyof ExecutionRecord]]),
    ),
    lines: row.lines.map((line) =>
      line.baselineQuantity !== undefined
        ? {
            id: line.id,
            skuId: line.skuId,
            quality: line.quality,
            actualQuantity: line.actualQuantity ?? null,
            reason: line.reason ?? '',
            notes: line.notes,
          }
        : structuredClone(line.selectionInput),
    ),
  };
  if (row.kind) {
    const source = row[sourceField[row.kind] as keyof ExecutionRecord];
    value.sourceId = typeof source === 'string' ? source : '';
  }
  return value;
}
export function requestContent(page: ExecutionPage, draft: Draft) {
  const common = {
    subjectId: draft.subjectId,
    warehouseId: draft.warehouseId,
    occurredOn: draft.occurredOn,
    reason: draft.reason,
    notes: draft.notes,
  };
  if (isOrder(page))
    return {
      ...common,
      partnerId: draft.partnerId,
      sourceChannel: 'manual',
      currency: draft.currency.trim().toUpperCase(),
      deliveryOn: draft.deliveryOn || null,
      deliveryTerms: draft.deliveryTerms,
      lines: draft.lines.map((line) => ({
        id: line.id,
        selection: line.selection,
        notes: line.notes,
        unitPrice: line.unitPrice ?? null,
        allocations: line.allocations ?? [],
      })),
    };
  if (page.kind === 'stockTransfers')
    return {
      ...common,
      destinationWarehouseId: draft.destinationWarehouseId,
      lines: draft.lines.map((line) => ({
        id: line.id,
        selection: line.selection,
        notes: line.notes,
      })),
    };
  if (page.kind === 'stockCounts')
    return {
      ...common,
      ...(draft.lines.length
        ? {
            lines: draft.lines.map((line) => ({
              id: line.id,
              skuId: line.skuId,
              quality: line.quality,
              actualQuantity: line.actualQuantity ?? null,
              reason: line.reason ?? '',
              notes: line.notes,
            })),
          }
        : {}),
    };
  const kind = draft.kind,
    field = sourceField[kind],
    body: Record<string, unknown> = {
      ...common,
      kind,
      ...(field ? { [field]: draft.sourceId } : {}),
    };
  if (kind === 'reversal')
    return {
      ...body,
      originalPostingId: draft.originalPostingId,
      evidence: draft.evidence,
    };
  if (['productionReceipt', 'productionIssue'].includes(kind))
    body.productionEvidence = draft.productionEvidence;
  if (kind === 'initial')
    body.initializationReference = draft.initializationReference;
  if (kind === 'loss') body.lossEvidence = draft.lossEvidence;
  if (kind === 'qualityTransfer')
    body.inspectionEvidence = draft.inspectionEvidence;
  if (kind === 'transferDiscrepancy') body.evidence = draft.evidence;
  body.lines = draft.lines.map((line) => {
    const result: Record<string, unknown> = { id: line.id, notes: line.notes };
    if (
      ['initial', 'productionReceipt', 'productionIssue', 'loss'].includes(kind)
    )
      return { ...result, selection: line.selection, quality: line.quality };
    const lineField = sourceLineField[kind];
    if (lineField) result[lineField] = line[lineField as keyof InputLine];
    result.quantity = line.quantity;
    if (
      (kind === 'purchaseReceipt' || kind === 'salesShipment') &&
      line.baseQuantity !== undefined
    )
      result.baseQuantity = line.baseQuantity;
    if (['purchaseReceipt', 'purchaseReturn', 'issueReturn'].includes(kind))
      result.quality = line.quality;
    if (kind === 'purchaseReceipt')
      result.rejectedQuantity = line.rejectedQuantity ?? '0';
    if (kind === 'purchaseReturn')
      result.replenishmentRequested = line.replenishmentRequested ?? false;
    if (kind === 'salesReturn' || kind === 'issueReturn')
      result.condition = line.condition ?? '';
    if (kind === 'qualityTransfer') result.targetQuality = line.targetQuality;
    return result;
  });
  return body;
}
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function validateDraft(
  page: ExecutionPage,
  draft: Draft,
  changeReason?: string,
) {
  const errors: Record<string, string> = {};
  for (const key of ['subjectId', 'warehouseId', 'occurredOn'] as const)
    if (!draft[key]) errors[key] = 'required';
  if (isOrder(page)) {
    if (!draft.partnerId) errors.partnerId = 'required';
    if (!/^[A-Za-z]{3}$/u.test(draft.currency))
      errors.currency = 'currencyInvalid';
  }
  if (
    page.kind === 'stockTransfers' &&
    (!draft.destinationWarehouseId ||
      draft.destinationWarehouseId === draft.warehouseId)
  )
    errors.destinationWarehouseId = 'differentWarehouse';
  if (isWarehouse(page)) {
    if (!draft.reason.trim()) errors.reason = 'required';
    if (sourceField[draft.kind] && !draft.sourceId)
      errors.sourceId = 'required';
    for (const field of [
      'initializationReference',
      'lossEvidence',
      'inspectionEvidence',
      'evidence',
    ] as const)
      if (
        ({
          initializationReference: 'initial',
          lossEvidence: 'loss',
          inspectionEvidence: 'qualityTransfer',
          evidence: 'reversal',
        }[field] === draft.kind ||
          (field === 'evidence' && draft.kind === 'transferDiscrepancy')) &&
        !draft[field].trim()
      )
        errors[field] = 'required';
    if (['productionReceipt', 'productionIssue'].includes(draft.kind))
      for (const field of [
        'reference',
        'title',
        'description',
        'occurredOn',
      ] as const)
        if (!draft.productionEvidence[field].trim())
          errors[`productionEvidence.${field}`] = 'required';
  }
  if (changeReason !== undefined && !changeReason.trim())
    errors.changeReason = 'required';
  if (
    page.kind !== 'stockCounts' &&
    draft.kind !== 'reversal' &&
    !draft.lines.length
  )
    errors.lines = 'linesRequired';
  for (const line of draft.lines) {
    const prefix = `line-${line.id}-`,
      quantity =
        page.kind === 'stockCounts'
          ? line.actualQuantity
          : (line.selection?.quantity ?? line.quantity);
    if (page.kind === 'stockCounts' && quantity === null) continue;
    if (
      !quantity ||
      !/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/u.test(quantity) ||
      (page.kind !== 'stockCounts' && !/[1-9]/u.test(quantity))
    )
      errors[`${prefix}quantity`] = 'quantityInvalid';
    const counted = line.selection?.baseQuantity ?? line.baseQuantity;
    if (
      counted !== undefined &&
      (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/u.test(counted) ||
        !/[1-9]/u.test(counted))
    )
      errors[`${prefix}baseQuantity`] = 'quantityInvalid';
    if (line.selection && (!line.selection.skuId || !line.selection.unitId))
      errors[`${prefix}selection`] = 'required';
    if (
      page.kind === 'stockCounts' &&
      line.actualQuantity !== null &&
      !line.skuId
    )
      errors[`${prefix}selection`] = 'required';
    if (
      ['salesReturn', 'issueReturn'].includes(draft.kind) &&
      !line.condition?.trim()
    )
      errors[`${prefix}condition`] = 'required';
  }
  return errors;
}
