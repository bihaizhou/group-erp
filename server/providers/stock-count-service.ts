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
import { InventoryService } from './inventory-service.js';
import { warehousePosting } from './warehouse-posting.js';
import {
  executionActor,
  executionCompany,
  executionRepo as repo,
  executionText as text,
  executionJson as json,
  executionWrite,
} from './execution-access.js';
import {
  countCreate,
  countUpdate,
  executionMutation,
} from './execution-model.js';
import {
  inventoryError as fail,
  stockMicros,
  stockPrecision,
  stockQuantity,
} from './inventory-quantity.js';

export class StockCountService {
  private readonly context = new AsyncLocalStorage<MaterialPolicies>();
  constructor(
    readonly records: ExecutionRecords,
    private readonly reviews: ExecutionReviewService,
    private readonly inventory: InventoryService,
    private readonly materials: SupplyChainMaterialService,
  ) {
    reviews.register('stockCounts', (c, context, operation) =>
      this.prepare(c, context, operation),
    );
  }
  private async warehouse(
    c: DatabaseConnection,
    subjectId: string,
    warehouseId: string,
    p: MaterialPolicies,
  ) {
    await executionCompany(c, subjectId, p);
    if (
      !(await repo(c, 'warehouses', p).exists({
        filter: { id: warehouseId, subjectId, status: 'active' },
      }))
    )
      return fail('STOCK_WAREHOUSE_UNAVAILABLE');
  }
  private async baseline(
    c: DatabaseConnection,
    head: RepositoryRecord,
    p: MaterialPolicies,
  ) {
    const filter = {
        subjectId: text(head.subjectId),
        warehouseId: text(head.warehouseId),
      },
      balances = await repo(c, 'stockBalances', p).findMany({
        filter,
        limit: 10001,
        sort: (s) => [s.field('dimensionKey').asc()],
      });
    if (balances.length > 10000) return fail('STOCK_COUNT_SCOPE_TOO_BROAD');
    if (
      balances.length !==
        (await c.repository('stockBalances').count({ filter })) ||
      balances.some((row) =>
        ['id', 'skuId', 'baseUnitId', 'quality', 'quantity'].some(
          (key) => !(key in row),
        ),
      )
    )
      return fail('STOCK_FORBIDDEN');
    for (const balance of balances) {
      const sku = await repo(c, 'materialSkus', p).findOne({
          filter: { id: text(balance.skuId) },
        }),
        unit = await repo(c, 'measureUnits', p).findOne({
          filter: { id: text(balance.baseUnitId) },
        });
      if (
        !sku ||
        !unit ||
        typeof sku.code !== 'string' ||
        typeof sku.name !== 'string' ||
        typeof unit.name !== 'string'
      )
        return fail('STOCK_FORBIDDEN');
      await c.repository('stockCountLines').createOne({
        values: {
          id: randomUUID(),
          countId: head.id,
          ...filter,
          balanceId: balance.id,
          skuId: balance.skuId,
          baseUnitId: balance.baseUnitId,
          quality: balance.quality,
          baselineQuantity: balance.quantity,
          actualQuantity: null,
          materialSnapshot: json({
            code: sku.code,
            name: sku.name,
            specification: sku.specification ?? '',
            baseUnitName: unit.name,
          }),
          reason: '',
          notes: '',
          countedBy: null,
          revision: 1,
        },
      });
    }
    await c.repository('warehouseStockGates').updateOne({
      filter: { id: text(head.warehouseId) },
      values: { countId: head.id },
    });
    return { baselineAt: new Date().toISOString() };
  }
  private async adjust(
    c: DatabaseConnection,
    head: RepositoryRecord,
    lines: RepositoryRecord[],
    actor: LifecycleActor,
    reason: string,
  ) {
    const differences = lines.filter(
      (line) =>
        stockMicros(text(line.actualQuantity)) !==
        stockMicros(text(line.baselineQuantity)),
    );
    // Each generated posting follows the engine's 100-line bound. All chunks,
    // their source effects, the approval and the final unfreeze remain atomic.
    for (let offset = 0; offset < differences.length; offset += 100) {
      const chunk = differences.slice(offset, offset + 100),
        now = new Date(),
        documentId = randomUUID(),
        created = await this.records.runtime.create(
          'stockDocuments',
          {
            id: documentId,
            code: `CA-${randomUUID().replaceAll('-', '').toUpperCase()}`,
            subjectId: head.subjectId,
            warehouseId: head.warehouseId,
            kind: 'countAdjustment',
            countId: head.id,
            revision: 1,
            contentVersion: 1,
            reviewRound: 0,
            nonce: randomUUID(),
            occurredOn: head.occurredOn,
            reason,
            notes: '',
            createdBy: actor.id,
            updatedBy: actor.id,
            createdAt: now,
            updatedAt: now,
          },
          { actor, transaction: c },
        ),
        doc = created.record as RepositoryRecord;
      for (const [index, line] of chunk.entries()) {
        const delta =
            stockMicros(text(line.actualQuantity)) -
            stockMicros(text(line.baselineQuantity)),
          amount = stockQuantity(delta < 0n ? -delta : delta);
        await c.repository('stockDocumentLines').createOne({
          values: {
            id: randomUUID(),
            documentId,
            subjectId: head.subjectId,
            lineNo: index + 1,
            revision: 1,
            nonce: randomUUID(),
            status: 'active',
            skuId: line.skuId,
            baseUnitId: line.baseUnitId,
            unitId: line.baseUnitId,
            unitRuleId: null,
            quantity: amount,
            baseQuantity: amount,
            numeratorSnapshot: '1',
            denominatorSnapshot: '1',
            quality: line.quality,
            materialSnapshot: line.materialSnapshot,
            selectionInput: json({ countLineId: line.id }),
            returnedQuantity: '0',
            rejectedQuantity: '0',
            notes: line.reason,
          },
        });
      }
      let plan: Awaited<ReturnType<typeof warehousePosting>> | undefined;
      const posting = await this.inventory.postInTransaction(
        c,
        {
          documentId,
          actorId: actor.id,
          version: Number(doc.revision),
          lifecycleVersion: Number(doc.lifecycleVersion),
          requestKey: randomUUID(),
          reason,
        },
        {
          postableStates: ['draft'],
          authorize: async (tx, document) => {
            await executionActor(tx, this.records.users, actor.id);
            const gate = await tx.repository('warehouseStockGates').findOne({
              filter: {
                id: text(head.warehouseId),
                subjectId: text(head.subjectId),
                countId: text(head.id),
              },
            });
            if (
              !gate ||
              document.countId !== head.id ||
              head.status !== 'pending'
            )
              return fail('STOCK_COUNT_SOURCE_CHANGED');
          },
          prepare: async (tx, document, rows) => {
            plan = await warehousePosting(tx, document, rows);
            return plan.entries;
          },
          posted: async (tx, document) => {
            if (!plan) return fail('STOCK_COUNT_SOURCE_CHANGED');
            await plan.apply();
            await this.records.runtime.fire(
              'stockDocuments',
              documentId,
              'post',
              {
                actor,
                transaction: tx,
                expect: { version: Number(document.lifecycleVersion) },
                requestId: randomUUID(),
                input: { reason },
              },
            );
          },
        },
      );
      await this.records.audit(
        c,
        'stockDocuments',
        doc,
        actor,
        'countAdjustment',
        reason,
        null,
        { countId: head.id, postingId: posting.postingId },
      );
    }
  }
  private async prepare(
    c: DatabaseConnection,
    context: TransitionContext<ExecutionWorkflowTypes>,
    operation: string,
  ) {
    const p = this.context.getStore();
    if (!p) return fail('STOCK_FORBIDDEN');
    const head = context.record as RepositoryRecord,
      lines = await this.records.lines(c, 'stockCounts', text(head.id));
    if (operation === 'edit')
      return {
        ...(context.input.values as import('@nocobase/lifecycle').JsonObject),
        contentVersion: Number(head.contentVersion) + 1,
        approvedVersionId: null,
        approvedAt: null,
      };
    if (operation === 'start') return this.baseline(c, head, p);
    if (['submit', 'approve'].includes(operation)) {
      if (!head.baselineAt) return fail('STOCK_COUNT_NOT_STARTED');
      for (const line of lines) {
        if (line.actualQuantity === null || !line.countedBy)
          return fail(
            'STOCK_COUNT_INCOMPLETE',
            `lines.${text(line.id)}.actualQuantity`,
          );
        if (
          stockMicros(text(line.actualQuantity)) !==
            stockMicros(text(line.baselineQuantity)) &&
          !text(line.reason).trim()
        )
          return fail(
            'STOCK_COUNT_REASON_REQUIRED',
            `lines.${text(line.id)}.reason`,
          );
      }
    }
    if (
      operation === 'withdraw' &&
      head.createdBy !== context.actor.id &&
      head.submittedBy !== context.actor.id
    )
      return fail('STOCK_WITHDRAW_FORBIDDEN');
    const prepared = await this.reviews.prepare(
      c,
      'stockCounts',
      context,
      operation,
      lines,
    );
    if (operation === 'approve')
      await this.adjust(
        c,
        head,
        lines,
        context.actor,
        text(context.input.reason),
      );
    if (['approve', 'cancel'].includes(operation))
      await c.repository('warehouseStockGates').updateOne({
        filter: { id: text(head.warehouseId), countId: text(head.id) },
        values: { countId: null },
      });
    return prepared;
  }
  async save(
    id: string | undefined,
    raw: z.infer<typeof countCreate> | z.infer<typeof countUpdate>,
    actor: LifecycleActor,
    p: MaterialPolicies,
    copyFrom?: string,
  ) {
    const input =
        id || copyFrom ? countUpdate.parse(raw) : countCreate.parse(raw),
      content = input.content;
    return this.records.db.transaction(async (c) => {
      // Draft creation/editing has no quantity effect. Counting edits take the
      // warehouse gate first, matching posting/start/approve and reservations.
      if (!id) await this.records.masterLock(c);
      else {
        const before = await this.records.head(c, 'stockCounts', id, p);
        await this.inventory.lockWarehouses(
          c,
          text(before.subjectId),
          [text(before.warehouseId)],
          id,
        );
        await this.records.lockHead(c, 'stockCounts', id);
      }
      const read = (resultId: string) =>
        this.records.view(c, 'stockCounts', resultId, p);
      return this.records.mutate(
        c,
        'stockCounts',
        id ? `update:${id}` : copyFrom ? `copy:${copyFrom}` : 'create',
        input,
        actor,
        async (resultId) => {
          await this.records.head(c, 'stockCounts', resultId, p);
          await executionWrite(
            c,
            'stockCounts',
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
              'stockCounts',
              copyFrom,
              p,
            );
            this.records.expect(source, input as z.infer<typeof countUpdate>);
            if (source.status !== 'cancelled')
              return fail('STOCK_COPY_NOT_CANCELLED');
          }
          let head = id
            ? await this.records.head(c, 'stockCounts', id, p)
            : null;
          if (head) {
            this.records.expect(head, input as z.infer<typeof countUpdate>);
            if (!['draft', 'counting'].includes(text(head.status)))
              return fail('STOCK_NOT_DRAFT');
            if (
              head.subjectId !== content.subjectId ||
              head.warehouseId !== content.warehouseId
            )
              return fail('STOCK_DOCUMENT_IDENTITY_FROZEN');
            await this.records.wholeLines(c, 'stockCounts', head, p);
          }
          await this.warehouse(c, content.subjectId, content.warehouseId, p);
          const { lines: _lines, ...values } = content as z.infer<
            typeof countUpdate
          >['content'];
          if (!head)
            head = await this.records.create(
              c,
              'stockCounts',
              {
                ...values,
                baselineAt: null,
                countedActors: [],
                supersedesId: copyFrom ?? null,
              },
              actor,
              p,
            );
          const countId = text(head.id),
            before = {
              head,
              lines: await this.records.lines(c, 'stockCounts', countId),
            },
            updatedLines = (content as z.infer<typeof countUpdate>['content'])
              .lines;
          if (updatedLines) {
            let changedCounter = false;
            if (head.status !== 'counting')
              return fail('STOCK_COUNT_NOT_STARTED');
            if (
              new Set(updatedLines.map((line) => line.id)).size !==
                updatedLines.length ||
              new Set(
                updatedLines.map((line) => `${line.skuId}:${line.quality}`),
              ).size !== updatedLines.length
            )
              return fail('STOCK_LINES_INVALID');
            for (const line of updatedLines) {
              const old = before.lines.find((row) => row.id === line.id);
              if (
                old &&
                (old.skuId !== line.skuId || old.quality !== line.quality)
              )
                return fail('STOCK_COUNT_BASELINE_FROZEN');
              let source = old;
              if (!source) {
                if (
                  before.lines.some(
                    (row) =>
                      row.skuId === line.skuId && row.quality === line.quality,
                  ) ||
                  (await c
                    .repository('stockCountLines')
                    .exists({ filter: { id: line.id } }))
                )
                  return fail('STOCK_LINE_ID_REUSED');
                const sku = await repo(c, 'materialSkus', p).findOne({
                  filter: { id: line.skuId },
                });
                if (!sku || typeof sku.baseUnitId !== 'string')
                  return fail('STOCK_MATERIAL_UNAVAILABLE');
                const selected =
                  await this.materials.previewSelectionInTransaction(
                    c,
                    'warehouse',
                    {
                      kind: 'known',
                      subjectId: content.subjectId,
                      skuId: line.skuId,
                      unitId: sku.baseUnitId,
                      quantity: '1',
                    },
                    p,
                  );
                if (
                  await c.repository('stockBalances').exists({
                    filter: {
                      subjectId: content.subjectId,
                      warehouseId: content.warehouseId,
                      skuId: line.skuId,
                      quality: line.quality,
                    },
                  })
                )
                  return fail('STOCK_COUNT_BASELINE_FROZEN');
                source = {
                  id: line.id,
                  countId,
                  subjectId: content.subjectId,
                  warehouseId: content.warehouseId,
                  balanceId: null,
                  skuId: line.skuId,
                  baseUnitId: selected.baseUnitId,
                  quality: line.quality,
                  baselineQuantity: '0',
                  materialSnapshot: selected.materialSnapshot,
                  revision: 0,
                };
              }
              if (line.actualQuantity !== null) {
                const unit = await c
                  .repository('measureUnits')
                  .findOne({ filter: { id: text(source.baseUnitId) } });
                if (!unit) return fail('STOCK_MATERIAL_UNAVAILABLE');
                stockPrecision(
                  stockMicros(line.actualQuantity),
                  Number(unit.precision),
                );
              }
              const quantityChanged = old
                ? (old.actualQuantity === null) !==
                    (line.actualQuantity === null) ||
                  (old.actualQuantity !== null &&
                    line.actualQuantity !== null &&
                    stockMicros(text(old.actualQuantity)) !==
                      stockMicros(line.actualQuantity))
                : true;
              if (
                old &&
                !quantityChanged &&
                old.reason === line.reason &&
                old.notes === line.notes
              )
                continue;
              changedCounter = true;
              const next = {
                ...source,
                actualQuantity: line.actualQuantity,
                reason: line.reason,
                notes: line.notes,
                countedBy:
                  line.actualQuantity === null
                    ? null
                    : quantityChanged
                      ? actor.id
                      : (source.countedBy ?? actor.id),
                revision: Number(source.revision) + 1,
              };
              await executionWrite(
                c,
                'stockCountLines',
                next,
                p,
                old ? 'update' : 'create',
                old ? line.id : undefined,
              );
              if (old)
                await c
                  .repository('stockCountLines')
                  .updateOne({ filter: { id: line.id }, values: next });
              else
                await c
                  .repository('stockCountLines')
                  .createOne({ values: next });
            }
            if (changedCounter)
              Object.assign(values, {
                countedActors: [
                  ...new Set([
                    ...(Array.isArray(head.countedActors)
                      ? head.countedActors.map(text)
                      : []),
                    actor.id,
                  ]),
                ],
              });
          }
          if (id) {
            await executionWrite(c, 'stockCounts', values, p, 'update', id);
            await this.context.run(p, () =>
              this.records.runtime.fire(
                'stockCounts',
                id,
                head.status === 'draft' ? 'editDraft' : 'edit',
                {
                  actor,
                  transaction: c,
                  manual: false,
                  expect: { version: Number(head.lifecycleVersion) },
                  requestId: input.requestKey,
                  input: {
                    values: json(values),
                    reason: (input as z.infer<typeof countUpdate>).reason,
                  },
                },
              ),
            );
          }
          const after = await this.records.head(c, 'stockCounts', countId, p);
          await this.records.audit(
            c,
            'stockCounts',
            after,
            actor,
            id ? 'update' : 'create',
            content.reason,
            before,
            {
              head: after,
              lines: await this.records.lines(c, 'stockCounts', countId),
            },
          );
          return { id: countId, data: await read(countId) };
        },
        read,
      );
    });
  }
  async fire(
    id: string,
    action:
      | 'start'
      | 'submit'
      | 'approve'
      | 'return'
      | 'withdraw'
      | 'cancel'
      | 'reassign',
    raw: z.infer<typeof executionMutation>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = executionMutation.parse(raw);
    return this.records.db.transaction(async (c) => {
      const initial = await this.records.head(c, 'stockCounts', id, p);
      await this.inventory.lockWarehouses(
        c,
        text(initial.subjectId),
        [text(initial.warehouseId)],
        id,
      );
      await this.records.lockHead(c, 'stockCounts', id);
      const authorize = async (resultId: string) => {
        await this.records.head(c, 'stockCounts', resultId, p);
        await executionWrite(
          c,
          'stockCounts',
          { updatedBy: actor.id },
          p,
          'update',
          resultId,
        );
      };
      return this.records.mutate(
        c,
        'stockCounts',
        `${action}:${id}`,
        input,
        actor,
        authorize,
        async () => {
          await authorize(id);
          const before = await this.records.head(c, 'stockCounts', id, p);
          this.records.expect(before, input);
          await this.records.wholeLines(c, 'stockCounts', before, p);
          await this.warehouse(
            c,
            text(before.subjectId),
            text(before.warehouseId),
            p,
          );
          await this.context.run(p, () =>
            this.records.runtime.fire('stockCounts', id, action, {
              actor,
              transaction: c,
              expect: { version: input.lifecycleVersion },
              requestId: input.requestKey,
              input: { reason: input.reason },
            }),
          );
          const after = await c
            .repository('stockCounts')
            .findOne({ filter: { id } });
          if (!after) return fail('STOCK_NOT_FOUND');
          await this.records.audit(
            c,
            'stockCounts',
            after,
            actor,
            action,
            input.reason,
            before,
            {
              head: after,
              lines: await this.records.lines(c, 'stockCounts', id),
            },
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
        (resultId) => this.records.view(c, 'stockCounts', resultId, p),
      );
    });
  }
}
