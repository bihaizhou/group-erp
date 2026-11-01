import {
  hasOpenTradePartner,
  guardTradeScope,
} from './inventory-dependencies.js';
import { createHash, randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  FilterBuilder,
  RepositoryRecord,
} from '@nocobase/db';
import {
  defineLifecycle,
  type JsonObject,
  type LifecycleActor,
  type LifecycleRecord,
  type LifecycleRuntime,
} from '@nocobase/lifecycle';
import { ApiError } from '@nocobase/app-server/router';
import type { MaterialPolicies } from './material-service.js';
import { materialIdFilter } from './material-filters.js';
import {
  supplierCreate,
  supplierLink,
  supplierIdentityUpdate,
  supplierRelationshipUpdate,
  supplierMutation,
  supplierIdentityView,
  supplierView,
  type SupplierCreate,
  type SupplierLink,
  type SupplierMutation,
  type SupplierIdentityUpdate,
  type SupplierRelationshipUpdate,
  type SupplierQuery,
  type SupplierPage,
} from './supplier-model.js';
import {
  supplierApplicabilityInput,
  supplierApplicabilityView,
  supplierAvailabilityView,
  supplierOverrideInput,
  matchingPartnerPolicies,
} from './partner-applicability.js';
import { z } from 'zod';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';

type Row = RepositoryRecord & LifecycleRecord & { id: string };
type Table =
  'businessPartners' | 'partnerSubjectSettings' | 'partnerRolePolicies';
const json = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export function supplierError(
  reason: string,
  status: ConstructorParameters<
    typeof ApiError
  >[0]['status'] = 'FAILED_PRECONDITION',
  field?: string,
): never {
  throw new ApiError({
    status,
    domain: 'procurement',
    reason,
    message: 'The supplier operation could not be completed.',
    ...(field ? { fieldViolations: [{ field, description: reason }] } : {}),
  });
}
const scalar = (value: unknown) => (typeof value === 'string' ? value : '');
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

export class SupplierService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly runtime: LifecycleRuntime,
    private readonly role: 'supplier' | 'customer' = 'supplier',
    private readonly users?: UserAdministrationService,
  ) {
    // Procurement owns registration of the shared identity/role lifecycles.
    // The customer facade reuses those definitions and never registers copies.
    if (role === 'customer') return;
    for (const table of [
      'businessPartners',
      'partnerSubjectSettings',
      'partnerRolePolicies',
    ] as const) {
      const transition = (from: string, to: string) => ({
        from,
        to,
        set: ({
          record,
          input,
        }: {
          record: LifecycleRecord;
          input: JsonObject;
        }) => ({
          ...(input.values as JsonObject),
          revision: Number(record.revision) + 1,
          updatedAt: new Date(),
        }),
      });
      runtime.register(
        defineLifecycle({
          name: table,
          collection: table,
          initial: 'active',
          states: ['active', 'inactive'],
          create: {
            guard: ({ values, actor }) => values.createdBy === actor.id,
          },
          transitions: {
            edit: { ...transition('active', 'active'), manual: false },
            editInactive: {
              ...transition('inactive', 'inactive'),
              manual: false,
            },
            deactivate: transition('active', 'inactive'),
            reactivate: transition('inactive', 'active'),
          },
        }),
      );
    }
  }
  private error(
    reason: string,
    status: ConstructorParameters<
      typeof ApiError
    >[0]['status'] = 'FAILED_PRECONDITION',
    field?: string,
  ): never {
    throw new ApiError({
      status,
      domain: this.role === 'customer' ? 'sales' : 'procurement',
      reason:
        this.role === 'customer'
          ? reason.replace(/^SUPPLIER/u, 'CUSTOMER')
          : reason,
      message: 'The partner operation could not be completed.',
      ...(field ? { fieldViolations: [{ field, description: reason }] } : {}),
    });
  }
  private denied(): never {
    return this.error('SUPPLIER_FORBIDDEN', 'PERMISSION_DENIED');
  }
  private missing(): never {
    return this.error('SUPPLIER_NOT_FOUND', 'NOT_FOUND');
  }
  private repo(
    c: DatabaseConnection,
    table: string,
    policies: MaterialPolicies,
  ) {
    if (!policies[table] || policies[table].read === false)
      return this.denied();
    return c.repository(table).withPolicy(policies[table]);
  }
  private async company(
    c: DatabaseConnection,
    subjectId: string,
    p: MaterialPolicies,
    active = false,
  ) {
    if (
      !(await this.repo(c, 'orgSubjects', p).exists({
        filter: { id: subjectId, ...(active ? { status: 'active' } : {}) },
      }))
    )
      return this.error(
        'SUPPLIER_COMPANY_UNAVAILABLE',
        'INVALID_ARGUMENT',
        'subjectId',
      );
  }
  private async lock(c: DatabaseConnection) {
    // Same ordering as organization and business material selection. A future
    // procurement transaction acquires organization, supply chain, then material.
    await c.repository('orgMutationLock').updateOne({
      filter: { id: 'organization' },
      values: { nonce: randomUUID() },
    });
    await c.repository('supplyChainMutationLock').updateOne({
      filter: { id: 'supplyChain' },
      values: { nonce: randomUUID() },
    });
  }
  private identity(row: RepositoryRecord) {
    return supplierIdentityView.parse({
      ...row,
      updatedAt: iso(row.updatedAt),
    });
  }
  private async view(
    c: DatabaseConnection,
    setting: RepositoryRecord,
    p: MaterialPolicies,
  ) {
    const partner = await this.repo(c, 'businessPartners', p).findOne({
      filter: { id: scalar(setting.partnerId) },
    });
    if (!partner) return this.missing();
    return supplierView.extend({ partnerRole: z.literal(this.role) }).parse({
      ...setting,
      updatedAt: iso(setting.updatedAt),
      identity: this.identity(partner),
    });
  }
  private async setting(
    c: DatabaseConnection,
    id: string,
    p: MaterialPolicies,
  ) {
    const setting = await this.repo(c, 'partnerSubjectSettings', p).findOne({
      filter: { id, partnerRole: this.role },
    });
    if (!setting) return this.missing();
    await this.company(c, scalar(setting.subjectId), p);
    return setting;
  }
  async detail(id: string, p: MaterialPolicies) {
    const c = this.db.connection();
    return this.view(c, await this.setting(c, id, p), p);
  }
  async list(query: SupplierQuery, p: MaterialPolicies) {
    const c = this.db.connection();
    await this.company(c, query.subjectId, p);
    let matches: string[] | null = null;
    if (query.q) {
      // A bounded ID search keeps both Collection policies applied. Do not trim
      // an overbroad search and return a plausible but incomplete total.
      const visibleSettings = await this.repo(
        c,
        'partnerSubjectSettings',
        p,
      ).findMany({
        filter: {
          subjectId: query.subjectId,
          partnerRole: this.role,
          ...(query.status ? { status: query.status } : {}),
        },
        select: (s) => s.fields('partnerId'),
        limit: 10001,
      });
      if (visibleSettings.length > 10000)
        return this.error('SUPPLIER_SEARCH_TOO_BROAD', 'INVALID_ARGUMENT', 'q');
      const partners = await this.repo(c, 'businessPartners', p).findMany({
        filter: (f) =>
          f.and([
            materialIdFilter(
              f,
              'id',
              visibleSettings.map((r) => scalar(r.partnerId)),
            ),
            this.identitySearch(query.q)(f),
          ]),
        limit: 10000,
      });
      matches = partners.map((r) => scalar(r.id));
    }
    const repo = this.repo(c, 'partnerSubjectSettings', p);
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('subjectId').eq(query.subjectId),
        f.string('partnerRole').eq(this.role),
        ...(query.status ? [f.string('status').eq(query.status)] : []),
        ...(matches ? [materialIdFilter(f, 'partnerId', matches)] : []),
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
      data: await Promise.all(rows.map((r) => this.view(c, r, p))),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  private identitySearch(q: string) {
    return (f: FilterBuilder) =>
      f.or([
        f.string('name').includes(q, { mode: 'insensitive' }),
        f
          .string('code')
          .includes(q.normalize('NFKC').trim(), { mode: 'insensitive' }),
        f
          .string('registrationCode')
          .includes(q.normalize('NFKC').replace(/\s+/gu, ''), {
            mode: 'insensitive',
          }),
      ]);
  }
  async identities(query: SupplierPage, p: MaterialPolicies) {
    const repo = this.repo(this.db.connection(), 'businessPartners', p);
    const filter = query.q ? this.identitySearch(query.q) : undefined;
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [s.field('code').asc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: rows.map((r) => this.identity(r)),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async identityDetail(id: string, p: MaterialPolicies) {
    const row = await this.repo(
      this.db.connection(),
      'businessPartners',
      p,
    ).findOne({ filter: { id } });
    if (!row) return this.missing();
    return this.identity(row);
  }
  // A presentation hint evaluated by the same repository policies as writes.
  // Every mutation still rechecks authorization, scope, fields and versions.
  async canManage(
    action: 'updateIdentity' | 'configureApplicability' | 'updateRelationship',
    partnerId: string,
    subjectId: string | undefined,
    p: MaterialPolicies,
  ) {
    const c = this.db.connection();
    try {
      if (action === 'updateIdentity') {
        const row = await this.identityDetail(partnerId, p);
        await this.assertWrite(
          c,
          'businessPartners',
          {
            code: row.code,
            name: row.name,
            registrationCode: row.registrationCode,
          },
          p,
          'update',
          partnerId,
        );
      } else if (action === 'configureApplicability') {
        const row = await this.applicability(partnerId, p);
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          {
            scopeMode: row.scopeMode,
            status: row.status,
          },
          p,
          'update',
          row.id,
        );
      } else {
        if (!subjectId) return false;
        const row = await this.availabilityDetail(partnerId, subjectId, p);
        if (row.settingId) {
          await this.assertWrite(
            c,
            'partnerSubjectSettings',
            {
              notes: row.notes,
              status: row.companyStatus,
            },
            p,
            'update',
            row.settingId,
          );
        } else {
          const policy = p.partnerSubjectSettings?.create;
          // Creation has a generated id/actor/time. validateMutation checks its
          // field list; row scope is rechecked on the actual created record.
          if (!policy) return false;
          const validation = await c
            .repository('partnerSubjectSettings')
            .withPolicy(p.partnerSubjectSettings)
            .validateMutation({
              operation: 'createOne',
              values: {
                id: randomUUID(),
                partnerId,
                subjectId,
                partnerRole: this.role,
                status: 'active',
                notes: '',
                revision: 1,
                lifecycleVersion: 1,
                createdBy: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                statusChangedAt: new Date(),
              },
            });
          if (!validation.valid) return false;
        }
      }
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        [
          'SUPPLIER_FORBIDDEN',
          'SUPPLIER_NOT_FOUND',
          'SUPPLIER_COMPANY_UNAVAILABLE',
        ].includes(error.reason ?? '')
      )
        return false;
      throw error;
    }
  }
  async scopeReferences(
    regionIds: string[],
    subjectIds: string[],
    p: MaterialPolicies,
  ) {
    const c = this.db.connection();
    const rows = async (table: string, ids: string[]) =>
      this.repo(c, table, p).findMany({
        filter: (f) => materialIdFilter(f, 'id', ids),
        select: (s) => s.fields('id', 'code', 'name', 'status'),
        limit: 500,
      });
    const [regions, companies] = await Promise.all([
      rows('orgRegions', regionIds),
      rows('orgSubjects', subjectIds),
    ]);
    return { regions, companies };
  }
  async identityHistory(id: string, query: SupplierPage, p: MaterialPolicies) {
    await this.identityDetail(id, p);
    const repo = this.repo(this.db.connection(), 'supplyChainAudit', p);
    const filter = { kind: 'businessPartners', recordId: id };
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: (await this.withActorNames(this.db.connection(), rows)).map(
        (r) => ({
          ...r,
          createdAt: iso(r.createdAt),
        }),
      ),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async companies(query: SupplierPage, p: MaterialPolicies) {
    const repo = this.repo(this.db.connection(), 'orgSubjects', p);
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('status').eq('active'),
        ...(query.q
          ? [
              f.or([
                f.string('name').includes(query.q, { mode: 'insensitive' }),
                f.string('code').includes(query.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        select: (s) => s.fields('id', 'code', 'name'),
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [s.field('code').asc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async companyDetail(id: string, p: MaterialPolicies) {
    const row = await this.repo(this.db.connection(), 'orgSubjects', p).findOne(
      {
        filter: { id, status: 'active' },
        select: (s) => s.fields('id', 'code', 'name'),
      },
    );
    if (!row) return this.missing();
    return row;
  }
  private async withActorNames<T extends { actorId?: unknown }>(
    c: DatabaseConnection,
    rows: T[],
  ): Promise<(T & { actorName: string })[]> {
    if (!this.users || !rows.length)
      return rows.map((row) => ({ ...row, actorName: '' }));
    const ids = [
      ...new Set(rows.map((row) => scalar(row.actorId)).filter(Boolean)),
    ];
    const names = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const user = await this.users!.withConnection(c).get(id);
          names.set(id, scalar(user?.name) || scalar(user?.username));
        } catch {
          names.set(id, '');
        }
      }),
    );
    return rows.map((row) => ({
      ...row,
      actorName: names.get(scalar(row.actorId)) ?? '',
    }));
  }
  async history(id: string, query: SupplierPage, p: MaterialPolicies) {
    const c = this.db.connection();
    const setting = await this.setting(c, id, p);
    const repo = this.repo(c, 'supplyChainAudit', p);
    // Company readers never receive another company's relationship audit or
    // unrestricted shared-identity before/after values.
    const filter = {
      kind: 'partnerSubjectSettings',
      recordId: id,
      subjectId: scalar(setting.subjectId),
    };
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: (await this.withActorNames(c, rows)).map((r) => ({
        ...r,
        createdAt: iso(r.createdAt),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  // The shared LifecycleRuntime owns the actual state write. Enforce the
  // action's public RepositoryPolicy fields AND write scope before delegating,
  // and check post-write scope in the same transaction (including creates).
  private async assertWrite(
    c: DatabaseConnection,
    table: Table | 'partnerCompanyScopes' | 'partnerRegionScopes',
    values: Record<string, unknown>,
    p: MaterialPolicies,
    operation: 'create' | 'update',
    id?: string,
  ) {
    const policy = p[table];
    if (!policy || policy.read === false || policy[operation] === false)
      return this.denied();
    const node = policy[operation];
    const validation = await c
      .repository(table)
      .withPolicy(policy)
      .validateMutation(
        operation === 'create'
          ? { operation: 'createOne', values: values as RepositoryRecord }
          : {
              operation: 'updateOne',
              filter: { id },
              values: values as RepositoryRecord,
            },
      );
    if (!validation.valid) return this.denied();
    if (node !== true) {
      if (
        id &&
        !(await c
          .repository(table)
          .withPolicy({
            ...policy,
            read: { scope: node.scope, fields: ['id'] },
          })
          .exists({ filter: { id } }))
      )
        return this.denied();
    }
  }
  private async createRow(
    c: DatabaseConnection,
    table: Table,
    values: Record<string, unknown>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const next = {
      ...values,
      id: randomUUID(),
      createdBy: actor.id,
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.assertWrite(c, table, next, p, 'create');
    const result = await this.runtime.create(table, next, {
      actor,
      transaction: c,
    });
    await this.assertWrite(
      c,
      table,
      next,
      p,
      'create',
      String(result.record.id),
    );
    if (
      !(await this.repo(c, table, p).exists({
        filter: { id: result.record.id },
      }))
    )
      return this.denied();
    return result.record as Row;
  }
  private async unique(
    c: DatabaseConnection,
    input: { code: string; registrationCode: string | null },
    except?: string,
  ) {
    // Integrity lookup intentionally includes invisible identities. Its only
    // externally observable result is the same non-disclosing conflict.
    const duplicate = await c.repository('businessPartners').exists({
      filter: (f) =>
        f.and([
          f.or([
            f.string('code').eq(input.code),
            ...(input.registrationCode
              ? [f.string('registrationCode').eq(input.registrationCode)]
              : []),
          ]),
          ...(except ? [f.string('id').ne(except)] : []),
        ]),
    });
    if (duplicate)
      return this.error('SUPPLIER_IDENTITY_CONFLICT', 'ALREADY_EXISTS');
  }
  private async audit(
    c: DatabaseConnection,
    table: Table,
    before: RepositoryRecord | null,
    after: RepositoryRecord,
    actor: LifecycleActor,
    operation: string,
    reason: string,
  ) {
    await c.repository('supplyChainAudit').createOne({
      values: {
        id: randomUUID(),
        kind: table,
        recordId: after.id,
        subjectId: after.subjectId ?? null,
        actorId: actor.id,
        operation,
        reason,
        beforeValue: before ? json(before) : null,
        afterValue: json(after),
        createdAt: new Date(),
      },
    });
  }
  private async action<T>(
    operation: string,
    input: { requestKey: string },
    actor: LifecycleActor,
    p: MaterialPolicies,
    identity: boolean,
    authorizeReplay: (c: DatabaseConnection, resultId: string) => Promise<void>,
    run: (c: DatabaseConnection) => Promise<{ id: string; data: T }>,
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const id = hash(stable([actor.id, input.requestKey]));
      const fingerprint = hash(
        stable(
          this.role === 'supplier'
            ? [operation, input]
            : [this.role, operation, input],
        ),
      );
      const replay = await c
        .repository('supplyChainActionRequests')
        .findOne({ filter: { id } });
      if (replay) {
        if (identity) {
          if (
            !(await this.repo(c, 'businessPartners', p).exists({
              filter: { id: scalar(replay.resultId) },
            }))
          )
            return this.missing();
        } else await this.setting(c, scalar(replay.resultId), p);
        if (replay.fingerprint !== fingerprint)
          return this.error('SUPPLIER_REQUEST_CONFLICT', 'ABORTED');
        await authorizeReplay(c, scalar(replay.resultId));
        return replay.response as T;
      }
      const result = await run(c);
      await c.repository('supplyChainActionRequests').createOne({
        values: {
          id,
          actorId: actor.id,
          requestKey: input.requestKey,
          fingerprint,
          resultId: result.id,
          response: json(result.data),
          createdAt: new Date(),
        },
      });
      return result.data;
    });
  }
  async create(
    raw: SupplierCreate,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierCreate.parse(raw);
    return this.action(
      'createSupplier',
      input,
      actor,
      p,
      false,
      async (c, resultId) => {
        const setting = await this.setting(c, resultId, p);
        await this.assertWrite(
          c,
          'partnerSubjectSettings',
          setting,
          p,
          'create',
          resultId,
        );
        const partner = await this.repo(c, 'businessPartners', p).findOne({
          filter: { id: scalar(setting.partnerId) },
        });
        if (!partner) return this.missing();
        await this.assertWrite(
          c,
          'businessPartners',
          partner,
          p,
          'create',
          scalar(partner.id),
        );
      },
      async (c) => {
        await this.company(c, input.subjectId, p, true);
        await this.unique(c, input);
        const partner = await this.createRow(
          c,
          'businessPartners',
          {
            code: input.code,
            name: input.name,
            registrationCode: input.registrationCode,
          },
          actor,
          p,
        );
        const setting = await this.createRow(
          c,
          'partnerSubjectSettings',
          {
            partnerId: partner.id,
            subjectId: input.subjectId,
            partnerRole: this.role,
            notes: input.notes,
          },
          actor,
          p,
        );
        const policy = await this.createRow(
          c,
          'partnerRolePolicies',
          {
            partnerId: partner.id,
            partnerRole: this.role,
            scopeMode: 'selected',
          },
          actor,
          p,
        );
        await this.repo(c, 'partnerCompanyScopes', p).createOne({
          values: {
            id: randomUUID(),
            policyId: policy.id,
            subjectId: input.subjectId,
          },
        });
        await this.audit(
          c,
          'partnerRolePolicies',
          null,
          { ...policy, regionIds: [], subjectIds: [input.subjectId] },
          actor,
          'create',
          'create',
        );
        await this.audit(
          c,
          'businessPartners',
          null,
          partner,
          actor,
          'create',
          'create',
        );
        await this.audit(
          c,
          'partnerSubjectSettings',
          null,
          setting,
          actor,
          'create',
          'create',
        );
        return { id: setting.id, data: await this.view(c, setting, p) };
      },
    );
  }
  async link(raw: SupplierLink, actor: LifecycleActor, p: MaterialPolicies) {
    const input = supplierLink.parse(raw);
    return this.action(
      'linkSupplier',
      input,
      actor,
      p,
      false,
      async (c, resultId) => {
        const setting = await this.setting(c, resultId, p);
        await this.assertWrite(
          c,
          'partnerSubjectSettings',
          setting,
          p,
          'create',
          resultId,
        );
      },
      async (c) => {
        await this.company(c, input.subjectId, p, true);
        const match = (
          await this.matchingCompany(c, input.subjectId, input.partnerId, p)
        )[0];
        if (!match || match.policy.status !== 'active')
          return this.error('SUPPLIER_OUTSIDE_SCOPE');
        if (
          !(await this.repo(c, 'businessPartners', p).exists({
            filter: { id: input.partnerId, status: 'active' },
          }))
        )
          return this.error(
            'SUPPLIER_IDENTITY_UNAVAILABLE',
            'INVALID_ARGUMENT',
            'partnerId',
          );
        if (
          await c.repository('partnerSubjectSettings').exists({
            filter: {
              partnerId: input.partnerId,
              subjectId: input.subjectId,
              partnerRole: this.role,
            },
          })
        )
          return this.error('SUPPLIER_RELATIONSHIP_CONFLICT', 'ALREADY_EXISTS');
        const setting = await this.createRow(
          c,
          'partnerSubjectSettings',
          {
            partnerId: input.partnerId,
            subjectId: input.subjectId,
            partnerRole: this.role,
            notes: input.notes,
          },
          actor,
          p,
        );
        await this.audit(
          c,
          'partnerSubjectSettings',
          null,
          setting,
          actor,
          'create',
          'link',
        );
        return { id: setting.id, data: await this.view(c, setting, p) };
      },
    );
  }
  async addRole(raw: SupplierLink, actor: LifecycleActor, p: MaterialPolicies) {
    const input = supplierLink.parse(raw);
    return this.action(
      'addPartnerRole',
      input,
      actor,
      p,
      false,
      async (c, resultId) => {
        const setting = await this.setting(c, resultId, p);
        await this.assertWrite(
          c,
          'partnerSubjectSettings',
          setting,
          p,
          'create',
          resultId,
        );
        const policy = await this.rolePolicy(c, input.partnerId, p);
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          policy,
          p,
          'create',
          scalar(policy.id),
        );
      },
      async (c) => {
        await this.company(c, input.subjectId, p, true);
        if (
          !(await this.repo(c, 'businessPartners', p).exists({
            filter: { id: input.partnerId, status: 'active' },
          }))
        )
          return this.missing();
        if (
          await c.repository('partnerRolePolicies').exists({
            filter: { partnerId: input.partnerId, partnerRole: this.role },
          })
        )
          return this.error('SUPPLIER_ROLE_EXISTS', 'ALREADY_EXISTS');
        const policy = await this.createRow(
          c,
          'partnerRolePolicies',
          {
            partnerId: input.partnerId,
            partnerRole: this.role,
            scopeMode: 'selected',
          },
          actor,
          p,
        );
        await this.assertWrite(
          c,
          'partnerCompanyScopes',
          { id: randomUUID(), policyId: policy.id, subjectId: input.subjectId },
          p,
          'create',
        );
        await this.repo(c, 'partnerCompanyScopes', p).createOne({
          values: {
            id: randomUUID(),
            policyId: policy.id,
            subjectId: input.subjectId,
          },
        });
        const setting = await this.createRow(
          c,
          'partnerSubjectSettings',
          {
            partnerId: input.partnerId,
            subjectId: input.subjectId,
            partnerRole: this.role,
            notes: input.notes,
          },
          actor,
          p,
        );
        await this.audit(
          c,
          'partnerRolePolicies',
          null,
          policy,
          actor,
          'addRole',
          `SYSTEM_${this.role.toUpperCase()}_ROLE_ADDED`,
        );
        await this.audit(
          c,
          'partnerSubjectSettings',
          null,
          setting,
          actor,
          'addRole',
          `SYSTEM_${this.role.toUpperCase()}_ROLE_ADDED`,
        );
        return { id: setting.id, data: await this.view(c, setting, p) };
      },
    );
  }
  async updateRelationship(
    id: string,
    raw: SupplierRelationshipUpdate,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierRelationshipUpdate.parse(raw);
    return this.mutate(
      'partnerSubjectSettings',
      id,
      input,
      { notes: input.notes },
      actor,
      p,
    );
  }
  private async rolePolicy(
    c: DatabaseConnection,
    partnerId: string,
    p: MaterialPolicies,
  ) {
    const policy = await this.repo(c, 'partnerRolePolicies', p).findOne({
      filter: { partnerId, partnerRole: this.role },
    });
    if (!policy) return this.missing();
    if (
      !(await this.repo(c, 'businessPartners', p).exists({
        filter: { id: partnerId },
      }))
    )
      return this.missing();
    return policy;
  }
  private async applicabilityInConnection(
    c: DatabaseConnection,
    partnerId: string,
    p: MaterialPolicies,
  ) {
    const policy = await this.rolePolicy(c, partnerId, p);
    const [regions, companies] = await Promise.all([
      this.repo(c, 'partnerRegionScopes', p).findMany({
        filter: { policyId: scalar(policy.id) },
        limit: 501,
      }),
      this.repo(c, 'partnerCompanyScopes', p).findMany({
        filter: { policyId: scalar(policy.id) },
        limit: 501,
      }),
    ]);
    if (regions.length > 500 || companies.length > 500)
      return this.error('SUPPLIER_SCOPE_TOO_BROAD');
    const [regionCount, companyCount] = await Promise.all([
      c
        .repository('partnerRegionScopes')
        .count({ filter: { policyId: scalar(policy.id) } }),
      c
        .repository('partnerCompanyScopes')
        .count({ filter: { policyId: scalar(policy.id) } }),
    ]);
    if (regionCount !== regions.length || companyCount !== companies.length)
      return this.denied();
    return supplierApplicabilityView
      .extend({ partnerRole: z.literal(this.role) })
      .parse({
        ...policy,
        regionIds: regions.map((r) => scalar(r.regionId)).sort(),
        subjectIds: companies.map((r) => scalar(r.subjectId)).sort(),
      });
  }
  async applicability(partnerId: string, p: MaterialPolicies) {
    return this.applicabilityInConnection(this.db.connection(), partnerId, p);
  }
  async applicabilityHistory(
    partnerId: string,
    query: SupplierPage,
    p: MaterialPolicies,
  ) {
    const c = this.db.connection(),
      row = await this.rolePolicy(c, partnerId, p),
      repo = this.repo(c, 'supplyChainAudit', p);
    const filter = { kind: 'partnerRolePolicies', recordId: scalar(row.id) };
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: (await this.withActorNames(c, rows)).map((r) => ({
        ...r,
        createdAt: iso(r.createdAt),
      })),
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }
  // Procurement submission must call this with its real transaction, rather
  // than treating a previously fetched option as current business eligibility.
  async resolveSupplierInTransaction(
    c: DatabaseConnection,
    subjectId: string,
    partnerId: string,
    p: MaterialPolicies,
  ) {
    await this.lock(c);
    return this.previewSupplierInTransaction(c, subjectId, partnerId, p);
  }
  /** Read-only qualification projection; writes still acquire the shared locks above. */
  async previewSupplierInTransaction(
    c: DatabaseConnection,
    subjectId: string,
    partnerId: string,
    p: MaterialPolicies,
  ) {
    const match = (await this.matchingCompany(c, subjectId, partnerId, p))[0];
    if (!match) return this.error('SUPPLIER_OUTSIDE_SCOPE');
    const identity = await this.repo(c, 'businessPartners', p).findOne({
      filter: { id: partnerId, status: 'active' },
    });
    if (!identity || match.policy.status !== 'active')
      return this.error('SUPPLIER_GLOBALLY_INACTIVE');
    const filter = { partnerId, subjectId, partnerRole: this.role };
    const setting = await this.repo(c, 'partnerSubjectSettings', p).findOne({
      filter,
    });
    if (
      !setting &&
      (await c.repository('partnerSubjectSettings').exists({ filter }))
    )
      return this.denied();
    if (setting?.status === 'inactive')
      return this.error('SUPPLIER_COMPANY_INACTIVE');
    return {
      subjectId,
      identity: this.identity(identity),
      scopeMatch: match.scopeMatch,
      policyRevision: Number(match.policy.revision),
      companySettingRevision: Number(setting?.revision ?? 0),
    };
  }
  async resolveSupplier(
    subjectId: string,
    partnerId: string,
    p: MaterialPolicies,
  ) {
    return this.db.transaction((c) =>
      this.resolveSupplierInTransaction(c, subjectId, partnerId, p),
    );
  }
  async configureApplicability(
    partnerId: string,
    raw: z.infer<typeof supplierApplicabilityInput>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierApplicabilityInput.parse(raw);
    return this.action(
      `supplierApplicability/${partnerId}`,
      input,
      actor,
      p,
      true,
      async (c) => {
        const row = await this.rolePolicy(c, partnerId, p);
        await this.applicabilityInConnection(c, partnerId, p);
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { scopeMode: input.scopeMode },
          p,
          'update',
          scalar(row.id),
        );
      },
      async (c) => {
        const before = await this.applicabilityInConnection(c, partnerId, p),
          row = await this.rolePolicy(c, partnerId, p);
        if (before.revision !== input.version)
          return this.error('SUPPLIER_VERSION_CONFLICT', 'ABORTED');
        for (const [table, ids, field] of [
          ['orgSubjects', input.subjectIds, 'subjectIds'],
          ['orgRegions', input.regionIds, 'regionIds'],
        ] as const)
          if (ids.length) {
            const refs = await this.repo(c, table, p).findMany({
              filter: (f) =>
                f.and([
                  materialIdFilter(f, 'id', ids),
                  f.string('status').eq('active'),
                ]),
              limit: 500,
            });
            if (refs.length !== ids.length)
              return this.error(
                'SUPPLIER_SCOPE_REFERENCE_UNAVAILABLE',
                'INVALID_ARGUMENT',
                field,
              );
          }
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { scopeMode: input.scopeMode },
          p,
          'update',
          scalar(row.id),
        );
        await guardTradeScope(c, partnerId, this.role, input);
        for (const table of ['partnerRegionScopes', 'partnerCompanyScopes'])
          await this.repo(c, table, p).deleteMany({
            filter: { policyId: scalar(row.id) },
          });
        for (const regionId of input.regionIds)
          await this.repo(c, 'partnerRegionScopes', p).createOne({
            values: { id: randomUUID(), policyId: row.id, regionId },
          });
        for (const subjectId of input.subjectIds)
          await this.repo(c, 'partnerCompanyScopes', p).createOne({
            values: { id: randomUUID(), policyId: row.id, subjectId },
          });
        await this.runtime.fire(
          'partnerRolePolicies',
          scalar(row.id),
          row.status === 'active' ? 'edit' : 'editInactive',
          {
            actor,
            manual: false,
            transaction: c,
            expect: { version: Number(row.lifecycleVersion) },
            input: {
              values: { scopeMode: input.scopeMode },
              reason: input.reason,
            },
          },
        );
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { scopeMode: input.scopeMode },
          p,
          'update',
          scalar(row.id),
        );
        const after = await this.applicabilityInConnection(c, partnerId, p);
        await this.audit(
          c,
          'partnerRolePolicies',
          before,
          after,
          actor,
          'configureApplicability',
          input.reason,
        );
        return { id: partnerId, data: after };
      },
    );
  }
  async changeSupplierStatus(
    partnerId: string,
    transition: 'deactivate' | 'reactivate',
    raw: SupplierMutation,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierMutation.parse(raw),
      status = transition === 'deactivate' ? 'inactive' : 'active';
    return this.action(
      `supplierApplicability/${partnerId}/${transition}`,
      input,
      actor,
      p,
      true,
      async (c) => {
        const row = await this.rolePolicy(c, partnerId, p);
        await this.applicabilityInConnection(c, partnerId, p);
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { status },
          p,
          'update',
          scalar(row.id),
        );
      },
      async (c) => {
        const row = await this.rolePolicy(c, partnerId, p),
          before = await this.applicabilityInConnection(c, partnerId, p);
        if (row.revision !== input.version)
          return this.error('SUPPLIER_VERSION_CONFLICT', 'ABORTED');
        if (row.status === status)
          return this.error('SUPPLIER_ACTION_UNAVAILABLE');
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { status },
          p,
          'update',
          scalar(row.id),
        );
        if (
          transition === 'deactivate' &&
          (await hasOpenTradePartner(c, partnerId, this.role))
        )
          return this.error('SUPPLIER_IN_USE');
        await this.runtime.fire(
          'partnerRolePolicies',
          scalar(row.id),
          transition,
          {
            actor,
            transaction: c,
            expect: { version: Number(row.lifecycleVersion) },
            input: { reason: input.reason, values: {} },
          },
        );
        await this.assertWrite(
          c,
          'partnerRolePolicies',
          { status },
          p,
          'update',
          scalar(row.id),
        );
        const after = await this.applicabilityInConnection(c, partnerId, p);
        await this.audit(
          c,
          'partnerRolePolicies',
          before,
          after,
          actor,
          transition,
          input.reason,
        );
        return { id: partnerId, data: after };
      },
    );
  }
  private async matchingCompany(
    c: DatabaseConnection,
    subjectId: string,
    partnerId: string | undefined,
    p: MaterialPolicies,
  ) {
    const subject = await this.repo(c, 'orgSubjects', p).findOne({
      filter: { id: subjectId, status: 'active' },
    });
    if (!subject)
      return this.error(
        'SUPPLIER_COMPANY_UNAVAILABLE',
        'INVALID_ARGUMENT',
        'subjectId',
      );
    return matchingPartnerPolicies(c, subject, p, partnerId, this.role);
  }
  private async availabilityInConnection(
    c: DatabaseConnection,
    query: SupplierPage & {
      subjectId: string;
      status?: string;
      orderBy?: string;
    },
    p: MaterialPolicies,
    onlyActive: boolean,
    partnerId?: string,
  ) {
    const matches = await this.matchingCompany(
      c,
      query.subjectId,
      partnerId,
      p,
    );
    const ids = matches.map(({ policy }) => scalar(policy.partnerId));
    const [partners, settings] = await Promise.all([
      this.repo(c, 'businessPartners', p).findMany({
        filter: (f) => materialIdFilter(f, 'id', ids),
        limit: 10000,
      }),
      this.repo(c, 'partnerSubjectSettings', p).findMany({
        filter: {
          subjectId: query.subjectId,
          partnerRole: this.role,
          ...(partnerId ? { partnerId } : {}),
        },
        limit: 10001,
      }),
    ]);
    if (settings.length > 10000) return this.error('SUPPLIER_SCOPE_TOO_BROAD');
    const identities = new Map(partners.map((r) => [scalar(r.id), r])),
      overrides = new Map(settings.map((r) => [scalar(r.partnerId), r]));
    // A narrower read policy must never make a hidden local exclusion disappear.
    // Use only presence as an integrity guard; no hidden values leave this service.
    const persistedOverrides = await c
      .repository('partnerSubjectSettings')
      .findMany({
        filter: {
          subjectId: query.subjectId,
          partnerRole: this.role,
          ...(partnerId ? { partnerId } : {}),
        },
        select: (s) => s.fields('partnerId'),
        limit: 10001,
      });
    if (persistedOverrides.length > 10000)
      return this.error('SUPPLIER_SCOPE_TOO_BROAD');
    const hiddenOverrides = new Set(
      persistedOverrides
        .map((r) => scalar(r.partnerId))
        .filter((id) => !overrides.has(id)),
    );
    const q = query.q.normalize('NFKC').toLowerCase();
    const data = matches
      .flatMap(({ policy, scopeMatch }) => {
        const partnerId = scalar(policy.partnerId),
          identity = identities.get(partnerId),
          setting = overrides.get(partnerId);
        if (!identity || hiddenOverrides.has(partnerId)) return [];
        if (
          q &&
          ![identity.code, identity.name, identity.registrationCode].some((v) =>
            scalar(v).normalize('NFKC').toLowerCase().includes(q),
          )
        )
          return [];
        const effectiveStatus =
          policy.status === 'active' &&
          identity.status === 'active' &&
          setting?.status !== 'inactive'
            ? 'active'
            : 'inactive';
        if (onlyActive && effectiveStatus !== 'active') return [];
        if (query.status && query.status !== effectiveStatus) return [];
        return [
          supplierAvailabilityView.parse({
            partnerId,
            subjectId: query.subjectId,
            identity: this.identity(identity),
            scopeMatch,
            supplierStatus: policy.status,
            companyStatus: setting?.status ?? 'active',
            effectiveStatus,
            settingId: setting?.id ?? null,
            revision: setting?.revision ?? 0,
            notes: setting?.notes ?? '',
            updatedAt: new Date(
              Math.max(
                new Date(identity.updatedAt as string).getTime(),
                new Date(policy.updatedAt as string).getTime(),
                setting ? new Date(setting.updatedAt as string).getTime() : 0,
              ),
            ).toISOString(),
          }),
        ];
      })
      .sort(
        (a, b) =>
          (query.orderBy === '-updatedAt'
            ? b.updatedAt.localeCompare(a.updatedAt)
            : query.orderBy === 'updatedAt'
              ? a.updatedAt.localeCompare(b.updatedAt)
              : query.orderBy === 'name'
                ? a.identity.name.localeCompare(b.identity.name)
                : query.orderBy === '-name'
                  ? b.identity.name.localeCompare(a.identity.name)
                  : query.orderBy === '-code'
                    ? b.identity.code.localeCompare(a.identity.code)
                    : 0) ||
          a.identity.code.localeCompare(b.identity.code) ||
          a.partnerId.localeCompare(b.partnerId),
      );
    return {
      data: data.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      ),
      meta: { total: data.length, page: query.page, pageSize: query.pageSize },
    };
  }
  async availability(
    query: SupplierPage & {
      subjectId: string;
      status?: string;
      orderBy?: string;
    },
    p: MaterialPolicies,
    onlyActive = false,
  ) {
    return this.availabilityInConnection(
      this.db.connection(),
      query,
      p,
      onlyActive,
    );
  }
  async availabilityDetail(
    partnerId: string,
    subjectId: string,
    p: MaterialPolicies,
  ) {
    const result = await this.availabilityInConnection(
      this.db.connection(),
      { subjectId, q: '', page: 1, pageSize: 1 },
      p,
      false,
      partnerId,
    );
    if (!result.data[0]) return this.missing();
    return result.data[0];
  }
  async overrideCompany(
    raw: z.infer<typeof supplierOverrideInput>,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierOverrideInput.parse(raw);
    return this.action(
      `supplierOverride/${input.partnerId}/${input.subjectId}`,
      input,
      actor,
      p,
      false,
      async (c, id) => {
        const setting = await this.setting(c, id, p);
        await this.assertWrite(
          c,
          'partnerSubjectSettings',
          input.version === 0
            ? setting
            : { notes: input.notes, status: input.status },
          p,
          input.version === 0 ? 'create' : 'update',
          id,
        );
      },
      async (c) => {
        if (
          input.status === 'inactive' &&
          (await hasOpenTradePartner(
            c,
            input.partnerId,
            this.role,
            input.subjectId,
          ))
        )
          return this.error('SUPPLIER_IN_USE');
        const matches = await this.matchingCompany(
            c,
            input.subjectId,
            input.partnerId,
            p,
          ),
          match = matches[0];
        if (!match)
          return this.error('SUPPLIER_OUTSIDE_SCOPE', 'FAILED_PRECONDITION');
        const previous = await this.repo(
          c,
          'partnerSubjectSettings',
          p,
        ).findOne({
          filter: {
            subjectId: input.subjectId,
            partnerId: input.partnerId,
            partnerRole: this.role,
          },
        });
        if (
          !previous &&
          (await c.repository('partnerSubjectSettings').exists({
            filter: {
              subjectId: input.subjectId,
              partnerId: input.partnerId,
              partnerRole: this.role,
            },
          }))
        )
          return this.denied();
        if ((previous?.revision ?? 0) !== input.version)
          return this.error('SUPPLIER_VERSION_CONFLICT', 'ABORTED');
        // Notes may be maintained while globally disabled. Only a real local
        // inactive -> active transition is a restore; inherited active remains
        // ineffective while either global status is inactive.
        if (
          input.status === 'active' &&
          previous?.status === 'inactive' &&
          (match.policy.status !== 'active' ||
            !(await this.repo(c, 'businessPartners', p).exists({
              filter: { id: input.partnerId, status: 'active' },
            })))
        )
          return this.error('SUPPLIER_GLOBALLY_INACTIVE');
        let saved: RepositoryRecord;
        if (previous) {
          await this.assertWrite(
            c,
            'partnerSubjectSettings',
            { status: input.status, notes: input.notes },
            p,
            'update',
            scalar(previous.id),
          );
          const transition =
            previous.status === input.status
              ? previous.status === 'active'
                ? 'edit'
                : 'editInactive'
              : input.status === 'active'
                ? 'reactivate'
                : 'deactivate';
          saved = (
            await this.runtime.fire(
              'partnerSubjectSettings',
              scalar(previous.id),
              transition,
              {
                actor,
                manual: !transition.startsWith('edit'),
                transaction: c,
                expect: { version: Number(previous.lifecycleVersion) },
                input: { values: { notes: input.notes }, reason: input.reason },
              },
            )
          ).record as Row;
          await this.assertWrite(
            c,
            'partnerSubjectSettings',
            { status: input.status, notes: input.notes },
            p,
            'update',
            scalar(previous.id),
          );
        } else {
          saved = await this.createRow(
            c,
            'partnerSubjectSettings',
            {
              partnerId: input.partnerId,
              subjectId: input.subjectId,
              partnerRole: this.role,
              notes: input.notes,
            },
            actor,
            p,
          );
          if (input.status === 'inactive') {
            await this.assertWrite(
              c,
              'partnerSubjectSettings',
              { status: 'inactive' },
              p,
              'update',
              scalar(saved.id),
            );
            saved = (
              await this.runtime.fire(
                'partnerSubjectSettings',
                scalar(saved.id),
                'deactivate',
                {
                  actor,
                  transaction: c,
                  expect: { version: Number(saved.lifecycleVersion) },
                  input: { values: {}, reason: input.reason },
                },
              )
            ).record as Row;
            await this.assertWrite(
              c,
              'partnerSubjectSettings',
              { status: 'inactive' },
              p,
              'update',
              scalar(saved.id),
            );
          }
        }
        await this.audit(
          c,
          'partnerSubjectSettings',
          previous ?? null,
          saved,
          actor,
          previous ? 'override' : 'createOverride',
          input.reason,
        );
        return { id: scalar(saved.id), data: await this.view(c, saved, p) };
      },
    );
  }
  async scopeRegions(query: SupplierPage, p: MaterialPolicies) {
    const repo = this.repo(this.db.connection(), 'orgRegions', p);
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('status').eq('active'),
        ...(query.q
          ? [
              f.or([
                f.string('name').includes(query.q),
                f.string('code').includes(query.q),
              ]),
            ]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        select: (s) => s.fields('id', 'code', 'name', 'parentId'),
        sort: (s) => s.field('code').asc(),
      }),
      repo.count({ filter }),
    ]);
    return {
      data,
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }
  async updateIdentity(
    id: string,
    raw: SupplierIdentityUpdate,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    const input = supplierIdentityUpdate.parse(raw);
    return this.mutate(
      'businessPartners',
      id,
      input,
      {
        code: input.code,
        name: input.name,
        registrationCode: input.registrationCode,
      },
      actor,
      p,
    );
  }
  async changeStatus(
    table: Table,
    id: string,
    transition: 'deactivate' | 'reactivate',
    raw: SupplierMutation,
    actor: LifecycleActor,
    p: MaterialPolicies,
  ) {
    return this.mutate(
      table,
      id,
      supplierMutation.parse(raw),
      {},
      actor,
      p,
      transition,
    );
  }
  private async mutate(
    table: Table,
    id: string,
    input: SupplierMutation,
    values: Record<string, unknown>,
    actor: LifecycleActor,
    p: MaterialPolicies,
    transition?: 'deactivate' | 'reactivate',
  ) {
    const changes = {
      ...values,
      ...(transition
        ? { status: transition === 'deactivate' ? 'inactive' : 'active' }
        : {}),
    };
    return this.action(
      `${table}/${id}/${transition ?? 'edit'}`,
      input,
      actor,
      p,
      table === 'businessPartners',
      async (c) => {
        await this.assertWrite(c, table, changes, p, 'update', id);
      },
      async (c) => {
        const before =
          table === 'partnerSubjectSettings'
            ? await this.setting(c, id, p)
            : await this.repo(c, table, p).findOne({ filter: { id } });
        if (!before) return this.missing();
        if (before.revision !== input.version)
          return this.error('SUPPLIER_VERSION_CONFLICT', 'ABORTED');
        if (
          transition &&
          before.status ===
            (transition === 'deactivate' ? 'inactive' : 'active')
        )
          return this.error('SUPPLIER_ACTION_UNAVAILABLE');
        if (
          transition === 'deactivate' &&
          (await hasOpenTradePartner(
            c,
            table === 'businessPartners' ? id : scalar(before.partnerId),
            table === 'businessPartners' ? undefined : this.role,
            table === 'businessPartners' ? undefined : scalar(before.subjectId),
          ))
        )
          return this.error('SUPPLIER_IN_USE');
        if (table === 'businessPartners' && !transition)
          await this.unique(
            c,
            values as { code: string; registrationCode: string | null },
            id,
          );
        if (table === 'partnerSubjectSettings' && transition === 'reactivate') {
          await this.company(c, scalar(before.subjectId), p, true);
          const match = (
            await this.matchingCompany(
              c,
              scalar(before.subjectId),
              scalar(before.partnerId),
              p,
            )
          )[0];
          if (!match || match.policy.status !== 'active')
            return this.error('SUPPLIER_OUTSIDE_SCOPE');
          if (
            !(await this.repo(c, 'businessPartners', p).exists({
              filter: { id: scalar(before.partnerId), status: 'active' },
            }))
          )
            return this.error(
              'SUPPLIER_IDENTITY_UNAVAILABLE',
              'INVALID_ARGUMENT',
              'partnerId',
            );
        }
        await this.assertWrite(c, table, changes, p, 'update', id);
        const result = await this.runtime.fire(
          table,
          id,
          transition ??
            (before.status === 'inactive' ? 'editInactive' : 'edit'),
          {
            actor,
            manual: !!transition,
            expect: { version: Number(before.lifecycleVersion) },
            input: { values: json(values), reason: input.reason },
            transaction: c,
          },
        );
        await this.assertWrite(c, table, changes, p, 'update', id);
        if (!(await this.repo(c, table, p).exists({ filter: { id } })))
          return this.denied();
        await this.audit(
          c,
          table,
          before,
          result.record as Row,
          actor,
          transition ?? 'edit',
          input.reason,
        );
        return {
          id,
          data:
            table === 'businessPartners'
              ? this.identity(result.record as Row)
              : await this.view(c, result.record as Row, p),
        };
      },
    );
  }
}
