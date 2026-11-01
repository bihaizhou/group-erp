import { createHash, randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
  FilterBuilder,
} from '@nocobase/db';
import type { LifecycleRuntime, LifecycleActor } from '@nocobase/lifecycle';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { MaterialPolicies } from './material-service.js';
import type { ExecutionKind } from './execution-workflow.js';
import type { ExecutionQuery } from './execution-model.js';
import {
  executionActor,
  executionCompany,
  executionJson as json,
  executionRepo as repo,
  executionText as text,
  executionWrite,
} from './execution-access.js';
import { businessDate } from './business-date.js';
import { inventoryError as fail } from './inventory-quantity.js';
import { materialIdFilter } from './material-filters.js';

export const executionLineCollections = {
  purchaseOrders: ['purchaseOrderLines', 'orderId'],
  salesOrders: ['salesOrderLines', 'orderId'],
  stockDocuments: ['stockDocumentLines', 'documentId'],
  stockTransfers: ['stockTransferLines', 'transferId'],
  stockCounts: ['stockCountLines', 'countId'],
} as const;
export const executionFingerprint = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
      ),
    )
    .digest('hex');
export function executionUniqueConflict(error: unknown): never {
  let cause: unknown = error;
  for (
    let depth = 0;
    depth < 6 && cause && typeof cause === 'object';
    depth++
  ) {
    if (
      'code' in cause &&
      ['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(String(cause.code))
    )
      return fail('STOCK_REQUEST_KEY_REUSED');
    cause = 'cause' in cause ? cause.cause : undefined;
  }
  throw error;
}
/** Shared application persistence, not an HTTP CRUD or a second workflow engine. */
export class ExecutionRecords {
  constructor(
    readonly db: DatabaseManager,
    readonly runtime: LifecycleRuntime,
    readonly users: UserAdministrationService,
    readonly timeZone: string,
  ) {}
  async masterLock(c: DatabaseConnection) {
    for (const [table, id] of [
      ['orgMutationLock', 'organization'],
      ['supplyChainMutationLock', 'supplyChain'],
      ['materialMutationLock', 'materials'],
    ])
      await c
        .repository(table)
        .updateOne({ filter: { id }, values: { nonce: randomUUID() } });
  }
  async head(
    c: DatabaseConnection,
    kind: ExecutionKind,
    id: string,
    p: MaterialPolicies,
  ) {
    const visible = await repo(c, kind, p).findOne({ filter: { id } });
    if (!visible) return fail('STOCK_NOT_FOUND');
    for (const field of [
      'id',
      'subjectId',
      'warehouseId',
      'status',
      'revision',
      'lifecycleVersion',
    ])
      if (!(field in visible)) return fail('STOCK_FORBIDDEN');
    await executionCompany(c, text(visible.subjectId), p, false);
    if (
      !(await repo(c, 'warehouses', p).exists({
        filter: {
          id: text(visible.warehouseId),
          subjectId: text(visible.subjectId),
        },
      })) &&
      !(
        kind === 'stockTransfers' &&
        (await repo(c, 'warehouses', p).exists({
          filter: {
            id: text(visible.destinationWarehouseId),
            subjectId: text(visible.subjectId),
          },
        }))
      )
    )
      return fail('STOCK_FORBIDDEN');
    return (
      (await c.repository(kind).findOne({ filter: { id } })) ??
      fail('STOCK_NOT_FOUND')
    );
  }
  async lockHead(c: DatabaseConnection, kind: ExecutionKind, id: string) {
    await c
      .repository(kind)
      .updateOne({ filter: { id }, values: { nonce: randomUUID() } });
  }
  expect(
    head: RepositoryRecord,
    input: { version: number; lifecycleVersion: number },
  ) {
    if (
      head.revision !== input.version ||
      head.lifecycleVersion !== input.lifecycleVersion
    )
      return fail('STOCK_VERSION_CONFLICT');
  }
  async lines(c: DatabaseConnection, kind: ExecutionKind, id: string) {
    const [table, parent] = executionLineCollections[kind];
    const rows = await c.repository(table).findMany({
      filter: {
        [parent]: id,
        ...(kind === 'stockCounts' ? {} : { status: 'active' }),
      },
      limit: kind === 'stockCounts' ? 10001 : 101,
      sort: (s) => [s.field(kind === 'stockCounts' ? 'id' : 'lineNo').asc()],
    });
    if (rows.length > (kind === 'stockCounts' ? 10000 : 100))
      return fail('STOCK_LINES_INVALID');
    return rows;
  }
  async wholeLines(
    c: DatabaseConnection,
    kind: ExecutionKind,
    head: RepositoryRecord,
    p: MaterialPolicies,
  ) {
    const lines = await this.lines(c, kind, text(head.id)),
      [table] = executionLineCollections[kind];
    for (const line of lines) {
      const visible = await repo(c, table, p).findOne({
        filter: { id: text(line.id) },
      });
      if (
        !visible ||
        [
          'id',
          'skuId',
          'baseUnitId',
          kind === 'stockCounts' ? 'baselineQuantity' : 'baseQuantity',
        ].some((key) => !(key in visible))
      )
        return fail('STOCK_FORBIDDEN');
    }
    return lines;
  }
  async reference(
    c: DatabaseConnection,
    table: string,
    id: unknown,
    p: MaterialPolicies,
  ) {
    if (!id || !p[table] || p[table].read === false) return null;
    const row = await repo(c, table, p).findOne({ filter: { id: text(id) } });
    return row && typeof row.name === 'string'
      ? {
          id: text(row.id),
          name: row.name,
          ...(typeof row.code === 'string' ? { code: row.code } : {}),
        }
      : null;
  }
  async view(
    c: DatabaseConnection,
    kind: ExecutionKind,
    id: string,
    p: MaterialPolicies,
  ) {
    const raw = await this.head(c, kind, id, p),
      visible = (await repo(c, kind, p).findOne({ filter: { id } }))!,
      [table, parent] = executionLineCollections[kind],
      canReadLines = !!p[table] && p[table].read !== false,
      lines = canReadLines
        ? await repo(c, table, p).findMany({
            filter: {
              [parent]: id,
              ...(kind === 'stockCounts' ? {} : { status: 'active' }),
            },
            limit: kind === 'stockCounts' ? 10000 : 100,
            sort: (s) => [
              s.field(kind === 'stockCounts' ? 'id' : 'lineNo').asc(),
            ],
          })
        : [];
    const safeLines = await Promise.all(
      lines.map((line) => this.safeLine(c, kind, line, p)),
    );
    const issue =
      kind === 'stockDocuments' &&
      visible.issueRequestId &&
      p.materialIssueRequests?.read
        ? await c.repository('materialIssueRequests').findOne({
            filter: { id: text(visible.issueRequestId) },
          })
        : null;
    return json({
      ...visible,
      lines: safeLines,
      linesRestricted: !canReadLines,
      ...(kind === 'purchaseOrders'
        ? { allocations: await this.allocationSources(c, id, p) }
        : {}),
      review: await this.reviewContext(c, kind, id, p, undefined, 1),
      display: {
        company: await this.reference(c, 'orgSubjects', raw.subjectId, p),
        warehouse: await this.reference(
          c,
          'warehouses',
          visible.warehouseId,
          p,
        ),
        destinationWarehouse: await this.reference(
          c,
          'warehouses',
          visible.destinationWarehouseId,
          p,
        ),
        partner: await this.reference(
          c,
          'businessPartners',
          visible.partnerId,
          p,
        ),
        issueRequest: issue
          ? {
              id: text(issue.id),
              code: text(issue.code),
              fulfillmentStatus: issue.fulfillmentStatus ?? null,
            }
          : null,
        recipient: await this.reference(
          c,
          'personnelEmployees',
          issue?.recipientEmployeeId,
          p,
        ),
      },
    });
  }
  async list(kind: ExecutionKind, q: ExecutionQuery, p: MaterialPolicies) {
    const c = this.db.connection();
    await executionCompany(c, q.subjectId, p, false);
    const warehouses = await repo(c, 'warehouses', p).findMany({
      filter: { subjectId: q.subjectId },
      limit: 10001,
    });
    if (warehouses.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    const warehouseIds = warehouses.map((row) => text(row.id));
    const field = q.orderBy.replace(/^-/u, ''),
      allowed = [
        'code',
        'updatedAt',
        kind === 'stockCounts' ? 'baselineAt' : 'occurredOn',
        ...(kind.endsWith('Orders') ? ['deliveryOn'] : []),
      ];
    if (!allowed.includes(field)) return fail('STOCK_SORT_INVALID', 'orderBy');
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('subjectId').eq(q.subjectId),
        kind === 'stockTransfers'
          ? f.or([
              materialIdFilter(f, 'warehouseId', warehouseIds),
              materialIdFilter(f, 'destinationWarehouseId', warehouseIds),
            ])
          : materialIdFilter(f, 'warehouseId', warehouseIds),
        ...(q.warehouseId ? [f.string('warehouseId').eq(q.warehouseId)] : []),
        ...(q.status ? [f.string('status').eq(q.status)] : []),
        ...(kind === 'stockDocuments'
          ? [
              'purchaseOrderId',
              'salesOrderId',
              'transferId',
              'issueRequestId',
              'originalDocumentId',
            ].flatMap((key) => {
              const value = q[key as keyof ExecutionQuery];
              return typeof value === 'string' ? [f.string(key).eq(value)] : [];
            })
          : []),
        ...(kind === 'stockDocuments' && q.kind
          ? [f.string('kind').eq(q.kind)]
          : []),
        ...(kind === 'stockDocuments' && q.direction
          ? [
              f.or(
                (q.direction === 'inbound'
                  ? [
                      'purchaseReceipt',
                      'productionReceipt',
                      'salesReturn',
                      'issueReturn',
                      'transferReceipt',
                      'initial',
                      'qualityTransfer',
                      'reversal',
                      'countAdjustment',
                    ]
                  : [
                      'salesShipment',
                      'purchaseReturn',
                      'issue',
                      'productionIssue',
                      'transferDispatch',
                      'loss',
                      'transferDiscrepancy',
                    ]
                ).map((value) => f.string('kind').eq(value)),
              ),
            ]
          : []),
        ...(q.q
          ? [
              f.or([
                f.string('code').includes(q.q, { mode: 'insensitive' }),
                f.text('notes').includes(q.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
        ...(q.from ? [f.date('occurredOn').notBefore(q.from)] : []),
        ...(q.to ? [f.date('occurredOn').notAfter(q.to)] : []),
      ]);
    const scoped = repo(c, kind, p),
      rows = await scoped.findMany({
        filter,
        limit: q.pageSize,
        offset: (q.page - 1) * q.pageSize,
        sort: (s) => [
          q.orderBy.startsWith('-')
            ? s.field(field).desc()
            : s.field(field).asc(),
          s.field('id').asc(),
        ],
      });
    return {
      data: await Promise.all(
        rows.map((row) => this.view(c, kind, text(row.id), p)),
      ),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: await scoped.count({ filter }),
        businessDate: businessDate(this.timeZone),
      },
    };
  }
  private async reviewContext(
    c: DatabaseConnection,
    kind: ExecutionKind,
    id: string,
    p: MaterialPolicies,
    versionId?: string,
    limit = 1000,
  ) {
    if (!p.executionReviewTasks?.read) return { restricted: true };
    const tasks = await repo(c, 'executionReviewTasks', p).findMany({
      filter: { kind, documentId: id, ...(versionId ? { versionId } : {}) },
      limit: limit + 1,
      sort: (s) => [s.field('round').desc()],
    });
    if (limit > 1 && tasks.length > limit)
      return fail('STOCK_REFERENCE_TOO_BROAD');
    const data = [];
    for (const task of tasks.slice(0, limit)) {
      const reviewers = [];
      if (Array.isArray(task.candidates))
        for (const id of task.candidates) {
          if (typeof id !== 'string') continue;
          const user = await this.users.withConnection(c).get(id);
          reviewers.push({ id, name: user?.name ?? null });
        }
      data.push({ ...task, reviewers });
    }
    return { restricted: false, tasks: data };
  }
  /** A technical input echo cannot reveal a business field hidden by this action. */
  private async safeLine(
    c: DatabaseConnection,
    kind: ExecutionKind,
    line: RepositoryRecord,
    p: MaterialPolicies,
  ) {
    const raw = line.selectionInput;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return line;
    const input = { ...raw } as Record<string, unknown>;
    for (const field of [
      'notes',
      'quality',
      'condition',
      'rejectedQuantity',
      'replenishmentRequested',
      'unitPrice',
      'targetQuality',
      'sourceBalanceId',
      'originalLineId',
      'issueRequestLineId',
      'purchaseOrderLineId',
      'salesOrderLineId',
      'transferLineId',
      'quantity',
    ])
      if (!(field in line)) delete input[field];
    if (
      input.selection &&
      typeof input.selection === 'object' &&
      !Array.isArray(input.selection)
    ) {
      const selection = { ...input.selection } as Record<string, unknown>;
      for (const [field, business] of [
        ['quantity', 'quantity'],
        ['skuId', 'skuId'],
        ['unitId', 'unitId'],
        ['unitRuleId', 'unitRuleId'],
      ] as const)
        if (!(business in line)) delete selection[field];
      input.selection = selection;
    }
    if (kind === 'purchaseOrders' && Array.isArray(input.allocations)) {
      if (!p.purchaseAllocations?.read) delete input.allocations;
      else {
        const visible = await repo(c, 'purchaseAllocations', p).findMany({
          filter: { orderLineId: text(line.id) },
          limit: 10001,
        });
        if (visible.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
        input.allocations = input.allocations.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            return [];
          const allocation = value as Record<string, unknown>,
            proof = visible.find(
              (row) => row.requestLineId === allocation.requestLineId,
            );
          if (!proof) return [];
          return [
            Object.fromEntries(
              Object.entries(allocation).filter(([key]) => key in proof),
            ),
          ];
        });
      }
    }
    return { ...line, selectionInput: json(input) };
  }
  /** Order-owned, typed allocation proof exposes only the recorded demand basis. */
  private async allocationSources(
    c: DatabaseConnection,
    orderId: string,
    p: MaterialPolicies,
  ) {
    if (!p.purchaseAllocations?.read) return { restricted: true, items: [] };
    const rows = await repo(c, 'purchaseAllocations', p).findMany({
      filter: { orderId },
      limit: 10001,
    });
    if (rows.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    const items = [];
    for (const row of rows) {
      if (
        [
          'id',
          'orderLineId',
          'subjectId',
          'requestId',
          'requestLineId',
          'requestVersionId',
          'baseQuantity',
        ].some((key) => !(key in row))
      )
        continue;
      const version = await c.repository('supplyChainRequestVersions').findOne({
          filter: {
            id: text(row.requestVersionId),
            requestId: text(row.requestId),
            subjectId: text(row.subjectId),
          },
        }),
        payload = version?.payload as
          { head?: RepositoryRecord; lines?: RepositoryRecord[] } | undefined,
        source = payload?.lines?.find((line) => line.id === row.requestLineId);
      if (!source || !payload?.head) continue;
      items.push({
        id: row.id,
        orderLineId: row.orderLineId,
        status: row.status,
        baseQuantity: row.baseQuantity,
        source: {
          id: row.requestId,
          code: payload.head.code,
          versionId: row.requestVersionId,
          lineId: row.requestLineId,
          baseQuantity: source.baseQuantity,
          materialSnapshot: source.materialSnapshot,
        },
      });
    }
    return { restricted: false, items };
  }
  async audit(
    c: DatabaseConnection,
    kind: ExecutionKind,
    head: RepositoryRecord,
    actor: LifecycleActor,
    operation: string,
    reason: string,
    before: unknown,
    after: unknown,
  ) {
    await c.repository('supplyChainAudit').createOne({
      values: {
        id: randomUUID(),
        kind,
        recordId: head.id,
        subjectId: head.subjectId,
        actorId: actor.id,
        operation,
        reason,
        beforeValue: before ? json(before) : null,
        afterValue: json(after),
        createdAt: new Date(),
      },
    });
  }
  private async frozen(
    c: DatabaseConnection,
    kind: ExecutionKind,
    value: unknown,
    p: MaterialPolicies,
  ): Promise<unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const payload = value as Record<string, unknown>,
      project = (table: string, row: RepositoryRecord) => {
        const permission = p[table]?.read;
        if (!permission) return {};
        const fields = permission === true ? undefined : permission.fields;
        return Object.fromEntries(
          Object.entries(row).filter(([key]) =>
            fields === undefined
              ? permission === true
              : Array.isArray(fields) && fields.includes(key),
          ),
        );
      };
    if ('head' in payload) {
      const [table] = executionLineCollections[kind],
        lines: RepositoryRecord[] = [];
      for (const raw of Array.isArray(payload.lines) ? payload.lines : []) {
        const line = raw as RepositoryRecord;
        if (
          p[table]?.read &&
          (await repo(c, table, p).exists({ filter: { id: text(line.id) } }))
        )
          lines.push(await this.safeLine(c, kind, project(table, line), p));
      }
      return { head: project(kind, payload.head as RepositoryRecord), lines };
    }
    return project(kind, payload as RepositoryRecord);
  }
  async history(
    kind: ExecutionKind,
    id: string,
    q: { page: number; pageSize: number },
    p: MaterialPolicies,
  ) {
    const c = this.db.connection();
    await this.head(c, kind, id, p);
    const scoped = repo(c, 'supplyChainAudit', p),
      filter = { kind, recordId: id },
      data = await scoped.findMany({
        filter,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        limit: q.pageSize,
        offset: (q.page - 1) * q.pageSize,
      });
    return {
      data: await Promise.all(
        data.map(async (row) => {
          const actor =
            typeof row.actorId === 'string'
              ? await this.users.withConnection(c).get(row.actorId)
              : null;
          return json({
            ...row,
            ...('beforeValue' in row
              ? { beforeValue: await this.frozen(c, kind, row.beforeValue, p) }
              : {}),
            ...('afterValue' in row
              ? { afterValue: await this.frozen(c, kind, row.afterValue, p) }
              : {}),
            actor: actor ? { id: actor.id, name: actor.name } : null,
          });
        }),
      ),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: await scoped.count({ filter }),
      },
    };
  }
  async versions(
    kind: ExecutionKind,
    id: string,
    q: { page: number; pageSize: number },
    p: MaterialPolicies,
    versionId?: string,
  ) {
    const c = this.db.connection();
    await this.head(c, kind, id, p);
    const scoped = repo(c, 'executionVersions', p),
      filter = {
        kind,
        documentId: id,
        ...(versionId ? { id: versionId } : {}),
      };
    const data = await scoped.findMany({
      filter,
      sort: (s) => [s.field('contentVersion').desc()],
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    if (versionId && !data.length) return fail('STOCK_VERSION_NOT_FOUND');
    return {
      data: await Promise.all(
        data.map(async (row) =>
          json({
            ...row,
            ...('payload' in row
              ? { payload: await this.frozen(c, kind, row.payload, p) }
              : {}),
            ...(versionId
              ? { review: await this.reviewContext(c, kind, id, p, versionId) }
              : {}),
          }),
        ),
      ),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: await scoped.count({ filter }),
      },
    };
  }
  async create(
    c: DatabaseConnection,
    kind: ExecutionKind,
    content: RepositoryRecord,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const now = new Date(),
      prefix = {
        purchaseOrders: 'PO',
        salesOrders: 'SO',
        stockDocuments: 'WH',
        stockTransfers: 'TR',
        stockCounts: 'SC',
      }[kind],
      values: RepositoryRecord = {
        ...content,
        id: randomUUID(),
        code: `${prefix}-${businessDate(this.timeZone).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
        revision: 1,
        contentVersion: 1,
        reviewRound: 0,
        submittedVersionId: null,
        approvedVersionId: null,
        submittedBy: null,
        submittedAt: null,
        approvedAt: null,
        nonce: randomUUID(),
        createdBy: actor.id,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };
    await executionWrite(c, kind, values, p, 'create');
    const result = await this.runtime.create(kind, values, {
      actor,
      transaction: c,
    });
    await executionWrite(
      c,
      kind,
      result.record as RepositoryRecord,
      p,
      'create',
    );
    return result.record as RepositoryRecord;
  }
  async mutate<T>(
    c: DatabaseConnection,
    kind: ExecutionKind,
    operation: string,
    input: { requestKey: string },
    actor: LifecycleActor,
    authorizeReplay: (id: string) => Promise<void>,
    run: () => Promise<{ id: string; data: T }>,
    read: (id: string) => Promise<T>,
  ): Promise<T> {
    await executionActor(c, this.users, actor.id);
    const fingerprint = executionFingerprint({ kind, operation, input }),
      previous = await c.repository('executionActionRequests').findOne({
        filter: { actorId: actor.id, requestKey: input.requestKey },
      });
    if (previous) {
      if (
        previous.kind !== kind ||
        previous.operation !== operation ||
        previous.fingerprint !== fingerprint
      )
        return fail('STOCK_REQUEST_KEY_REUSED');
      await authorizeReplay(text(previous.resultId));
      return read(text(previous.resultId));
    }
    const result = await run();
    try {
      await c.repository('executionActionRequests').createOne({
        values: {
          id: randomUUID(),
          actorId: actor.id,
          requestKey: input.requestKey,
          kind,
          operation,
          resultId: result.id,
          fingerprint,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      executionUniqueConflict(error);
    }
    return result.data;
  }
}
