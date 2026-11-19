import { businessDate } from './business-date.js';
import { randomUUID } from 'node:crypto';
import type {
  DatabaseManager,
  DatabaseConnection,
  FilterBuilder,
  RepositoryRecord,
} from '@nocobase/db';
import {
  tables,
  kinds,
  inputSchemas,
  OrganizationError,
  type OrgKind,
  type OrgRecord,
  type OrgInput,
  type Actor,
} from './organization-model.js';
import { hasOpenPurchaseOrganizationReferences } from './purchase-reference-service.js';
import { hasOpenIssueOrganizationReferences } from './issue-request-references.js';

type Row = Record<string, unknown>;
function scalar(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : '';
}
export type ListQuery = {
  page: number;
  pageSize: number;
  q?: string;
  status?: string;
  subjectId?: string;
  unitId?: string;
  sectorId?: string;
  regionId?: string;
  orderBy?: string;
  kind?: string;
  recordId?: string;
};

function view(row: Row): OrgRecord {
  const { revision, ...rest } = row;
  return {
    ...rest,
    version: Number(revision),
    createdAt: new Date(scalar(row.createdAt)).toISOString(),
    updatedAt: new Date(scalar(row.updatedAt)).toISOString(),
  } as OrgRecord;
}
const fail = (reason: string, field?: string): never => {
  throw new OrganizationError(reason, field);
};

export type PendingChange = {
  id: string;
  kind: OrgKind;
  recordId: string;
  operation: string;
  payload: Record<string, unknown>;
  effectiveFrom: string;
  status: string;
  reason: string;
  actorId: string;
  actorName: string;
  errorReason: string | null;
  appliedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleChangeInput = {
  version: number;
  reason: string;
  effectiveFrom: string;
  changes: Record<string, unknown>;
};

export type ScheduleChangeOptions = {
  /**
   * Whether the actor may approve organization changes. Maintainers only queue
   * changes for review; approvers can queue an already-approved change.
   */
  canApprove: boolean;
};

const payloadOf = (value: unknown): Record<string, unknown> => {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {};
};

const pendingView = (row: Row): PendingChange => ({
  id: scalar(row.id),
  kind: scalar(row.kind) as OrgKind,
  recordId: scalar(row.recordId),
  operation: scalar(row.operation),
  payload: payloadOf(row.payload),
  effectiveFrom: scalar(row.effectiveFrom),
  status: scalar(row.status),
  reason: scalar(row.reason),
  actorId: scalar(row.actorId),
  actorName: scalar(row.actorName),
  errorReason: row.errorReason ? scalar(row.errorReason) : null,
  appliedAt: row.appliedAt
    ? new Date(scalar(row.appliedAt)).toISOString()
    : null,
  version: Number(row.version),
  createdAt: new Date(scalar(row.createdAt)).toISOString(),
  updatedAt: new Date(scalar(row.updatedAt)).toISOString(),
});

/** A calendar date in YYYY-MM-DD form that names a real day. */
const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};

/**
 * The single orgMutationLock row every organization mutation serializes on.
 * Position permission-mapping writes must take the very same row so mapping
 * saves and position deactivation can never interleave.
 */
export const ORG_MUTATION_LOCK_ID = 'organization';

/**
 * Take the shared organization mutation lock inside an already-open
 * transaction. Callers keep the transaction open around their reads and
 * writes so the lock is held until commit.
 */
export const lockOrgMutation = (connection: DatabaseConnection) =>
  connection.repository('orgMutationLock').updateOne({
    filter: { id: ORG_MUTATION_LOCK_ID },
    values: { nonce: randomUUID() },
  });

export class OrganizationService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly timeZone = 'Asia/Shanghai',
  ) {}

  async list(kind: OrgKind, query: ListQuery) {
    const repo = this.db.repository(tables[kind]);
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(query.q
          ? [
              f.or([
                f.string('name').includes(query.q, { mode: 'insensitive' }),
                f.string('code').includes(query.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
        ...(['status', 'subjectId', 'unitId', 'sectorId', 'regionId'] as const)
          .filter(
            (field) =>
              query[field] &&
              (field === 'status' ||
                (Object.hasOwn(
                  {
                    subjects: ['sectorId', 'regionId'],
                    units: ['subjectId'],
                    positions: ['unitId'],
                  },
                  kind,
                ) &&
                  (
                    {
                      subjects: ['sectorId', 'regionId'],
                      units: ['subjectId'],
                      positions: ['unitId'],
                    } as Record<string, string[]>
                  )[kind]?.includes(field))),
          )
          .map((field) => f.string(field).eq(query[field]!)),
      ]);
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [
          query.orderBy === 'updatedAt'
            ? s.field('updatedAt').asc()
            : s.field('updatedAt').desc(),
          s.field('id').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: rows.map(view),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(kind: OrgKind, id: string): Promise<OrgRecord> {
    const row = await this.db
      .repository(tables[kind])
      .findOne({ filter: { id } });
    if (!row) return fail('ORG_NOT_FOUND');
    return view(row);
  }

  async options() {
    // Bounded master-data picker: expose totals and truncation rather than silently hiding records.
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const repo = this.db.repository(tables[kind]);
        const [rows, total] = await Promise.all([
          repo.findMany({
            limit: 1000,
            sort: (s) => [s.field('sortOrder').asc(), s.field('code').asc()],
          }),
          repo.count(),
        ]);
        return [
          kind,
          { rows: rows.map(view), total, truncated: total > rows.length },
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async history(query: ListQuery) {
    const repo = this.db.repository('orgAudit');
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(query.kind ? [f.string('kind').eq(query.kind)] : []),
        ...(query.recordId ? [f.string('recordId').eq(query.recordId)] : []),
        ...(query.q
          ? [f.string('recordName').includes(query.q, { mode: 'insensitive' })]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [
          query.orderBy === 'createdAt'
            ? s.field('createdAt').asc()
            : s.field('createdAt').desc(),
          s.field('id').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: data.map((row) => ({
        ...row,
        createdAt: new Date(scalar(row.createdAt)).toISOString(),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async save(
    kind: OrgKind,
    input: OrgInput,
    actor: Actor,
    id?: string,
  ): Promise<OrgRecord> {
    return this.db.transaction(async (connection) => {
      // Acquire the shared database row lock BEFORE any reads. This serializes topology checks across
      // all application processes, including concurrent moves in different branches and enable/disable.
      await lockOrgMutation(connection);
      return this.saveWithinLock(connection, kind, input, actor, id);
    });
  }

  /**
   * Apply one organization mutation on an already-locked connection. The caller
   * owns the transaction and must have taken `orgMutationLock` first. `save` and
   * the scheduled-change sweep share this body so the lock is taken exactly once.
   */
  private async saveWithinLock(
    connection: DatabaseConnection,
    kind: OrgKind,
    input: OrgInput,
    actor: Actor,
    id?: string,
  ): Promise<OrgRecord> {
    const repo = connection.repository(tables[kind]);
    const before = id
      ? ((await repo.findOne({ filter: { id } })) ?? null)
      : null;
    if (id && !before) return fail('ORG_NOT_FOUND');
    if (before && Number(before.revision) !== input.version)
      return fail('ORG_VERSION_CONFLICT');
    const { version: _version, reason: _reason, ...changes } = input;
    const next: Row = {
      ...before,
      ...changes,
      id: id ?? randomUUID(),
      status: changes.status ?? before?.status ?? 'active',
      revision: Number(before?.revision ?? 0) + 1,
      createdAt: before?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    if (
      await repo.exists({
        filter: (f) =>
          f.and([
            f.string('code').eq(scalar(next.code)),
            f.string('id').ne(scalar(next.id)),
          ]),
      })
    ) {
      return fail('ORG_CODE_EXISTS', 'code');
    }
    await this.validate(connection, kind, next, before);
    const result = before
      ? await repo.updateOne({
          filter: { id },
          values: Object.fromEntries(
            Object.entries(next).filter(
              ([key]) => key !== 'id' && key !== 'createdAt',
            ),
          ) as RepositoryRecord,
        })
      : await repo.createOne({ values: next as RepositoryRecord });
    const record = view(result.record);
    await connection.repository('orgAudit').createOne({
      values: {
        id: randomUUID(),
        kind,
        recordId: record.id,
        recordName: record.name,
        operation: !before
          ? 'create'
          : before.status !== record.status
            ? scalar(record.status === 'active' ? 'enable' : 'disable')
            : 'update',
        actorId: actor.id,
        actorName: actor.name,
        reason: scalar(input.reason ?? 'Initial creation'),
        beforeValue: before ? view(before) : null,
        afterValue: record,
        createdAt: new Date(),
      },
    });
    return record;
  }

  /**
   * Queue a mutation for a future business date. Nothing on the organization
   * record changes until the sweep reaches `effectiveFrom`; until then the
   * pending row can be cancelled. Version checks and reference validation still
   * happen when the change is applied, because the organization may move before
   * then.
   */
  async scheduleChange(
    kind: OrgKind,
    recordId: string,
    input: ScheduleChangeInput,
    actor: Actor,
    options: ScheduleChangeOptions = { canApprove: false },
  ): Promise<PendingChange> {
    if (!isCalendarDate(input.effectiveFrom))
      return fail('ORG_INVALID_EFFECTIVE_DATE', 'effectiveFrom');
    if (input.effectiveFrom <= businessDate(this.timeZone))
      return fail('ORG_INVALID_EFFECTIVE_DATE', 'effectiveFrom');
    const entries = Object.entries(input.changes ?? {});
    if (!entries.length) return fail('INVALID_INPUT', 'changes');
    // `status` is not part of the create/update schemas but scheduling an
    // enable/disable is a first-class operation.
    const allowed = new Set<string>([
      ...Object.keys(inputSchemas[kind].shape),
      'status',
    ]);
    for (const [field] of entries)
      if (!allowed.has(field)) return fail('INVALID_INPUT', field);
    return this.db.transaction(async (connection) => {
      await lockOrgMutation(connection);
      const record = await connection.repository(tables[kind]).findOne({
        filter: { id: recordId },
      });
      if (!record) return fail('ORG_NOT_FOUND');
      if (Number(record.revision) !== input.version)
        return fail('ORG_VERSION_CONFLICT');
      const requestedStatus = input.changes.status;
      const operation =
        typeof requestedStatus === 'string' && requestedStatus !== record.status
          ? requestedStatus === 'active'
            ? 'enable'
            : 'disable'
          : 'update';
      const created = await connection
        .repository('orgPendingChanges')
        .createOne({
          values: {
            id: randomUUID(),
            kind,
            recordId,
            operation,
            payload: input.changes,
            effectiveFrom: input.effectiveFrom,
            status: options.canApprove ? 'pending' : 'awaiting_approval',
            reason: input.reason,
            actorId: actor.id,
            actorName: actor.name,
            errorReason: null,
            appliedAt: null,
            version: input.version,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as RepositoryRecord,
        });
      await connection.repository('orgAudit').createOne({
        values: {
          id: randomUUID(),
          kind,
          recordId,
          recordName: scalar(record.name),
          operation: 'schedule',
          actorId: actor.id,
          actorName: actor.name,
          reason: `${input.reason} (effective ${input.effectiveFrom})`,
          beforeValue: null,
          afterValue: view(record),
          createdAt: new Date(),
        },
      });
      // Scheduling a change is an approval in its own right when the author
      // holds the approve action; record it so a self-approved change is still
      // visible in the audit trail next to reviewed ones.
      if (options.canApprove)
        await connection.repository('orgAudit').createOne({
          values: {
            id: randomUUID(),
            kind,
            recordId,
            recordName: scalar(record.name),
            operation: 'approveSchedule',
            actorId: actor.id,
            actorName: actor.name,
            reason: `${input.reason} (scheduled directly by an approver)`,
            beforeValue: null,
            afterValue: view(record),
            createdAt: new Date(),
          },
        });
      return pendingView(created.record);
    });
  }

  async listPending(kind?: string, recordId?: string) {
    const repo = this.db.repository('orgPendingChanges');
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(kind ? [f.string('kind').eq(kind)] : []),
        ...(recordId ? [f.string('recordId').eq(recordId)] : []),
      ]);
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: 1000,
        sort: (s) => [
          s.field('effectiveFrom').asc(),
          s.field('createdAt').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return { rows: rows.map(pendingView), total };
  }

  async cancelPending(
    id: string,
    actor: Actor,
    input: { reason: string; version?: number },
  ): Promise<PendingChange> {
    return this.db.transaction(async (connection) => {
      // The sweep takes the same lock before reading a pending row, so cancel
      // and apply cannot interleave on one change.
      await lockOrgMutation(connection);
      const pending = await connection
        .repository('orgPendingChanges')
        .findOne({ filter: { id } });
      if (!pending) return fail('ORG_PENDING_NOT_FOUND');
      if (!['pending', 'awaiting_approval'].includes(scalar(pending.status)))
        return fail('ORG_PENDING_STATE');
      if (
        input.version !== undefined &&
        Number(pending.version) !== input.version
      )
        return fail('ORG_VERSION_CONFLICT');
      const updated = await connection
        .repository('orgPendingChanges')
        .updateOne({
          filter: { id },
          values: { status: 'cancelled', updatedAt: new Date() },
        });
      const kind = scalar(pending.kind) as OrgKind;
      const record = await connection
        .repository(tables[kind])
        .findOne({ filter: { id: scalar(pending.recordId) } });
      await connection.repository('orgAudit').createOne({
        values: {
          id: randomUUID(),
          kind,
          recordId: scalar(pending.recordId),
          recordName: record ? scalar(record.name) : '',
          operation: 'cancelSchedule',
          actorId: actor.id,
          actorName: actor.name,
          reason: input.reason,
          beforeValue: null,
          afterValue: pendingView(updated.record),
          createdAt: new Date(),
        },
      });
      return pendingView(updated.record);
    });
  }

  /**
   * Approve a change queued by a maintainer. Approval moves the row to
   * `pending`, after which the sweep applies it on its effective date. The
   * requester can never approve their own change, mirroring the review rules
   * used elsewhere in the ERP.
   */
  async approvePending(
    id: string,
    actor: Actor,
    input: { reason?: string; version?: number },
  ): Promise<PendingChange> {
    return this.db.transaction(async (connection) => {
      await lockOrgMutation(connection);
      const pending = await connection
        .repository('orgPendingChanges')
        .findOne({ filter: { id } });
      if (!pending) return fail('ORG_PENDING_NOT_FOUND');
      if (scalar(pending.status) !== 'awaiting_approval')
        return fail('ORG_PENDING_STATE');
      if (scalar(pending.actorId) === actor.id)
        return fail('ORG_SELF_APPROVAL');
      if (
        input.version !== undefined &&
        Number(pending.version) !== input.version
      )
        return fail('ORG_VERSION_CONFLICT');
      const updated = await connection
        .repository('orgPendingChanges')
        .updateOne({
          filter: { id },
          values: { status: 'pending', updatedAt: new Date() },
        });
      const kind = scalar(pending.kind) as OrgKind;
      const record = await connection
        .repository(tables[kind])
        .findOne({ filter: { id: scalar(pending.recordId) } });
      await connection.repository('orgAudit').createOne({
        values: {
          id: randomUUID(),
          kind,
          recordId: scalar(pending.recordId),
          recordName: record ? scalar(record.name) : '',
          operation: 'approveSchedule',
          actorId: actor.id,
          actorName: actor.name,
          reason: input.reason?.trim() || '',
          beforeValue: null,
          afterValue: pendingView(updated.record),
          createdAt: new Date(),
        },
      });
      return pendingView(updated.record);
    });
  }

  /**
   * Apply every pending change whose effective date has arrived. Each row gets
   * its own transaction: the sweep takes the mutation lock once, reads the
   * record at its current revision, then reuses `saveWithinLock` (never
   * `save`, which would open a nested transaction and re-take the lock).
   * A row that cannot be applied is marked `failed` with the reason and does
   * not stop the remaining rows.
   */
  async applyDue(now?: string): Promise<Array<{ id: string; reason: string }>> {
    const due = now ?? businessDate(this.timeZone);
    const rows = (
      await this.db.repository('orgPendingChanges').findMany({
        filter: (f) => f.string('status').eq('pending'),
        sort: (s) => [
          s.field('effectiveFrom').asc(),
          s.field('createdAt').asc(),
        ],
        limit: 1000,
      })
    ).filter((row) => scalar(row.effectiveFrom) <= due);
    const failures: Array<{ id: string; reason: string }> = [];
    for (const row of rows) {
      const rowId = scalar(row.id);
      try {
        await this.db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const pending = await connection
            .repository('orgPendingChanges')
            .findOne({ filter: { id: rowId } });
          // Another process may have applied or cancelled it while we queued.
          if (!pending || pending.status !== 'pending') return;
          const kind = scalar(pending.kind) as OrgKind;
          if (!(kinds as readonly string[]).includes(kind))
            return fail('ORG_INVALID_REFERENCE');
          const record = await connection
            .repository(tables[kind])
            .findOne({ filter: { id: scalar(pending.recordId) } });
          if (!record) return fail('ORG_NOT_FOUND');
          const actor = {
            id: scalar(pending.actorId),
            name: scalar(pending.actorName),
          };
          const saved = await this.saveWithinLock(
            connection,
            kind,
            {
              ...payloadOf(pending.payload),
              version: Number(record.revision),
              reason: scalar(pending.reason),
            },
            actor,
            scalar(pending.recordId),
          );
          await connection.repository('orgPendingChanges').updateOne({
            filter: { id: scalar(pending.id), status: 'pending' },
            values: {
              status: 'applied',
              appliedAt: new Date(),
              errorReason: null,
              updatedAt: new Date(),
            },
          });
          await connection.repository('orgAudit').createOne({
            values: {
              id: randomUUID(),
              kind,
              recordId: saved.id,
              recordName: saved.name,
              operation: 'applySchedule',
              actorId: actor.id,
              actorName: actor.name,
              reason: `Applied scheduled change effective ${scalar(pending.effectiveFrom)}: ${scalar(pending.reason)}`,
              beforeValue: view(record),
              afterValue: saved,
              createdAt: new Date(),
            },
          });
        });
      } catch (error) {
        const reason =
          error instanceof OrganizationError
            ? error.reason
            : error instanceof Error
              ? error.message
              : 'Unknown error';
        const errorReason = reason.slice(0, 500);
        failures.push({ id: scalar(row.id), reason: errorReason });
        await this.db.repository('orgPendingChanges').updateOne({
          filter: { id: scalar(row.id), status: 'pending' },
          values: { status: 'failed', errorReason, updatedAt: new Date() },
        });
      }
    }
    return failures;
  }

  private async validate(
    c: DatabaseConnection,
    kind: OrgKind,
    next: Row,
    before: Row | null,
  ) {
    const id = scalar(next.id);
    const active = next.status === 'active';
    const ref = async (
      target: OrgKind,
      value: unknown,
      field: string,
      required = false,
    ) => {
      if (!value) {
        if (required) fail('ORG_REQUIRED_REFERENCE', field);
        return null;
      }
      const row = await c
        .repository(tables[target])
        .findOne({ filter: { id: scalar(value) } });
      if (!row) return fail('ORG_INVALID_REFERENCE', field);
      if (active && row.status !== 'active')
        return fail('ORG_INACTIVE_REFERENCE', field);
      return row;
    };
    const cycle = async (field: string) => {
      let current = next[field];
      const seen = new Set<string>([id]);
      while (current) {
        if (seen.has(scalar(current))) return fail('ORG_CYCLE', field);
        seen.add(scalar(current));
        const parent = await ref(kind, current, field);
        current = parent?.[field];
      }
    };
    const exists = async (target: OrgKind, filter: Record<string, string>) =>
      c
        .repository(tables[target])
        .exists({ filter: { ...filter, status: 'active' } });
    // Direct open purchase ownership cannot become invalid. Retired requests
    // keep their historical references; personnel departures use review handover.
    if (
      before &&
      ((kind === 'subjects' && !active) ||
        (kind === 'units' &&
          (!active || next.subjectId !== before.subjectId))) &&
      (await hasOpenPurchaseOrganizationReferences(c, kind, id))
    )
      return fail('ORG_PURCHASE_DEPENDENTS');
    if (
      before &&
      ((kind === 'subjects' && !active) ||
        (kind === 'units' &&
          (!active || next.subjectId !== before.subjectId))) &&
      (await hasOpenIssueOrganizationReferences(c, kind, id))
    )
      return fail('ORG_ISSUE_DEPENDENTS');
    // Material writes acquire orgMutationLock first too, so retirement and warehouse assignment cannot race.
    if (before && kind === 'subjects' && !active) {
      for (const table of ['warehouses', 'materialReferences'])
        if (
          await c
            .repository(table)
            .exists({ filter: { subjectId: id, status: 'active' } })
        )
          return fail('ORG_MATERIAL_DEPENDENTS');
      if (
        await c.repository('materialRequests').exists({
          filter: (f) =>
            f.and([
              f.string('subjectId').eq(id),
              f.or([
                f.string('status').eq('draft'),
                f.string('status').eq('pending'),
              ]),
            ]),
        })
      )
        return fail('ORG_MATERIAL_DEPENDENTS');
    }
    if (
      before &&
      kind === 'positions' &&
      (!active || next.unitId !== before.unitId)
    ) {
      if (
        await c
          .repository('warehouses')
          .exists({ filter: { responsiblePositionId: id, status: 'active' } })
      )
        return fail('ORG_MATERIAL_DEPENDENTS');
    }
    if (
      before &&
      kind === 'units' &&
      (!active || next.subjectId !== before.subjectId)
    ) {
      const positions = await c
        .repository('orgPositions')
        .findMany({ filter: { unitId: id }, limit: 10001 });
      if (positions.length > 10000) return fail('ORG_MATERIAL_DEPENDENTS');
      for (const position of positions)
        if (
          await c.repository('warehouses').exists({
            filter: {
              responsiblePositionId: scalar(position.id),
              status: 'active',
            },
          })
        )
          return fail('ORG_MATERIAL_DEPENDENTS');
    }
    if (
      before &&
      ['subjects', 'units', 'positions'].includes(kind) &&
      (!active || (kind === 'positions' && next.unitId !== before.unitId))
    ) {
      const assignments = await c
        .repository('personnelAssignments')
        .findMany({ limit: 100001 });
      const changes = await c.repository('personnelChanges').findMany({
        filter: (f) =>
          f.or([
            f.string('status').eq('draft'),
            f.string('status').eq('pending'),
            f.string('status').eq('approved'),
          ]),
        limit: 100001,
      });
      if (assignments.length > 100000 || changes.length > 100000)
        return fail('ORG_PERSONNEL_DEPENDENTS');
      const matches = async (positionId: unknown, subjectId: unknown) => {
        if (kind === 'subjects') return subjectId === id;
        if (kind === 'positions') return positionId === id;
        if (typeof positionId !== 'string' || !positionId) return false;
        const position = await c
          .repository('orgPositions')
          .findOne({ filter: { id: positionId } });
        return position?.unitId === id;
      };
      const on = businessDate(this.timeZone);
      for (const assignment of assignments) {
        const data = assignment.data as Record<string, unknown>;
        if (
          (typeof data.endDate !== 'string' || data.endDate > on) &&
          (await matches(assignment.positionId, assignment.subjectId))
        )
          return fail('ORG_PERSONNEL_DEPENDENTS');
      }
      for (const change of changes) {
        const data = change.data as Record<string, unknown>;
        if (await matches(data.targetPositionId, data.targetSubjectId))
          return fail('ORG_PERSONNEL_DEPENDENTS');
      }
      if (kind === 'subjects') {
        const employments = await c
          .repository('personnelEmployments')
          .findMany({ filter: { subjectId: id }, limit: 100001 });
        if (
          employments.length > 100000 ||
          employments.some(
            (r) =>
              !(r.data as Record<string, unknown>).endDate ||
              String((r.data as Record<string, unknown>).endDate) > on,
          )
        )
          return fail('ORG_PERSONNEL_DEPENDENTS');
      }
    }
    if (['sectors', 'regions', 'subjects', 'units'].includes(kind))
      await cycle('parentId');
    if (kind === 'subjects') {
      if (next.type === 'company' && (!next.sectorId || !next.regionId))
        return fail(
          'ORG_COMPANY_CLASSIFICATION',
          !next.sectorId ? 'sectorId' : 'regionId',
        );
      await ref('sectors', next.sectorId, 'sectorId');
      await ref('regions', next.regionId, 'regionId');
    }
    if (kind === 'units') {
      await ref('subjects', next.subjectId, 'subjectId', true);
      if (
        before &&
        next.subjectId !== before.subjectId &&
        ((await c
          .repository('orgUnits')
          .exists({ filter: { parentId: id } })) ||
          (await c
            .repository('orgPositions')
            .exists({ filter: { unitId: id } })) ||
          (await c.repository('orgRelations').exists({
            filter: (f) =>
              f.or([
                f.and([
                  f.string('sourceKind').eq('units'),
                  f.string('sourceId').eq(id),
                ]),
                f.and([
                  f.string('targetKind').eq('units'),
                  f.string('targetId').eq(id),
                ]),
              ]),
          })))
      )
        return fail('ORG_UNIT_SUBJECT_LOCKED', 'subjectId');
      const parent = await ref('units', next.parentId, 'parentId');
      if (parent && parent.subjectId !== next.subjectId)
        return fail('ORG_UNIT_SUBJECT_MISMATCH', 'parentId');
      const leader = await ref(
        'positions',
        next.leaderPositionId,
        'leaderPositionId',
      );
      if (leader && leader.unitId !== id)
        return fail('ORG_LEADER_UNIT_MISMATCH', 'leaderPositionId');
    }
    if (kind === 'positions') {
      const unit = await ref('units', next.unitId, 'unitId', true);
      await cycle('reportsToId');
      const manager = await ref('positions', next.reportsToId, 'reportsToId');
      if (manager) {
        const managerUnit = await ref(
          'units',
          manager.unitId,
          'reportsToId',
          true,
        );
        if (unit?.subjectId !== managerUnit?.subjectId)
          return fail('ORG_POSITION_SUBJECT_MISMATCH', 'reportsToId');
      }
      if (
        before &&
        next.unitId !== before.unitId &&
        ((await c
          .repository('orgUnits')
          .exists({ filter: { leaderPositionId: id } })) ||
          (await c
            .repository('orgPositions')
            .exists({ filter: { reportsToId: id } })))
      )
        return fail('ORG_POSITION_UNIT_LOCKED', 'unitId');
    }
    if (kind === 'relations') {
      if (
        next.sourceKind === next.targetKind &&
        next.sourceId === next.targetId
      )
        return fail('ORG_SELF_RELATION', 'targetId');
      await ref(next.sourceKind as OrgKind, next.sourceId, 'sourceId', true);
      await ref(next.targetKind as OrgKind, next.targetId, 'targetId', true);
      if (next.endDate && scalar(next.endDate) < scalar(next.startDate))
        return fail('ORG_DATE_RANGE', 'endDate');
    }
    if (before?.status === 'active' && !active) {
      if (
        ['sectors', 'regions', 'subjects', 'units'].includes(kind) &&
        (await exists(kind, { parentId: id }))
      )
        return fail('ORG_ACTIVE_DEPENDENTS');
      if (kind === 'sectors' && (await exists('subjects', { sectorId: id })))
        return fail('ORG_ACTIVE_DEPENDENTS');
      if (kind === 'regions' && (await exists('subjects', { regionId: id })))
        return fail('ORG_ACTIVE_DEPENDENTS');
      if (kind === 'subjects' && (await exists('units', { subjectId: id })))
        return fail('ORG_ACTIVE_DEPENDENTS');
      if (kind === 'units' && (await exists('positions', { unitId: id })))
        return fail('ORG_ACTIVE_DEPENDENTS');
      if (
        kind === 'positions' &&
        ((await exists('positions', { reportsToId: id })) ||
          (await exists('units', { leaderPositionId: id })))
      )
        return fail('ORG_ACTIVE_DEPENDENTS');
      // Residual permission-set mappings block deactivation: clearing them is
      // an explicit configuration step the operator must take first.
      if (
        kind === 'positions' &&
        (await c
          .repository('orgPositionPermissionSets')
          .exists({ filter: { positionId: id } }))
      )
        return fail('ORG_POSITION_MAPPING_DEPENDENTS');
      if (kind === 'units') {
        const positions = await c
          .repository('orgPositions')
          .findMany({ filter: { unitId: id }, limit: 10001 });
        if (positions.length > 10000)
          return fail('ORG_POSITION_MAPPING_DEPENDENTS');
        for (const position of positions)
          if (
            await c
              .repository('orgPositionPermissionSets')
              .exists({ filter: { positionId: scalar(position.id) } })
          )
            return fail('ORG_POSITION_MAPPING_DEPENDENTS');
      }
      // Assets reference entities (assets.subjectId → orgSubjects.id), not
      // units or positions, so only subject deactivation checks them.
      // Scrapped assets are out of service and do not block deactivation.
      if (
        kind === 'subjects' &&
        (await c.repository('assets').exists({
          filter: (f) =>
            f.and([
              f.string('subjectId').eq(id),
              f.string('status').ne('scrapped'),
            ]),
        }))
      )
        return fail('ORG_ASSET_DEPENDENTS');
      if (
        (kind === 'subjects' || kind === 'units') &&
        (await c.repository('orgRelations').exists({
          filter: (f) =>
            f.and([
              f.string('status').eq('active'),
              f.or([
                f.and([
                  f.string('sourceKind').eq(kind),
                  f.string('sourceId').eq(id),
                ]),
                f.and([
                  f.string('targetKind').eq(kind),
                  f.string('targetId').eq(id),
                ]),
              ]),
            ]),
        }))
      )
        return fail('ORG_ACTIVE_DEPENDENTS');
    }
  }
}
