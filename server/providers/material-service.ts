import { randomUUID, createHash } from 'node:crypto';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
  FilterBuilder,
} from '@nocobase/db';
import { LifecycleRuntime, type JsonObject } from '@nocobase/lifecycle';
import { z } from 'zod';
import {
  materialKinds,
  materialTables,
  materialSchemas,
  materialColumns,
  materialWorkflowKinds,
  materialScopedKinds,
  materialDependencies,
  materialAttribute,
  normalizeDecimal,
  positiveDecimal,
  materialFail as fail,
  materialView,
  type MaterialKind,
  type MaterialRow,
  type MaterialQuery,
  type MaterialActor,
} from './material-model.js';
import {
  materialLifecycles,
  type MaterialLifecycleTypes,
} from './material-workflows.js';
import type { TransitionHookContext } from '@nocobase/lifecycle';
import type { MaterialSourceService } from './material-source-service.js';
import { materialOrgColumns } from './material-resources.js';
import { materialIdFilter } from './material-filters.js';
import {
  materialNameMatch,
  materialNameSearchKeys,
  type MaterialNameMatchReason,
} from './material-name-similarity.js';
import { materialNameAbbreviation } from './material-code.js';

export type MaterialPolicies = Record<string, RepositoryPolicy>;
export interface MaterialCatalogContext {
  connection: DatabaseConnection;
  subjectId: string;
  skuIds: readonly string[];
  nameIds: readonly string[];
}
export interface MaterialTransitionInput {
  version: number;
  requestKey: string;
  reason: string;
  resolvedSkuId?: string;
}
const row = (value: unknown) => value as MaterialRow;
const json = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;
const scalar = (value: unknown) => (typeof value === 'string' ? value : '');
// Enough candidates to rank a hint without scanning an unbounded name table.
const materialNameCandidateLimit = 500;

export class MaterialService {
  private sources?: Pick<
    MaterialSourceService,
    'afterTask' | 'excludesSkuReviewer' | 'runTask'
  >;
  attachSources(
    sources: Pick<
      MaterialSourceService,
      'afterTask' | 'excludesSkuReviewer' | 'runTask'
    >,
  ) {
    this.sources = sources;
  }

  constructor(
    private readonly db: DatabaseManager,
    public readonly runtime: LifecycleRuntime,
  ) {
    for (const kind of materialKinds)
      runtime.register(materialLifecycles[kind], {
        services: (handle) => {
          const c =
            (handle as DatabaseConnection | undefined) ?? db.connection();
          return {
            allowed: (record, actor, transition) =>
              this.allowed(c, kind, record, actor, transition),
            prepare: (record, input, transition) =>
              this.prepare(c, kind, record, input, transition),
            transitioned: (context) => this.transitioned(c, kind, context),
          };
        },
      });
  }
  private repo(
    c: DatabaseConnection,
    table: string,
    policies: MaterialPolicies,
  ) {
    if (!policies[table]) return fail('MATERIAL_FORBIDDEN');
    return c.repository(table).withPolicy(policies[table]);
  }
  private async taggedTargets(
    c: DatabaseConnection,
    tagId: string,
    policies: MaterialPolicies,
  ) {
    const active = await this.repo(c, 'materialTags', policies).exists({
      filter: { id: tagId, status: 'active' },
    });
    if (!active) return { names: [] as string[], skus: [] as string[] };
    const links = await this.repo(c, 'materialTagLinks', policies).findMany({
      filter: { tagId, status: 'active' },
      limit: 10001,
    });
    if (links.length > 10000) return fail('MATERIAL_SEARCH_TOO_BROAD', 'tagId');
    return {
      names: links
        .filter((link) => link.targetKind === 'names')
        .map((link) => scalar(link.targetId)),
      skus: links
        .filter((link) => link.targetKind === 'skus')
        .map((link) => scalar(link.targetId)),
    };
  }
  private async lock(c: DatabaseConnection) {
    // Global materials are also referenced by purchase drafts and frozen lines.
    // Start with the common organization lock before taking the material lock,
    // matching supplier, personnel and purchase mutation ordering.
    await c.repository('orgMutationLock').updateOne({
      filter: { id: 'organization' },
      values: { nonce: randomUUID() },
    });
    await c.repository('supplyChainMutationLock').updateOne({
      filter: { id: 'supplyChain' },
      values: { nonce: randomUUID() },
    });
    await c.repository('materialMutationLock').updateOne({
      filter: { id: 'materials' },
      values: { nonce: randomUUID() },
    });
  }
  async list(
    kind: MaterialKind,
    query: MaterialQuery,
    policies: MaterialPolicies,
  ) {
    const repository = this.repo(
      this.db.connection(),
      materialTables[kind],
      policies,
    );
    let nameCandidates: RepositoryRecord[] = [];
    let aliasSkuIds: string[] = [];
    const tagged =
      kind === 'skus' && query.tagId
        ? await this.taggedTargets(this.db.connection(), query.tagId, policies)
        : null;
    if (kind === 'skus' && query.q) {
      nameCandidates = await this.repo(
        this.db.connection(),
        'materialNames',
        policies,
      ).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.string('name').includes(query.q!, { mode: 'insensitive' }),
          ]),
        limit: 1001,
      });
      const aliases = await this.repo(
        this.db.connection(),
        'materialReferences',
        policies,
      ).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.string('subjectId').eq(null),
            f
              .string('searchKey')
              .includes(query.q!.normalize('NFKC').trim().toLowerCase()),
          ]),
        limit: 1001,
      });
      if (nameCandidates.length > 1000 || aliases.length > 1000)
        return fail('MATERIAL_SEARCH_TOO_BROAD', 'q');
      const ids = aliases
        .filter((item) => item.targetKind === 'names')
        .map((item) => scalar(item.targetId));
      if (ids.length) {
        const matched = await this.repo(
          this.db.connection(),
          'materialNames',
          policies,
        ).findMany({
          filter: (f) =>
            f.and([
              f.string('status').eq('active'),
              f.or(ids.map((id) => f.string('id').eq(id))),
            ]),
          limit: 1000,
        });
        nameCandidates = [
          ...new Map(
            [...nameCandidates, ...matched].map((item) => [item.id, item]),
          ).values(),
        ];
      }
      aliasSkuIds = aliases
        .filter((item) => item.targetKind === 'skus')
        .map((item) => scalar(item.targetId));
    }
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(tagged
          ? [
              f.or([
                materialIdFilter(f, 'materialNameId', tagged.names),
                materialIdFilter(f, 'id', tagged.skus),
              ]),
            ]
          : []),
        ...(query.q
          ? [
              f.or([
                f.string('name').includes(query.q, { mode: 'insensitive' }),
                f.string('code').includes(query.q, { mode: 'insensitive' }),
                ...(kind === 'skus'
                  ? [
                      f
                        .text('searchText')
                        .includes(query.q, { mode: 'insensitive' }),
                    ]
                  : []),
                ...nameCandidates.map((item) =>
                  f.string('materialNameId').eq(scalar(item.id)),
                ),
                ...aliasSkuIds.map((id) => f.string('id').eq(id)),
              ]),
            ]
          : []),
        ...(
          [
            'status',
            'subjectId',
            'skuId',
            'materialNameId',
            'baseUnitId',
            'templateId',
            'unitId',
            'tagId',
            'responsiblePositionId',
          ] as const
        )
          .filter(
            (key) =>
              query[key] &&
              (key === 'status' || materialColumns[kind].includes(key)),
          )
          .map((key) => f.string(key).eq(query[key]!)),
      ]);
    const field = query.orderBy.replace('-', '');
    const [records, total] = await Promise.all([
      repository.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [
          query.orderBy.startsWith('-')
            ? s.field(field).desc()
            : s.field(field).asc(),
          s.field('id').asc(),
        ],
      }),
      repository.count({ filter }),
    ]);
    return {
      data: records.map(materialView),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        nameCandidates: nameCandidates.map((item) => ({
          id: item.id,
          name: item.name,
        })),
      },
    };
  }
  async get(
    kind: MaterialKind,
    id: string,
    policies: MaterialPolicies,
    actor: MaterialActor,
  ) {
    const record = await this.repo(
      this.db.connection(),
      materialTables[kind],
      policies,
    ).findOne({ filter: { id } });
    if (!record) return fail('MATERIAL_NOT_FOUND');
    const view = await this.runtime.view(materialTables[kind], id, actor);
    const sourceLinked =
      kind === 'requests' &&
      (await this.db
        .repository('materialRequestSources')
        .exists({ filter: { requestId: id } }));
    const linkedSkus = [];
    if (kind === 'requests') {
      const links = await this.db
        .repository('materialRequestLinks')
        .findMany({ filter: { requestId: id }, limit: 101 });
      for (const link of links.slice(0, 100)) {
        const sku = await this.repo(
          this.db.connection(),
          'materialSkus',
          policies,
        ).findOne({ filter: { id: scalar(link.skuId) } });
        if (sku)
          linkedSkus.push({
            id: sku.id,
            name: sku.name,
            code: sku.code,
            status: sku.status,
            relation: link.relation,
          });
      }
    }
    return {
      linkedSkus,

      ...materialView(record),
      ...(kind === 'requests' ? { sourceLinked } : {}),
      workflow: {
        available: sourceLinked
          ? view.available.filter(
              (action) =>
                !action.name.startsWith('edit') && action.name !== 'submit',
            )
          : view.available,
        history: view.history.transitions,
      },
    };
  }
  async options(
    kind: MaterialKind | 'catalog',
    policies: MaterialPolicies,
    q = '',
    selectedIds: string[] = [],
  ) {
    if (kind === 'catalog') {
      const result: Record<
        string,
        { rows: Record<string, unknown>[]; total: number; truncated: boolean }
      > = {};
      for (const key of ['tags', 'names'] as const) {
        const repository = this.repo(
          this.db.connection(),
          materialTables[key],
          policies,
        );
        const filter = (f: FilterBuilder) =>
          f.and([
            f.string('status').eq('active'),
            ...(q
              ? [f.string('name').includes(q, { mode: 'insensitive' })]
              : []),
          ]);
        const [rows, total] = await Promise.all([
          repository.findMany({
            filter,
            limit: 100,
            sort: (s) => s.field('name').asc(),
          }),
          repository.count({ filter }),
        ]);
        const selected = selectedIds.length
          ? await repository.findMany({
              filter: (f) =>
                f.and([
                  f.string('status').eq('active'),
                  f.or(selectedIds.map((id) => f.string('id').eq(id))),
                ]),
              limit: 100,
            })
          : [];
        result[key] = {
          rows: [
            ...new Map(
              [...rows, ...selected].map((item) => [item.id, item]),
            ).values(),
          ],
          total,
          truncated: total > rows.length,
        };
      }
      return result;
    }
    const expandedIds = new Set(selectedIds);
    const result: Record<
      string,
      { rows: Record<string, unknown>[]; total: number; truncated: boolean }
    > = {};
    for (const dependency of new Set([kind, ...materialDependencies[kind]])) {
      const repository = this.repo(
        this.db.connection(),
        materialTables[dependency],
        policies,
      );
      const filter = (f: FilterBuilder) =>
        f.and([
          ...(dependency !== kind
            ? [
                f
                  .string('status')
                  .eq(dependency === 'requests' ? 'pending' : 'active'),
              ]
            : []),
          ...(q
            ? [
                f.or([
                  f.string('name').includes(q, { mode: 'insensitive' }),
                  f.string('code').includes(q, { mode: 'insensitive' }),
                ]),
              ]
            : []),
        ]);
      const [records, total] = await Promise.all([
        repository.findMany({
          filter,
          limit: 100,
          sort: (s) => s.field('code').asc(),
        }),
        repository.count({ filter }),
      ]);
      const selected = expandedIds.size
        ? await repository.findMany({
            filter: (f) =>
              f.and([
                f.or([...expandedIds].map((id) => f.string('id').eq(id))),
                ...(dependency !== kind
                  ? [
                      f
                        .string('status')
                        .eq(dependency === 'requests' ? 'pending' : 'active'),
                    ]
                  : []),
              ]),
            limit: 100,
          })
        : [];
      const combined = [
        ...new Map(
          [...records, ...selected].map((record) => [record.id, record]),
        ).values(),
      ];
      for (const item of combined)
        if (expandedIds.has(scalar(item.id)))
          for (const key of [
            'materialNameId',
            'baseUnitId',
            'templateId',
            'subjectId',
            'responsiblePositionId',
            'unitId',
          ])
            if (typeof item[key] === 'string')
              expandedIds.add(scalar(item[key]));
      result[dependency] = {
        rows: combined.map(materialView),
        total,
        truncated: total > records.length,
      };
    }
    const organizationRows: Record<string, RepositoryRecord[]> = {};
    for (const [table, columns] of Object.entries(materialOrgColumns)) {
      if (!policies[table]) continue;
      const repository = this.repo(this.db.connection(), table, policies);
      const parentKey =
        table === 'orgUnits'
          ? 'subjectId'
          : table === 'orgPositions'
            ? 'unitId'
            : null;
      const parentTable = table === 'orgUnits' ? 'orgSubjects' : 'orgUnits';
      const parents = organizationRows[parentTable] ?? [];
      if (parentKey && !parents.length) {
        result[table] = { rows: [], total: 0, truncated: false };
        organizationRows[table] = [];
        continue;
      }
      const records = await repository.findMany({
        ...(parentKey
          ? {
              filter: (f: FilterBuilder) =>
                f.or(
                  parents.map((parent) =>
                    f.string(parentKey).eq(scalar(parent.id)),
                  ),
                ),
            }
          : {}),
        select: (selector) => selector.fields(...columns),
        limit: 10001,
        sort: (sort) => sort.field('id').asc(),
      });
      if (records.length > 10000) return fail('MATERIAL_SEARCH_TOO_BROAD', 'q');
      organizationRows[table] = records;
      const needle = q.normalize('NFKC').toLowerCase();
      const matching = records.filter(
        (item) =>
          item.status === 'active' &&
          (!needle ||
            [item.name, item.code].some((value) =>
              scalar(value).normalize('NFKC').toLowerCase().includes(needle),
            )),
      );
      const selected = records.filter((item) =>
        expandedIds.has(scalar(item.id)),
      );
      result[table] = {
        rows: [
          ...new Map(
            [...matching.slice(0, 100), ...selected].map((item) => [
              item.id,
              item,
            ]),
          ).values(),
        ],
        total: matching.length,
        truncated: matching.length > 100,
      };
    }
    // A searched position retains its authorized department so company filtering and current labels still work.
    if (result.orgPositions && result.orgUnits) {
      const units = new Set(
        result.orgPositions.rows.map((item) => scalar(item.unitId)),
      );
      result.orgUnits.rows = [
        ...new Map(
          [
            ...result.orgUnits.rows,
            ...(organizationRows.orgUnits ?? []).filter((item) =>
              units.has(scalar(item.id)),
            ),
          ].map((item) => [item.id, item]),
        ).values(),
      ];
    }
    return result;
  }
  // A non-blocking hint on the standard-name form: find names the proposed
  // text resembles so a near-duplicate can be reused instead of re-created.
  async similarNames(
    name: string,
    policies: MaterialPolicies,
    excludeId?: string,
    limit = 5,
  ) {
    const rows: {
      id: string;
      code: string;
      name: string;
      status: string;
      score: number;
      reason: MaterialNameMatchReason;
    }[] = [];
    const { primary, grams } = materialNameSearchKeys(name);
    if (!primary) return { rows, total: 0, truncated: false };
    const repository = this.repo(
      this.db.connection(),
      materialTables.names,
      policies,
    );
    let truncated = false;
    const candidates = async (keys: readonly string[]) => {
      const records = await repository.findMany({
        filter: (f) =>
          f.and([
            ...(excludeId ? [f.string('id').ne(excludeId)] : []),
            f.or(
              keys.map((key) =>
                f.string('name').includes(key, { mode: 'insensitive' }),
              ),
            ),
          ]),
        limit: materialNameCandidateLimit,
      });
      if (records.length >= materialNameCandidateLimit) truncated = true;
      return records;
    };
    // The whole input first: a name containing it is the strongest hint and
    // usually the only query needed. Shared phrases are the fallback.
    const seen = new Set<string>();
    const collect = (records: readonly RepositoryRecord[]) => {
      for (const record of records) {
        const id = scalar(record.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const match = materialNameMatch(name, scalar(record.name));
        if (!match) continue;
        rows.push({
          id,
          code: scalar(record.code),
          name: scalar(record.name),
          status: scalar(record.status),
          score: Math.round(match.score * 1000) / 1000,
          reason: match.reason,
        });
      }
    };
    collect(await candidates([primary]));
    if (rows.length < limit) collect(await candidates(grams));
    rows.sort(
      (left, right) =>
        right.score - left.score ||
        Number(left.status !== 'active') - Number(right.status !== 'active') ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
    return { rows: rows.slice(0, limit), total: rows.length, truncated };
  }
  // A new standard name takes the uppercase initials of its own name as the
  // code; a numeric suffix keeps abbreviations unique.
  private async nameCode(
    c: DatabaseConnection,
    policies: MaterialPolicies,
    name: string,
  ) {
    const base = materialNameAbbreviation(name) || 'NAM';
    const repository = this.repo(c, materialTables.names, policies);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = attempt === 0 ? base : `${base}-${attempt + 1}`;
      if (!(await repository.exists({ filter: { code } }))) return code;
    }
    return `${base}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }
  async suggestNameCode(name: string, policies: MaterialPolicies) {
    return {
      code: await this.nameCode(this.db.connection(), policies, name),
    };
  }
  async save(
    kind: MaterialKind,
    input: Record<string, unknown>,
    actor: MaterialActor,
    policies: MaterialPolicies,
    id?: string,
  ) {
    return this.db.transaction((c) =>
      this.saveInTransaction(c, kind, input, actor, policies, id),
    );
  }
  // The caller owns this transaction. Never open another one for a source write.
  async saveInTransaction(
    c: DatabaseConnection,
    kind: MaterialKind,
    input: Record<string, unknown>,
    actor: MaterialActor,
    policies: MaterialPolicies,
    id?: string,
  ) {
    await this.lock(c);
    const repository = this.repo(c, materialTables[kind], policies);
    const previous = id ? await repository.findOne({ filter: { id } }) : null;
    if (id && !previous) return fail('MATERIAL_NOT_FOUND');
    if (previous && Number(input.version) !== Number(previous.revision))
      return fail('MATERIAL_VERSION_CONFLICT');
    const { version: _version, reason: _reason, ...patch } = input;
    const editable = Object.fromEntries(
      Object.entries(previous ?? {}).filter(([key]) =>
        Object.keys(materialSchemas[kind].shape).includes(key),
      ),
    );
    const values = materialSchemas[kind].parse({
      ...editable,
      ...patch,
    }) as Record<string, unknown>;
    if (
      previous &&
      kind === 'references' &&
      previous.status === 'active' &&
      values.name !== previous.name
    )
      return fail('MATERIAL_IMMUTABLE', 'name');
    const requestId = scalar(values.requestId);
    delete values.requestId;
    if (
      previous &&
      materialWorkflowKinds.includes(kind) &&
      previous.status !== 'draft'
    ) {
      if (
        previous.status !== 'active' ||
        Object.keys(patch).some(
          (key) => !['name', 'notes', 'code'].includes(key),
        ) ||
        ('code' in patch && patch.code !== previous.code)
      )
        return fail('MATERIAL_USE_DRAFT');
    }
    const next = {
      ...previous,
      ...values,
      id: id ?? randomUUID(),
      code:
        values.code ??
        previous?.code ??
        (kind === 'names'
          ? await this.nameCode(c, policies, scalar(values.name))
          : `${kind.slice(0, 3).toUpperCase()}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`),
      notes: values.notes ?? '',
      createdBy: previous?.createdBy ?? actor.id,
      revision: Number(previous?.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? new Date(),
      updatedAt: new Date(),
    } as unknown as MaterialRow;
    if (kind === 'requests') next.proposedUnit ??= '';
    await this.validate(
      c,
      kind,
      next,
      previous ? row(previous) : null,
      policies,
    );
    if (requestId) {
      if (kind !== 'skus' || previous)
        return fail('MATERIAL_INVALID_REFERENCE', 'requestId');
      const request = await this.repo(c, 'materialRequests', policies).findOne({
        filter: { id: requestId, status: 'pending' },
      });
      if (!request) return fail('MATERIAL_INVALID_REFERENCE', 'requestId');
    }
    let saved: MaterialRow;
    if (previous) {
      await repository.updateOne({
        filter: { id, revision: Number(input.version) },
        values: { name: previous.name },
      });
      const transition =
        previous.status === 'inactive'
          ? 'editInactive'
          : previous.status === 'active' && materialWorkflowKinds.includes(kind)
            ? 'editActive'
            : 'edit';
      const {
        id: _id,
        status: _status,
        lifecycleVersion: _lv,
        statusChangedAt: _changedAt,
        ...updates
      } = next;
      saved = row(
        (
          await this.runtime.fire(materialTables[kind], next.id, transition, {
            actor,
            manual: false,
            expect: { version: Number(previous.lifecycleVersion) },
            input: { values: json(updates), reason: scalar(input.reason) },
            transaction: c,
          })
        ).record,
      );
    } else {
      saved = row(
        (
          await this.runtime.create(materialTables[kind], next, {
            actor,
            transaction: c,
          })
        ).record,
      );
      // Create policies do not constrain a row scope in the framework. Read back under the same action before committing.
      if (!(await repository.exists({ filter: { id: saved.id } })))
        return fail('MATERIAL_FORBIDDEN');
      await this.audit(
        c,
        kind,
        null,
        saved,
        actor,
        'create',
        scalar(input.reason) || 'create',
      );
      if (requestId)
        await c.repository('materialRequestLinks').createOne({
          values: {
            id: randomUUID(),
            requestId,
            skuId: saved.id,
            relation: 'proposed',
            createdBy: actor.id,
            createdAt: new Date(),
          },
        });
    }
    return materialView(saved);
  }
  async fire(
    kind: MaterialKind,
    id: string,
    transition: string,
    input: MaterialTransitionInput,
    actor: MaterialActor,
    policies: MaterialPolicies,
  ) {
    const run = () =>
      this.db.transaction((c) =>
        this.fireInTransaction(c, kind, id, transition, input, actor, policies),
      );
    return kind === 'requests' && this.sources
      ? this.sources.runTask(id, actor, run)
      : run();
  }
  async fireInTransaction(
    c: DatabaseConnection,
    kind: MaterialKind,
    id: string,
    transition: string,
    input: MaterialTransitionInput,
    actor: MaterialActor,
    policies: MaterialPolicies,
  ) {
    await this.lock(c);
    const repository = this.repo(c, materialTables[kind], policies);
    const current = await repository.findOne({ filter: { id } });
    if (!current) return fail('MATERIAL_NOT_FOUND');
    // Runtime resolves an identical request key before the expected-version check.
    if (transition === 'resolve') {
      if (kind !== 'requests' || !input.resolvedSkuId)
        return fail('MATERIAL_REQUIRED', 'resolvedSkuId');
      const sku = await this.repo(c, 'materialSkus', policies).findOne({
        filter: { id: input.resolvedSkuId, status: 'active' },
      });
      if (!sku) return fail('MATERIAL_INVALID_REFERENCE', 'resolvedSkuId');
    }
    if (!policies[materialTables[kind]].update)
      return fail('MATERIAL_FORBIDDEN');
    await repository.updateOne({
      filter: { id },
      values: { name: current.name },
    });
    const result = await this.runtime.fire(
      materialTables[kind],
      id,
      transition,
      {
        actor,
        expect: { version: input.version },
        requestId: input.requestKey,
        input: json(input),
        transaction: c,
      },
    );
    return materialView(result.record);
  }
  private async active(
    c: DatabaseConnection,
    table: string,
    id: unknown,
    field: string,
    policies?: MaterialPolicies,
  ) {
    if (typeof id !== 'string' || !id)
      return fail('MATERIAL_INVALID_REFERENCE', field);
    const repository = policies
      ? this.repo(c, table, policies)
      : c.repository(table);
    const record = await repository.findOne({
      filter: { id, status: 'active' },
    });
    if (!record) return fail('MATERIAL_INVALID_REFERENCE', field);
    return record;
  }
  private async validate(
    c: DatabaseConnection,
    kind: MaterialKind,
    next: MaterialRow,
    previous: MaterialRow | null,
    policies: MaterialPolicies,
  ) {
    if (
      previous &&
      [
        'subjectId',
        'skuId',
        'unitId',
        'baseUnitId',
        'numerator',
        'denominator',
        'managementMode',
        'precision',
        'templateId',
        'materialNameId',
      ].some(
        (field) =>
          JSON.stringify(previous[field]) !== JSON.stringify(next[field]),
      )
    )
      await guardInventoryMaterial(c, kind, previous);
    const duplicates = await c.repository(materialTables[kind]).exists({
      filter: (f) =>
        f.and([
          f.string('code').eq(next.code),
          f.string('id').ne(next.id),
          ...(kind === 'warehouses'
            ? [f.string('subjectId').eq(scalar(next.subjectId))]
            : []),
        ]),
    });
    if (duplicates) return fail('MATERIAL_CODE_EXISTS', 'code');
    if (
      materialScopedKinds.includes(kind) ||
      (kind === 'references' && next.subjectId)
    )
      await this.active(
        c,
        'orgSubjects',
        next.subjectId,
        'subjectId',
        policies,
      );
    if (
      previous &&
      kind === 'warehouses' &&
      next.subjectId !== previous.subjectId
    )
      return fail('MATERIAL_IMMUTABLE', 'subjectId');
    if (kind === 'names') {
      if (next.templateId)
        await this.active(
          c,
          'materialAttributeTemplates',
          next.templateId,
          'templateId',
          policies,
        );
      if (
        previous &&
        previous.templateId !== next.templateId &&
        (await c
          .repository('materialSkus')
          .exists({ filter: { materialNameId: next.id } }))
      )
        return fail('MATERIAL_IMMUTABLE', 'templateId');
    }
    if (kind === 'templates') {
      const fields = z.array(materialAttribute).parse(next.fields);
      if (
        new Set(fields.map((field) => field.key)).size !== fields.length ||
        fields.some(
          (field) => field.type === 'option' && !field.options?.length,
        )
      )
        return fail('MATERIAL_INVALID_ATTRIBUTES', 'fields');
      if (
        previous &&
        JSON.stringify(
          z
            .array(materialAttribute)
            .parse(previous.fields)
            .map((field) => ({
              ...field,
              unit: field.unit ?? '',
              options: field.options ?? [],
            })),
        ) !==
          JSON.stringify(
            fields.map((field) => ({
              ...field,
              unit: field.unit ?? '',
              options: field.options ?? [],
            })),
          ) &&
        (await c
          .repository('materialNames')
          .exists({ filter: { templateId: next.id } }))
      )
        return fail('MATERIAL_IMMUTABLE', 'fields');
    }
    if (
      kind === 'units' &&
      previous &&
      (next.precision !== previous.precision ||
        next.unitType !== previous.unitType)
    ) {
      if (
        (await c
          .repository('materialSkus')
          .exists({ filter: { baseUnitId: next.id } })) ||
        (await c
          .repository('materialUnitRules')
          .exists({ filter: { unitId: next.id } }))
      )
        return fail('MATERIAL_IMMUTABLE', 'precision');
    }
    if (kind === 'skus') {
      const name = await this.active(
        c,
        'materialNames',
        next.materialNameId,
        'materialNameId',
        policies,
      );
      await this.active(
        c,
        'measureUnits',
        next.baseUnitId,
        'baseUnitId',
        policies,
      );
      const attributes = next.attributeValues as Record<string, string>;
      const canonical: Record<string, string> = {};
      if (name.templateId) {
        const template = await this.active(
          c,
          'materialAttributeTemplates',
          name.templateId,
          'materialNameId',
          policies,
        );
        const fields = z.array(materialAttribute).parse(template.fields);
        if (
          Object.keys(attributes).some(
            (key) => !fields.some((field) => field.key === key),
          )
        )
          return fail('MATERIAL_INVALID_ATTRIBUTES', 'attributeValues');
        for (const field of fields) {
          const value = (attributes[field.key] ?? '').trim();
          if (
            value &&
            field.type === 'option' &&
            !field.options?.includes(value)
          )
            return fail(
              'MATERIAL_INVALID_ATTRIBUTES',
              `attributeValues.${field.key}`,
            );
          if (
            value &&
            field.type === 'number' &&
            !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(value)
          )
            return fail(
              'MATERIAL_INVALID_ATTRIBUTES',
              `attributeValues.${field.key}`,
            );
          const normalized =
            value && field.type === 'number' ? normalizeDecimal(value) : value;
          if (normalized) attributes[field.key] = normalized;
          if (field.identity) canonical[field.key] = normalized;
        }
      } else
        for (const key of Object.keys(attributes).sort())
          canonical[key] = attributes[key].trim();
      next.identityKey = createHash('sha256')
        .update(
          JSON.stringify(
            Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)),
          ),
        )
        .digest('hex');
      next.searchText = [
        next.name,
        next.code,
        ...Object.values(attributes),
      ].join(' ');
      if (
        previous &&
        (previous.identityKey !== next.identityKey ||
          previous.baseUnitId !== next.baseUnitId ||
          previous.materialNameId !== next.materialNameId ||
          previous.managementMode !== next.managementMode) &&
        previous.status !== 'draft'
      )
        return fail('MATERIAL_IMMUTABLE', 'attributeValues');
      if (
        await c.repository('materialSkus').exists({
          filter: (f) =>
            f.and([
              f.string('materialNameId').eq(scalar(next.materialNameId)),
              f.string('identityKey').eq(scalar(next.identityKey)),
              f.string('id').ne(next.id),
            ]),
        })
      )
        return fail('MATERIAL_IDENTITY_EXISTS', 'attributeValues');
    }
    if (kind === 'unitRules') {
      const sku = await this.active(
        c,
        'materialSkus',
        next.skuId,
        'skuId',
        policies,
      );
      const unit = await this.active(
        c,
        'measureUnits',
        next.unitId,
        'unitId',
        policies,
      );
      const base = await c
        .repository('measureUnits')
        .findOne({ filter: { id: scalar(sku.baseUnitId) } });
      next.numerator = normalizeDecimal(scalar(next.numerator));
      next.denominator = normalizeDecimal(scalar(next.denominator));
      if (
        !positiveDecimal(scalar(next.numerator)) ||
        !positiveDecimal(scalar(next.denominator))
      )
        return fail('MATERIAL_INVALID_RATIO', 'numerator');
      if (unit.id === sku.baseUnitId && next.numerator !== next.denominator)
        return fail('MATERIAL_INVALID_RATIO', 'numerator');
      if (unit.unitType !== 'package' && unit.unitType !== base?.unitType)
        return fail('MATERIAL_VARIABLE_CONVERSION', 'unitId');
      if (
        await c.repository('materialUnitRules').exists({
          filter: (f) =>
            f.and([
              f.string('skuId').eq(scalar(next.skuId)),
              f.string('unitId').eq(scalar(next.unitId)),
              f.string('numerator').eq(scalar(next.numerator)),
              f.string('denominator').eq(scalar(next.denominator)),
              f.string('id').ne(next.id),
            ]),
        })
      )
        return fail('MATERIAL_RULE_EXISTS', 'unitId');
    }
    if (kind === 'references' || kind === 'tagLinks') {
      const targetKind = next.targetKind === 'names' ? 'names' : 'skus';
      await this.active(
        c,
        materialTables[targetKind],
        next.targetId,
        'targetId',
        policies,
      );
      if (kind === 'references') {
        next.searchKey = next.name.normalize('NFKC').trim().toLowerCase();
        next.scopeKey = next.subjectId || 'global';
        if (
          await c.repository('materialReferences').exists({
            filter: (f) =>
              f.and([
                f.string('searchKey').eq(scalar(next.searchKey)),
                f.string('scopeKey').eq(scalar(next.scopeKey)),
                f.string('targetKind').eq(targetKind),
                f.string('targetId').eq(scalar(next.targetId)),
                f.string('id').ne(next.id),
              ]),
          })
        )
          return fail('MATERIAL_REFERENCE_EXISTS', 'targetId');
      } else {
        const tag = await this.active(
          c,
          'materialTags',
          next.tagId,
          'tagId',
          policies,
        );
        if (tag.appliesTo !== 'both' && tag.appliesTo !== targetKind)
          return fail('MATERIAL_INVALID_REFERENCE', 'targetKind');
        if (
          await c.repository('materialTagLinks').exists({
            filter: (f) =>
              f.and([
                f.string('tagId').eq(scalar(next.tagId)),
                f.string('targetKind').eq(targetKind),
                f.string('targetId').eq(scalar(next.targetId)),
                f.string('id').ne(next.id),
              ]),
          })
        )
          return fail('MATERIAL_REFERENCE_EXISTS', 'tagId');
      }
    }
    if (kind === 'subjectSettings') {
      await this.active(c, 'materialSkus', next.skuId, 'skuId', policies);
      if (
        await c.repository('materialSubjectSettings').exists({
          filter: (f) =>
            f.and([
              f.string('subjectId').eq(scalar(next.subjectId)),
              f.string('skuId').eq(scalar(next.skuId)),
              f.string('id').ne(next.id),
            ]),
        })
      )
        return fail('MATERIAL_RULE_EXISTS', 'skuId');
    }
    if (kind === 'warehouses' && next.responsiblePositionId) {
      const position = await this.active(
        c,
        'orgPositions',
        next.responsiblePositionId,
        'responsiblePositionId',
        policies,
      );
      const unit = await this.active(
        c,
        'orgUnits',
        position.unitId,
        'responsiblePositionId',
        policies,
      );
      if (unit.subjectId !== next.subjectId)
        return fail('MATERIAL_INVALID_REFERENCE', 'responsiblePositionId');
    }
  }
  private async allowed(
    c: DatabaseConnection,
    kind: MaterialKind,
    record: MaterialRow,
    actor: MaterialActor,
    transition: string,
  ) {
    if (transition === 'approve') {
      if (record.createdBy === actor.id) return false;
      if (kind === 'skus') {
        const links = await c.repository('materialRequestLinks').findMany({
          filter: { skuId: record.id, relation: 'proposed' },
          limit: 1001,
        });
        if (links.length > 1000) return false;
        for (const link of links) {
          if (
            await this.sources?.excludesSkuReviewer(
              c,
              scalar(link.requestId),
              actor.id,
            )
          )
            return false;
          if (
            (
              await c
                .repository('materialRequests')
                .findOne({ filter: { id: scalar(link.requestId) } })
            )?.createdBy === actor.id
          )
            return false;
        }
      }
    }
    if (kind === 'requests' && ['submit', 'withdraw'].includes(transition))
      return record.createdBy === actor.id;
    return true;
  }
  private async prepare(
    c: DatabaseConnection,
    kind: MaterialKind,
    record: MaterialRow,
    input: JsonObject,
    transition: string,
  ) {
    if (transition.startsWith('edit'))
      return (input.values ?? {}) as Record<string, unknown>;
    if (['submit', 'approve', 'reactivate'].includes(transition)) {
      // References are checked again at activation, not only when the draft was created.
      for (const [field, table] of this.activationReferences(kind, record))
        if (record[field]) await this.active(c, table, record[field], field);
      if (kind === 'skus') {
        const name = await this.active(
          c,
          'materialNames',
          record.materialNameId,
          'materialNameId',
        );
        if (name.templateId) {
          const template = await this.active(
            c,
            'materialAttributeTemplates',
            name.templateId,
            'materialNameId',
          );
          const attributes = record.attributeValues as Record<string, string>;
          for (const field of z.array(materialAttribute).parse(template.fields))
            if (field.required && !attributes[field.key]?.trim())
              return fail('MATERIAL_REQUIRED', `attributeValues.${field.key}`);
        }
      }
    }
    if (
      transition === 'reactivate' &&
      kind === 'warehouses' &&
      record.responsiblePositionId
    ) {
      const position = await this.active(
        c,
        'orgPositions',
        record.responsiblePositionId,
        'responsiblePositionId',
      );
      const unit = await this.active(
        c,
        'orgUnits',
        position.unitId,
        'responsiblePositionId',
      );
      if (unit.subjectId !== record.subjectId)
        return fail('MATERIAL_INVALID_REFERENCE', 'responsiblePositionId');
    }
    if (transition === 'deactivate')
      await this.checkDependents(c, kind, record);
    if (transition === 'resolve') {
      const sku = await this.active(
        c,
        'materialSkus',
        input.resolvedSkuId,
        'resolvedSkuId',
      );
      return { resolvedSkuId: sku.id };
    }
    return {};
  }
  private activationReferences(
    kind: MaterialKind,
    record: MaterialRow,
  ): [string, string][] {
    switch (kind) {
      case 'names':
        return [['templateId', 'materialAttributeTemplates']];
      case 'skus':
        return [
          ['materialNameId', 'materialNames'],
          ['baseUnitId', 'measureUnits'],
        ];
      case 'unitRules':
        return [
          ['skuId', 'materialSkus'],
          ['unitId', 'measureUnits'],
        ];
      case 'references':
        return [
          [
            'targetId',
            record.targetKind === 'names' ? 'materialNames' : 'materialSkus',
          ],
          ['subjectId', 'orgSubjects'],
        ];
      case 'tagLinks':
        return [
          ['tagId', 'materialTags'],
          [
            'targetId',
            record.targetKind === 'names' ? 'materialNames' : 'materialSkus',
          ],
        ];
      case 'subjectSettings':
        return [
          ['subjectId', 'orgSubjects'],
          ['skuId', 'materialSkus'],
        ];
      case 'warehouses':
        return [
          ['subjectId', 'orgSubjects'],
          ['responsiblePositionId', 'orgPositions'],
        ];
      case 'requests':
        return [['subjectId', 'orgSubjects']];
      default:
        return [];
    }
  }
  private async checkDependents(
    c: DatabaseConnection,
    kind: MaterialKind,
    record: MaterialRow,
  ) {
    await guardInventoryMaterial(c, kind, record);
    const dependencies: Record<string, [string, string][]> = {
      templates: [['materialNames', 'templateId']],
      names: [['materialSkus', 'materialNameId']],
      skus: [
        ['materialUnitRules', 'skuId'],
        ['materialSubjectSettings', 'skuId'],
      ],
      units: [
        ['materialSkus', 'baseUnitId'],
        ['materialUnitRules', 'unitId'],
      ],
      tags: [['materialTagLinks', 'tagId']],
    };
    if (['names', 'skus'].includes(kind))
      for (const table of ['materialReferences', 'materialTagLinks'])
        if (
          await c.repository(table).exists({
            filter: (f) =>
              f.and([
                f.string('targetKind').eq(kind),
                f.string('targetId').eq(record.id),
                f.string('status').ne('inactive'),
              ]),
          })
        )
          return fail('MATERIAL_IN_USE');
    for (const [table, field] of dependencies[kind] ?? [])
      if (
        await c.repository(table).exists({
          filter: (f) =>
            f.and([
              f.string(field).eq(record.id),
              f.string('status').ne('inactive'),
            ]),
        })
      )
        return fail('MATERIAL_IN_USE');
  }
  private async transitioned(
    c: DatabaseConnection,
    kind: MaterialKind,
    context: TransitionHookContext<MaterialLifecycleTypes>,
  ) {
    if (kind === 'requests' && context.entry.transition === 'resolve') {
      const skuId = scalar(context.record.resolvedSkuId);
      const requestId = context.record.id;
      if (
        !(await c
          .repository('materialRequestLinks')
          .exists({ filter: { requestId, skuId, relation: 'resolved' } }))
      )
        await c.repository('materialRequestLinks').createOne({
          values: {
            id: randomUUID(),
            requestId,
            skuId,
            relation: 'resolved',
            createdBy: context.actor.id,
            createdAt: new Date(),
          },
        });
    }
    if (kind === 'requests') await this.sources?.afterTask(c, context);
    await this.audit(
      c,
      kind,
      context.previous,
      context.record,
      context.actor,
      context.entry.transition,
      scalar(context.input.reason) || context.entry.transition,
    );
  }
  private async audit(
    c: DatabaseConnection,
    kind: MaterialKind,
    before: MaterialRow | null,
    after: MaterialRow,
    actor: MaterialActor,
    operation: string,
    reason: string,
  ) {
    await c.repository('materialAudit').createOne({
      values: {
        id: randomUUID(),
        kind,
        recordId: after.id,
        recordName: after.name,
        subjectId: after.subjectId ?? null,
        actorId: actor.id,
        actorName: actor.name ?? actor.id,
        operation,
        reason,
        beforeValue: before ? json(before) : null,
        afterValue: json(after),
        createdAt: new Date(),
      },
    });
  }
  async history(
    query: {
      kind?: MaterialKind;
      recordId?: string;
      page: number;
      q?: string;
      orderBy?: 'createdAt' | '-createdAt';
    },
    policies: MaterialPolicies,
  ) {
    const repository = this.repo(
      this.db.connection(),
      'materialAudit',
      policies,
    );
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(query.kind ? [f.string('kind').eq(query.kind)] : []),
        ...(query.recordId ? [f.string('recordId').eq(query.recordId)] : []),
        ...(query.q
          ? [f.string('recordName').includes(query.q, { mode: 'insensitive' })]
          : []),
      ]);
    const [data, total] = await Promise.all([
      repository.findMany({
        filter,
        limit: 20,
        offset: (query.page - 1) * 20,
        sort: (s) => [
          query.orderBy === 'createdAt'
            ? s.field('createdAt').asc()
            : s.field('createdAt').desc(),
          s.field('id').desc(),
        ],
      }),
      repository.count({ filter }),
    ]);
    return { data, meta: { page: query.page, pageSize: 20, total } };
  }
  async catalog(
    query: MaterialQuery,
    policies: MaterialPolicies,
    id?: string,
    context?: MaterialCatalogContext,
  ) {
    const c = context?.connection ?? this.db.connection();
    const byIds = materialIdFilter;
    const referenceScope = (f: FilterBuilder) =>
      context
        ? f.or([
            f.string('subjectId').eq(null),
            f.string('subjectId').eq(context.subjectId),
          ])
        : f.string('subjectId').eq(null);
    const skus = this.repo(c, 'materialSkus', policies);
    let names: RepositoryRecord[] = [],
      references: RepositoryRecord[] = [];
    if (query.q) {
      names = await this.repo(c, 'materialNames', policies).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.string('name').includes(query.q!, { mode: 'insensitive' }),
            ...(context ? [byIds(f, 'id', context.nameIds)] : []),
          ]),
        limit: 1001,
      });
      references = await this.repo(c, 'materialReferences', policies).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            referenceScope(f),
            ...(context
              ? [
                  f.or([
                    f.and([
                      f.string('targetKind').eq('skus'),
                      byIds(f, 'targetId', context.skuIds),
                    ]),
                    f.and([
                      f.string('targetKind').eq('names'),
                      byIds(f, 'targetId', context.nameIds),
                    ]),
                  ]),
                ]
              : []),
            f
              .string('searchKey')
              .includes(query.q!.normalize('NFKC').trim().toLowerCase(), {
                mode: 'insensitive',
              }),
          ]),
        limit: 1001,
      });
      if (names.length > 1000 || references.length > 1000)
        return fail('MATERIAL_SEARCH_TOO_BROAD', 'q');
    }
    const aliasNames = references
      .filter((item) => item.targetKind === 'names')
      .map((item) => scalar(item.targetId));
    if (aliasNames.length) {
      const matched = await this.repo(c, 'materialNames', policies).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.or(aliasNames.map((id) => f.string('id').eq(id))),
          ]),
        limit: 1000,
      });
      names = [
        ...new Map(
          [...names, ...matched].map((item) => [item.id, item]),
        ).values(),
      ];
    }
    const nameIds = [
      ...new Set([
        ...names.map((item) => scalar(item.id)),
        ...references
          .filter((item) => item.targetKind === 'names')
          .map((item) => scalar(item.targetId)),
      ]),
    ];
    const skuIds = references
      .filter((item) => item.targetKind === 'skus')
      .map((item) => scalar(item.targetId));
    const tagged = query.tagId
      ? await this.taggedTargets(c, query.tagId, policies)
      : null;
    const filter = (f: FilterBuilder) =>
      f.and([
        f.string('status').eq('active'),
        ...(context ? [byIds(f, 'id', context.skuIds)] : []),
        ...(id ? [f.string('id').eq(id)] : []),
        ...(query.materialNameId
          ? [f.string('materialNameId').eq(query.materialNameId)]
          : []),
        ...(tagged
          ? [
              f.or([
                materialIdFilter(f, 'materialNameId', tagged.names),
                materialIdFilter(f, 'id', tagged.skus),
              ]),
            ]
          : []),
        ...(query.q
          ? [
              f.or([
                f.string('name').includes(query.q, { mode: 'insensitive' }),
                f.string('code').includes(query.q, { mode: 'insensitive' }),
                f.text('searchText').includes(query.q, { mode: 'insensitive' }),
                ...nameIds.map((value) => f.string('materialNameId').eq(value)),
                ...skuIds.map((value) => f.string('id').eq(value)),
              ]),
            ]
          : []),
      ]);
    if (id) {
      const sku = await skus.findOne({ filter });
      if (!sku) return fail('MATERIAL_NOT_FOUND');
      const name = await this.repo(c, 'materialNames', policies).findOne({
        filter: { id: scalar(sku.materialNameId), status: 'active' },
      });
      const unit = await this.repo(c, 'measureUnits', policies).findOne({
        filter: { id: scalar(sku.baseUnitId), status: 'active' },
      });
      if (!name || !unit) return fail('MATERIAL_NOT_FOUND');
      const template = name.templateId
        ? await this.repo(c, 'materialAttributeTemplates', policies).findOne({
            filter: { id: scalar(name.templateId), status: 'active' },
          })
        : null;
      const attributeLabels = Object.fromEntries(
        z
          .array(materialAttribute)
          .parse(template?.fields ?? [])
          .map((field) => [
            field.key,
            { title: field.title, unit: field.unit ?? '' },
          ]),
      );
      const packages = await this.repo(
        c,
        'materialUnitRules',
        policies,
      ).findMany({ filter: { skuId: id, status: 'active' }, limit: 101 });
      const links = await this.repo(c, 'materialTagLinks', policies).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.or([
              f.and([
                f.string('targetKind').eq('skus'),
                f.string('targetId').eq(id),
              ]),
              f.and([
                f.string('targetKind').eq('names'),
                f.string('targetId').eq(scalar(sku.materialNameId)),
              ]),
            ]),
          ]),
        limit: 101,
      });
      const tags = new Map<string, RepositoryRecord & { inherited: boolean }>();
      for (const link of links.slice(0, 100)) {
        const tag = await this.repo(c, 'materialTags', policies).findOne({
          filter: { id: scalar(link.tagId), status: 'active' },
        });
        if (tag && (!tags.has(scalar(tag.id)) || link.targetKind === 'skus'))
          tags.set(scalar(tag.id), {
            ...tag,
            inherited: link.targetKind === 'names',
          });
      }
      const aliases = await this.repo(
        c,
        'materialReferences',
        policies,
      ).findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            referenceScope(f),
            f.or([
              f.and([
                f.string('targetKind').eq('skus'),
                f.string('targetId').eq(id),
              ]),
              f.and([
                f.string('targetKind').eq('names'),
                f.string('targetId').eq(scalar(sku.materialNameId)),
              ]),
            ]),
          ]),
        limit: 101,
      });
      return {
        data: {
          ...materialView(sku),
          attributeLabels,
          aliases: aliases.slice(0, 100).map((item) => ({
            id: item.id,
            name: item.name,
            inherited: item.targetKind === 'names',
          })),
          standardName: name.name,
          baseUnitName: unit.name,
          packages: packages.slice(0, 100),
          tags: [...tags.values()],
          relationsTruncated:
            packages.length > 100 || links.length > 100 || aliases.length > 100,
        },
      };
    }
    const [data, total] = await Promise.all([
      skus.findMany({
        filter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (s) => [
          query.orderBy.startsWith('-')
            ? s.field(query.orderBy.replace('-', '')).desc()
            : s.field(query.orderBy).asc(),
          s.field('id').asc(),
        ],
      }),
      skus.count({ filter }),
    ]);
    return {
      data: data.map(materialView),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        nameCandidates: names.map((value) => ({
          id: value.id,
          name: value.name,
        })),
        ambiguous: total > 1,
        ...(context
          ? (() => {
              const exact = references.filter(
                (value) =>
                  value.searchKey ===
                  query.q?.normalize('NFKC').trim().toLowerCase(),
              );
              const candidates = [
                ...new Set(
                  exact
                    .filter((value) => value.targetKind === 'skus')
                    .map((value) => scalar(value.targetId)),
                ),
              ];
              const hasName = exact.some(
                (value) => value.targetKind === 'names',
              );
              return {
                aliasMatch: {
                  status: !exact.length
                    ? 'none'
                    : hasName || candidates.length !== 1
                      ? 'ambiguous'
                      : 'unique',
                  skuId:
                    !hasName && candidates.length === 1 ? candidates[0] : null,
                },
              };
            })()
          : {}),
      },
    };
  }
}
import { guardInventoryMaterial } from './inventory-dependencies.js';
