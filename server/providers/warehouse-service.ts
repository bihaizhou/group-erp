import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type {
  LifecycleActor,
  JsonObject,
  TransitionContext,
} from '@nocobase/lifecycle';
import { z } from 'zod';
import { ExecutionRecords, executionFingerprint } from './execution-records.js';
import { ExecutionReviewService } from './execution-review-service.js';
import type { ExecutionWorkflowTypes } from './execution-workflow.js';
import type { MaterialPolicies } from './material-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import { InventoryService } from './inventory-service.js';
import type { IssueRequestService } from './issue-request-service.js';
import type { SupplierService } from './supplier-service.js';
import { warehouseSourceLines } from './warehouse-source-lines.js';
import { warehousePosting } from './warehouse-posting.js';
import {
  warehouseCreate,
  warehouseUpdate,
  warehouseContent,
  executionMutation,
  type WarehouseContent,
} from './execution-model.js';
import {
  executionActor,
  executionCompany,
  executionJson as json,
  executionRepo as repo,
  executionText as text,
  executionWrite,
} from './execution-access.js';
import { inventoryError as fail } from './inventory-quantity.js';

export interface WarehouseAccess {
  policies: MaterialPolicies;
  types: Record<string, MaterialPolicies | null>;
}
const controlled = new Set([
  'productionReceipt',
  'productionIssue',
  'loss',
  'transferDiscrepancy',
]);
const typeAction: Record<string, string> = {
  initial: 'initial',
  loss: 'loss',
  productionReceipt: 'productionReceipt',
  productionIssue: 'productionIssue',
  qualityTransfer: 'quality',
  reversal: 'reverse',
  transferDispatch: 'dispatch',
  transferReceipt: 'receive',
  transferDiscrepancy: 'discrepancy',
};
const commonContent = [
  'kind',
  'subjectId',
  'warehouseId',
  'occurredOn',
  'reason',
  'notes',
];
const headerContent: Record<string, string[]> = {
  purchaseReceipt: ['purchaseOrderId'],
  salesShipment: ['salesOrderId'],
  issue: ['issueRequestId'],
  purchaseReturn: ['originalDocumentId'],
  salesReturn: ['originalDocumentId'],
  issueReturn: ['originalDocumentId'],
  productionReceipt: ['productionEvidence'],
  productionIssue: ['productionEvidence'],
  transferDispatch: ['transferId'],
  transferReceipt: ['transferId'],
  transferDiscrepancy: ['transferId', 'evidence'],
  initial: ['initializationReference'],
  loss: ['lossEvidence'],
  qualityTransfer: ['inspectionEvidence'],
  reversal: ['originalDocumentId', 'originalPostingId', 'evidence'],
};
export class WarehouseService {
  private readonly context = new AsyncLocalStorage<WarehouseAccess>();
  constructor(
    readonly records: ExecutionRecords,
    private readonly reviews: ExecutionReviewService,
    private readonly inventory: InventoryService,
    private readonly materials: SupplyChainMaterialService,
    private readonly issues: IssueRequestService,
    private readonly suppliers: SupplierService,
    private readonly customers: SupplierService,
  ) {
    reviews.register('stockDocuments', (c, context, operation) =>
      this.prepare(c, context, operation),
    );
  }
  private async warehouse(
    c: DatabaseConnection,
    subjectId: string,
    warehouseId: string,
    p: MaterialPolicies,
    active = true,
  ) {
    if (
      !(await repo(c, 'warehouses', p).exists({
        filter: {
          id: warehouseId,
          subjectId,
          ...(active ? { status: 'active' } : {}),
        },
      }))
    )
      return fail('STOCK_WAREHOUSE_UNAVAILABLE', 'warehouseId');
  }
  private async typed(
    c: DatabaseConnection,
    head: RepositoryRecord,
    actor: LifecycleActor,
    access: WarehouseAccess,
  ) {
    const action = typeAction[text(head.kind)];
    if (!action) return;
    const p = access.types[action];
    if (!p) return fail('STOCK_TYPE_FORBIDDEN');
    await executionCompany(c, text(head.subjectId), p, false);
    await this.warehouse(
      c,
      text(head.subjectId),
      text(head.warehouseId),
      p,
      false,
    );
    if (['dispatch', 'receive', 'discrepancy'].includes(action)) {
      await this.records.head(c, 'stockTransfers', text(head.transferId), p);
      await executionWrite(
        c,
        'stockTransfers',
        { updatedBy: actor.id },
        p,
        'update',
        text(head.transferId),
      );
    } else {
      await this.records.head(c, 'stockDocuments', text(head.id), p);
      await executionWrite(
        c,
        'stockDocuments',
        { updatedBy: actor.id },
        p,
        'update',
        text(head.id),
      );
    }
  }
  private content(
    head: RepositoryRecord,
    lines: RepositoryRecord[],
  ): WarehouseContent {
    const values: Record<string, unknown> = Object.fromEntries(
      [...commonContent, ...(headerContent[text(head.kind)] ?? [])].map(
        (key) => [key, head[key]],
      ),
    );
    if (head.kind !== 'reversal')
      values.lines = lines.map((line) => line.selectionInput);
    return warehouseContent.parse(values);
  }
  async warehousesFor(c: DatabaseConnection, head: RepositoryRecord) {
    if (!head.transferId) return [text(head.warehouseId)];
    const transfer = await c.repository('stockTransfers').findOne({
      filter: { id: text(head.transferId), subjectId: text(head.subjectId) },
    });
    if (!transfer) return fail('STOCK_SOURCE_UNAVAILABLE');
    return [text(transfer.warehouseId), text(transfer.destinationWarehouseId)];
  }
  private async validate(
    c: DatabaseConnection,
    head: RepositoryRecord,
    lines: RepositoryRecord[],
    p: MaterialPolicies,
  ) {
    if (head.kind === 'issue') {
      const source = await c.repository('materialIssueRequests').findOne({
        filter: {
          id: text(head.issueRequestId),
          subjectId: text(head.subjectId),
        },
      });
      if (!source) return fail('STOCK_SOURCE_UNAVAILABLE');
      await this.issues.assertExecutionPeople(c, source);
    }
    if (head.kind === 'purchaseReceipt' || head.kind === 'salesShipment') {
      const purchase = head.kind === 'purchaseReceipt',
        source = await c
          .repository(purchase ? 'purchaseOrders' : 'salesOrders')
          .findOne({
            filter: {
              id: text(purchase ? head.purchaseOrderId : head.salesOrderId),
              subjectId: text(head.subjectId),
            },
          });
      if (!source) return fail('STOCK_SOURCE_UNAVAILABLE');
      await (
        purchase ? this.suppliers : this.customers
      ).previewSupplierInTransaction(
        c,
        text(head.subjectId),
        text(source.partnerId),
        p,
      );
    }
    const resolved = await warehouseSourceLines(
      c,
      this.content(head, lines),
      p,
      this.materials,
      lines,
      true,
    );
    if (resolved.lines.length !== lines.length)
      return fail('STOCK_SOURCE_CHANGED');
    for (const line of lines) {
      const current = resolved.lines.find((row) => row.id === line.id);
      if (
        !current ||
        [
          'skuId',
          'baseUnitId',
          'unitId',
          'unitRuleId',
          'quantity',
          'baseQuantity',
          'numeratorSnapshot',
          'denominatorSnapshot',
          'quality',
          'targetQuality',
          'purchaseOrderId',
          'purchaseOrderLineId',
          'salesOrderId',
          'salesOrderLineId',
          'issueRequestId',
          'issueRequestLineId',
          'transferId',
          'transferLineId',
          'originalDocumentId',
          'originalLineId',
          'sourceBalanceId',
          'commercialSnapshot',
          'sourceSnapshot',
        ].some(
          (field) =>
            executionFingerprint(line[field] ?? null) !==
            executionFingerprint(current[field] ?? null),
        )
      )
        return fail('STOCK_SOURCE_CHANGED', `lines.${text(line.id)}.quantity`);
    }
  }
  private async saveLines(
    c: DatabaseConnection,
    head: RepositoryRecord,
    values: RepositoryRecord[],
    p: MaterialPolicies,
  ) {
    const documentId = text(head.id),
      old = await c
        .repository('stockDocumentLines')
        .findMany({ filter: { documentId }, limit: 10001 });
    if (old.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    for (const [index, row] of old.entries())
      await c.repository('stockDocumentLines').updateOne({
        filter: { id: text(row.id) },
        values: { lineNo: 10001 + index },
      });
    for (const row of old.filter(
      (line) =>
        line.status === 'active' && !values.some((next) => next.id === line.id),
    )) {
      await executionWrite(
        c,
        'stockDocumentLines',
        { status: 'cancelled' },
        p,
        'update',
        text(row.id),
      );
      await c.repository('stockDocumentLines').updateOne({
        filter: { id: text(row.id) },
        values: { status: 'cancelled', revision: Number(row.revision) + 1 },
      });
    }
    for (const value of values) {
      const previous = old.find((row) => row.id === value.id);
      if (previous?.status === 'cancelled') return fail('STOCK_LINE_ID_REUSED');
      const next = {
        ...value,
        documentId,
        subjectId: head.subjectId,
        revision: Number(previous?.revision ?? 0) + 1,
        nonce: randomUUID(),
      };
      await executionWrite(
        c,
        'stockDocumentLines',
        next,
        p,
        previous ? 'update' : 'create',
        previous ? text(previous.id) : undefined,
      );
      if (previous)
        await c
          .repository('stockDocumentLines')
          .updateOne({ filter: { id: text(previous.id) }, values: next });
      else {
        if (
          await c
            .repository('stockDocumentLines')
            .exists({ filter: { id: text(value.id) } })
        )
          return fail('STOCK_LINE_ID_REUSED');
        await c.repository('stockDocumentLines').createOne({ values: next });
      }
    }
  }
  async save(
    id: string | undefined,
    raw: z.infer<typeof warehouseCreate> | z.infer<typeof warehouseUpdate>,
    actor: LifecycleActor,
    access: WarehouseAccess,
    copyFrom?: string,
  ) {
    const input =
        id || copyFrom
          ? warehouseUpdate.parse(raw)
          : warehouseCreate.parse(raw),
      content = input.content,
      p = access.policies;
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      const read = (resultId: string) =>
        this.records.view(c, 'stockDocuments', resultId, p);
      return this.records.mutate(
        c,
        'stockDocuments',
        id ? `update:${id}` : copyFrom ? `copy:${copyFrom}` : 'create',
        input,
        actor,
        async (resultId) => {
          const head = await this.records.head(
            c,
            'stockDocuments',
            resultId,
            p,
          );
          await executionWrite(
            c,
            'stockDocuments',
            { updatedBy: actor.id },
            p,
            id ? 'update' : 'create',
            id ? resultId : undefined,
          );
          await this.typed(c, head, actor, access);
        },
        async () => {
          if (copyFrom) {
            const source = await this.records.head(
              c,
              'stockDocuments',
              copyFrom,
              p,
            );
            this.records.expect(
              source,
              input as z.infer<typeof warehouseUpdate>,
            );
            if (source.status !== 'cancelled' || source.kind !== content.kind)
              return fail('STOCK_COPY_NOT_CANCELLED');
          }
          let head = id
            ? await this.records.head(c, 'stockDocuments', id, p)
            : null;
          if (head) {
            await this.records.lockHead(c, 'stockDocuments', id!);
            head = await this.records.head(c, 'stockDocuments', id!, p);
            this.records.expect(head, input as z.infer<typeof warehouseUpdate>);
            if (head.status !== 'draft') return fail('STOCK_NOT_DRAFT');
            if (
              head.subjectId !== content.subjectId ||
              head.kind !== content.kind
            )
              return fail('STOCK_DOCUMENT_IDENTITY_FROZEN');
            await this.records.wholeLines(c, 'stockDocuments', head, p);
          }
          await executionCompany(c, content.subjectId, p);
          await this.warehouse(c, content.subjectId, content.warehouseId, p);
          const before = head
              ? {
                  head,
                  lines: await this.records.lines(
                    c,
                    'stockDocuments',
                    text(head.id),
                  ),
                }
              : null,
            resolved = await warehouseSourceLines(
              c,
              content,
              p,
              this.materials,
              head
                ? await this.records.lines(c, 'stockDocuments', text(head.id))
                : [],
            ),
            { lines: _lines, ...body } = content as WarehouseContent & {
              lines?: unknown;
            },
            values: RepositoryRecord = {
              ...body,
              ...resolved.derived,
              supersedesId: copyFrom ?? head?.supersedesId ?? null,
            };
          if (!head)
            head = await this.records.create(
              c,
              'stockDocuments',
              values,
              actor,
              p,
            );
          await this.typed(c, { ...head, ...values }, actor, access);
          await this.saveLines(c, head, resolved.lines, p);
          if (id) {
            await executionWrite(c, 'stockDocuments', values, p, 'update', id);
            await this.context.run(access, () =>
              this.records.runtime.fire('stockDocuments', id, 'edit', {
                actor,
                transaction: c,
                manual: false,
                expect: { version: Number(head.lifecycleVersion) },
                requestId: input.requestKey,
                input: {
                  values: json(values),
                  reason: (input as z.infer<typeof warehouseUpdate>).reason,
                },
              }),
            );
          }
          const after = await this.records.head(
            c,
            'stockDocuments',
            text(head.id),
            p,
          );
          await this.records.audit(
            c,
            'stockDocuments',
            after,
            actor,
            id ? 'update' : 'create',
            id
              ? (input as z.infer<typeof warehouseUpdate>).reason
              : content.reason,
            before,
            {
              head: after,
              lines: await this.records.lines(
                c,
                'stockDocuments',
                text(head.id),
              ),
            },
          );
          return { id: text(head.id), data: await read(text(head.id)) };
        },
        read,
      );
    });
  }
  private async prepare(
    c: DatabaseConnection,
    context: TransitionContext<ExecutionWorkflowTypes>,
    operation: string,
  ): Promise<JsonObject> {
    const head = context.record as RepositoryRecord;
    if (operation === 'post') {
      // Only the quantity engine can produce this immutable posting first in
      // this exact transaction. A direct lifecycle fire cannot fake stock.
      if (
        !(await c.repository('stockPostings').exists({
          filter: {
            documentId: text(head.id),
            subjectId: text(head.subjectId),
            actorId: context.actor.id,
          },
        }))
      )
        return fail('STOCK_POSTING_REQUIRED');
      return { postedBy: context.actor.id, postedAt: new Date().toISOString() };
    }
    const access = this.context.getStore();
    if (!access) return fail('STOCK_FORBIDDEN');
    const lines = await this.records.lines(c, 'stockDocuments', text(head.id));
    if (operation === 'edit')
      return {
        ...(context.input.values as JsonObject),
        contentVersion: Number(head.contentVersion) + 1,
        approvedVersionId: null,
        approvedAt: null,
      };
    if (['submit', 'approve'].includes(operation)) {
      if (!controlled.has(text(head.kind)))
        return fail('STOCK_REVIEW_NOT_REQUIRED');
      await this.validate(c, head, lines, access.policies);
    }
    if (
      operation === 'withdraw' &&
      head.createdBy !== context.actor.id &&
      head.submittedBy !== context.actor.id
    )
      return fail('STOCK_WITHDRAW_FORBIDDEN');
    return this.reviews.prepare(c, 'stockDocuments', context, operation, lines);
  }
  async fire(
    id: string,
    transition:
      | 'submit'
      | 'approve'
      | 'return'
      | 'withdraw'
      | 'revise'
      | 'cancel'
      | 'reassign',
    raw: z.infer<typeof executionMutation>,
    actor: LifecycleActor,
    access: WarehouseAccess,
  ) {
    const input = executionMutation.parse(raw),
      p = access.policies;
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      await this.records.lockHead(c, 'stockDocuments', id);
      const read = (resultId: string) =>
          this.records.view(c, 'stockDocuments', resultId, p),
        authorize = async (resultId: string) => {
          await this.records.head(c, 'stockDocuments', resultId, p);
          await executionWrite(
            c,
            'stockDocuments',
            { updatedBy: actor.id },
            p,
            'update',
            resultId,
          );
        };
      return this.records.mutate(
        c,
        'stockDocuments',
        `${transition}:${id}`,
        input,
        actor,
        authorize,
        async () => {
          await authorize(id);
          const before = await this.records.head(c, 'stockDocuments', id, p);
          this.records.expect(before, input);
          await this.records.wholeLines(c, 'stockDocuments', before, p);
          if (transition === 'submit')
            await this.typed(c, before, actor, access);
          await this.context.run(access, () =>
            this.records.runtime.fire('stockDocuments', id, transition, {
              actor,
              transaction: c,
              expect: { version: input.lifecycleVersion },
              requestId: input.requestKey,
              input: { reason: input.reason },
            }),
          );
          const after = await c
            .repository('stockDocuments')
            .findOne({ filter: { id } });
          if (!after) return fail('STOCK_NOT_FOUND');
          await this.records.audit(
            c,
            'stockDocuments',
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
  async post(
    id: string,
    raw: z.infer<typeof executionMutation>,
    actor: LifecycleActor,
    access: WarehouseAccess,
  ) {
    const input = executionMutation.parse(raw),
      p = access.policies;
    return this.records.db.transaction(async (c) => {
      let plan: Awaited<ReturnType<typeof warehousePosting>> | undefined;
      const result = await this.inventory.postInTransaction(
        c,
        { ...input, documentId: id, actorId: actor.id },
        {
          postableStates: ['draft', 'approved'],
          warehouseIds: (tx, head) => this.warehousesFor(tx, head),
          authorize: async (tx, head, lines, replay) => {
            await executionActor(tx, this.records.users, actor.id);
            await this.records.head(tx, 'stockDocuments', id, p);
            await executionWrite(
              tx,
              'stockDocuments',
              { updatedBy: actor.id },
              p,
              'update',
              id,
            );
            await this.typed(tx, head, actor, access);
            if (!replay) {
              await executionCompany(tx, text(head.subjectId), p);
              await this.records.wholeLines(tx, 'stockDocuments', head, p);
              if (
                controlled.has(text(head.kind))
                  ? head.status !== 'approved' || !head.approvedVersionId
                  : head.status !== 'draft'
              )
                return fail('STOCK_NOT_APPROVED');
              if (lines.some((line) => line.subjectId !== head.subjectId))
                return fail('STOCK_SOURCE_UNAVAILABLE');
            }
          },
          prepare: async (tx, head, lines) => {
            await this.validate(tx, head, lines, p);
            plan = await warehousePosting(tx, head, lines);
            return plan.entries;
          },
          posted: async (tx, head, posting) => {
            if (!plan) return fail('STOCK_SOURCE_UNAVAILABLE');
            await plan.apply();
            await this.records.runtime.fire('stockDocuments', id, 'post', {
              actor,
              transaction: tx,
              expect: { version: Number(head.lifecycleVersion) },
              requestId: input.requestKey,
              input: { reason: input.reason },
            });
            const after = await tx
              .repository('stockDocuments')
              .findOne({ filter: { id } });
            if (!after) return fail('STOCK_NOT_FOUND');
            await this.records.audit(
              tx,
              'stockDocuments',
              after,
              actor,
              'post',
              input.reason,
              {
                head,
                lines: await this.records.lines(tx, 'stockDocuments', id),
              },
              { head: after, postingId: posting.postingId },
            );
          },
        },
      );
      const after = await c
        .repository('stockDocuments')
        .findOne({ filter: { id } });
      if (!after) return fail('STOCK_NOT_FOUND');
      return {
        id,
        status: after.status,
        revision: after.revision,
        lifecycleVersion: after.lifecycleVersion,
        postingId: result.postingId,
        replayed: result.replayed,
      };
    });
  }
}
