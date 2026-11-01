import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '@nocobase/app-server/router';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import {
  defineLifecycle,
  type LifecycleRuntime,
  type LifecycleActor,
  type JsonObject,
} from '@nocobase/lifecycle';
import type { MaterialPolicies } from './material-service.js';
import {
  issuePurposeCreate,
  issuePurposeUpdate,
  issuePurposeMutation,
  issuePurposeQuery,
} from './issue-purpose-model.js';
import { z } from 'zod';

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as JsonObject;
const canonical = (v: unknown) =>
  JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const hash = (v: unknown) =>
  createHash('sha256').update(canonical(v)).digest('hex');
function fail(
  reason: string,
  status: ConstructorParameters<
    typeof ApiError
  >[0]['status'] = 'FAILED_PRECONDITION',
): never {
  throw new ApiError({
    domain: 'requisitions',
    reason,
    status,
    message: 'The issue purpose operation could not be completed.',
  });
}
const purposeLifecycle = defineLifecycle({
  name: 'materialIssuePurposes',
  collection: 'materialIssuePurposes',
  initial: 'active',
  states: ['active', 'inactive'],
  create: { guard: ({ actor, values }) => values.createdBy === actor.id },
  transitions: {
    editActive: {
      from: 'active',
      to: 'active',
      manual: false,
      set: ({ input, record, actor }) => ({
        ...(input.values as JsonObject),
        revision: Number(record.revision) + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      }),
    },
    editInactive: {
      from: 'inactive',
      to: 'inactive',
      manual: false,
      set: ({ input, record, actor }) => ({
        ...(input.values as JsonObject),
        revision: Number(record.revision) + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      }),
    },
    activate: {
      from: 'inactive',
      to: 'active',
      set: ({ record, actor }) => ({
        revision: Number(record.revision) + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      }),
    },
    deactivate: {
      from: 'active',
      to: 'inactive',
      set: ({ record, actor }) => ({
        revision: Number(record.revision) + 1,
        updatedBy: actor.id,
        updatedAt: new Date(),
      }),
    },
  },
});

export class IssuePurposeService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly runtime: LifecycleRuntime,
  ) {
    runtime.register(purposeLifecycle);
  }
  private repo(c: DatabaseConnection, table: string, p: MaterialPolicies) {
    if (!p[table] || p[table].read === false)
      return fail('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
    return c.repository(table).withPolicy(p[table]);
  }
  private async company(
    c: DatabaseConnection,
    subjectId: string,
    p: MaterialPolicies,
    active = true,
  ) {
    const company = await this.repo(c, 'orgSubjects', p).findOne({
      filter: { id: subjectId, ...(active ? { status: 'active' } : {}) },
    });
    if (!company) return fail('ISSUE_COMPANY_UNAVAILABLE', 'NOT_FOUND');
    return company;
  }
  private async get(c: DatabaseConnection, id: string, p: MaterialPolicies) {
    const row = await this.repo(c, 'materialIssuePurposes', p).findOne({
      filter: { id },
    });
    if (!row) return fail('ISSUE_PURPOSE_NOT_FOUND', 'NOT_FOUND');
    await this.company(c, text(row.subjectId), p, false);
    return row;
  }
  async detail(id: string, p: MaterialPolicies) {
    const c = this.db.connection(),
      row = await this.get(c, id, p);
    const company = await this.company(c, text(row.subjectId), p, false);
    return json({
      ...row,
      company: { id: company.id, code: company.code, name: company.name },
    });
  }
  async list(raw: z.infer<typeof issuePurposeQuery>, p: MaterialPolicies) {
    const q = issuePurposeQuery.parse(raw),
      c = this.db.connection();
    await this.company(c, q.subjectId, p, false);
    const repo = this.repo(c, 'materialIssuePurposes', p);
    const filter = (f: import('@nocobase/db').FilterBuilder) =>
      f.and([
        f.string('subjectId').eq(q.subjectId),
        ...(q.status ? [f.string('status').eq(q.status)] : []),
        ...(q.q
          ? [
              f.or([
                f.string('code').includes(q.q, { mode: 'insensitive' }),
                f.string('name').includes(q.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        offset: (q.page - 1) * q.pageSize,
        limit: q.pageSize,
        sort: (s) => [
          q.orderBy.startsWith('-')
            ? s.field(q.orderBy.slice(1)).desc()
            : s.field(q.orderBy).asc(),
          s.field('id').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: data.map(json),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }
  async companies(
    q: { q?: string; page: number; pageSize: number },
    p: MaterialPolicies,
  ) {
    const repo = this.repo(this.db.connection(), 'orgSubjects', p);
    const filter = (f: import('@nocobase/db').FilterBuilder) =>
      f.and([
        f.string('status').eq('active'),
        ...(q.q
          ? [
              f.or([
                f.string('code').includes(q.q, { mode: 'insensitive' }),
                f.string('name').includes(q.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: q.pageSize,
        offset: (q.page - 1) * q.pageSize,
        sort: (s) => [s.field('code').asc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: data.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }
  async previewPurposeInTransaction(
    c: DatabaseConnection,
    subjectId: string,
    id: string,
    p: MaterialPolicies,
  ) {
    await this.company(c, subjectId, p);
    const row = await this.repo(c, 'materialIssuePurposes', p).findOne({
      filter: { id, subjectId, status: 'active' },
    });
    if (!row) return fail('ISSUE_PURPOSE_UNAVAILABLE', 'INVALID_ARGUMENT');
    return {
      id: text(row.id),
      subjectId,
      code: text(row.code),
      name: text(row.name),
      revision: Number(row.revision),
    };
  }
  async resolvePurposeInTransaction(
    c: DatabaseConnection,
    subjectId: string,
    id: string,
    p: MaterialPolicies,
  ) {
    // Callers hold organization -> supply-chain locks in this same transaction.
    return this.previewPurposeInTransaction(c, subjectId, id, p);
  }
  private async write(
    c: DatabaseConnection,
    row: RepositoryRecord,
    before: RepositoryRecord | null,
    p: MaterialPolicies,
  ) {
    const policy = p.materialIssuePurposes,
      operation = before ? 'update' : 'create';
    if (!policy || !policy[operation])
      return fail('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
    const values = before
      ? Object.fromEntries(
          Object.entries(row).filter(
            ([key, value]) => canonical(value) !== canonical(before[key]),
          ),
        )
      : row;
    const valid = await c
      .repository('materialIssuePurposes')
      .withPolicy(policy)
      .validateMutation(
        before
          ? { operation: 'updateOne', filter: { id: text(before.id) }, values }
          : { operation: 'createOne', values },
      );
    if (!valid.valid) return fail('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
    const mode = policy[operation];
    if (
      before &&
      mode !== true &&
      !(await c
        .repository('materialIssuePurposes')
        .withPolicy({ ...policy, read: { scope: mode.scope, fields: ['id'] } })
        .exists({ filter: { id: text(before.id) } }))
    )
      return fail('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
  }
  async save(
    id: string | undefined,
    raw:
      | z.infer<typeof issuePurposeCreate>
      | z.infer<typeof issuePurposeUpdate>
      | (z.infer<typeof issuePurposeMutation> & {
          transition: 'activate' | 'deactivate';
        }),
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = id
      ? 'content' in raw
        ? issuePurposeUpdate.parse(raw)
        : issuePurposeMutation
            .extend({ transition: z.enum(['activate', 'deactivate']) })
            .parse(raw)
      : issuePurposeCreate.parse(raw);
    return this.db.transaction(async (c) => {
      await c.repository('orgMutationLock').updateOne({
        filter: { id: 'organization' },
        values: { nonce: randomUUID() },
      });
      await c.repository('supplyChainMutationLock').updateOne({
        filter: { id: 'supplyChain' },
        values: { nonce: randomUUID() },
      });
      const actionId = hash([actor.id, input.requestKey]),
        fingerprint = hash(['issuePurpose', id, input]);
      const replay = await c
        .repository('supplyChainActionRequests')
        .findOne({ filter: { id: actionId } });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return fail('ISSUE_REQUEST_CONFLICT', 'ABORTED');
        const row = await this.get(c, text(replay.resultId), p);
        await this.write(
          c,
          replay.response as RepositoryRecord,
          id ? row : null,
          p,
        );
        return json(row);
      }
      const before = id ? await this.get(c, id, p) : null;
      if (
        before &&
        'version' in input &&
        (before.revision !== input.version ||
          before.lifecycleVersion !== input.lifecycleVersion)
      )
        return fail('ISSUE_VERSION_CONFLICT', 'ABORTED');
      const content = 'content' in input ? input.content : null;
      if (content) {
        await this.company(c, content.subjectId, p);
        if (before && before.subjectId !== content.subjectId)
          return fail('ISSUE_COMPANY_FROZEN', 'INVALID_ARGUMENT');
        if (
          await this.repo(c, 'materialIssuePurposes', p).exists({
            filter: (f) =>
              f.and([
                f.string('subjectId').eq(content.subjectId),
                f.string('code').eq(content.code),
                ...(id ? [f.string('id').ne(id)] : []),
              ]),
          })
        )
          return fail('ISSUE_PURPOSE_CODE_DUPLICATE', 'ALREADY_EXISTS');
      }
      const now = new Date(),
        next = before
          ? {
              ...before,
              ...(content ?? {}),
              revision: Number(before.revision) + 1,
              updatedBy: actor.id,
              updatedAt: now,
            }
          : {
              ...content!,
              id: randomUUID(),
              revision: 1,
              createdBy: actor.id,
              updatedBy: actor.id,
              createdAt: now,
              updatedAt: now,
            };
      await this.write(c, next, before, p);
      const operation = before
        ? 'transition' in input
          ? input.transition
          : 'edit'
        : 'create';
      const result = before
        ? await this.runtime.fire(
            'materialIssuePurposes',
            text(before.id),
            operation === 'edit'
              ? before.status === 'active'
                ? 'editActive'
                : 'editInactive'
              : operation,
            {
              actor,
              expect: { version: Number(before.lifecycleVersion) },
              input: {
                reason: 'reason' in input ? input.reason : '',
                values: content ? json(content) : {},
              },
              requestId: input.requestKey,
              transaction: c,
            },
          )
        : await this.runtime.create('materialIssuePurposes', next, {
            actor,
            transaction: c,
          });
      const row = result.record as RepositoryRecord;
      await this.write(c, row, before, p);
      await this.get(c, text(row.id), p);
      await c.repository('supplyChainAudit').createOne({
        values: {
          id: randomUUID(),
          kind: 'materialIssuePurposes',
          recordId: row.id,
          subjectId: row.subjectId,
          actorId: actor.id,
          operation,
          reason: 'reason' in input ? input.reason : 'create',
          beforeValue: before ? json(before) : null,
          afterValue: json(row),
          createdAt: now,
        },
      });
      await c.repository('supplyChainActionRequests').createOne({
        values: {
          id: actionId,
          actorId: actor.id,
          requestKey: input.requestKey,
          fingerprint,
          resultId: row.id,
          response: json(row),
          createdAt: now,
        },
      });
      return json(await this.get(c, text(row.id), p));
    });
  }
}
