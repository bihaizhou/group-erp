import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type {
  LifecycleActor,
  TransitionContext,
  JsonObject,
} from '@nocobase/lifecycle';
import type { MaterialPolicies } from './material-service.js';
import type { SupplierService } from './supplier-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import {
  ExecutionRecords,
  executionLineCollections,
} from './execution-records.js';
import { ExecutionReviewService } from './execution-review-service.js';
import type { ExecutionWorkflowTypes } from './execution-workflow.js';
import {
  executionJson as json,
  executionRepo as repo,
  executionText as text,
  executionWrite,
  executionCompany,
} from './execution-access.js';
import {
  orderCreate,
  orderUpdate,
  executionMutation,
  executionQuantityAction,
  type OrderContent,
} from './execution-model.js';
import { executionRules } from './execution-workflow.js';
import {
  inventoryError as fail,
  stockMicros,
  stockQuantity,
  stockPrecision,
} from './inventory-quantity.js';
import { insertStockRowIfMissing, lockStockRow } from './inventory-db.js';
import { z } from 'zod';

export type TradeKind = 'purchaseOrders' | 'salesOrders';
const kinds: TradeKind[] = ['purchaseOrders', 'salesOrders'];
export class TradeOrderService {
  private readonly context = new AsyncLocalStorage<{
    policies: MaterialPolicies;
  }>();
  constructor(
    readonly records: ExecutionRecords,
    private readonly reviews: ExecutionReviewService,
    private readonly materials: SupplyChainMaterialService,
    private readonly suppliers: SupplierService,
    private readonly customers: SupplierService,
  ) {
    for (const kind of kinds)
      reviews.register(kind, (c, context, operation) =>
        this.prepare(c, kind, context, operation),
      );
  }
  private async warehouse(
    c: DatabaseConnection,
    subjectId: string,
    warehouseId: string,
    p: MaterialPolicies,
  ) {
    if (
      !(await repo(c, 'warehouses', p).exists({
        filter: { id: warehouseId, subjectId, status: 'active' },
      }))
    )
      return fail('STOCK_WAREHOUSE_UNAVAILABLE', 'warehouseId');
  }
  private partner(kind: TradeKind) {
    return kind === 'purchaseOrders' ? this.suppliers : this.customers;
  }
  async capabilities(
    kind: TradeKind,
    id: string,
    actor: LifecycleActor,
    read: MaterialPolicies,
    decisions: Record<string, MaterialPolicies | null>,
  ) {
    return this.records.db.transaction(async (c) => {
      const head = await this.records.head(c, kind, id, read),
        states: Record<string, string[]> = {
          update: ['draft'],
          submit: ['draft'],
          approve: ['pending'],
          return: ['pending'],
          withdraw: ['pending'],
          revise: ['approved'],
          cancel: ['draft', 'pending', 'approved'],
          reassign: ['pending'],
          copy: ['cancelled'],
          closeRemainder: ['approved'],
        },
        actions: Record<
          string,
          { visible: boolean; enabled: boolean; reason: string | null }
        > = {};
      for (const [action, from] of Object.entries(states)) {
        const p = decisions[action];
        if (!p) {
          actions[action] = { visible: false, enabled: false, reason: null };
          continue;
        }
        try {
          await this.records.head(c, kind, id, p);
          if (!from.includes(text(head.status))) returnUnavailable();
          if (action === 'copy')
            await executionWrite(
              c,
              kind,
              {
                ...head,
                id: randomUUID(),
                createdBy: actor.id,
                updatedBy: actor.id,
              },
              p,
              'create',
            );
          else
            await executionWrite(
              c,
              kind,
              { updatedBy: actor.id },
              p,
              'update',
              id,
            );
          if (
            ['approve', 'return'].includes(action) &&
            !(await this.reviews.canReview(c, kind, head, actor.id))
          )
            return fail('STOCK_REVIEW_FORBIDDEN');
          if (
            action === 'withdraw' &&
            head.submittedBy !== actor.id &&
            head.createdBy !== actor.id
          )
            return fail('STOCK_WITHDRAW_FORBIDDEN');
          if (['revise', 'cancel', 'closeRemainder'].includes(action))
            for (const line of await this.records.lines(c, kind, id))
              if (await this.reserved(c, kind, text(line.id)))
                return fail('STOCK_RESERVATIONS_ACTIVE');
          if (action === 'submit') {
            const current = await this.reviews.settings(
              c,
              kind,
              text(head.subjectId),
            );
            const rules = executionRules.safeParse(current.values);
            if (!rules.success) return fail('STOCK_REVIEWERS_EMPTY');
            await this.reviews.reviewers.resolve(
              c,
              text(head.subjectId),
              rules.data.reviewerSelections,
              [text(head.createdBy), actor.id],
            );
          }
          actions[action] = { visible: true, enabled: true, reason: null };
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'reason' in error &&
            typeof error.reason === 'string'
          )
            actions[action] = {
              visible: true,
              enabled: false,
              reason: error.reason,
            };
          else throw error;
        }
      }
      return {
        recordRevision: Number(head.revision),
        lifecycleVersion: Number(head.lifecycleVersion),
        actions,
      };
    });
    function returnUnavailable(): never {
      return fail('STOCK_ACTION_UNAVAILABLE');
    }
  }
  private async resolve(
    c: DatabaseConnection,
    kind: TradeKind,
    content: OrderContent,
    p: MaterialPolicies,
  ) {
    await executionCompany(c, content.subjectId, p);
    await this.warehouse(c, content.subjectId, content.warehouseId, p);
    const partner = await this.partner(kind).resolveSupplierInTransaction(
        c,
        content.subjectId,
        content.partnerId,
        p,
      ),
      resolved: RepositoryRecord[] = [];
    for (const [index, line] of content.lines.entries()) {
      if (
        line.selection.kind !== 'known' ||
        line.selection.subjectId !== content.subjectId
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE', `lines.${line.id}.selection`);
      if (kind === 'salesOrders' && line.allocations.length)
        return fail('STOCK_ALLOCATION_INVALID', `lines.${line.id}.allocations`);
      const selection = await this.materials.resolveSelectionInTransaction(
        c,
        kind === 'purchaseOrders' ? 'procurement' : 'sales',
        line.selection,
        p,
      );
      if (selection.identificationStatus !== 'identified')
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      resolved.push({
        ...selection,
        id: line.id,
        lineNo: index + 1,
        quantity: text(selection.requestedQuantity),
        selectionInput: json(line),
        unitPrice: line.unitPrice,
        notes: line.notes,
      });
    }
    return { partner: json(partner.identity), lines: resolved };
  }
  private async allocationLocks(
    c: DatabaseConnection,
    sources: { requestId: string; requestLineId: string; subjectId: string }[],
  ) {
    for (const source of [
      ...new Map(sources.map((row) => [row.requestLineId, row])).values(),
    ].sort((a, b) => a.requestLineId.localeCompare(b.requestLineId))) {
      await insertStockRowIfMissing(c, 'purchaseAllocationGates', {
        id: source.requestLineId,
        requestId: source.requestId,
        subjectId: source.subjectId,
        nonce: randomUUID(),
      });
      await lockStockRow(c, 'purchaseAllocationGates', source.requestLineId);
    }
  }
  private async allocations(
    c: DatabaseConnection,
    orderId: string,
    content: OrderContent,
    resolved: RepositoryRecord[],
    p: MaterialPolicies,
    required: boolean,
  ) {
    const old = await c
      .repository('purchaseAllocations')
      .findMany({ filter: { orderId }, limit: 10001 });
    if (old.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    for (const previous of old.filter((row) => row.status === 'active')) {
      const visible = await repo(c, 'purchaseAllocations', p).findOne({
        filter: { id: text(previous.id) },
      });
      if (
        !visible ||
        [
          'id',
          'requestId',
          'requestLineId',
          'requestVersionId',
          'baseQuantity',
        ].some((field) => !(field in visible))
      )
        return fail('STOCK_FORBIDDEN');
    }
    await this.allocationLocks(c, [
      ...content.lines.flatMap((line) =>
        line.allocations.map((item) => ({
          ...item,
          subjectId: content.subjectId,
        })),
      ),
      ...old.map((row) => ({
        requestId: text(row.requestId),
        requestLineId: text(row.requestLineId),
        subjectId: text(row.subjectId),
      })),
    ]);
    const desired = new Map<string, bigint>(),
      normalized: RepositoryRecord[] = [];
    for (const [index, line] of content.lines.entries()) {
      if (
        new Set(line.allocations.map((item) => item.requestLineId)).size !==
        line.allocations.length
      )
        return fail('STOCK_ALLOCATION_INVALID', `lines.${line.id}.allocations`);
      const sum = line.allocations.reduce(
        (value, item) => value + stockMicros(item.baseQuantity),
        0n,
      );
      if (
        (required || line.allocations.length > 0) &&
        sum !== stockMicros(text(resolved[index].baseQuantity))
      )
        return fail(
          'STOCK_ALLOCATION_QUANTITY',
          `lines.${line.id}.allocations`,
        );
      for (const allocation of line.allocations) {
        const source = await repo(c, 'purchaseRequests', p).findOne({
            filter: {
              id: allocation.requestId,
              subjectId: content.subjectId,
              status: 'approved',
            },
          }),
          sourceLine = await repo(c, 'purchaseRequestLines', p).findOne({
            filter: {
              id: allocation.requestLineId,
              requestId: allocation.requestId,
              subjectId: content.subjectId,
              status: 'active',
              identificationStatus: 'identified',
            },
          });
        if (
          !source ||
          !sourceLine ||
          source.approvedVersionId !== allocation.requestVersionId ||
          sourceLine.skuId !== resolved[index].skuId ||
          sourceLine.baseUnitId !== resolved[index].baseUnitId
        )
          return fail('STOCK_SOURCE_CHANGED', `lines.${line.id}.allocations`);
        const version = await c
            .repository('supplyChainRequestVersions')
            .findOne({
              filter: {
                id: allocation.requestVersionId,
                requestId: allocation.requestId,
                subjectId: content.subjectId,
                kind: 'purchaseRequest',
              },
            }),
          frozen = (
            version?.payload as { lines?: RepositoryRecord[] } | undefined
          )?.lines?.find((row) => row.id === allocation.requestLineId);
        if (
          !frozen ||
          frozen.skuId !== sourceLine.skuId ||
          frozen.baseUnitId !== sourceLine.baseUnitId ||
          frozen.baseQuantity !== sourceLine.baseQuantity
        )
          return fail('STOCK_SOURCE_CHANGED');
        desired.set(
          allocation.requestLineId,
          (desired.get(allocation.requestLineId) ?? 0n) +
            stockMicros(allocation.baseQuantity),
        );
        normalized.push({
          id:
            old.find(
              (row) =>
                row.orderLineId === line.id &&
                row.requestLineId === allocation.requestLineId,
            )?.id ?? randomUUID(),
          subjectId: content.subjectId,
          orderId,
          orderLineId: line.id,
          ...allocation,
          status: 'active',
          createdAt:
            old.find(
              (row) =>
                row.orderLineId === line.id &&
                row.requestLineId === allocation.requestLineId,
            )?.createdAt ?? new Date(),
          updatedAt: new Date(),
        });
      }
    }
    for (const [lineId, amount] of desired) {
      const others = await c.repository('purchaseAllocations').findMany({
        filter: (f) =>
          f.and([
            f.string('requestLineId').eq(lineId),
            f.string('status').eq('active'),
            f.string('orderId').ne(orderId),
          ]),
        limit: 10001,
      });
      if (others.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
      const line = await c
        .repository('purchaseRequestLines')
        .findOne({ filter: { id: lineId } });
      if (
        !line ||
        amount +
          others.reduce(
            (sum, row) => sum + stockMicros(text(row.baseQuantity)),
            0n,
          ) >
          stockMicros(text(line.baseQuantity))
      )
        return fail('STOCK_SOURCE_REMAINING_EXCEEDED', 'lines');
    }
    return { old, normalized };
  }
  private async saveLines(
    c: DatabaseConnection,
    kind: TradeKind,
    head: RepositoryRecord,
    content: OrderContent,
    values: RepositoryRecord[],
    p: MaterialPolicies,
  ) {
    const [table] = executionLineCollections[kind],
      id = text(head.id),
      old = await c
        .repository(table)
        .findMany({ filter: { orderId: id }, limit: 10001 });
    if (old.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    // Give every historical line a distinct temporary number before reordering.
    for (const [index, line] of old.entries())
      await c.repository(table).updateOne({
        filter: { id: text(line.id) },
        values: { lineNo: 10001 + index },
      });
    for (const line of old.filter(
      (row) =>
        row.status === 'active' && !values.some((next) => next.id === row.id),
    )) {
      if (
        stockMicros(text(line.fulfilledQuantity)) > 0n ||
        (await this.reserved(c, kind, text(line.id)))
      )
        return fail('STOCK_FULFILLED_LINE_FROZEN', 'lines');
      await executionWrite(
        c,
        table,
        { status: 'cancelled' },
        p,
        'update',
        text(line.id),
      );
      await c.repository(table).updateOne({
        filter: { id: text(line.id) },
        values: { status: 'cancelled', revision: Number(line.revision) + 1 },
      });
    }
    for (const value of values) {
      const previous = old.find((row) => row.id === value.id);
      if (previous?.status === 'cancelled')
        return fail('STOCK_LINE_ID_REUSED', 'lines');
      const protectedLine =
        previous &&
        (stockMicros(text(previous.fulfilledQuantity)) > 0n ||
          (await this.reserved(c, kind, text(previous.id))));
      if (
        protectedLine &&
        [
          'skuId',
          'baseUnitId',
          'unitId',
          'unitRuleId',
          'numeratorSnapshot',
          'denominatorSnapshot',
        ].some((field) => (previous[field] ?? null) !== (value[field] ?? null))
      )
        return fail(
          'STOCK_FULFILLED_LINE_FROZEN',
          `lines.${text(value.id)}.selection`,
        );
      if (
        previous &&
        stockMicros(text(value.baseQuantity)) +
          stockMicros(text(previous.replacementQuantity)) <
          stockMicros(text(previous.fulfilledQuantity))
      )
        return fail(
          'STOCK_QUANTITY_BELOW_FULFILLED',
          `lines.${text(value.id)}.quantity`,
        );
      const next: RepositoryRecord = {
        id: value.id,
        orderId: id,
        subjectId: content.subjectId,
        lineNo: value.lineNo,
        status: 'active',
        revision: Number(previous?.revision ?? 0) + 1,
        nonce: randomUUID(),
        ...Object.fromEntries(
          [
            'skuId',
            'baseUnitId',
            'unitId',
            'unitRuleId',
            'quantity',
            'baseQuantity',
            'numeratorSnapshot',
            'denominatorSnapshot',
            'materialSnapshot',
            'selectionInput',
            'unitPrice',
            'managementModeSnapshot',
            'notes',
          ].map((field) => [field, value[field] ?? null]),
        ),
        fulfilledQuantity: previous?.fulfilledQuantity ?? '0',
        returnedQuantity: previous?.returnedQuantity ?? '0',
        replacementQuantity: previous?.replacementQuantity ?? '0',
        closedQuantity: previous?.closedQuantity ?? '0',
      };
      await executionWrite(
        c,
        table,
        next,
        p,
        previous ? 'update' : 'create',
        previous ? text(previous.id) : undefined,
      );
      if (previous)
        await c
          .repository(table)
          .updateOne({ filter: { id: text(previous.id) }, values: next });
      else {
        if (
          await c.repository(table).exists({ filter: { id: text(value.id) } })
        )
          return fail('STOCK_LINE_ID_REUSED', 'lines');
        await c.repository(table).createOne({ values: next });
      }
    }
  }
  private async reserved(
    c: DatabaseConnection,
    kind: TradeKind,
    lineId: string,
  ) {
    if (kind !== 'salesOrders') return false;
    const rows = await c
      .repository('stockReservations')
      .findMany({ filter: { salesOrderLineId: lineId }, limit: 1001 });
    if (rows.length > 1000) return fail('STOCK_RESERVATION_LIMIT');
    return rows.some((row) => stockMicros(text(row.remainingQuantity)) > 0n);
  }
  async save(
    kind: TradeKind,
    id: string | undefined,
    raw: z.infer<typeof orderCreate> | z.infer<typeof orderUpdate>,
    actor: LifecycleActor,
    p: MaterialPolicies,
    copyFrom?: string,
  ) {
    const input =
        id || copyFrom ? orderUpdate.parse(raw) : orderCreate.parse(raw),
      content = input.content;
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      const read = (resultId: string) =>
        this.records.view(c, kind, resultId, p);
      return this.records.mutate(
        c,
        kind,
        id ? `update:${id}` : copyFrom ? `copy:${copyFrom}` : 'create',
        input,
        actor,
        async (resultId) => {
          const head = await this.records.head(c, kind, resultId, p);
          await executionWrite(
            c,
            kind,
            { updatedBy: actor.id },
            p,
            id ? 'update' : 'create',
            id ? resultId : undefined,
          );
          await this.warehouse(
            c,
            text(head.subjectId),
            text(head.warehouseId),
            p,
          );
        },
        async () => {
          if (copyFrom) {
            const source = await this.records.head(c, kind, copyFrom, p);
            this.records.expect(source, input as z.infer<typeof orderUpdate>);
            if (source.status !== 'cancelled')
              return fail('STOCK_COPY_NOT_CANCELLED');
          }
          let head = id ? await this.records.head(c, kind, id, p) : null;
          if (head) {
            await this.records.lockHead(c, kind, id!);
            head = await this.records.head(c, kind, id!, p);
            this.records.expect(head, input as z.infer<typeof orderUpdate>);
            if (head.status !== 'draft') return fail('STOCK_NOT_DRAFT');
            if (head.subjectId !== content.subjectId)
              return fail('STOCK_COMPANY_FROZEN', 'subjectId');
            await this.records.wholeLines(c, kind, head, p);
          }
          const resolved = await this.resolve(c, kind, content, p),
            before = head
              ? json({
                  head,
                  lines: await this.records.lines(c, kind, text(head.id)),
                })
              : null;
          const values: RepositoryRecord = {
            subjectId: content.subjectId,
            warehouseId: content.warehouseId,
            partnerId: content.partnerId,
            currency: content.currency,
            deliveryOn: content.deliveryOn,
            deliveryTerms: content.deliveryTerms,
            notes: content.notes,
            reason: content.reason,
            occurredOn: content.occurredOn,
            partnerSnapshot: resolved.partner,
            supersedesId: copyFrom ?? head?.supersedesId ?? null,
          };
          if (!head)
            head = await this.records.create(c, kind, values, actor, p);
          const allocation =
            kind === 'purchaseOrders'
              ? await this.allocations(
                  c,
                  text(head.id),
                  content,
                  resolved.lines,
                  p,
                  false,
                )
              : null;
          await this.saveLines(c, kind, head, content, resolved.lines, p);
          if (allocation) {
            for (const previous of allocation.old)
              if (
                previous.status === 'active' &&
                !allocation.normalized.some((row) => row.id === previous.id)
              )
                await c.repository('purchaseAllocations').updateOne({
                  filter: { id: text(previous.id) },
                  values: { status: 'cancelled', updatedAt: new Date() },
                });
            for (const row of allocation.normalized) {
              await executionWrite(
                c,
                'purchaseAllocations',
                row,
                p,
                allocation.old.some((old) => old.id === row.id)
                  ? 'update'
                  : 'create',
                allocation.old.some((old) => old.id === row.id)
                  ? text(row.id)
                  : undefined,
              );
              if (allocation.old.some((old) => old.id === row.id))
                await c
                  .repository('purchaseAllocations')
                  .updateOne({ filter: { id: text(row.id) }, values: row });
              else
                await c
                  .repository('purchaseAllocations')
                  .createOne({ values: row });
            }
          }
          if (id) {
            await executionWrite(c, kind, values, p, 'update', id);
            await this.context.run({ policies: p }, () =>
              this.records.runtime.fire(kind, id, 'edit', {
                actor,
                transaction: c,
                manual: false,
                expect: { version: Number(head.lifecycleVersion) },
                requestId: input.requestKey,
                input: {
                  values: json(values),
                  reason: (input as z.infer<typeof orderUpdate>).reason,
                },
              }),
            );
          }
          const after = await this.records.head(c, kind, text(head.id), p);
          await this.records.audit(
            c,
            kind,
            after,
            actor,
            id ? 'update' : 'create',
            id ? (input as z.infer<typeof orderUpdate>).reason : content.reason,
            before,
            {
              head: after,
              lines: await this.records.lines(c, kind, text(head.id)),
            },
          );
          return { id: text(head.id), data: await read(text(head.id)) };
        },
        read,
      );
    });
  }
  private async validateStored(
    c: DatabaseConnection,
    kind: TradeKind,
    head: RepositoryRecord,
    lines: RepositoryRecord[],
    p: MaterialPolicies,
  ) {
    const content = orderCreate.shape.content.parse({
        ...Object.fromEntries(
          [
            'subjectId',
            'warehouseId',
            'partnerId',
            'occurredOn',
            'currency',
            'deliveryOn',
            'deliveryTerms',
            'notes',
            'reason',
          ].map((key) => [key, head[key]]),
        ),
        lines: lines.map((line) => line.selectionInput),
      }),
      resolved = await this.resolve(c, kind, content, p);
    for (const [index, line] of lines.entries())
      if (
        [
          'skuId',
          'baseUnitId',
          'unitId',
          'unitRuleId',
          'quantity',
          'baseQuantity',
          'numeratorSnapshot',
          'denominatorSnapshot',
        ].some(
          (key) => (line[key] ?? null) !== (resolved.lines[index][key] ?? null),
        )
      )
        return fail('STOCK_SOURCE_CHANGED', `lines.${text(line.id)}.selection`);
    if (kind === 'purchaseOrders')
      await this.allocations(
        c,
        text(head.id),
        content,
        resolved.lines,
        p,
        true,
      );
  }
  private async prepare(
    c: DatabaseConnection,
    kind: TradeKind,
    context: TransitionContext<ExecutionWorkflowTypes>,
    operation: string,
  ): Promise<JsonObject> {
    const access = this.context.getStore();
    if (!access) return fail('STOCK_FORBIDDEN');
    const head = context.record as RepositoryRecord,
      lines = await this.records.lines(c, kind, text(head.id));
    if (operation === 'edit')
      return {
        ...(context.input.values as JsonObject),
        contentVersion: Number(head.contentVersion) + 1,
        approvedVersionId: null,
        approvedAt: null,
      };
    if (['submit', 'approve'].includes(operation))
      await this.validateStored(c, kind, head, lines, access.policies);
    if (['revise', 'cancel'].includes(operation))
      for (const line of lines)
        if (await this.reserved(c, kind, text(line.id)))
          return fail('STOCK_RESERVATIONS_ACTIVE');
    if (
      operation === 'cancel' &&
      lines.some((line) => stockMicros(text(line.fulfilledQuantity)) > 0n)
    )
      return fail('STOCK_ORDER_FULFILLED');
    if (
      operation === 'withdraw' &&
      head.submittedBy !== context.actor.id &&
      head.createdBy !== context.actor.id
    )
      return fail('STOCK_WITHDRAW_FORBIDDEN');
    if (operation === 'closeRemainder') {
      const requested = executionQuantityAction.shape.lines.parse(
        context.input.lines,
      );
      if (
        new Set(requested.map((line) => line.lineId)).size !== requested.length
      )
        return fail('STOCK_LINES_INVALID');
      for (const item of [...requested].sort((a, b) =>
        a.lineId.localeCompare(b.lineId),
      )) {
        if (!lines.some((line) => line.id === item.lineId))
          return fail('STOCK_SOURCE_UNAVAILABLE');
        const [table] = executionLineCollections[kind],
          line = await lockStockRow(c, table, item.lineId),
          amount = stockMicros(item.quantity);
        if (await this.reserved(c, kind, item.lineId))
          return fail('STOCK_RESERVATIONS_ACTIVE');
        const unit = await c
          .repository('measureUnits')
          .findOne({ filter: { id: text(line.baseUnitId) } });
        if (!unit) return fail('STOCK_MATERIAL_UNAVAILABLE');
        stockPrecision(amount, Number(unit.precision));
        if (
          amount +
            stockMicros(text(line.closedQuantity)) +
            stockMicros(text(line.fulfilledQuantity)) >
          stockMicros(text(line.baseQuantity)) +
            stockMicros(text(line.replacementQuantity))
        )
          return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
        const values = {
          closedQuantity: stockQuantity(
            stockMicros(text(line.closedQuantity)) + amount,
          ),
          revision: Number(line.revision) + 1,
        };
        await executionWrite(
          c,
          table,
          values,
          access.policies,
          'update',
          item.lineId,
        );
        await c
          .repository(table)
          .updateOne({ filter: { id: item.lineId }, values });
      }
    }
    if (operation === 'revise') {
      const [table] = executionLineCollections[kind];
      for (const line of lines)
        await c.repository(table).updateOne({
          filter: { id: text(line.id) },
          values: {
            closedQuantity: '0',
            revision: Number(line.revision) + 1,
          },
        });
    }
    if (operation === 'cancel' && kind === 'purchaseOrders') {
      const allocations = await c.repository('purchaseAllocations').findMany({
        filter: { orderId: text(head.id), status: 'active' },
        limit: 10001,
      });
      if (allocations.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
      await this.allocationLocks(
        c,
        allocations.map((row) => ({
          requestId: text(row.requestId),
          requestLineId: text(row.requestLineId),
          subjectId: text(row.subjectId),
        })),
      );
      // An already fulfilled commitment is retained as history. Cancellation
      // never silently creates a replacement purchase for that demand.
      for (const allocation of allocations) {
        const line = lines.find((row) => row.id === allocation.orderLineId);
        if (line && stockMicros(text(line.fulfilledQuantity)) === 0n)
          await c.repository('purchaseAllocations').updateOne({
            filter: { id: text(allocation.id) },
            values: { status: 'cancelled', updatedAt: new Date() },
          });
      }
    }
    return this.reviews.prepare(c, kind, context, operation, lines);
  }
  async fire(
    kind: TradeKind,
    id: string,
    transition:
      | 'submit'
      | 'approve'
      | 'return'
      | 'withdraw'
      | 'revise'
      | 'cancel'
      | 'reassign'
      | 'closeRemainder',
    raw:
      | z.infer<typeof executionMutation>
      | z.infer<typeof executionQuantityAction>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input =
      transition === 'closeRemainder'
        ? executionQuantityAction.parse(raw)
        : executionMutation.parse(raw);
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      await this.records.lockHead(c, kind, id);
      const read = (resultId: string) =>
          this.records.view(c, kind, resultId, p),
        authorize = async (resultId: string) => {
          await this.records.head(c, kind, resultId, p);
          await executionWrite(
            c,
            kind,
            { updatedBy: actor.id },
            p,
            'update',
            resultId,
          );
        };
      return this.records.mutate(
        c,
        kind,
        `${transition}:${id}`,
        input,
        actor,
        authorize,
        async () => {
          await authorize(id);
          const before = await this.records.head(c, kind, id, p);
          this.records.expect(before, input);
          await this.records.wholeLines(c, kind, before, p);
          await this.context.run({ policies: p }, () =>
            this.records.runtime.fire(kind, id, transition, {
              actor,
              transaction: c,
              expect: { version: input.lifecycleVersion },
              requestId: input.requestKey,
              input: {
                reason: input.reason,
                ...('lines' in input
                  ? { lines: json({ values: input.lines }).values }
                  : {}),
              },
            }),
          );
          const after = await c.repository(kind).findOne({ filter: { id } });
          if (!after) return fail('STOCK_NOT_FOUND');
          await this.records.audit(
            c,
            kind,
            after,
            actor,
            transition,
            input.reason,
            before,
            after,
          );
          return {
            id,
            data: json({
              id,
              status: after.status,
              revision: after.revision,
              lifecycleVersion: after.lifecycleVersion,
            }),
          };
        },
        read,
      );
    });
  }
}
