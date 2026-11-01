import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { LifecycleActor, TransitionContext } from '@nocobase/lifecycle';
import { z } from 'zod';
import { ExecutionRecords } from './execution-records.js';
import { ExecutionReviewService } from './execution-review-service.js';
import type { ExecutionWorkflowTypes } from './execution-workflow.js';
import type { MaterialPolicies } from './material-service.js';
import type { SupplyChainMaterialService } from './supply-chain-material-service.js';
import {
  executionCompany,
  executionRepo as repo,
  executionText as text,
  executionJson as json,
  executionWrite,
} from './execution-access.js';
import {
  transferCreate,
  transferUpdate,
  transferContent,
  executionMutation,
} from './execution-model.js';
import { inventoryError as fail, stockMicros } from './inventory-quantity.js';

export class StockTransferService {
  private readonly context = new AsyncLocalStorage<MaterialPolicies>();
  constructor(
    readonly records: ExecutionRecords,
    private readonly reviews: ExecutionReviewService,
    private readonly materials: SupplyChainMaterialService,
  ) {
    reviews.register('stockTransfers', (c, context, operation) =>
      this.prepare(c, context, operation),
    );
  }
  private async resolve(
    c: DatabaseConnection,
    content: z.infer<typeof transferContent>,
    p: MaterialPolicies,
    preview = false,
  ) {
    await executionCompany(c, content.subjectId, p);
    for (const id of [content.warehouseId, content.destinationWarehouseId])
      if (
        !(await repo(c, 'warehouses', p).exists({
          filter: { id, subjectId: content.subjectId, status: 'active' },
        }))
      )
        return fail('STOCK_WAREHOUSE_UNAVAILABLE');
    const rows: RepositoryRecord[] = [];
    for (const [index, line] of content.lines.entries()) {
      if (
        line.selection.kind !== 'known' ||
        line.selection.subjectId !== content.subjectId
      )
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      const resolved = await (preview
        ? this.materials.previewSelectionInTransaction(
            c,
            'warehouse',
            line.selection,
            p,
          )
        : this.materials.resolveSelectionInTransaction(
            c,
            'warehouse',
            line.selection,
            p,
          ));
      if (resolved.identificationStatus !== 'identified')
        return fail('STOCK_MATERIAL_UNAVAILABLE');
      rows.push({
        id: line.id,
        subjectId: content.subjectId,
        lineNo: index + 1,
        status: 'active',
        quality: 'qualified',
        ...Object.fromEntries(
          (
            [
              'skuId',
              'baseUnitId',
              'unitId',
              'unitRuleId',
              'baseQuantity',
              'numeratorSnapshot',
              'denominatorSnapshot',
              'materialSnapshot',
            ] as const
          ).map((key) => [key, resolved[key] ?? null]),
        ),
        quantity: resolved.requestedQuantity,
        selectionInput: json(line),
        notes: line.notes,
      });
    }
    return rows;
  }
  private content(head: RepositoryRecord, lines: RepositoryRecord[]) {
    return transferContent.parse({
      ...Object.fromEntries(
        [
          'subjectId',
          'warehouseId',
          'destinationWarehouseId',
          'occurredOn',
          'reason',
          'notes',
        ].map((key) => [key, head[key]]),
      ),
      lines: lines.map((line) => line.selectionInput),
    });
  }
  private async prepare(
    c: DatabaseConnection,
    context: TransitionContext<ExecutionWorkflowTypes>,
    operation: string,
  ) {
    const p = this.context.getStore();
    if (!p) return fail('STOCK_FORBIDDEN');
    const head = context.record as RepositoryRecord,
      lines = await this.records.lines(c, 'stockTransfers', text(head.id));
    if (operation === 'edit')
      return {
        ...(context.input.values as import('@nocobase/lifecycle').JsonObject),
        contentVersion: Number(head.contentVersion) + 1,
        approvedVersionId: null,
        approvedAt: null,
      };
    if (['submit', 'approve'].includes(operation)) {
      const resolved = await this.resolve(
        c,
        this.content(head, lines),
        p,
        true,
      );
      for (const line of lines) {
        const next = resolved.find((row) => row.id === line.id);
        if (
          !next ||
          [
            'skuId',
            'baseUnitId',
            'unitId',
            'unitRuleId',
            'baseQuantity',
            'numeratorSnapshot',
            'denominatorSnapshot',
          ].some((key) => (line[key] ?? null) !== (next[key] ?? null))
        )
          return fail('STOCK_SOURCE_CHANGED');
      }
    }
    if (
      ['revise', 'cancel'].includes(operation) &&
      lines.some(
        (line) =>
          stockMicros(text(line.dispatchedQuantity)) >
          stockMicros(text(line.receivedQuantity)) +
            stockMicros(text(line.discrepancyQuantity)),
      )
    )
      return fail('STOCK_TRANSFER_IN_TRANSIT');
    if (
      operation === 'withdraw' &&
      head.createdBy !== context.actor.id &&
      head.submittedBy !== context.actor.id
    )
      return fail('STOCK_WITHDRAW_FORBIDDEN');
    return this.reviews.prepare(c, 'stockTransfers', context, operation, lines);
  }
  async save(
    id: string | undefined,
    raw: z.infer<typeof transferCreate> | z.infer<typeof transferUpdate>,
    actor: LifecycleActor,
    p: MaterialPolicies,
    copyFrom?: string,
  ) {
    const input =
        id || copyFrom ? transferUpdate.parse(raw) : transferCreate.parse(raw),
      content = input.content;
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      const read = (resultId: string) =>
        this.records.view(c, 'stockTransfers', resultId, p);
      return this.records.mutate(
        c,
        'stockTransfers',
        id ? `update:${id}` : copyFrom ? `copy:${copyFrom}` : 'create',
        input,
        actor,
        async (resultId) => {
          await this.records.head(c, 'stockTransfers', resultId, p);
          await executionWrite(
            c,
            'stockTransfers',
            { updatedBy: actor.id },
            p,
            id ? 'update' : 'create',
            id ? resultId : undefined,
          );
        },
        async () => {
          if (copyFrom) {
            const source = await this.records.head(
              c,
              'stockTransfers',
              copyFrom,
              p,
            );
            this.records.expect(
              source,
              input as z.infer<typeof transferUpdate>,
            );
            if (source.status !== 'cancelled')
              return fail('STOCK_COPY_NOT_CANCELLED');
          }
          let head = id
            ? await this.records.head(c, 'stockTransfers', id, p)
            : null;
          if (head) {
            await this.records.lockHead(c, 'stockTransfers', text(head.id));
            head = await this.records.head(
              c,
              'stockTransfers',
              text(head.id),
              p,
            );
            this.records.expect(head, input as z.infer<typeof transferUpdate>);
            if (head.status !== 'draft') return fail('STOCK_NOT_DRAFT');
            if (head.subjectId !== content.subjectId)
              return fail('STOCK_COMPANY_FROZEN');
            await this.records.wholeLines(c, 'stockTransfers', head, p);
          }
          const values = await this.resolve(c, content, p),
            before = head
              ? {
                  head,
                  lines: await this.records.lines(
                    c,
                    'stockTransfers',
                    text(head.id),
                  ),
                }
              : null,
            { lines: _lines, ...body } = content;
          if (!head)
            head = await this.records.create(
              c,
              'stockTransfers',
              { ...body, supersedesId: copyFrom ?? null },
              actor,
              p,
            );
          const transferId = text(head.id),
            old = await c
              .repository('stockTransferLines')
              .findMany({ filter: { transferId }, limit: 10001 });
          if (old.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
          for (const [index, line] of old.entries())
            await c.repository('stockTransferLines').updateOne({
              filter: { id: text(line.id) },
              values: { lineNo: 10001 + index },
            });
          for (const line of old.filter(
            (row) =>
              row.status === 'active' &&
              !values.some((value) => value.id === row.id),
          )) {
            if (stockMicros(text(line.dispatchedQuantity)) > 0n)
              return fail('STOCK_EXECUTED_LINE_FROZEN');
            await executionWrite(
              c,
              'stockTransferLines',
              { status: 'cancelled' },
              p,
              'update',
              text(line.id),
            );
            await c.repository('stockTransferLines').updateOne({
              filter: { id: text(line.id) },
              values: {
                status: 'cancelled',
                revision: Number(line.revision) + 1,
              },
            });
          }
          for (const value of values) {
            const previous = old.find((row) => row.id === value.id);
            if (previous?.status === 'cancelled')
              return fail('STOCK_LINE_ID_REUSED');
            if (
              previous &&
              stockMicros(text(previous.dispatchedQuantity)) > 0n &&
              [
                'skuId',
                'baseUnitId',
                'unitId',
                'unitRuleId',
                'numeratorSnapshot',
                'denominatorSnapshot',
              ].some((key) => (previous[key] ?? null) !== (value[key] ?? null))
            )
              return fail('STOCK_EXECUTED_LINE_FROZEN');
            if (
              previous &&
              stockMicros(text(previous.dispatchedQuantity)) >
                stockMicros(text(value.baseQuantity))
            )
              return fail('STOCK_SOURCE_REMAINING_EXCEEDED');
            const next = {
              ...value,
              transferId,
              revision: Number(previous?.revision ?? 0) + 1,
              nonce: randomUUID(),
              dispatchedQuantity: previous?.dispatchedQuantity ?? '0',
              receivedQuantity: previous?.receivedQuantity ?? '0',
              discrepancyQuantity: previous?.discrepancyQuantity ?? '0',
            };
            await executionWrite(
              c,
              'stockTransferLines',
              next,
              p,
              previous ? 'update' : 'create',
              previous ? text(previous.id) : undefined,
            );
            if (previous)
              await c
                .repository('stockTransferLines')
                .updateOne({ filter: { id: text(previous.id) }, values: next });
            else {
              if (
                await c
                  .repository('stockTransferLines')
                  .exists({ filter: { id: text(value.id) } })
              )
                return fail('STOCK_LINE_ID_REUSED');
              await c
                .repository('stockTransferLines')
                .createOne({ values: next });
            }
          }
          if (id) {
            await executionWrite(c, 'stockTransfers', body, p, 'update', id);
            await this.context.run(p, () =>
              this.records.runtime.fire('stockTransfers', id, 'edit', {
                actor,
                transaction: c,
                manual: false,
                expect: { version: Number(head.lifecycleVersion) },
                requestId: input.requestKey,
                input: {
                  values: json(body),
                  reason: (input as z.infer<typeof transferUpdate>).reason,
                },
              }),
            );
          }
          const after = await this.records.head(
            c,
            'stockTransfers',
            transferId,
            p,
          );
          await this.records.audit(
            c,
            'stockTransfers',
            after,
            actor,
            id ? 'update' : 'create',
            content.reason,
            before,
            {
              head: after,
              lines: await this.records.lines(c, 'stockTransfers', transferId),
            },
          );
          return { id: transferId, data: await read(transferId) };
        },
        read,
      );
    });
  }
  async fire(
    id: string,
    action:
      | 'submit'
      | 'approve'
      | 'return'
      | 'withdraw'
      | 'revise'
      | 'cancel'
      | 'reassign',
    raw: z.infer<typeof executionMutation>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = executionMutation.parse(raw);
    return this.records.db.transaction(async (c) => {
      await this.records.masterLock(c);
      await this.records.lockHead(c, 'stockTransfers', id);
      const authorize = async (resultId: string) => {
        await this.records.head(c, 'stockTransfers', resultId, p);
        await executionWrite(
          c,
          'stockTransfers',
          { updatedBy: actor.id },
          p,
          'update',
          resultId,
        );
      };
      return this.records.mutate(
        c,
        'stockTransfers',
        `${action}:${id}`,
        input,
        actor,
        authorize,
        async () => {
          await authorize(id);
          const before = await this.records.head(c, 'stockTransfers', id, p);
          this.records.expect(before, input);
          await this.records.wholeLines(c, 'stockTransfers', before, p);
          await this.context.run(p, () =>
            this.records.runtime.fire('stockTransfers', id, action, {
              actor,
              transaction: c,
              expect: { version: input.lifecycleVersion },
              requestId: input.requestKey,
              input: { reason: input.reason },
            }),
          );
          const after = await c
            .repository('stockTransfers')
            .findOne({ filter: { id } });
          if (!after) return fail('STOCK_NOT_FOUND');
          await this.records.audit(
            c,
            'stockTransfers',
            after,
            actor,
            action,
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
        (resultId) => this.records.view(c, 'stockTransfers', resultId, p),
      );
    });
  }
}
