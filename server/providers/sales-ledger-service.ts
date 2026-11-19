import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';
import type { MaterialPolicies } from './material-service.js';
import { executionCompany, executionText as text } from './execution-access.js';
import {
  decimalText,
  normalizeDecimal,
  positiveDecimal,
} from './material-model.js';
import { amountCents, amountText, orderAmount } from './order-amount.js';

const id = z.string().uuid();
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
const dateText = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const money = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/);
const price = decimalText.refine(positiveDecimal);

export const priceListStatus = z.enum(['active', 'inactive']);
export const receivableStatus = z.enum([
  'open',
  'partially_paid',
  'paid',
  'void',
]);

export const priceListQuery = z.strictObject({
  subjectId: id,
  status: priceListStatus.optional(),
  customerId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const priceListFields = z.strictObject({
  customerId: id.optional(),
  skuId: id.optional(),
  unitPrice: price.nullable().optional(),
  currency: currency.optional(),
  effectiveFrom: dateText.optional(),
  effectiveTo: dateText.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export const priceListCreate = priceListFields.extend({
  subjectId: id,
  customerId: id,
  skuId: id,
  unitPrice: price,
  effectiveFrom: dateText,
  requestKey: id,
});
export const priceListUpdate = priceListFields.extend({
  version: z.number().int().min(1).optional(),
  requestKey: id,
});
export const priceListDisable = z.strictObject({
  version: z.number().int().min(1).optional(),
  requestKey: id,
});

export const receivableQuery = z.strictObject({
  subjectId: id,
  status: receivableStatus.optional(),
  customerId: id.optional(),
  orderId: id.optional(),
  documentId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const paymentCreate = z.strictObject({
  amount: money.refine(
    (value) => BigInt(value.replace('.', '')) > 0n,
    'The payment amount must be greater than zero.',
  ),
  paidAt: dateText,
  method: z.string().trim().min(1).max(32),
  reference: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  requestKey: id,
});

export type PriceListQuery = z.infer<typeof priceListQuery>;
export type ReceivableQuery = z.infer<typeof receivableQuery>;
export type PriceListCreate = z.infer<typeof priceListCreate>;
export type PriceListUpdate = z.infer<typeof priceListUpdate>;
export type PaymentCreate = z.infer<typeof paymentCreate>;

function ledgerError(reason: string, field?: string): never {
  const status =
    reason === 'SALES_COMPANY_FORBIDDEN'
      ? 'PERMISSION_DENIED'
      : reason === 'SALES_PRICE_LIST_CONFLICT' ||
          reason === 'SALES_RECEIVABLE_CONFLICT'
        ? 'ABORTED'
        : reason === 'SALES_PRICE_LIST_NOT_FOUND' ||
            reason === 'SALES_RECEIVABLE_NOT_FOUND'
          ? 'NOT_FOUND'
          : reason === 'SALES_PAYMENT_EXCEEDS' ||
              reason === 'SALES_PAYMENT_INVALID'
            ? 'INVALID_ARGUMENT'
            : 'FAILED_PRECONDITION';
  throw new ApiError({
    status,
    domain: 'sales',
    reason,
    message:
      status === 'PERMISSION_DENIED'
        ? 'The sales ledger record is outside the permitted company scope.'
        : status === 'NOT_FOUND'
          ? 'The sales ledger record does not exist.'
          : status === 'ABORTED'
            ? 'The sales ledger record conflicts with the current data.'
            : status === 'INVALID_ARGUMENT'
              ? 'The sales ledger input is invalid.'
              : 'The sales ledger operation could not be completed.',
    ...(field
      ? { fieldViolations: [{ field, description: reason }] }
      : {}),
  });
}

const day = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).slice(0, 10);
};
const nullable = (value: unknown): string | null => {
  const result = text(value);
  return result ? result : null;
};
const sumPayments = async (
  c: DatabaseConnection,
  receivableIds: string[],
): Promise<Map<string, bigint>> => {
  const totals = new Map<string, bigint>();
  // The filter capability does not accept `$in`, so each receivable is summed
  // through its own indexed lookup (there is at most one page of rows).
  for (const receivableId of receivableIds) {
    const rows = await c.repository('salesPayments').findMany({
      filter: { receivableId },
      limit: 100_000,
    });
    let total = 0n;
    for (const row of rows) total += amountCents(text(row.amount));
    totals.set(receivableId, total);
  }
  return totals;
};

type Party = { id: string; code: string; name: string };
const parties = async (
  c: DatabaseConnection,
  table: 'businessPartners' | 'salesOrders' | 'stockDocuments',
  ids: string[],
): Promise<Map<string, Party>> => {
  const map = new Map<string, Party>();
  // The primary key only accepts shorthand equality in this application's
  // filter capability, so ids are resolved one by one.
  for (const id of ids) {
    const row = await c.repository(table).findOne({ filter: { id } });
    if (row)
      map.set(id, {
        id,
        code: text(row.code),
        name: table === 'businessPartners' ? text(row.name) : text(row.code),
      });
  }
  return map;
};

export type SalesLedgerActor = { id: string };

/**
 * Customer material prices, shipment receivables and collections.
 *
 * The order line price is snapshotted into the receivable when the shipment is
 * posted, so a later price-list change never rewrites an issued balance. A
 * payment only appends a fact and moves the receivable status; the receivable
 * amount itself is immutable.
 */
export class SalesLedgerService {
  constructor(private readonly database: DatabaseManager) {}

  private async company(
    c: DatabaseConnection,
    subjectId: string,
    policies: MaterialPolicies,
  ) {
    try {
      await executionCompany(c, subjectId, policies);
    } catch {
      ledgerError('SALES_COMPANY_FORBIDDEN', 'subjectId');
    }
  }

  private async customer(
    c: DatabaseConnection,
    subjectId: string,
    customerId: string,
  ) {
    const partner = await c
      .repository('businessPartners')
      .findOne({ filter: { id: customerId } });
    if (!partner || text(partner.status) !== 'active')
      ledgerError('SALES_REFERENCE_UNAVAILABLE', 'customerId');
    const policy = await c.repository('partnerRolePolicies').findOne({
      filter: { partnerId: customerId, partnerRole: 'customer' },
    });
    if (!policy || text(policy.status) !== 'active')
      ledgerError('SALES_REFERENCE_UNAVAILABLE', 'customerId');
    if (text(policy.scopeMode) !== 'all') {
      const scoped = await c.repository('partnerCompanyScopes').findOne({
        filter: { policyId: text(policy.id), subjectId },
      });
      if (!scoped) ledgerError('SALES_REFERENCE_UNAVAILABLE', 'customerId');
    }
  }

  private async material(c: DatabaseConnection, skuId: string) {
    const sku = await c
      .repository('materialSkus')
      .findOne({ filter: { id: skuId } });
    if (!sku || text(sku.status) !== 'active')
      ledgerError('SALES_REFERENCE_UNAVAILABLE', 'skuId');
  }

  private async priceView(
    c: DatabaseConnection,
    row: RepositoryRecord,
  ): Promise<Record<string, unknown>> {
    const customerId = text(row.customerId),
      skuId = text(row.skuId),
      partners = await parties(c, 'businessPartners', [customerId]),
      skus = await c
        .repository('materialSkus')
        .findMany({ filter: { id: skuId } });
    return {
      ...row,
      unitPrice: nullable(row.unitPrice),
      effectiveFrom: day(row.effectiveFrom),
      effectiveTo: day(row.effectiveTo),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: partners.get(customerId) ?? null,
      sku: skus[0]
        ? {
            id: text(skus[0].id),
            code: text(skus[0].code),
            name: text(skus[0].name),
          }
        : null,
    };
  }

  async priceLists(
    query: PriceListQuery,
    policies: MaterialPolicies,
  ): Promise<[Record<string, unknown>[], number]> {
    const c = this.database.connection();
    await this.company(c, query.subjectId, policies);
    const filter = {
      subjectId: query.subjectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const rows = await c.repository('salesPriceLists').findMany({
      filter,
      sort: (sort) => [
        sort.field('effectiveFrom').desc(),
        sort.field('createdAt').desc(),
      ],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const total = await c.repository('salesPriceLists').count({ filter });
    return [
      await Promise.all(rows.map((row) => this.priceView(c, row))),
      total,
    ];
  }

  async createPriceList(
    input: PriceListCreate,
    policies: MaterialPolicies,
    actor: SalesLedgerActor,
  ) {
    return this.database.transaction(async (c) => {
      await this.company(c, input.subjectId, policies);
      await this.customer(c, input.subjectId, input.customerId);
      await this.material(c, input.skuId);
      this.validateRange(input.effectiveFrom, input.effectiveTo ?? null);
      const duplicate = await this.findPriceList(
        c,
        input.subjectId,
        input.customerId,
        input.skuId,
        input.effectiveFrom,
      );
      if (duplicate) ledgerError('SALES_PRICE_LIST_CONFLICT', 'effectiveFrom');
      const now = new Date();
      const created = await c.repository('salesPriceLists').createOne({
        values: {
          id: randomUUID(),
          subjectId: input.subjectId,
          customerId: input.customerId,
          skuId: input.skuId,
          unitPrice: normalizeDecimal(input.unitPrice),
          currency: input.currency ?? 'CNY',
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          status: 'active',
          note: input.note ?? null,
          version: 1,
          createdBy: actor.id,
          updatedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      return this.priceView(c, created.record);
    });
  }

  async updatePriceList(
    priceListId: string,
    input: PriceListUpdate,
    policies: MaterialPolicies,
    actor: SalesLedgerActor,
  ) {
    return this.database.transaction(async (c) => {
      const row = await this.priceListRow(c, priceListId);
      const subjectId = text(row.subjectId);
      await this.company(c, subjectId, policies);
      const customerId = input.customerId ?? text(row.customerId),
        skuId = input.skuId ?? text(row.skuId),
        effectiveFrom = input.effectiveFrom ?? day(row.effectiveFrom) ?? '',
        effectiveTo =
          input.effectiveTo === undefined
            ? day(row.effectiveTo)
            : input.effectiveTo;
      if (customerId !== text(row.customerId))
        await this.customer(c, subjectId, customerId);
      if (skuId !== text(row.skuId)) await this.material(c, skuId);
      this.validateRange(effectiveFrom, effectiveTo);
      if (
        customerId !== text(row.customerId) ||
        skuId !== text(row.skuId) ||
        effectiveFrom !== day(row.effectiveFrom)
      ) {
        const duplicate = await this.findPriceList(
          c,
          subjectId,
          customerId,
          skuId,
          effectiveFrom,
        );
        if (duplicate && text(duplicate.id) !== priceListId)
          ledgerError('SALES_PRICE_LIST_CONFLICT', 'effectiveFrom');
      }
      if (input.version !== undefined && input.version !== Number(row.version))
        ledgerError('SALES_PRICE_LIST_CONFLICT', 'version');
      const result = await c.repository('salesPriceLists').updateOne({
        filter: { id: priceListId, version: Number(row.version) },
        values: {
          customerId,
          skuId,
          unitPrice:
            input.unitPrice === undefined
              ? row.unitPrice
              : input.unitPrice === null
                ? null
                : normalizeDecimal(input.unitPrice),
          currency: input.currency ?? text(row.currency) ?? 'CNY',
          effectiveFrom,
          effectiveTo,
          note: input.note === undefined ? row.note : input.note,
          version: Number(row.version) + 1,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      });
      if (!result.record) ledgerError('SALES_PRICE_LIST_CONFLICT', 'version');
      return this.priceView(c, result.record);
    });
  }

  async disablePriceList(
    priceListId: string,
    input: { version?: number },
    policies: MaterialPolicies,
    actor: SalesLedgerActor,
  ) {
    return this.database.transaction(async (c) => {
      const row = await this.priceListRow(c, priceListId);
      await this.company(c, text(row.subjectId), policies);
      if (text(row.status) === 'inactive') return this.priceView(c, row);
      if (input.version !== undefined && input.version !== Number(row.version))
        ledgerError('SALES_PRICE_LIST_CONFLICT', 'version');
      const result = await c.repository('salesPriceLists').updateOne({
        filter: { id: priceListId, version: Number(row.version) },
        values: {
          status: 'inactive',
          version: Number(row.version) + 1,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      });
      if (!result.record) ledgerError('SALES_PRICE_LIST_CONFLICT', 'version');
      return this.priceView(c, result.record);
    });
  }

  private async priceListRow(
    c: DatabaseConnection,
    priceListId: string,
  ): Promise<RepositoryRecord> {
    const row = await c
      .repository('salesPriceLists')
      .findOne({ filter: { id: priceListId } });
    if (!row) ledgerError('SALES_PRICE_LIST_NOT_FOUND', 'id');
    return row;
  }

  /**
   * Date columns do not support shorthand filter operators, so the unique key
   * is compared by calendar day after narrowing on its text columns.
   */
  private async findPriceList(
    c: DatabaseConnection,
    subjectId: string,
    customerId: string,
    skuId: string,
    effectiveFrom: string,
  ): Promise<RepositoryRecord | undefined> {
    const rows = await c.repository('salesPriceLists').findMany({
      filter: { subjectId, customerId, skuId },
      limit: 1000,
    });
    return rows.find((row) => day(row.effectiveFrom) === effectiveFrom);
  }

  private validateRange(from: string, to: string | null) {
    if (to && to < from)
      ledgerError('SALES_PRICE_LIST_INVALID_RANGE', 'effectiveTo');
  }

  async receivables(
    query: ReceivableQuery,
    policies: MaterialPolicies,
  ): Promise<[Record<string, unknown>[], number]> {
    const c = this.database.connection();
    await this.company(c, query.subjectId, policies);
    const filter = {
      subjectId: query.subjectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.documentId ? { documentId: query.documentId } : {}),
    };
    const rows = await c.repository('salesReceivables').findMany({
      filter,
      sort: (sort) => sort.field('createdAt').desc(),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const total = await c.repository('salesReceivables').count({ filter });
    return [await this.receivableViews(c, rows), total];
  }

  async receivable(
    receivableId: string,
    policies: MaterialPolicies,
  ): Promise<Record<string, unknown>> {
    const c = this.database.connection();
    const row = await this.receivableRow(c, receivableId);
    await this.company(c, text(row.subjectId), policies);
    const view = (await this.receivableViews(c, [row]))[0];
    const payments = await c.repository('salesPayments').findMany({
      filter: { receivableId },
      sort: (sort) => [
        sort.field('paidAt').asc(),
        sort.field('createdAt').asc(),
      ],
      limit: 10_000,
    });
    return { ...view, payments: payments.map(paymentView) };
  }

  async registerPayment(
    receivableId: string,
    input: PaymentCreate,
    policies: MaterialPolicies,
    actor: SalesLedgerActor,
  ) {
    return this.database.transaction(async (c) => {
      const row = await this.receivableRow(c, receivableId);
      await this.company(c, text(row.subjectId), policies);
      if (text(row.status) === 'void')
        ledgerError('SALES_RECEIVABLE_VOID', 'status');
      const amount = amountCents(text(row.amount)),
        paid = (await sumPayments(c, [receivableId])).get(receivableId) ?? 0n,
        added = amountCents(input.amount),
        next = paid + added;
      if (next > amount) ledgerError('SALES_PAYMENT_EXCEEDS', 'amount');
      if (added <= 0n) ledgerError('SALES_PAYMENT_INVALID', 'amount');
      const now = new Date(),
        payment = await c.repository('salesPayments').createOne({
          values: {
            id: randomUUID(),
            receivableId,
            amount: amountText(added),
            paidAt: input.paidAt,
            method: input.method,
            reference: input.reference ?? null,
            note: input.note ?? null,
            version: 1,
            createdBy: actor.id,
            updatedBy: actor.id,
            createdAt: now,
            updatedAt: now,
          },
        }),
        status =
          next === amount ? 'paid' : next > 0n ? 'partially_paid' : 'open',
        result = await c.repository('salesReceivables').updateOne({
          filter: { id: receivableId, version: Number(row.version) },
          values: {
            status,
            version: Number(row.version) + 1,
            updatedBy: actor.id,
            updatedAt: now,
          },
        });
      if (!result.record) ledgerError('SALES_RECEIVABLE_CONFLICT', 'version');
      const view = (await this.receivableViews(c, [result.record]))[0];
      return { ...view, payment: paymentView(payment.record) };
    });
  }

  private async receivableRow(
    c: DatabaseConnection,
    receivableId: string,
  ): Promise<RepositoryRecord> {
    const row = await c
      .repository('salesReceivables')
      .findOne({ filter: { id: receivableId } });
    if (!row) ledgerError('SALES_RECEIVABLE_NOT_FOUND', 'id');
    return row;
  }

  private async receivableViews(
    c: DatabaseConnection,
    rows: RepositoryRecord[],
  ): Promise<Record<string, unknown>[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => text(row.id)),
      paid = await sumPayments(c, ids),
      customerIds = [...new Set(rows.map((row) => text(row.customerId)))],
      orderIds = [...new Set(rows.map((row) => text(row.orderId)))],
      documentIds = [...new Set(rows.map((row) => text(row.documentId)))],
      customers = await parties(c, 'businessPartners', customerIds),
      orders = await parties(c, 'salesOrders', orderIds),
      documents = await parties(c, 'stockDocuments', documentIds);
    return rows.map((row) => {
      const id = text(row.id),
        amount = text(row.amount) || '0.00',
        paidAmount = amountText(paid.get(id) ?? 0n),
        outstandingCents =
          text(row.status) === 'void'
            ? 0n
            : amountCents(amount) - (paid.get(id) ?? 0n);
      return {
        ...row,
        amount,
        paidAmount,
        outstanding: amountText(outstandingCents > 0n ? outstandingCents : 0n),
        // A zero amount is the marker for a shipment whose order line had no
        // unit price when it was posted; the row is intentionally adjustable.
        priced: amountCents(amount) > 0n,
        dueDate: day(row.dueDate),
        customer: customers.get(text(row.customerId)) ?? null,
        order: orders.get(text(row.orderId)) ?? null,
        document: documents.get(text(row.documentId)) ?? null,
      };
    });
  }
}

function paymentView(row: RepositoryRecord): Record<string, unknown> {
  return {
    ...row,
    amount: text(row.amount),
    paidAt: day(row.paidAt),
    reference: nullable(row.reference),
    note: nullable(row.note),
  };
}

export type ShipmentReceivableLine = {
  orderLineId: string;
  quantity: string;
  unitPrice: string | null;
};

/**
 * Called inside the posting transaction after the document's stock facts are
 * applied. Amounts use the order line price frozen into the approved version,
 * so the receivable follows the approved order rather than today's price list.
 * A line without a price yields 0.00 and is flagged by `priced: false` on the
 * read projection.
 */
export async function postShipmentReceivables(
  c: DatabaseConnection,
  input: {
    documentId: string;
    subjectId: string;
    orderId: string;
    customerId: string;
    currency: string;
    actorId: string;
    lines: ShipmentReceivableLine[];
  },
): Promise<number> {
  if (!input.lines.length) return 0;
  const existing = await c.repository('salesReceivables').count({
    filter: { documentId: input.documentId },
  });
  if (existing > 0) return 0;
  const now = new Date();
  for (const line of input.lines) {
    const amount = orderAmount(line.quantity, line.unitPrice) ?? '0.00';
    await c.repository('salesReceivables').createOne({
      values: {
        id: randomUUID(),
        subjectId: input.subjectId,
        customerId: input.customerId,
        orderId: input.orderId,
        orderLineId: line.orderLineId,
        documentId: input.documentId,
        amount,
        currency: input.currency || 'CNY',
        status: 'open',
        dueDate: null,
        note: null,
        version: 1,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  return input.lines.length;
}

/**
 * Reduces the receivable of one shipment line when goods are returned.
 *
 * The reduction is proportional to the returned quantity against the shipped
 * quantity, using the amount already frozen on the receivable. Money already
 * collected is never lowered below the paid total, so a return cannot turn a
 * collected receivable into a credit without a separate refund.
 */
export async function reduceShipmentReceivables(
  c: DatabaseConnection,
  input: {
    shipmentId: string;
    orderLineId: string;
    returnedQuantity: string;
    totalReturnedQuantity: string;
    shippedQuantity: string;
    actorId: string;
  },
): Promise<number> {
  if (!input.shipmentId || !input.orderLineId) return 0;
  const row = await c.repository('salesReceivables').findOne({
    filter: { documentId: input.shipmentId, orderLineId: input.orderLineId },
  });
  if (!row || text(row.status) === 'void') return 0;
  const shipped = Number(input.shippedQuantity);
  const returned = Number(input.returnedQuantity);
  const totalReturned = Number(input.totalReturnedQuantity);
  if (!Number.isFinite(shipped) || shipped <= 0) return 0;
  if (!Number.isFinite(returned) || returned <= 0) return 0;
  // Reduce by this return's share of what was still on the shipment, so
  // successive partial returns add up to the full amount instead of leaving a
  // rounding remainder behind.
  const remainingBefore = Number.isFinite(totalReturned)
    ? shipped - (totalReturned - returned)
    : shipped;
  const current = amountCents(text(row.amount));
  const reduction =
    remainingBefore <= 0
      ? current
      : BigInt(
          Math.round(Number(current) * Math.min(1, returned / remainingBefore)),
        );
  if (reduction <= 0n) return 0;
  const paid = (await sumPayments(c, [text(row.id)])).get(text(row.id)) ?? 0n;
  let next = current - reduction;
  if (next < 0n) next = 0n;
  if (next < paid) next = paid;
  if (next === current) return 0;
  const status =
    next === 0n
      ? paid > 0n
        ? 'paid'
        : 'void'
      : paid >= next
        ? 'paid'
        : paid > 0n
          ? 'partially_paid'
          : 'open';
  const result = await c.repository('salesReceivables').updateOne({
    filter: { id: text(row.id), version: Number(row.version) },
    values: {
      amount: amountText(next),
      status,
      version: Number(row.version) + 1,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    },
  });
  return result.record ? 1 : 0;
}

/**
 * Reversal of a shipment voids its receivables instead of writing a negative
 * receivable. Money already collected cannot be reversed here: a refund is a
 * separate business fact, so the reversal is refused and the caller keeps the
 * shipment posted.
 */
export async function reverseShipmentReceivables(
  c: DatabaseConnection,
  input: { shipmentId: string; actorId: string },
): Promise<number> {
  const rows = await c.repository('salesReceivables').findMany({
    filter: { documentId: input.shipmentId },
    limit: 10_000,
  });
  if (!rows.length) return 0;
  const paid = await sumPayments(
    c,
    rows.map((row) => text(row.id)),
  );
  if ([...paid.values()].some((value) => value > 0n))
    ledgerError('SALES_RECEIVABLE_HAS_PAYMENTS', 'documentId');
  let changed = 0;
  for (const row of rows) {
    if (text(row.status) === 'void') continue;
    const result = await c.repository('salesReceivables').updateOne({
      filter: { id: text(row.id), version: Number(row.version) },
      values: {
        status: 'void',
        version: Number(row.version) + 1,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      },
    });
    if (result.record) changed += 1;
  }
  return changed;
}
