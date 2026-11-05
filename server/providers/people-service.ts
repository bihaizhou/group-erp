import { businessDate } from './business-date.js';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import {
  PermissionSetLastAssignmentError,
  type PermissionSetsApi,
} from '@nocobase/authorization/permission-sets';
import { randomUUID } from 'node:crypto';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
  FilterBuilder,
} from '@nocobase/db';
import {
  LifecycleRuntime,
  SYSTEM_ACTOR,
  type JsonObject,
} from '@nocobase/lifecycle';
import { z } from 'zod';
import {
  PEOPLE_APPROVAL_SCOPE,
  PeopleApproval,
  parseApprovalChains,
  type ApprovalChains,
} from './people-approval.js';
import {
  peopleTables,
  scalar,
  peopleDataSchemas,
  workforceTaskResult,
  peopleView,
  peopleFail as fail,
  workflowKinds,
  type PeopleKind,
  type PeopleRow,
  type PeopleQuery,
  type PeopleActor,
} from './people-model.js';
import { PeopleChecklist } from './people-checklist.js';
import { syncAccountPositionPermissions } from './position-permission-sync.js';
import { peopleDependencies, orgReadColumns } from './people-resources.js';
import {
  peopleLifecycles,
  type PeopleWorkflowContext,
} from './people-workflows.js';

export type PeoplePolicies = Record<string, RepositoryPolicy>;
const jsonObject = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;
const asRow = (v: unknown) => v as PeopleRow;
type ChangeData = z.infer<typeof peopleDataSchemas.changes>;
const changeTypeLabels: Record<ChangeData['type'], string> = {
  entry: '入职',
  transfer: '调动',
  partTime: '兼职',
  endPartTime: '结束兼职',
  exit: '离职',
  regularize: '转正',
};
type EvaluationData = z.infer<typeof peopleDataSchemas.evaluations>;
type ProfileData = z.infer<typeof peopleDataSchemas.profiles>;
type ModelData = z.infer<typeof peopleDataSchemas.models>;
type WorkforceData = z.infer<typeof peopleDataSchemas.workforcePlans>;

export class PeopleService {
  private readonly approval: PeopleApproval;
  private readonly checklist = new PeopleChecklist();
  constructor(
    private readonly db: DatabaseManager,
    public readonly runtime: LifecycleRuntime,
    private readonly users: UserAdministrationService,
    public readonly timeZone = 'Asia/Shanghai',
    private readonly permissionSets: PermissionSetsApi<DatabaseConnection>,
  ) {
    this.businessDate(); // Validate the configured IANA timezone during service initialization.
    this.approval = new PeopleApproval(db, users, permissionSets, timeZone);
    for (const [kind, definition] of Object.entries(peopleLifecycles))
      runtime.register(definition, {
        ...(kind === 'changes'
          ? {
              parameterConfiguration: {
                store: this.approval.parameters,
                scope: () => PEOPLE_APPROVAL_SCOPE,
                legacyRecord: () => false,
              },
            }
          : {}),
        services: (handle) => {
          const connection =
            (handle as DatabaseConnection | undefined) ?? this.db.connection();
          return {
            allowed: (record, actor, transition) =>
              this.allowed(
                connection,
                kind as PeopleKind,
                record,
                actor,
                transition,
              ),
            prepare: (record, input, transition, actor) =>
              this.prepare(
                connection,
                kind as PeopleKind,
                record,
                input,
                transition,
                actor,
              ),
            transitioned: (context) =>
              this.transitioned(connection, context, kind as PeopleKind),
          };
        },
      });
  }
  businessDate() {
    return businessDate(this.timeZone);
  }
  private repo(
    connection: DatabaseConnection,
    kind: PeopleKind,
    policies: PeoplePolicies,
  ) {
    if (!policies[peopleTables[kind]]) return fail('PEOPLE_FORBIDDEN');
    return connection
      .repository(peopleTables[kind])
      .withPolicy(policies[peopleTables[kind]]);
  }
  private async lock(c: DatabaseConnection) {
    await c.repository('orgMutationLock').updateOne({
      filter: { id: 'organization' },
      values: { nonce: randomUUID() },
    });
  }
  async list(kind: PeopleKind, q: PeopleQuery, policies: PeoplePolicies) {
    const repo = this.repo(this.db.connection(), kind, policies);
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(q.q
          ? [
              f.or([
                f.string('name').includes(q.q, { mode: 'insensitive' }),
                f.string('code').includes(q.q, { mode: 'insensitive' }),
              ]),
            ]
          : []),
        ...(['status', 'subjectId', 'personId'] as const)
          .filter((k) => q[k])
          .map((k) => f.string(k).eq(q[k]!)),
      ]);
    const field = q.orderBy.replace('-', '');
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: q.pageSize,
        offset: (q.page - 1) * q.pageSize,
        sort: (s) => [
          q.orderBy.startsWith('-')
            ? s.field(field).desc()
            : s.field(field).asc(),
          s.field('id').asc(),
        ],
      }),
      repo.count({ filter }),
    ]);
    return {
      data: rows.map(peopleView),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }
  async get(
    kind: PeopleKind,
    id: string,
    policies: PeoplePolicies,
    actor?: PeopleActor,
  ) {
    const row = await this.repo(this.db.connection(), kind, policies).findOne({
      filter: { id },
    });
    if (!row) return fail('PEOPLE_NOT_FOUND');
    const record = peopleView(row);
    const currentStaffing: Record<string, number> = {};
    if (kind === 'workforcePlans')
      for (const item of (row.data as WorkforceData).items) {
        const assignments = await this.repo(
          this.db.connection(),
          'assignments',
          policies,
        ).findMany({
          filter: {
            subjectId: scalar(row.subjectId),
            positionId: item.positionId,
          },
          limit: 100001,
        });
        if (assignments.length > 100000) return fail('PEOPLE_TOO_MANY_RECORDS');
        currentStaffing[item.positionId] = new Set(
          assignments
            .filter(
              (a) =>
                this.isCurrent(asRow(a)) &&
                (a.data as Record<string, unknown>).type === 'primary',
            )
            .map((a) => a.personId),
        ).size;
      }
    const approval =
        kind === 'changes'
          ? await this.approval.view(this.db.connection(), id)
          : null,
      checklist =
        kind === 'changes'
          ? await this.checklist.view(this.db.connection(), id)
          : null,
      card =
        kind === 'employees'
          ? await this.db
              .connection()
              .repository('hrProfiles')
              .findOne({ filter: { personId: id } })
          : null,
      profileId = card ? scalar(card.id) : null;
    if (workflowKinds.includes(kind) && actor) {
      const view = await this.runtime.view(peopleTables[kind], id, actor);
      return {
        ...record,
        currentStaffing,
        ...(approval ? { approval } : {}),
        ...(checklist ? { checklist } : {}),
        ...(profileId ? { profileId } : {}),
        workflow: {
          available: view.available,
          history: view.history.transitions,
        },
      };
    }
    return {
      ...record,
      currentStaffing,
      ...(approval ? { approval } : {}),
      ...(checklist ? { checklist } : {}),
      ...(profileId ? { profileId } : {}),
    };
  }
  async options(
    kind: PeopleKind,
    policies: PeoplePolicies,
    includeAccounts = false,
  ) {
    const tables = [...new Set([kind, ...peopleDependencies[kind]])];
    const entries = await Promise.all(
      tables.map(async (k) => {
        const repo = this.repo(this.db.connection(), k, policies);
        const [rows, total] = await Promise.all([
          repo.findMany({ limit: 1000, sort: (s) => s.field('code').asc() }),
          repo.count(),
        ]);
        return [
          k,
          { rows: rows.map(peopleView), total, truncated: total > rows.length },
        ] as [
          string,
          {
            rows: Record<string, unknown>[];
            total: number;
            truncated: boolean;
          },
        ];
      }),
    );
    for (const table of Object.keys(orgReadColumns)) {
      if (!policies[table]) return fail('PEOPLE_FORBIDDEN');
      const repo = this.db.repository(table).withPolicy(policies[table]);
      const [rows, total] = await Promise.all([
        repo.findMany({ limit: 1000 }),
        repo.count(),
      ]);
      entries.push([table, { rows, total, truncated: total > rows.length }]);
    }
    if (includeAccounts) {
      const page = await this.users.list({
        page: 1,
        pageSize: 1000,
        status: 'enabled',
      });
      entries.push([
        'accounts',
        {
          rows: page.items.map((user) => ({
            id: user.id,
            name: user.name,
            code: user.username ?? user.id.slice(0, 8),
            status: 'active',
          })),
          total: page.total,
          truncated: page.total > page.items.length,
        },
      ]);
    }
    return Object.fromEntries(entries);
  }
  async save(
    kind: PeopleKind,
    input: Record<string, unknown>,
    actor: PeopleActor,
    policies: PeoplePolicies,
    id?: string,
  ) {
    if (['employments', 'assignments'].includes(kind))
      return fail('PEOPLE_USE_CHANGE');
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const repo = this.repo(c, kind, policies);
      const previous = id ? await repo.findOne({ filter: { id } }) : null;
      if (id && !previous) return fail('PEOPLE_NOT_FOUND');
      if (previous && Number(previous.revision) !== input.version)
        return fail('PEOPLE_VERSION_CONFLICT');
      if (
        previous &&
        workflowKinds.includes(kind) &&
        previous.status !== 'draft'
      )
        return fail('PEOPLE_IMMUTABLE');
      const { version: _version, reason: _reason, ...changes } = input;
      const row = {
        ...previous,
        ...changes,
        id: id ?? randomUUID(),
        revision: Number(previous?.revision ?? 0) + 1,
        createdBy: previous?.createdBy ?? actor.id,
        createdAt: previous?.createdAt ?? new Date(),
        updatedAt: new Date(),
        snapshot: previous?.snapshot ?? null,
        grade: null,
      } as unknown as PeopleRow;
      row.data = peopleDataSchemas[kind].parse(row.data);
      // Scope columns are derived from trusted parents, never accepted as arbitrary scope claims.
      let person: RepositoryRecord | null = null;
      if (row.personId) {
        person =
          (await this.repo(c, 'employees', policies).findOne({
            filter: { id: row.personId },
          })) ?? null;
        if (!person || person.status !== 'active')
          return fail('PEOPLE_INVALID_REFERENCE', 'personId');
        row.subjectId = scalar(person.subjectId);
      }
      if (kind === 'changes') {
        // A change names itself: CHG-<date>-<random> and "<person> · <type>".
        if (!scalar(row.code)) row.code = await this.changeCode(c);
        if (!scalar(row.name))
          row.name = `${scalar(person?.name)} · ${changeTypeLabels[(row.data as ChangeData).type]}`;
      } else if (!scalar(row.code) || !scalar(row.name)) {
        return fail('PEOPLE_REQUIRED', !scalar(row.code) ? 'code' : 'name');
      }
      await this.validate(c, kind, row, policies, actor);
      if (kind === 'profiles') row.grade = (row.data as ProfileData).grade;
      if (kind === 'employees') {
        row.accountId = row.data.accountId;
        row.photoId = row.data.photoId;
      }
      if (
        await c.repository(peopleTables[kind]).exists({
          filter: (f) =>
            f.and([f.string('code').eq(row.code), f.string('id').ne(row.id)]),
        })
      )
        return fail('PEOPLE_CODE_EXISTS', 'code');
      if (kind === 'evaluations')
        row.snapshot = await this.evaluationSnapshot(c, row, policies);
      if (kind === 'workforcePlans')
        row.snapshot = await this.workforceSnapshot(c, row, policies);
      let result: PeopleRow;
      if (previous) {
        const {
          id: _id,
          createdAt: _createdAt,
          status: _status,
          lifecycleVersion: _lv,
          statusChangedAt: _sc,
          ...values
        } = row;
        if (workflowKinds.includes(kind)) {
          await repo.updateOne({
            filter: { id, revision: Number(input.version) },
            values: { name: previous.name },
          });
          result = asRow(
            (
              await this.runtime.fire(peopleTables[kind], row.id, 'edit', {
                actor,
                manual: false,
                expect: { version: Number(previous.lifecycleVersion) },
                input: {
                  values: jsonObject(values),
                  reason: scalar(input.reason),
                },
                transaction: c,
              })
            ).record,
          );
        } else
          result = asRow(
            (
              await repo.updateOne({
                filter: { id, revision: Number(input.version) },
                values: values as RepositoryRecord,
              })
            ).record,
          );
      } else if (workflowKinds.includes(kind)) {
        const {
          status: _s,
          lifecycleVersion: _lv,
          statusChangedAt: _sc,
          ...values
        } = row;
        result = asRow(
          (
            await this.runtime.create(peopleTables[kind], values, {
              actor,
              transaction: c,
            })
          ).record,
        );
        const create = policies[peopleTables[kind]].create;
        if (!create) return fail('PEOPLE_FORBIDDEN');
        const scope = typeof create === 'object' ? create.scope : true;
        if (
          !(await c
            .repository(peopleTables[kind])
            .withPolicy({
              read: { scope, fields: ['id'] },
              create: false,
              update: false,
              delete: false,
            })
            .exists({ filter: { id: result.id } }))
        )
          return fail('PEOPLE_FORBIDDEN');
      } else
        result = asRow(
          (
            await repo.createOne({
              values: {
                ...row,
                status: 'active',
                lifecycleVersion: 0,
              } as RepositoryRecord,
            })
          ).record,
        );
      // The framework intentionally treats create record access as unrestricted.
      // Verify the produced row against this business action's read scope inside the same transaction.
      if (!(await repo.exists({ filter: { id: result.id } })))
        return fail('PEOPLE_FORBIDDEN');
      if (!previous || !workflowKinds.includes(kind))
        await this.audit(
          c,
          kind,
          previous,
          result,
          actor,
          scalar(input.reason ?? 'create'),
          'save',
        );
      if (kind === 'employees' && !previous) {
        const profile = {
          id: randomUUID(),
          code: row.code,
          name: row.name,
          subjectId: row.subjectId,
          personId: row.id,
          positionId: null,
          grade: null,
          accountId: null,
          status: 'active',
          revision: 1,
          lifecycleVersion: 0,
          createdBy: actor.id,
          data: peopleDataSchemas.profiles.parse({}),
          snapshot: { generated: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await c
          .repository('hrProfiles')
          .createOne({ values: profile as RepositoryRecord });
        await this.audit(
          c,
          'profiles',
          null,
          profile,
          actor,
          'employee talent card initialized',
          'create',
        );
      }
      if (
        kind === 'employees' &&
        previous &&
        previous.subjectId !== result.subjectId
      ) {
        // Before the first employment, correcting the owning company must also move the initialized card.
        const profile = await c
          .repository('hrProfiles')
          .findOne({ filter: { personId: result.id } });
        if (profile) {
          const next = {
            ...profile,
            subjectId: result.subjectId,
            revision: Number(profile.revision) + 1,
            updatedAt: new Date(),
          };
          await c.repository('hrProfiles').updateOne({
            filter: { id: scalar(profile.id) },
            values: {
              subjectId: next.subjectId,
              revision: next.revision,
              updatedAt: next.updatedAt,
            },
          });
          await this.audit(
            c,
            'profiles',
            profile,
            next as unknown as PeopleRow,
            actor,
            scalar(input.reason),
            'scopeChanged',
          );
        }
        if (
          await c
            .repository('personnelPrivate')
            .exists({ filter: { id: result.id } })
        )
          await c.repository('personnelPrivate').updateOne({
            filter: { id: result.id },
            values: { subjectId: result.subjectId },
          });
      }
      return peopleView(result);
    });
  }
  private async validate(
    c: DatabaseConnection,
    kind: PeopleKind,
    row: PeopleRow,
    policies: PeoplePolicies,
    actor: PeopleActor,
  ) {
    if (kind === 'employees' || kind === 'workforcePlans') {
      if (!row.subjectId) return fail('PEOPLE_REQUIRED', 'subjectId');
      await this.active(c, 'orgSubjects', row.subjectId, 'subjectId');
    }
    if (
      ['profiles', 'evaluations', 'developmentPlans', 'changes'].includes(
        kind,
      ) &&
      !row.personId
    )
      return fail('PEOPLE_REQUIRED', 'personId');
    if (kind === 'employees') {
      const previous = await c
        .repository('personnelEmployees')
        .findOne({ filter: { id: row.id } });
      if (
        previous &&
        previous.subjectId !== row.subjectId &&
        (await c
          .repository('personnelEmployments')
          .exists({ filter: { personId: row.id } }))
      )
        return fail('PEOPLE_USE_CHANGE', 'subjectId');
      if (row.personId || row.positionId)
        return fail('PEOPLE_INVALID_REFERENCE', 'personId');
      const accountId = row.data.accountId;
      if (
        accountId !==
          (previous?.data as Record<string, unknown> | undefined)?.accountId &&
        accountId !== null &&
        !actor.bindAccounts
      )
        return fail('PEOPLE_FORBIDDEN', 'data.accountId');
      if (
        previous &&
        accountId !== (previous.data as Record<string, unknown>).accountId &&
        !actor.bindAccounts
      )
        return fail('PEOPLE_FORBIDDEN', 'data.accountId');
      if (accountId) {
        const user = await this.users.withConnection(c).get(scalar(accountId));
        if (!user || user.kind !== 'person' || user.disabledAt)
          return fail('PEOPLE_INVALID_REFERENCE', 'data.accountId');
        if (
          await c.repository('personnelEmployees').exists({
            filter: (f) =>
              f.and([
                f.string('id').ne(row.id),
                f.string('accountId').eq(scalar(accountId)),
              ]),
          })
        )
          return fail('PEOPLE_ACCOUNT_EXISTS', 'data.accountId');
      }
      if (row.data.photoId) {
        const stored = await c
          .repository('personnelEmployees')
          .findOne({ filter: { id: row.id } });
        if (
          (stored?.data as Record<string, unknown> | undefined)?.photoId !==
            row.data.photoId &&
          !(await c.repository('peopleFiles').exists({
            filter: { id: scalar(row.data.photoId), ownerId: actor.id },
          }))
        )
          return fail('PEOPLE_INVALID_REFERENCE', 'data.photoId');
      }
    }
    if (kind === 'dimensions' && row.subjectId)
      return fail('PEOPLE_INVALID_REFERENCE', 'subjectId');
    if (kind === 'models') {
      if (!row.positionId) return fail('PEOPLE_REQUIRED', 'positionId');
      const position = await this.active(
        c,
        'orgPositions',
        row.positionId,
        'positionId',
      );
      const unit = await this.active(
        c,
        'orgUnits',
        scalar(position.unitId),
        'positionId',
      );
      row.subjectId = scalar(unit.subjectId);
      const items = (row.data as ModelData).items;
      this.unique(
        items.map((v) => v.dimensionId),
        'data.items',
      );
      for (const item of items)
        await this.accessible(
          c,
          'dimensions',
          item.dimensionId,
          policies,
          'data.items',
        );
    }
    if (kind === 'profiles') {
      if (
        await c.repository('hrProfiles').exists({
          filter: (f) =>
            f.and([
              f.string('personId').eq(row.personId),
              f.string('id').ne(row.id),
            ]),
        })
      )
        return fail('PEOPLE_PROFILE_EXISTS', 'personId');
      const d = row.data as ProfileData;
      for (const key of ['modelId', 'targetModelId'] as const)
        if (d[key])
          await this.accessible(c, 'models', d[key], policies, `data.${key}`);
      this.unique(
        d.extraItems.map((v) => v.dimensionId),
        'data.extraItems',
      );
      for (const item of d.extraItems)
        await this.accessible(
          c,
          'dimensions',
          item.dimensionId,
          policies,
          'data.extraItems',
        );
    }
    if (kind === 'changes') {
      const d = row.data as ChangeData;
      if (
        !(
          await this.changeTypeChoices(c, scalar(row.personId), d.effectiveDate)
        ).includes(d.type)
      )
        return fail('PEOPLE_CHANGE_TYPE_CONFLICT', 'data.type');
      if (
        d.type === 'entry' ||
        d.type === 'transfer' ||
        d.type === 'partTime'
      ) {
        if (!d.targetPositionId)
          return fail('PEOPLE_REQUIRED', 'data.targetPositionId');
        const position = await this.active(
          c,
          'orgPositions',
          d.targetPositionId,
          'data.targetPositionId',
        );
        const unit = await this.active(
          c,
          'orgUnits',
          scalar(position.unitId),
          'data.targetPositionId',
        );
        if (d.targetSubjectId !== unit.subjectId)
          return fail('PEOPLE_COMPANY_MISMATCH', 'data.targetSubjectId');
        await this.active(
          c,
          'orgSubjects',
          scalar(unit.subjectId),
          'data.targetSubjectId',
        );
      }
      if (d.probationEnd && d.probationEnd < d.effectiveDate)
        return fail('PEOPLE_DATE_CONFLICT', 'data.probationEnd');
      // Exit and regularization often get recorded a day or two late; other
      // transactions must not silently rewrite an established timeline.
      if (d.effectiveDate < this.businessDate()) {
        const days = Math.round(
          (Date.parse(this.businessDate()) - Date.parse(d.effectiveDate)) /
            86_400_000,
        );
        if (!['exit', 'regularize'].includes(d.type) || days > 90)
          return fail('PEOPLE_BACKDATE', 'data.effectiveDate');
      }
    }
    if (kind === 'workforcePlans') {
      const d = row.data as WorkforceData;
      if (d.items.some((item) => item.approved !== null))
        return fail('PEOPLE_USE_WORKFLOW', 'data.items');
      if (d.taskResults.length)
        return fail('PEOPLE_USE_WORKFLOW', 'data.taskResults');
      this.unique(
        d.items.map((v) => v.positionId),
        'data.items',
      );
      if (d.baselineDate > this.businessDate())
        return fail('PEOPLE_DATE_CONFLICT', 'data.baselineDate');
      for (const item of d.items) {
        const position = await this.active(
          c,
          'orgPositions',
          item.positionId,
          'data.items',
        );
        const unit = await this.active(
          c,
          'orgUnits',
          scalar(position.unitId),
          'data.items',
        );
        if (unit.subjectId !== row.subjectId)
          return fail('PEOPLE_COMPANY_MISMATCH', 'data.items');
      }
      if (d.previousId) {
        const previous = await this.accessible(
          c,
          'workforcePlans',
          d.previousId,
          policies,
          'data.previousId',
        );
        if (
          previous.id === row.id ||
          previous.subjectId !== row.subjectId ||
          (previous.data as WorkforceData).period !== d.period ||
          previous.status !== 'approved'
        )
          return fail('PEOPLE_INVALID_REFERENCE', 'data.previousId');
      }
    }
  }
  private unique(values: string[], field: string) {
    if (new Set(values).size !== values.length)
      return fail('PEOPLE_DUPLICATE_DIMENSION', field);
  }
  private async active(
    c: DatabaseConnection,
    table: string,
    id: string,
    field: string,
  ) {
    const row = await c
      .repository(table)
      .findOne({ filter: { id, status: 'active' } });
    if (!row) return fail('PEOPLE_INVALID_REFERENCE', field);
    return row;
  }
  private async accessible(
    c: DatabaseConnection,
    kind: PeopleKind,
    id: string,
    policies: PeoplePolicies,
    field: string,
  ) {
    const row = await this.repo(c, kind, policies).findOne({ filter: { id } });
    if (
      !row ||
      (['dimensions', 'models'].includes(kind) && row.status !== 'active')
    )
      return fail('PEOPLE_INVALID_REFERENCE', field);
    return asRow(row);
  }
  private async evaluationSnapshot(
    c: DatabaseConnection,
    row: PeopleRow,
    policies: PeoplePolicies,
  ) {
    const d = row.data as EvaluationData;
    const model = await this.accessible(
      c,
      'models',
      d.modelId,
      policies,
      'data.modelId',
    );
    const profile = await this.repo(c, 'profiles', policies).findOne({
      filter: { personId: row.personId },
    });
    const common = await this.repo(c, 'dimensions', policies).findMany({
      filter: { status: 'active' },
      limit: 1000,
    });
    const commonItems = common
      .filter((r) => (r.data as Record<string, unknown>).category === 'common')
      .map((r) => ({
        dimensionId: scalar(r.id),
        target: 3,
        source: 'common' as const,
      }));
    const all = [
      ...commonItems,
      ...(model.data as ModelData).items,
      ...((profile?.data as ProfileData | undefined)?.extraItems ?? []),
    ];
    const items = [
      ...new Map(all.map((item) => [item.dimensionId, item])).values(),
    ];
    this.unique(
      d.ratings.map((v) => v.dimensionId),
      'data.ratings',
    );
    if (
      d.ratings.length !== items.length ||
      d.ratings.some(
        (v) => !items.some((item) => item.dimensionId === v.dimensionId),
      )
    )
      return fail('PEOPLE_MODEL_MISMATCH', 'data.ratings');
    if (
      d.ratings.some(
        (v) =>
          v.selfScore !== null ||
          v.managerScore !== null ||
          v.confirmedScore !== null,
      )
    )
      return fail('PEOPLE_USE_EVALUATION', 'data.ratings');
    const dimensions = await Promise.all(
      items.map(async (item) => {
        const dimension = await this.accessible(
          c,
          'dimensions',
          item.dimensionId,
          policies,
          'data.ratings',
        );
        return {
          ...item,
          name: dimension.name,
          version: dimension.revision,
          ...dimension.data,
        };
      }),
    );
    const person = await this.accessible(
      c,
      'employees',
      row.personId!,
      policies,
      'personId',
    );
    const assignments = await this.repo(c, 'assignments', policies).findMany({
      filter: { personId: row.personId },
      limit: 1000,
    });
    return {
      model: {
        id: model.id,
        name: model.name,
        version: model.revision,
        positionId: model.positionId,
      },
      dimensions,
      person: { id: person.id, name: person.name, subjectId: person.subjectId },
      assignments: assignments.map(peopleView),
      sources: [],
    };
  }
  private async workforceSnapshot(
    c: DatabaseConnection,
    row: PeopleRow,
    policies: PeoplePolicies,
  ) {
    const d = row.data as WorkforceData;
    const items = [];
    for (const item of d.items) {
      const assignments = await this.repo(c, 'assignments', policies).findMany({
        filter: { subjectId: row.subjectId, positionId: item.positionId },
        limit: 100001,
      });
      if (assignments.length > 100000) return fail('PEOPLE_TOO_MANY_RECORDS');
      const total = await c.repository('personnelAssignments').count({
        filter: { subjectId: row.subjectId, positionId: item.positionId },
      });
      if (total !== assignments.length) return fail('PEOPLE_INCOMPLETE_SCOPE');
      const actual = new Set(
        assignments
          .filter(
            (r) =>
              this.isCurrent(asRow(r), d.baselineDate) &&
              r.data &&
              (r.data as Record<string, unknown>).type === 'primary',
          )
          .map((r) => r.personId),
      ).size;
      const position = await c
        .repository('orgPositions')
        .findOne({ filter: { id: item.positionId } });
      items.push({
        ...item,
        baselineAssignmentIds: assignments
          .filter(
            (r) =>
              this.isCurrent(asRow(r), d.baselineDate) &&
              (r.data as Record<string, unknown>).type === 'primary',
          )
          .map((r) => scalar(r.id)),
        baseline: actual,
        positionName: position?.name ?? item.positionId,
      });
    }
    return { baselineDate: d.baselineDate, items };
  }
  private isCurrent(row: PeopleRow, on = this.businessDate()) {
    const d = row.data;
    return scalar(d.startDate) <= on && (!d.endDate || scalar(d.endDate) > on);
  }
  private async changeCode(c: DatabaseConnection) {
    const prefix = `CHG-${this.businessDate().replaceAll('-', '')}-`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 4).toUpperCase()}`;
      if (
        !(await c.repository('personnelChanges').exists({ filter: { code } }))
      )
        return code;
    }
    return fail('PEOPLE_CODE_EXISTS', 'code');
  }
  /**
   * The transaction types a person may start on a date, from their current
   * records. An unemployable person can only be onboarded; a person with one
   * active employment can transfer, regularize (until regularized), take a
   * secondary role, end it, or leave.
   */
  private async changeTypeChoices(
    c: DatabaseConnection,
    personId: string,
    on: string,
  ): Promise<ChangeData['type'][]> {
    const assignments = (
      await c
        .repository('personnelAssignments')
        .findMany({ filter: { personId }, limit: 10000 })
    ).map(asRow);
    const employments = (
      await c
        .repository('personnelEmployments')
        .findMany({ filter: { personId }, limit: 10000 })
    ).map(asRow);
    const current = assignments.filter((r) => this.isCurrent(r, on));
    const employed = employments.filter((r) => this.isCurrent(r, on));
    if (!employed.length && !current.length) return ['entry'];
    if (employed.length !== 1) return [];
    const types: ChangeData['type'][] = [];
    if (current.some((r) => r.data.type === 'primary')) types.push('transfer');
    if (!(employed[0].data as { regularizedAt?: string | null }).regularizedAt)
      types.push('regularize');
    types.push('partTime');
    if (current.some((r) => r.data.type === 'partTime'))
      types.push('endPartTime');
    types.push('exit');
    return types;
  }
  private async audit(
    c: DatabaseConnection,
    kind: PeopleKind,
    before: unknown,
    after: PeopleRow,
    actor: PeopleActor,
    reason: string,
    operation: string,
  ) {
    await c.repository('peopleAudit').createOne({
      values: {
        id: randomUUID(),
        kind,
        recordId: after.id,
        recordName: after.name,
        subjectId: after.subjectId,
        personId: after.personId,
        operation,
        actorId: actor.id,
        actorName: actor.name ?? actor.id,
        reason,
        beforeValue: before ? jsonObject(before) : null,
        afterValue: jsonObject(after),
        createdAt: new Date(),
      },
    });
  }
  async fire(
    kind: PeopleKind,
    id: string,
    input: {
      transition: string;
      version: number;
      requestId: string;
      reason: string;
      input?: JsonObject;
    },
    actor: PeopleActor,
    policies: PeoplePolicies,
  ) {
    if (!workflowKinds.includes(kind)) return fail('PEOPLE_INVALID_TRANSITION');
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const row = await this.repo(c, kind, policies).findOne({
        filter: { id },
      });
      if (!row) return fail('PEOPLE_NOT_FOUND');
      // A policy-bound no-op also checks update scope before the runtime's
      // trusted write. Approvers and initiators act with read-only access, so
      // the probe only runs when the role may update the record.
      if (policies[peopleTables[kind]]?.update !== false)
        await this.repo(c, kind, policies).updateOne({
          filter: { id },
          values: { name: row.name },
        });
      if (kind === 'changes' && input.transition === 'approve')
        await this.validateChangeScopes(c, asRow(row), policies);
      if (kind === 'workforcePlans' && input.transition === 'progress') {
        const tasks = z
          .array(workforceTaskResult)
          .min(1)
          .max(100)
          .parse(input.input?.taskResults);
        const plan = asRow(row).data as WorkforceData;
        this.unique(
          tasks.map((task) => task.positionId),
          'input.taskResults',
        );
        if (
          tasks.length !== plan.items.length ||
          tasks.some(
            (task) =>
              !plan.items.some((item) => item.positionId === task.positionId),
          )
        )
          return fail('PEOPLE_MODEL_MISMATCH', 'input.taskResults');
        for (const task of tasks) {
          const item = plan.items.find(
            (item) => item.positionId === task.positionId,
          )!;
          const baselineItem = (
            (row.snapshot as Record<string, unknown>)?.items as {
              positionId: string;
              baselineAssignmentIds?: string[];
            }[]
          ).find((v) => v.positionId === task.positionId);
          if (
            task.assignmentIds.some((id) =>
              baselineItem?.baselineAssignmentIds?.includes(id),
            )
          )
            return fail('PEOPLE_TASK_EVIDENCE', 'input.taskResults');
          this.unique(task.assignmentIds, 'input.taskResults');
          for (const assignmentId of task.assignmentIds) {
            const assignment = await this.accessible(
              c,
              'assignments',
              assignmentId,
              policies,
              'input.taskResults',
            );
            if (
              assignment.subjectId !== row.subjectId ||
              assignment.positionId !== task.positionId ||
              assignment.data.type !== 'primary' ||
              !this.isCurrent(assignment)
            )
              return fail('PEOPLE_INVALID_REFERENCE', 'input.taskResults');
          }
          if (task.status === 'completed' && !task.result)
            return fail('PEOPLE_REQUIRED', 'input.taskResults');
          const baseline =
            (
              (row.snapshot as Record<string, unknown>)?.items as {
                positionId: string;
                baseline: number;
              }[]
            ).find((v) => v.positionId === task.positionId)?.baseline ?? 0;
          const needed = Math.max(0, (item.approved ?? 0) - baseline);
          if (
            task.status === 'completed' &&
            item.approach !== 'develop' &&
            task.assignmentIds.length < needed
          )
            return fail('PEOPLE_TASK_EVIDENCE', 'input.taskResults');
          if (task.status === 'completed' && item.approach !== 'develop') {
            const actual = await this.repo(c, 'assignments', policies).findMany(
              {
                filter: {
                  subjectId: scalar(row.subjectId),
                  positionId: task.positionId,
                },
                limit: 100001,
              },
            );
            if (actual.length > 100000) return fail('PEOPLE_TOO_MANY_RECORDS');
            const count = new Set(
              actual
                .filter(
                  (a) =>
                    asRow(a).data.type === 'primary' &&
                    this.isCurrent(asRow(a)),
                )
                .map((a) => a.personId),
            ).size;
            if (count < (item.approved ?? 0))
              return fail('PEOPLE_TASK_EVIDENCE', 'input.taskResults');
          }
        }
      }
      await this.runtime.fire(peopleTables[kind], id, input.transition, {
        actor,
        manual: true,
        expect: { version: input.version },
        requestId: input.requestId,
        input: { ...input.input, reason: input.reason },
        transaction: c,
      });
      return this.getWithin(c, kind, id);
    });
  }
  /**
   * One approval on the current stage. The stage's last approver promotes the
   * next stage; the last stage advances the lifecycle as `approve` did.
   */
  async decide(
    kind: PeopleKind,
    id: string,
    input: {
      version: number;
      requestId: string;
      reason: string;
      input?: JsonObject;
    },
    actor: PeopleActor,
    policies: PeoplePolicies,
  ) {
    if (kind !== 'changes') return fail('PEOPLE_INVALID_TRANSITION');
    await this.db.transaction(async (c) => {
      await this.lock(c);
      const row = await this.repo(c, 'changes', policies).findOne({
        filter: { id },
      });
      if (!row) return fail('PEOPLE_NOT_FOUND');
      const reason = scalar(input.reason).trim();
      if (!reason) return fail('PEOPLE_REQUIRED', 'reason');
      if (Number(row.lifecycleVersion) !== input.version)
        return fail('PEOPLE_VERSION_CONFLICT');
      const pending = await this.approval.current(c, id);
      // Changes pending before approval chains existed carry no task and keep
      // the permission-only decision.
      if (!pending) {
        await this.validateChangeScopes(c, asRow(row), policies);
        await this.runtime.fire('personnelChanges', id, 'approve', {
          actor,
          manual: true,
          expect: { version: input.version },
          requestId: input.requestId,
          input: { reason, ...(input.input ?? {}) },
          transaction: c,
        });
        return;
      }
      const task = await this.approval.begin(c, id, actor),
        completed = this.approval.wouldComplete(task, actor.id);
      // The last approver of the last stage advances the lifecycle; the
      // transition hook records that decision together with the write.
      if (completed && !(await this.approval.hasNext(c, task))) {
        await this.validateChangeScopes(c, asRow(row), policies);
        await this.runtime.fire('personnelChanges', id, 'approve', {
          actor,
          manual: true,
          expect: { version: input.version },
          requestId: input.requestId,
          input: { reason, ...(input.input ?? {}) },
          transaction: c,
        });
        return;
      }
      const recorded = await this.approval.recordApproval(
        c,
        task,
        actor,
        reason,
      );
      if (recorded.completed) await this.approval.promote(c, task);
    });
    return this.get(kind, id, policies, actor);
  }
  async updateChecklistItem(
    id: string,
    itemId: string,
    input: { done: boolean; note?: string },
    actor: PeopleActor,
    policies: PeoplePolicies,
  ) {
    if (!policies[peopleTables.changes]) return fail('PEOPLE_FORBIDDEN');
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const row = await this.repo(c, 'changes', policies).findOne({
        filter: { id },
      });
      if (!row) return fail('PEOPLE_NOT_FOUND');
      const checklist = await this.checklist.set(c, id, itemId, input, actor);
      await this.audit(
        c,
        'changes',
        row,
        asRow(row),
        actor,
        input.note ?? '',
        'checklist',
      );
      return checklist;
    });
  }
  async approvalTodo(actor: PeopleActor, policies: PeoplePolicies) {
    return this.approval.todo(this.db.connection(), policies, actor);
  }
  async approvalPreview(
    type: string,
    subjectId: string,
    policies: PeoplePolicies,
  ) {
    if (!policies[peopleTables.changes]) return fail('PEOPLE_FORBIDDEN');
    const settings = await this.approval.settings(this.db.connection());
    const chains = settings.values.approvalChains as unknown as Record<
      string,
      {
        stages: {
          title: string;
          mode: 'any' | 'all';
          subjectIds: string[];
        }[];
      }
    >;
    const chain = chains[type];
    if (!chain) return { stages: [] };
    const stages: { title: string; mode: 'any' | 'all'; candidates: number }[] =
      [];
    for (const stage of chain.stages) {
      if (
        stage.subjectIds.length &&
        (!subjectId || !stage.subjectIds.includes(subjectId))
      )
        continue;
      const candidates = await this.approval.resolve(
        this.db.connection(),
        subjectId,
        stage as never,
        '',
      );
      stages.push({
        title: stage.title,
        mode: stage.mode,
        candidates: candidates.length,
      });
    }
    return { stages };
  }
  async approvalSettings() {
    // The parameter store reads through its own nested transaction.
    return this.db.transaction((c) => this.approval.settings(c));
  }
  async saveApprovalSettings(
    input: { values: JsonObject; version: number; requestId: string },
    actor: PeopleActor,
  ) {
    return this.db.transaction((c) => this.approval.save(c, input, actor));
  }
  /** Records a labour-contract end date without editing the immutable employment row. */
  async setContractEnd(
    id: string,
    input: {
      contractEnd: string | null;
      reason: string;
      version: number;
    },
    actor: PeopleActor,
    policies: PeoplePolicies,
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const row = await this.repo(c, 'employments', policies).findOne({
        filter: { id },
      });
      if (!row) return fail('PEOPLE_NOT_FOUND');
      if (Number(row.revision) !== input.version)
        return fail('PEOPLE_VERSION_CONFLICT');
      const reason = scalar(input.reason).trim();
      if (!reason) return fail('PEOPLE_REQUIRED', 'reason');
      const contractEnd = input.contractEnd || null;
      const startDate = scalar((row.data as JsonObject).startDate);
      if (contractEnd && startDate && contractEnd < startDate)
        return fail('PEOPLE_DATE_CONFLICT', 'contractEnd');
      const next = {
        ...row,
        data: { ...(row.data as JsonObject), contractEnd },
        revision: Number(row.revision) + 1,
        updatedAt: new Date(),
      };
      await c.repository(peopleTables.employments).updateOne({
        filter: { id },
        values: {
          data: next.data,
          revision: next.revision,
          updatedAt: next.updatedAt,
        },
      });
      await this.audit(
        c,
        'employments',
        asRow(row),
        next as unknown as PeopleRow,
        actor,
        reason,
        'contract',
      );
      return peopleView(next);
    });
  }
  /**
   * Active employments whose contract ends within the reminder window, oldest
   * first. Contracts without an end date (open-ended) never appear.
   */
  async contractExpiries(days: number, policies: PeoplePolicies) {
    const c = this.db.connection(),
      today = this.businessDate(),
      horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + days);
    const horizonDate = horizon.toISOString().slice(0, 10),
      day = (value: string) =>
        Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
    const rows = await this.repo(c, 'employments', policies).findMany({
      limit: 5000,
    });
    const items = rows
      .map((row) => asRow(row))
      .flatMap((row) => {
        const data = row.data as {
            startDate?: string;
            endDate?: string | null;
            contractEnd?: string | null;
          },
          contractEnd = scalar(data.contractEnd);
        if (!contractEnd || contractEnd > horizonDate) return [];
        if (scalar(data.startDate) > today) return [];
        const end = scalar(data.endDate);
        if (end && end < today) return [];
        return [
          {
            id: row.id,
            code: row.code,
            name: row.name,
            subjectId: row.subjectId,
            contractEnd,
            daysLeft: day(contractEnd) - day(today),
          },
        ];
      })
      .sort((a, b) => a.contractEnd.localeCompare(b.contractEnd));
    return {
      businessDate: today,
      days,
      items: items.slice(0, 20),
      total: items.length,
    };
  }
  private async getWithin(c: DatabaseConnection, kind: PeopleKind, id: string) {
    const row = await c
      .repository(peopleTables[kind])
      .findOne({ filter: { id } });
    if (!row) return fail('PEOPLE_NOT_FOUND');
    return peopleView(row);
  }
  private async validateChangeScopes(
    c: DatabaseConnection,
    row: PeopleRow,
    policies: PeoplePolicies,
  ) {
    const person = await this.accessible(
      c,
      'employees',
      row.personId!,
      policies,
      'personId',
    );
    for (const kind of ['employees', 'employments', 'assignments'] as const) {
      const rows = await this.repo(c, kind, policies).findMany({
        filter:
          kind === 'employees' ? { id: person.id } : { personId: person.id },
        limit: 1000,
      });
      const actual = await c.repository(peopleTables[kind]).count({
        filter:
          kind === 'employees' ? { id: person.id } : { personId: person.id },
      });
      if (rows.length !== actual) return fail('PEOPLE_FORBIDDEN');
      // An approver may hold read-only access; the write probes below only
      // prove update scope, which a decision does not need.
      if (policies[peopleTables[kind]]?.update === false) continue;
      for (const record of rows)
        await this.repo(c, kind, policies).updateOne({
          filter: { id: scalar(record.id) },
          values: { name: record.name },
        });
    }
    const d = row.data as ChangeData;
    if (d.targetSubjectId && policies.personnelAssignments?.create !== false) {
      const probe = {
        ...person,
        id: randomUUID(),
        code: `SCOPE-${randomUUID()}`,
        subjectId: d.targetSubjectId,
        personId: person.id,
        positionId: d.targetPositionId,
        data: {
          type: 'primary',
          startDate: d.effectiveDate,
          endDate: null,
          location: '',
        },
      };
      const created = await this.repo(c, 'assignments', policies).createOne({
        values: probe as RepositoryRecord,
      });
      if (
        !(await this.repo(c, 'assignments', policies).exists({
          filter: { id: scalar(created.record.id) },
        }))
      )
        return fail('PEOPLE_FORBIDDEN');
      await c
        .repository('personnelAssignments')
        .deleteOne({ filter: { id: scalar(created.record.id) } });
    }
  }
  private async allowed(
    c: DatabaseConnection,
    kind: PeopleKind,
    row: PeopleRow,
    actor: PeopleActor,
    transition: string,
  ) {
    if (transition === 'edit') return true;
    if (actor.system) return ['apply', 'supersede'].includes(transition);
    if (transition === 'companyConfirm') return actor.companyReview === true;
    if (kind === 'changes' && ['approve', 'return'].includes(transition)) {
      const task = await this.approval.current(c, scalar(row.id));
      // Rows submitted before approval chains existed keep the permission-only rule.
      if (!task) return actor.review === true;
      if (task.decisions.some((decision) => decision.actorId === actor.id))
        return false;
      // A stage nobody was assigned to stays open to reviewers, so a fresh
      // installation or an emptied role cannot deadlock a change.
      return task.candidates.length
        ? task.candidates.some((candidate) => candidate.id === actor.id)
        : actor.review === true;
    }
    if (kind === 'changes' && transition === 'withdraw') {
      if (row.createdBy !== actor.id) return false;
      const task = await this.approval.current(c, scalar(row.id));
      return !task || task.decisions.length === 0;
    }
    if (['approve', 'confirm', 'return'].includes(transition))
      return actor.review === true;
    if (
      kind === 'evaluations' &&
      ['selfAssess', 'managerAssess'].includes(transition)
    ) {
      if (actor.review) return true; // HR proxy entry remains explicitly attributed in snapshot.sources.
      const person = await c
        .repository('personnelEmployees')
        .findOne({ filter: { id: row.personId } });
      if (transition === 'selfAssess')
        return (
          (person?.data &&
            (person.data as Record<string, unknown>).accountId === actor.id) ||
          false
        );
      const primaries = await c
        .repository('personnelAssignments')
        .findMany({ filter: { personId: row.personId }, limit: 1000 });
      const current = primaries.find(
        (r) =>
          this.isCurrent(asRow(r)) &&
          (r.data as Record<string, unknown>).type === 'primary',
      );
      if (!current) return false;
      const position = await c
        .repository('orgPositions')
        .findOne({ filter: { id: scalar(current.positionId) } });
      if (!position?.reportsToId) return false;
      const managers = await c.repository('personnelAssignments').findMany({
        filter: { positionId: scalar(position.reportsToId) },
        limit: 1000,
      });
      for (const assignment of managers.filter((r) =>
        this.isCurrent(asRow(r)),
      )) {
        const manager = await c
          .repository('personnelEmployees')
          .findOne({ filter: { id: scalar(assignment.personId) } });
        if (
          (manager?.data as Record<string, unknown> | undefined)?.accountId ===
          actor.id
        )
          return true;
      }
      return false;
    }
    return row.createdBy === actor.id || actor.review === true;
  }
  private async prepare(
    c: DatabaseConnection,
    kind: PeopleKind,
    row: PeopleRow,
    input: JsonObject,
    transition: string,
    actor: PeopleActor,
  ) {
    if (transition === 'edit') return input.values as Record<string, unknown>;
    if (
      !scalar(input.reason ?? '').trim() &&
      !['apply', 'supersede'].includes(transition)
    )
      return fail('PEOPLE_REQUIRED', 'reason');
    if (
      kind === 'evaluations' &&
      ['selfAssess', 'managerAssess', 'confirm'].includes(transition)
    ) {
      const d = row.data as EvaluationData;
      const field =
        transition === 'selfAssess'
          ? 'selfScore'
          : transition === 'managerAssess'
            ? 'managerScore'
            : 'confirmedScore';
      const submitted = z
        .array(
          z.strictObject({
            dimensionId: z.string().uuid(),
            score: z.number().min(1).max(5).multipleOf(0.1).nullable(),
            evidence: z.string().trim().max(6000),
          }),
        )
        .min(1)
        .max(24)
        .parse(input.ratings);
      this.unique(
        submitted.map((v) => v.dimensionId),
        'input.ratings',
      );
      if (
        submitted.length !== d.ratings.length ||
        submitted.some(
          (v) => !d.ratings.some((r) => r.dimensionId === v.dimensionId),
        )
      )
        return fail('PEOPLE_MODEL_MISMATCH', 'input.ratings');
      if (!submitted.some((v) => v.score !== null))
        return fail('PEOPLE_REQUIRED', 'input.ratings');
      if (submitted.some((v) => v.score !== null && !v.evidence))
        return fail('PEOPLE_REQUIRED', 'input.ratings');
      const ratings = d.ratings.map((r) => {
        const value = submitted.find((v) => v.dimensionId === r.dimensionId)!;
        return {
          ...r,
          [field]: value.score,
          [`${field}Evidence`]: value.evidence,
          [`${field}Actor`]: actor.id,
        };
      });
      const sources: unknown[] = Array.isArray(row.snapshot?.sources)
        ? (row.snapshot.sources as unknown[])
        : [];
      return {
        data: { ...d, ratings },
        snapshot: {
          ...row.snapshot,
          sources: [
            ...sources,
            {
              stage: transition,
              actorId: actor.id,
              proxy: actor.review === true,
              at: new Date().toISOString(),
              reason: input.reason,
            },
          ],
        },
      };
    }
    if (kind === 'evaluations' && transition === 'return') {
      const d = row.data as EvaluationData;
      // Returned evaluations retain the rejected submission in audit; a new pass starts with no stale scores.
      return {
        data: {
          ...d,
          ratings: d.ratings.map((r) => ({
            dimensionId: r.dimensionId,
            selfScore: null,
            managerScore: null,
            confirmedScore: null,
            evidence: '',
          })),
        },
      };
    }
    if (
      kind === 'developmentPlans' &&
      ['progress', 'complete'].includes(transition)
    ) {
      const values = z
        .strictObject({
          progress: z.string().trim().max(6000).default(''),
          result: z.string().trim().max(6000).default(''),
        })
        .parse({ progress: input.progress ?? '', result: input.result ?? '' });
      if (transition === 'complete' && !values.result)
        return fail('PEOPLE_REQUIRED', 'input.result');
      return { data: { ...row.data, ...values } };
    }
    if (kind === 'workforcePlans' && transition === 'approve') {
      const d = row.data as WorkforceData;
      if (d.items.some((item) => !item.owner.trim()))
        return fail('PEOPLE_REQUIRED', 'data.items');
      const items = z
        .array(
          z.strictObject({
            positionId: z.string().uuid(),
            approved: z.number().int().min(0).max(100000),
          }),
        )
        .min(1)
        .max(100)
        .parse(input.items);
      this.unique(
        items.map((v) => v.positionId),
        'input.items',
      );
      if (
        items.length !== d.items.length ||
        items.some((v) => !d.items.some((r) => r.positionId === v.positionId))
      )
        return fail('PEOPLE_MODEL_MISMATCH', 'input.items');
      const existing = await c.repository('hrWorkforcePlans').findMany({
        filter: { subjectId: row.subjectId, status: 'approved' },
        limit: 10000,
      });
      const same = existing.filter(
        (r) => (r.data as WorkforceData).period === d.period,
      );
      if (same.length && (same.length !== 1 || same[0].id !== d.previousId))
        return fail('PEOPLE_PLAN_EXISTS', 'data.previousId');
      const approved = d.items.map((item) => ({
        ...item,
        approved: items.find((v) => v.positionId === item.positionId)!.approved,
      }));
      return {
        data: { ...d, items: approved },
        snapshot: {
          ...row.snapshot,
          approvedAt: new Date().toISOString(),
          approvedBy: actor.id,
          approvedItems: approved,
        },
      };
    }
    if (kind === 'workforcePlans' && transition === 'progress')
      return {
        data: {
          ...row.data,
          progress: z.string().trim().min(1).max(6000).parse(input.progress),
          taskResults: z
            .array(workforceTaskResult)
            .min(1)
            .max(100)
            .parse(input.taskResults),
        },
      };
    if (kind === 'changes' && transition === 'submit')
      return { reviewRound: Number(row.reviewRound ?? 0) + 1 };
    if (kind === 'changes' && transition === 'apply') {
      if ((row.data as ChangeData).effectiveDate > this.businessDate())
        return fail('PEOPLE_NOT_DUE');
    }
    return {};
  }
  private async transitioned(
    c: DatabaseConnection,
    context: PeopleWorkflowContext,
    kind: PeopleKind,
  ) {
    const { record, previous, entry, actor, input, tx } = context;
    if (kind === 'changes' && entry.transition === 'submit') {
      const row = asRow(record),
        d = row.data as ChangeData;
      if (
        !(
          await this.changeTypeChoices(c, scalar(row.personId), d.effectiveDate)
        ).includes(d.type)
      )
        return fail('PEOPLE_CHANGE_TYPE_CONFLICT', 'data.type');
      await this.checklist.ensure(
        c,
        scalar(row.id),
        scalar(row.personId),
        await this.approval.checklistTemplates(c, d.type),
      );
      await this.approval.submit(
        c,
        asRow(record),
        parseApprovalChains(
          context.parameters.approvalChains,
        ) as unknown as ApprovalChains,
      );
    }
    if (kind === 'changes' && entry.transition === 'approve')
      await this.approval.completeCurrent(
        c,
        asRow(record),
        actor,
        scalar(input.reason),
      );
    if (kind === 'changes' && entry.transition === 'return')
      await this.approval.close(
        c,
        scalar(record.id),
        'returned',
        actor,
        scalar(input.reason),
      );
    if (kind === 'changes' && entry.transition === 'withdraw')
      await this.approval.close(
        c,
        scalar(record.id),
        'withdrawn',
        actor,
        scalar(input.reason),
      );
    if (kind === 'changes' && entry.transition === 'cancel')
      await this.approval.close(
        c,
        scalar(record.id),
        'cancelled',
        actor,
        scalar(input.reason),
      );
    await this.audit(
      c,
      kind,
      previous,
      record,
      actor,
      scalar(input.reason ?? entry.transition),
      entry.transition,
    );
    if (
      kind === 'changes' &&
      entry.transition === 'approve' &&
      (record.data as ChangeData).effectiveDate <= this.businessDate()
    ) {
      await tx.fire('personnelChanges', record.id, 'apply', {
        actor: SYSTEM_ACTOR,
        input: { reason: 'approved and due' },
        requestId: `apply-${record.id}`,
      });
    }
    if (kind === 'changes' && entry.transition === 'apply')
      await this.applyChange(c, record, actor);
    if (
      kind === 'workforcePlans' &&
      entry.transition === 'approve' &&
      (record.data as WorkforceData).previousId
    )
      await tx.fire(
        'hrWorkforcePlans',
        (record.data as WorkforceData).previousId!,
        'supersede',
        {
          actor: SYSTEM_ACTOR,
          input: { reason: `superseded by ${record.code}` },
          requestId: `superseded-${record.id}`,
        },
      );
  }
  /**
   * A departure is an account lifecycle event, not just an assignment end.
   * Disable the sign-in account, invalidate its sessions, drop removable direct
   * Permission Sets, and release the employee's account binding so a rehire can
   * bind an account again. Protected sets are left in place: disabling the
   * account already removes its ability to act, and removing the last admin
   * assignment would lock the application out.
   */
  private async deactivateAccount(c: DatabaseConnection, person: PeopleRow) {
    const accountId = scalar(person.accountId);
    if (!accountId) return;
    const permissionSets = this.permissionSets.withTransaction(c);
    const assignments = await permissionSets.listAssignments();
    for (const assignment of assignments) {
      if (
        assignment.subject.type !== 'user' ||
        assignment.subject.id !== accountId
      )
        continue;
      const protection = permissionSets.protection(assignment.permissionSet);
      if (protection?.unrestricted || protection?.requireActiveAssignment)
        continue;
      try {
        await permissionSets.revoke(assignment.id);
      } catch (error) {
        if (!(error instanceof PermissionSetLastAssignmentError)) throw error;
      }
    }
    const users = this.users.withConnection(c);
    if (await users.get(accountId)) await users.disable(accountId);
  }
  private async closeEmployee(
    c: DatabaseConnection,
    person: PeopleRow,
    actor: PeopleActor,
    reason: string,
  ) {
    await this.deactivateAccount(c, person);
    const data = {
      ...person.data,
      accountId: null,
    };
    const next = {
      ...person,
      status: 'inactive',
      statusChangedAt: new Date(),
      accountId: null,
      data,
      revision: person.revision + 1,
      updatedAt: new Date(),
    };
    const updated = await c.repository('personnelEmployees').updateOne({
      filter: { id: person.id, revision: person.revision },
      values: {
        status: next.status,
        statusChangedAt: next.statusChangedAt,
        accountId: null,
        data: next.data,
        revision: next.revision,
        updatedAt: next.updatedAt,
      },
    });
    if (!updated) return fail('PEOPLE_VERSION_CONFLICT');
    await this.audit(c, 'employees', person, next, actor, reason, 'exit');
  }
  private async applyChange(
    c: DatabaseConnection,
    row: PeopleRow,
    actor: PeopleActor,
  ) {
    const d = row.data as ChangeData;
    const person = asRow(
      await c
        .repository('personnelEmployees')
        .findOne({ filter: { id: row.personId } }),
    );
    if (!person || person.status !== 'active')
      return fail('PEOPLE_INVALID_REFERENCE', 'personId');
    if (d.targetPositionId) {
      const position = await this.active(
        c,
        'orgPositions',
        d.targetPositionId,
        'data.targetPositionId',
      );
      const unit = await this.active(
        c,
        'orgUnits',
        scalar(position.unitId),
        'data.targetPositionId',
      );
      if (unit.subjectId !== d.targetSubjectId)
        return fail('PEOPLE_COMPANY_MISMATCH');
      await this.active(
        c,
        'orgSubjects',
        scalar(unit.subjectId),
        'data.targetSubjectId',
      );
    }
    const assignments = (
      await c
        .repository('personnelAssignments')
        .findMany({ filter: { personId: row.personId }, limit: 10000 })
    ).map(asRow);
    const employments = (
      await c
        .repository('personnelEmployments')
        .findMany({ filter: { personId: row.personId }, limit: 10000 })
    ).map(asRow);
    const currentAssignments = assignments.filter((r) =>
      this.isCurrent(r, d.effectiveDate),
    );
    const currentEmployment = employments.filter((r) =>
      this.isCurrent(r, d.effectiveDate),
    );
    const primary = currentAssignments.find((r) => r.data.type === 'primary');
    if (
      d.type === 'entry' &&
      (currentEmployment.length || currentAssignments.length)
    )
      return fail('PEOPLE_ASSIGNMENT_CONFLICT');
    if (d.type === 'transfer' && (!primary || currentEmployment.length !== 1))
      return fail('PEOPLE_NO_EMPLOYMENT');
    if (
      ['exit', 'regularize', 'partTime'].includes(d.type) &&
      currentEmployment.length !== 1
    )
      return fail('PEOPLE_NO_EMPLOYMENT');
    if (
      d.type === 'partTime' &&
      currentAssignments.some((r) => r.positionId === d.targetPositionId)
    )
      return fail('PEOPLE_ASSIGNMENT_CONFLICT');
    if (
      d.type === 'transfer' &&
      currentAssignments.some(
        (r) => r.positionId === d.targetPositionId && r.id !== primary?.id,
      )
    )
      return fail('PEOPLE_ASSIGNMENT_CONFLICT');
    const close = async (kind: PeopleKind, record: PeopleRow) => {
      const next = {
        ...record,
        data: { ...record.data, endDate: d.effectiveDate },
        revision: record.revision + 1,
        updatedAt: new Date(),
      };
      await c.repository(peopleTables[kind]).updateOne({
        filter: { id: record.id },
        values: {
          data: next.data,
          revision: next.revision,
          updatedAt: next.updatedAt,
        },
      });
      await this.audit(
        c,
        kind,
        record,
        next,
        actor,
        `change ${row.code}`,
        'end',
      );
    };
    const create = async (
      kind: PeopleKind,
      data: Record<string, unknown>,
      positionId: string | null,
    ) => {
      const subject = await c
        .repository('orgSubjects')
        .findOne({ filter: { id: d.targetSubjectId } });
      const position = positionId
        ? await c
            .repository('orgPositions')
            .findOne({ filter: { id: positionId } })
        : null;
      const unit = position
        ? await c
            .repository('orgUnits')
            .findOne({ filter: { id: scalar(position.unitId) } })
        : null;
      const next = {
        id: randomUUID(),
        code: `${kind === 'assignments' ? 'ASG' : 'EMP'}-${randomUUID().slice(0, 18).toUpperCase()}`,
        name: person.name,
        personId: person.id,
        subjectId: d.targetSubjectId,
        positionId,
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: row.createdBy,
        data,
        createdAt: new Date(),
        updatedAt: new Date(),
        snapshot: {
          changeId: row.id,
          personName: person.name,
          subjectName: subject?.name ?? null,
          positionName: position?.name ?? null,
          unitName: unit?.name ?? null,
        },
      };
      await c
        .repository(peopleTables[kind])
        .createOne({ values: next as RepositoryRecord });
      await this.audit(
        c,
        kind,
        null,
        next,
        actor,
        `change ${row.code}`,
        'create',
      );
    };
    if (d.type === 'entry' || (d.type === 'transfer' && d.changeEmployer)) {
      if (d.type === 'transfer')
        for (const employment of currentEmployment)
          await close('employments', employment);
      await create(
        'employments',
        {
          type: d.employmentType,
          startDate: d.effectiveDate,
          endDate: null,
          probationEnd: d.probationEnd,
          contractEnd: d.contractEnd,
        },
        null,
      );
      await c.repository('personnelEmployees').updateOne({
        filter: { id: person.id },
        values: {
          subjectId: d.targetSubjectId,
          revision: person.revision + 1,
          updatedAt: new Date(),
        },
      });
      const profile = await c
        .repository('hrProfiles')
        .findOne({ filter: { personId: person.id } });
      if (profile) {
        const next = {
          ...profile,
          subjectId: d.targetSubjectId,
          revision: Number(profile.revision) + 1,
          updatedAt: new Date(),
        };
        await c.repository('hrProfiles').updateOne({
          filter: { id: scalar(profile.id) },
          values: {
            subjectId: d.targetSubjectId,
            revision: next.revision,
            updatedAt: next.updatedAt,
          },
        });
        await this.audit(
          c,
          'profiles',
          profile,
          next as unknown as PeopleRow,
          actor,
          `change ${row.code}`,
          'scopeChanged',
        );
      }
      // Current personal-contact scope follows the employing company, while audit preserves its old scope.
      if (
        await c
          .repository('personnelPrivate')
          .exists({ filter: { id: person.id } })
      )
        await c.repository('personnelPrivate').updateOne({
          filter: { id: person.id },
          values: { subjectId: d.targetSubjectId },
        });
    }
    if (d.type === 'transfer') await close('assignments', primary!);
    if (['entry', 'transfer', 'partTime'].includes(d.type))
      await create(
        'assignments',
        {
          type: d.type === 'partTime' ? 'partTime' : 'primary',
          startDate: d.effectiveDate,
          endDate: null,
          location: d.location,
        },
        d.targetPositionId,
      );
    if (d.type === 'endPartTime') {
      const assignment = currentAssignments.find(
        (r) => r.id === d.assignmentId && r.data.type === 'partTime',
      );
      if (!assignment)
        return fail('PEOPLE_INVALID_REFERENCE', 'data.assignmentId');
      await close('assignments', assignment);
    }
    if (d.type === 'exit') {
      const outstandingAssets = await c.repository('assets').count({
        filter: { custodianEmployeeId: person.id, status: 'assigned' },
      });
      if (outstandingAssets > 0) return fail('PEOPLE_ASSETS_OUTSTANDING');
      for (const record of currentAssignments)
        await close('assignments', record);
      for (const record of currentEmployment)
        await close('employments', record);
      await this.closeEmployee(c, person, actor, `change ${row.code}`);
      const card = await c
        .repository('hrProfiles')
        .findOne({ filter: { personId: person.id } });
      if (card && card.status !== 'inactive') {
        const next = {
          ...card,
          status: 'inactive',
          revision: Number(card.revision) + 1,
          updatedAt: new Date(),
        };
        await c.repository('hrProfiles').updateOne({
          filter: { id: scalar(card.id) },
          values: {
            status: next.status,
            revision: next.revision,
            updatedAt: next.updatedAt,
          },
        });
        await this.audit(
          c,
          'profiles',
          card,
          next as unknown as PeopleRow,
          actor,
          `change ${row.code}`,
          'exit',
        );
      }
    }
    if (d.type === 'regularize') {
      const employment = currentEmployment[0];
      const next = {
        ...employment,
        data: {
          ...employment.data,
          probationEnd: d.effectiveDate,
          regularizedAt: d.effectiveDate,
        },
        revision: employment.revision + 1,
        updatedAt: new Date(),
      };
      await c.repository('personnelEmployments').updateOne({
        filter: { id: employment.id },
        values: {
          data: next.data,
          revision: next.revision,
          updatedAt: next.updatedAt,
        },
      });
      await this.audit(
        c,
        'employments',
        employment,
        next,
        actor,
        `change ${row.code}`,
        'regularize',
      );
    }
    const accountId = scalar(person.accountId);
    if (accountId) await syncAccountPositionPermissions(c, accountId);
  }

  async applyDue() {
    const failures: { id: string; reason: string }[] = [];
    const rows = await this.db
      .repository('personnelChanges')
      .findMany({ filter: { status: 'approved' }, limit: 1000 });
    for (const raw of rows) {
      const row = asRow(raw);
      if ((row.data as ChangeData).effectiveDate > this.businessDate())
        continue;
      try {
        await this.db.transaction(async (c) => {
          await this.lock(c);
          await this.runtime.fire('personnelChanges', row.id, 'apply', {
            actor: SYSTEM_ACTOR,
            input: { reason: 'scheduled effective date' },
            requestId: `apply-${row.id}`,
            transaction: c,
          });
        });
      } catch (error) {
        failures.push({
          id: row.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    return failures;
  }
  /** Lifecycle phase shown on the talent card; distinct from the card's own on/off status. */
  private async talentPhase(c: DatabaseConnection, person: PeopleRow) {
    const rows = (
        await c
          .repository(peopleTables.employments)
          .findMany({ filter: { personId: scalar(person.id) }, limit: 100 })
      ).map(asRow),
      today = this.businessDate();
    if (scalar(person.status) !== 'active') {
      const ended = rows
        .map((row) => {
          const end = (row.data as { endDate?: unknown }).endDate;
          return typeof end === 'string' ? end : null;
        })
        .filter((end): end is string => Boolean(end))
        .sort()
        .at(-1);
      return { phase: 'departed' as const, since: ended ?? null };
    }
    const current = rows.find((row) => this.isCurrent(row));
    if (!current) return { phase: 'pending' as const, since: null };
    const data = current.data as {
        startDate?: string;
        probationEnd?: string | null;
        regularizedAt?: string | null;
      },
      probationEnd =
        typeof data.probationEnd === 'string' ? data.probationEnd : null;
    if (data.regularizedAt || !probationEnd)
      return {
        phase: 'regular' as const,
        since: data.startDate ?? null,
        probationEnd,
      };
    return {
      phase: probationEnd > today ? ('probation' as const) : ('due' as const),
      since: data.startDate ?? null,
      probationEnd,
    };
  }
  async talent(personId: string, policies: PeoplePolicies, actor: PeopleActor) {
    const c = this.db.connection();
    const person = await this.accessible(
      c,
      'employees',
      personId,
      policies,
      'personId',
    );
    const related: Record<string, unknown> = {};
    for (const kind of [
      'profiles',
      'employments',
      'assignments',
      'evaluations',
      'developmentPlans',
    ] as const) {
      const repo = this.repo(c, kind, policies);
      const [rows, total] = await Promise.all([
        repo.findMany({
          filter: { personId },
          limit: 100,
          sort: (s) => s.field('updatedAt').desc(),
        }),
        repo.count({ filter: { personId } }),
      ]);
      related[kind] = {
        rows: rows.map(peopleView),
        total,
        truncated: total > rows.length,
      };
    }
    const photo = person.data.photoId
      ? await c
          .repository('peopleFiles')
          .findOne({ filter: { id: scalar(person.data.photoId) } })
      : null;
    return {
      person: peopleView(person),
      phase: await this.talentPhase(c, person),
      ...related,
      options: await this.options('profiles', policies),
      viewerId: actor.id,
      asOf: this.businessDate(),
      photo: photo ? { id: scalar(photo.id), ext: scalar(photo.ext) } : null,
    };
  }
  async career(personId: string, policies: PeoplePolicies) {
    const c = this.db.connection();
    const person = await this.accessible(
      c,
      'employees',
      personId,
      policies,
      'personId',
    );
    const sortText = (value: unknown): string =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
    const sortTime = (value: unknown): number => {
      const parsed = new Date(sortText(value)).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    const section = async (kind: 'employments' | 'assignments' | 'changes') => {
      if (!policies[peopleTables[kind]])
        return { rows: [], total: 0, truncated: false };
      const repo = this.repo(c, kind, policies);
      const [records, total] = await Promise.all([
        repo.findMany({
          filter: { personId },
          limit: 500,
          sort: (s) => s.field('createdAt').desc(),
        }),
        repo.count({ filter: { personId } }),
      ]);
      const key = kind === 'changes' ? 'effectiveDate' : 'startDate';
      const rows = records.map(peopleView).sort((a, b) => {
        const dataOf = (row: typeof a) =>
          (row as { data?: Record<string, unknown> }).data ?? {};
        const left = dataOf(a),
          right = dataOf(b);
        return (
          sortText(left[key]).localeCompare(sortText(right[key])) ||
          sortText(a.createdAt).localeCompare(sortText(b.createdAt))
        );
      });
      return { rows, total, truncated: total > records.length };
    };
    const [employments, assignments, changes] = await Promise.all([
      section('employments'),
      section('assignments'),
      section('changes'),
    ]);
    let audits = null;
    if (policies.peopleAudit) {
      const repo = c.repository('peopleAudit').withPolicy(policies.peopleAudit);
      const [records, total] = await Promise.all([
        repo.findMany({
          filter: { personId },
          limit: 500,
          sort: (s) => s.field('createdAt').desc(),
        }),
        repo.count({ filter: { personId } }),
      ]);
      const rows = [...records].sort(
        (a, b) => sortTime(a.createdAt) - sortTime(b.createdAt),
      );
      audits = { rows, total, truncated: total > records.length };
    }
    return {
      person: peopleView(person),
      asOf: this.businessDate(),
      employments,
      assignments,
      changes,
      audits,
    };
  }
  async overview(policies: PeoplePolicies) {
    const c = this.db.connection();
    const counts: Record<string, number> = {};
    for (const kind of [
      'employees',
      'profiles',
      'evaluations',
      'developmentPlans',
      'workforcePlans',
    ] as const)
      if (policies[peopleTables[kind]])
        counts[kind] = await this.repo(c, kind, policies).count({
          filter: (f) =>
            kind === 'evaluations'
              ? f.string('status').eq('confirmed')
              : kind === 'developmentPlans'
                ? f.or([
                    f.string('status').eq('draft'),
                    f.string('status').eq('active'),
                  ])
                : kind === 'workforcePlans'
                  ? f.or(
                      ['draft', 'companyConfirmed', 'pending'].map((status) =>
                        f.string('status').eq(status),
                      ),
                    )
                  : f.string('status').eq('active'),
        });
    const assignments = await this.repo(c, 'assignments', policies).findMany({
      limit: 100001,
    });
    if (assignments.length > 100000) return fail('PEOPLE_TOO_MANY_RECORDS');
    const current = assignments.filter((r) => this.isCurrent(asRow(r)));
    counts.activePeople = new Set(current.map((r) => r.personId)).size;
    counts.partTime = current.filter(
      (r) => (r.data as Record<string, unknown>).type === 'partTime',
    ).length;
    const company: Record<string, { primary: Set<string>; partTime: number }> =
      {};
    for (const r of current) {
      const key = scalar(r.subjectId);
      company[key] ??= { primary: new Set(), partTime: 0 };
      if ((r.data as Record<string, unknown>).type === 'primary')
        company[key].primary.add(scalar(r.personId));
      else company[key].partTime++;
    }
    return {
      counts,
      companies: Object.entries(company).map(([subjectId, v]) => ({
        subjectId,
        primary: v.primary.size,
        partTime: v.partTime,
      })),
      asOf: this.businessDate(),
    };
  }
  async history(q: PeopleQuery, policies: PeoplePolicies) {
    if (!policies.peopleAudit) return fail('PEOPLE_FORBIDDEN');
    const repo = this.db
      .repository('peopleAudit')
      .withPolicy(policies.peopleAudit);
    const filter = (f: FilterBuilder) =>
      f.and([
        ...(q.kind ? [f.string('kind').eq(q.kind)] : []),
        ...(q.recordId ? [f.string('recordId').eq(q.recordId)] : []),
        ...(q.subjectId ? [f.string('subjectId').eq(q.subjectId)] : []),
        ...(q.q
          ? [f.string('recordName').includes(q.q, { mode: 'insensitive' })]
          : []),
      ]);
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter,
        limit: q.pageSize,
        offset: (q.page - 1) * q.pageSize,
        sort: (s) => s.field('createdAt').desc(),
      }),
      repo.count({ filter }),
    ]);
    return { data: rows, meta: { page: q.page, pageSize: q.pageSize, total } };
  }
  async contacts(
    id: string,
    policies: PeoplePolicies,
    values?: { phone: string; email: string },
    actor?: PeopleActor,
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const found = await this.repo(c, 'employees', policies).findOne({
        filter: { id },
      });
      if (!found) return fail('PEOPLE_NOT_FOUND');
      const person = asRow(found);
      if (!values)
        return (
          (await c
            .repository('personnelPrivate')
            .findOne({ filter: { id } })) ?? { phone: '', email: '' }
        );
      const previous = await c
        .repository('personnelPrivate')
        .findOne({ filter: { id } });
      if (previous)
        await c
          .repository('personnelPrivate')
          .updateOne({ filter: { id }, values: { ...values } });
      else
        await c.repository('personnelPrivate').createOne({
          values: { id, subjectId: person.subjectId, ...values },
        });
      // Do not copy contact values into a broader audit permission surface.
      await this.audit(
        c,
        'employees',
        null,
        person,
        actor!,
        'contact information updated',
        'contacts',
      );
      return values;
    });
  }
}
