import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { PermissionSetsApi } from '@nocobase/authorization/permission-sets';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import {
  ParameterConfigurationError,
  StoredLifecycleParameters,
  createRepositoryLifecycleStore,
  normalizeParameterValues,
  type JsonObject,
  type JsonValue,
  type ParameterGroup,
} from '@nocobase/lifecycle';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { businessDate } from './business-date.js';
import { issueParameterCollections } from './issue-request-workflow.js';
import {
  peopleFail,
  peopleView,
  scalar,
  type PeopleActor,
  type PeopleRow,
} from './people-model.js';

/** The change type whose chain a submission follows. */
export const approvalChangeTypes = [
  'entry',
  'transfer',
  'partTime',
  'endPartTime',
  'exit',
  'regularize',
] as const;
export type ApprovalChangeType = (typeof approvalChangeTypes)[number];
/** The permission-set title is stored JSON-encoded; the editor shows the text. */
function roleTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
    // Translation descriptors are resolved by the client against its own
    // catalog; the settings picker falls back to the permission-set key.
    if (parsed && typeof parsed === 'object' && 'key' in parsed) return '';
  } catch {
    // A plain title that was never encoded.
  }
  return value;
}
/** One administrator-selectable source of approvers. `role` is a permission-set key. */
export const approvalSelectionTypes = ['role', 'user', 'position'] as const;
export type ApprovalSelectionType = (typeof approvalSelectionTypes)[number];
export type ApprovalSelection = {
  type: ApprovalSelectionType;
  referenceId: string;
};
export type ApprovalStage = {
  key: string;
  title: string;
  mode: 'any' | 'all';
  selections: ApprovalSelection[];
  /** Empty: the stage applies to every company. */
  subjectIds: string[];
};
export type ApprovalChains = Record<
  ApprovalChangeType,
  { stages: ApprovalStage[] }
>;

const approvalSelectionSchema = z.strictObject({
  type: z.enum(approvalSelectionTypes),
  referenceId: z.string().trim().min(1).max(200),
});
const approvalStageSchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(100),
  mode: z.enum(['any', 'all']),
  selections: z.array(approvalSelectionSchema).min(1).max(10),
  subjectIds: z.array(z.string().uuid()).max(100).default([]),
});
const approvalChainSchema = z.strictObject({
  stages: z.array(approvalStageSchema).min(1).max(5),
});
const approvalChainsSchema = z
  .strictObject({
    entry: approvalChainSchema,
    transfer: approvalChainSchema,
    partTime: approvalChainSchema,
    endPartTime: approvalChainSchema,
    exit: approvalChainSchema,
    regularize: approvalChainSchema,
  })
  .superRefine((chains, ctx) => {
    for (const type of approvalChangeTypes) {
      const keys = chains[type].stages.map((stage) => stage.key);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: 'custom',
          path: [type],
          message: '同一条审批链内的节点标识不能重复。',
        });
    }
  });
export type ParsedApprovalChains = z.infer<typeof approvalChainsSchema>;

/**
 * A fresh copy of the default chain: every change type goes through one
 * 人事复核 stage held by the built-in `personnel-reviewer` permission set.
 * Copies matter because administrators may edit the stored version.
 */
export function defaultApprovalChains(): ApprovalChains {
  return Object.fromEntries(
    approvalChangeTypes.map((type) => [
      type,
      {
        stages: [
          {
            key: 'hr-review',
            title: '人事复核',
            mode: 'any' as const,
            selections: [
              { type: 'role' as const, referenceId: 'personnel-reviewer' },
            ],
            subjectIds: [],
          },
        ],
      },
    ]),
  ) as unknown as ApprovalChains;
}
export const approvalChainsDefaults = defaultApprovalChains();

/**
 * Validates and normalizes the complete chain object. A missing type keeps
 * the default chain so an older client cannot silently strip a type.
 */
export function parseApprovalChains(value: unknown): JsonValue {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const merged = Object.fromEntries(
    approvalChangeTypes.map((type) => [
      type,
      input[type] ?? approvalChainsDefaults[type],
    ]),
  );
  const parsed = approvalChainsSchema.safeParse(merged);
  if (!parsed.success)
    throw new ParameterConfigurationError(
      'CONFIGURATION_INVALID',
      parsed.error.issues.map((issue) => issue.message).join('；'),
    );
  return parsed.data;
}

export type ChecklistTemplate = {
  key: string;
  title: string;
  owner: string;
  /** Expand into one row per asset the employee still holds. */
  assets?: boolean;
};
export type ChecklistTemplates = Record<
  ApprovalChangeType,
  ChecklistTemplate[]
>;
const checklistItemSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(100),
  owner: z.string().trim().max(30).default(''),
  assets: z.boolean().default(false),
});
const checklistTemplatesSchema = z
  .strictObject({
    entry: z.array(checklistItemSchema).max(20),
    transfer: z.array(checklistItemSchema).max(20),
    partTime: z.array(checklistItemSchema).max(20),
    endPartTime: z.array(checklistItemSchema).max(20),
    exit: z.array(checklistItemSchema).max(20),
    regularize: z.array(checklistItemSchema).max(20),
  })
  .superRefine((templates, ctx) => {
    for (const type of approvalChangeTypes) {
      const keys = templates[type].map((item) => item.key);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: 'custom',
          path: [type],
          message: '同一类型的清单事项标识不能重复。',
        });
    }
  });

/** The default onboarding/offboarding work each transaction type starts with. */
export function defaultChecklists(): ChecklistTemplates {
  return {
    entry: [
      { key: 'entry-pickup', title: '领取办公物品与设备', owner: '行政' },
      { key: 'entry-accounts', title: '开通账号与系统权限', owner: 'IT' },
      { key: 'entry-onboarding', title: '工作对接与入职引导', owner: '用人部门' },
      { key: 'entry-contract', title: '签署劳动合同', owner: '人事' },
    ],
    transfer: [
      { key: 'transfer-handover', title: '原岗位工作交接', owner: '原部门' },
      { key: 'transfer-role', title: '新岗位职责与目标确认', owner: '新部门' },
      { key: 'transfer-access', title: '系统权限调整', owner: 'IT' },
    ],
    partTime: [
      { key: 'parttime-agreement', title: '签署兼职协议', owner: '人事' },
      { key: 'parttime-plan', title: '兼职工作安排确认', owner: '用人部门' },
    ],
    endPartTime: [
      { key: 'endparttime-handover', title: '兼职工作交接', owner: '用人部门' },
      { key: 'endparttime-access', title: '收回兼职权限', owner: 'IT' },
    ],
    exit: [
      { key: 'exit-handover', title: '工作交接', owner: '用人部门' },
      {
        key: 'exit-assets',
        title: '归还公司资产',
        owner: '行政',
        assets: true,
      },
      { key: 'exit-access', title: '账号与系统权限回收', owner: 'IT' },
      { key: 'exit-settlement', title: '最后一笔工资与补偿结算', owner: '财务' },
      { key: 'exit-social', title: '社保与公积金减员', owner: '人事' },
      { key: 'exit-certificate', title: '开具离职证明', owner: '人事' },
    ],
    regularize: [
      { key: 'regularize-review', title: '转正评估与面谈', owner: '用人部门' },
      { key: 'regularize-paperwork', title: '转正手续与合同变更', owner: '人事' },
    ],
  };
}
export const checklistsDefaults = defaultChecklists();

/**
 * Validates and normalizes the checklist templates. A type that is missing
 * keeps its default, while an explicitly empty list disables that checklist.
 */
export function parseChecklists(value: unknown): JsonValue {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const merged = Object.fromEntries(
    approvalChangeTypes.map((type) => [
      type,
      input[type] === undefined ? checklistsDefaults[type] : input[type],
    ]),
  );
  const parsed = checklistTemplatesSchema.safeParse(merged);
  if (!parsed.success)
    throw new ParameterConfigurationError(
      'CONFIGURATION_INVALID',
      parsed.error.issues.map((issue) => issue.message).join('；'),
    );
  return parsed.data;
}

export const PEOPLE_APPROVAL_SCOPE = 'people:group';
export const PEOPLE_APPROVAL_TABLE = 'peopleApprovalTasks';
export const peopleApprovalGroup: ParameterGroup = {
  key: 'personnelApproval',
  title: '人事审批链',
  schemaVersion: 1,
  fields: {
    approvalChains: {
      type: 'object',
      title: '审批链',
      parse: parseApprovalChains,
    },
    checklists: {
      type: 'object',
      title: '办理清单模板',
      parse: parseChecklists,
    },
  },
};
export const peopleApprovalDefaults = {
  approvalChains: approvalChainsDefaults,
  checklists: checklistsDefaults,
};

export type ApprovalCandidate = { id: string; name: string };
export type ApprovalDecision = {
  actorId: string;
  actorName: string;
  decision: 'approve' | 'return';
  reason: string;
  at: string;
};
export type ApprovalTaskStatus =
  'waiting' | 'pending' | 'approved' | 'returned' | 'withdrawn' | 'cancelled';
export type ApprovalTask = {
  id: string;
  changeId: string;
  round: number;
  stageIndex: number;
  stageKey: string;
  title: string;
  mode: 'any' | 'all';
  status: ApprovalTaskStatus;
  candidates: ApprovalCandidate[];
  decisions: ApprovalDecision[];
  createdAt: Date | string;
  decidedAt: Date | string | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const asDate = (value: unknown) =>
  value instanceof Date ? value.toISOString() : text(value) || null;

/**
 * OA-style, per-change-type approval chains for personnel changes.
 *
 * The chain is configuration (lifecycle `parameterConfiguration`), frozen into
 * one task row per stage at submit. A stage advances once its mode is met:
 * `any` needs one approver, `all` needs every candidate. Only the last stage
 * advances the lifecycle; earlier stages only move the task rows, so a
 * returned change keeps a complete audit trail.
 */
export class PeopleApproval {
  readonly parameters: StoredLifecycleParameters;
  constructor(
    db: DatabaseManager,
    private readonly users: UserAdministrationService,
    private readonly permissionSets: PermissionSetsApi<DatabaseConnection>,
    private readonly timeZone: string,
  ) {
    // The parameter tables are shared with the supply-chain review settings:
    // one row per scope, and this module's scope is `people:group`.
    this.parameters = new StoredLifecycleParameters(
      createRepositoryLifecycleStore(db),
      issueParameterCollections,
    );
  }
  private repository(c: DatabaseConnection) {
    return c.repository(PEOPLE_APPROVAL_TABLE);
  }
  private task(row: RepositoryRecord): ApprovalTask {
    return {
      id: text(row.id),
      changeId: text(row.changeId),
      round: Number(row.round),
      stageIndex: Number(row.stageIndex),
      stageKey: text(row.stageKey),
      title: text(row.title),
      mode: row.mode === 'all' ? 'all' : 'any',
      status: text(row.status) as ApprovalTaskStatus,
      candidates: Array.isArray(row.candidates)
        ? (row.candidates as ApprovalCandidate[])
        : [],
      decisions: Array.isArray(row.decisions)
        ? (row.decisions as ApprovalDecision[])
        : [],
      createdAt: row.createdAt as Date | string,
      decidedAt: (row.decidedAt as Date | string | null) ?? null,
    };
  }
  private effective(row: RepositoryRecord) {
    const data = row.data as { startDate?: string; endDate?: string | null },
      today = businessDate(this.timeZone);
    return (
      typeof data.startDate === 'string' &&
      data.startDate <= today &&
      (!data.endDate || data.endDate > today)
    );
  }
  private async account(c: DatabaseConnection, accountId: string) {
    const user = await this.users.withConnection(c).get(accountId);
    return user && user.kind === 'person' && !user.disabledAt ? user : null;
  }
  /**
   * The accounts one selection names. Roles and explicit accounts need only an
   * active person account: group HR is often employed outside the company
   * whose change it reviews, so company employment is not required here.
   * Positions are company-bound and need an active assignment on that
   * position, effective on the business date.
   */
  private async accounts(
    c: DatabaseConnection,
    subjectId: string,
    selection: ApprovalSelection,
  ): Promise<string[]> {
    if (selection.type === 'user') return [selection.referenceId];
    if (selection.type === 'role') {
      const assignments = await this.permissionSets
        .withTransaction(c)
        .listAssignments(selection.referenceId);
      return assignments
        .filter((assignment) => assignment.subject.type === 'user')
        .map((assignment) => assignment.subject.id);
    }
    const position = await c
      .repository('orgPositions')
      .findOne({ filter: { id: selection.referenceId, status: 'active' } });
    if (!position) return [];
    const unit = await c
      .repository('orgUnits')
      .findOne({ filter: { id: text(position.unitId), status: 'active' } });
    if (!unit || (subjectId && text(unit.subjectId) !== subjectId)) return [];
    const rows = await c.repository('personnelAssignments').findMany({
      filter: {
        positionId: selection.referenceId,
        subjectId: text(unit.subjectId),
        status: 'active',
      },
      limit: 1001,
    });
    if (rows.length > 1000)
      return peopleFail('PEOPLE_APPROVAL_TOO_MANY', '岗位审批人');
    const accounts: string[] = [];
    for (const row of rows) {
      if (!this.effective(row)) continue;
      const person = await c
        .repository('personnelEmployees')
        .findOne({ filter: { id: text(row.personId), status: 'active' } });
      if (person?.accountId) accounts.push(text(person.accountId));
    }
    return accounts;
  }
  /** Resolves a stage against the company the change takes effect in, excluding the applicant. */
  async resolve(
    c: DatabaseConnection,
    subjectId: string,
    stage: ApprovalStage,
    applicantId: string,
  ): Promise<ApprovalCandidate[]> {
    const ids = new Set<string>();
    for (const selection of stage.selections)
      for (const id of await this.accounts(c, subjectId, selection))
        if (id !== applicantId) ids.add(id);
    if (ids.size > 200)
      return peopleFail('PEOPLE_APPROVAL_TOO_MANY', stage.title);
    const candidates: ApprovalCandidate[] = [];
    for (const id of ids) {
      const user = await this.account(c, id);
      if (user) candidates.push({ id: user.id, name: user.name });
    }
    return candidates;
  }
  async submit(
    c: DatabaseConnection,
    row: PeopleRow,
    chains: ApprovalChains,
  ): Promise<number> {
    const data = (row.data ?? {}) as {
      type?: string;
      targetSubjectId?: string | null;
    };
    const type = data.type as ApprovalChangeType;
    if (!approvalChangeTypes.includes(type))
      return peopleFail('PEOPLE_APPROVAL_CHAIN_MISSING');
    const subjectId = text(data.targetSubjectId) || scalar(row.subjectId);
    const stages = chains[type].stages.filter(
      (stage) =>
        !stage.subjectIds.length ||
        (subjectId !== '' && stage.subjectIds.includes(subjectId)),
    );
    if (!stages.length) return peopleFail('PEOPLE_APPROVAL_CHAIN_EMPTY');
    // `prepare('submit')` already bumped reviewRound on the record.
    const round = Number(row.reviewRound ?? 0);
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex],
        candidates = await this.resolve(
          c,
          subjectId,
          stage,
          text(row.createdBy),
        );
      // An empty stage stays open to reviewers instead of deadlocking the
      // change; the settings page shows the stage as unassigned.
      await this.repository(c).createOne({
        values: {
          id: randomUUID(),
          changeId: text(row.id),
          round,
          stageIndex,
          stageKey: stage.key,
          title: stage.title,
          mode: stage.mode,
          status: stageIndex === 0 ? 'pending' : 'waiting',
          candidates,
          decisions: [],
          createdAt: new Date(),
          decidedAt: null,
        },
      });
    }
    return round;
  }
  async tasks(
    c: DatabaseConnection,
    changeId: string,
  ): Promise<ApprovalTask[]> {
    const rows = await this.repository(c).findMany({
      filter: { changeId },
      limit: 100,
      sort: (s) => [s.field('round').asc(), s.field('stageIndex').asc()],
    });
    return rows.map((row) => this.task(row));
  }
  async current(
    c: DatabaseConnection,
    changeId: string,
  ): Promise<ApprovalTask | null> {
    const [row] = await this.repository(c).findMany({
      filter: { changeId, status: 'pending' },
      limit: 1,
      sort: (s) => [s.field('stageIndex').asc()],
    });
    return row ? this.task(row) : null;
  }
  private async next(
    c: DatabaseConnection,
    task: ApprovalTask,
  ): Promise<ApprovalTask | null> {
    const [row] = await this.repository(c).findMany({
      filter: {
        changeId: task.changeId,
        round: task.round,
        stageIndex: task.stageIndex + 1,
      },
      limit: 1,
    });
    return row ? this.task(row) : null;
  }
  async hasNext(c: DatabaseConnection, task: ApprovalTask) {
    return Boolean(await this.next(c, task));
  }
  /** Whether this actor's approval completes the stage under its mode. */
  wouldComplete(task: ApprovalTask, actorId: string) {
    if (task.mode === 'any') return true;
    return task.candidates.every(
      (candidate) =>
        candidate.id === actorId ||
        task.decisions.some(
          (decision) =>
            decision.actorId === candidate.id &&
            decision.decision === 'approve',
        ),
    );
  }
  async begin(
    c: DatabaseConnection,
    changeId: string,
    actor: PeopleActor,
  ): Promise<ApprovalTask> {
    const task = await this.current(c, changeId);
    if (!task) return peopleFail('PEOPLE_APPROVAL_NOT_PENDING');
    if (
      task.candidates.length
        ? !task.candidates.some((candidate) => candidate.id === actor.id)
        : actor.review !== true
    )
      return peopleFail('PEOPLE_FORBIDDEN');
    if (task.decisions.some((decision) => decision.actorId === actor.id))
      return peopleFail('PEOPLE_APPROVAL_DECIDED');
    return task;
  }
  private decision(
    actor: PeopleActor,
    decision: 'approve' | 'return',
    reason: string,
  ): ApprovalDecision {
    return {
      actorId: actor.id,
      actorName: actor.name ?? actor.id,
      decision,
      reason,
      at: new Date().toISOString(),
    };
  }
  /**
   * Records one approval. Returns whether the stage is complete; when it is,
   * the caller promotes the next stage or fires the lifecycle approval.
   */
  async recordApproval(
    c: DatabaseConnection,
    task: ApprovalTask,
    actor: PeopleActor,
    reason: string,
  ): Promise<{ completed: boolean; decisions: ApprovalDecision[] }> {
    const decisions = [
        ...task.decisions,
        this.decision(actor, 'approve', reason),
      ],
      completed = this.wouldComplete(task, actor.id);
    await this.repository(c).updateOne({
      filter: { id: task.id },
      values: {
        decisions,
        ...(completed ? { status: 'approved', decidedAt: new Date() } : {}),
      },
    });
    return { completed, decisions };
  }
  /** Moves the next stage from waiting to pending. Returns null after the last stage. */
  async promote(
    c: DatabaseConnection,
    task: ApprovalTask,
  ): Promise<ApprovalTask | null> {
    const next = await this.next(c, task);
    if (!next) return null;
    await this.repository(c).updateOne({
      filter: { id: next.id },
      values: { status: 'pending' },
    });
    return { ...next, status: 'pending' };
  }
  /** Completes the last stage from inside the lifecycle approval transition. */
  async completeCurrent(
    c: DatabaseConnection,
    row: PeopleRow,
    actor: PeopleActor,
    reason: string,
  ) {
    // A change pending from before chains existed has no stage to complete.
    if (!(await this.current(c, text(row.id)))) return;
    const task = await this.begin(c, text(row.id), actor);
    const { completed } = await this.recordApproval(c, task, actor, reason);
    if (!completed) return peopleFail('PEOPLE_APPROVAL_NOT_COMPLETE');
  }
  /**
   * Closes the current round. `returned` keeps the returning decision on the
   * pending stage; `withdrawn` and `cancelled` only close what was waiting.
   */
  async close(
    c: DatabaseConnection,
    changeId: string,
    status: 'returned' | 'withdrawn' | 'cancelled',
    actor?: PeopleActor,
    reason = '',
  ) {
    const rows = await this.repository(c).findMany({
      filter: { changeId },
      limit: 100,
    });
    for (const row of rows) {
      const task = this.task(row);
      if (task.status === 'waiting')
        await this.repository(c).updateOne({
          filter: { id: task.id },
          values: { status: 'cancelled' },
        });
      else if (task.status === 'pending')
        await this.repository(c).updateOne({
          filter: { id: task.id },
          values: {
            status,
            ...(status === 'returned' && actor
              ? {
                  decisions: [
                    ...task.decisions,
                    this.decision(actor, 'return', reason),
                  ],
                  decidedAt: new Date(),
                }
              : {}),
          },
        });
    }
  }
  async view(c: DatabaseConnection, changeId: string) {
    const tasks = await this.tasks(c, changeId);
    if (!tasks.length) return null;
    const round = Math.max(...tasks.map((task) => task.round)),
      stages = tasks
        .filter((task) => task.round === round)
        .map((task) => ({
          stageIndex: task.stageIndex,
          key: task.stageKey,
          title: task.title,
          mode: task.mode,
          status: task.status,
          candidates: task.candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
          })),
          decisions: task.decisions,
          decidedAt: asDate(task.decidedAt),
        })),
      current = stages.find((stage) => stage.status === 'pending');
    return {
      round,
      status: current
        ? 'pending'
        : (stages[stages.length - 1]?.status ?? 'cancelled'),
      currentStage: current?.stageIndex ?? null,
      stages,
    };
  }
  async todo(
    c: DatabaseConnection,
    policies: Record<string, import('@nocobase/db').RepositoryPolicy>,
    actor: PeopleActor,
  ) {
    const policy = policies.personnelChanges;
    if (!policy) return peopleFail('PEOPLE_FORBIDDEN');
    const rows = await this.repository(c).findMany({
      filter: { status: 'pending' },
      limit: 500,
      sort: (s) => [s.field('createdAt').asc()],
    });
    const repo = c.repository('personnelChanges').withPolicy(policy),
      items: Record<string, unknown>[] = [];
    for (const row of rows) {
      const task = this.task(row);
      const candidate = task.candidates.length
        ? task.candidates.some((item) => item.id === actor.id)
        : actor.review === true;
      if (
        !candidate ||
        task.decisions.some((decision) => decision.actorId === actor.id)
      )
        continue;
      const change = await repo.findOne({ filter: { id: task.changeId } });
      if (!change) continue;
      items.push({
        ...peopleView(change),
        approval: {
          round: task.round,
          stageIndex: task.stageIndex,
          title: task.title,
          mode: task.mode,
          candidates: task.candidates,
          createdAt: asDate(task.createdAt),
        },
      });
      if (items.length >= 100) break;
    }
    return { data: items, meta: { total: items.length } };
  }
  /** The configured checklist for one change type, without resolving people. */
  async checklistTemplates(c: DatabaseConnection, type: string) {
    const current = await this.parameters.read(
      PEOPLE_APPROVAL_SCOPE,
      peopleApprovalGroup.key,
      c,
    );
    const values = current
      ? normalizeParameterValues(peopleApprovalGroup, current.values)
      : peopleApprovalDefaults;
    const parsed = parseChecklists(values.checklists) as unknown as
      | ChecklistTemplates
      | JsonObject;
    return (parsed as ChecklistTemplates)[type as ApprovalChangeType] ?? [];
  }
  async settings(c: DatabaseConnection) {
    const current = await this.parameters.read(
      PEOPLE_APPROVAL_SCOPE,
      peopleApprovalGroup.key,
      c,
    );
    if (current && current.schemaVersion !== 1)
      return peopleFail('PEOPLE_CONFIGURATION_INCOMPATIBLE');
    const [sets, accounts, positions, units, subjects] = await Promise.all([
      this.permissionSets.withTransaction(c).list(),
      this.users.withConnection(c).list({ page: 1, pageSize: 500 }),
      c.repository('orgPositions').findMany({ limit: 1000 }),
      c.repository('orgUnits').findMany({ limit: 1000 }),
      c.repository('orgSubjects').findMany({ limit: 200 }),
    ]);
    const unitsById = new Map(units.map((unit) => [text(unit.id), unit])),
      subjectsById = new Map(subjects.map((row) => [text(row.id), row]));
    const values = current
      ? normalizeParameterValues(peopleApprovalGroup, current.values)
      : peopleApprovalDefaults;
    return {
      scope: PEOPLE_APPROVAL_SCOPE,
      revision: current?.revision ?? 0,
      schemaVersion: peopleApprovalGroup.schemaVersion,
      values: {
        approvalChains: parseApprovalChains(values.approvalChains),
        checklists: parseChecklists(values.checklists),
      },
      defaults: {
        approvalChains: approvalChainsDefaults,
        checklists: checklistsDefaults,
      },
      fields: [
        {
          key: 'approvalChains',
          type: 'object',
          title: peopleApprovalGroup.fields.approvalChains.title,
        },
        {
          key: 'checklists',
          type: 'object',
          title: peopleApprovalGroup.fields.checklists.title,
        },
      ],
      options: {
        roles: sets.map((set) => ({
          key: set.key,
          title: roleTitle(set.title) || set.key,
        })),
        accounts: accounts.items.map((user) => ({
          id: user.id,
          name: user.name,
          code: user.username ?? '',
        })),
        companies: subjects.map((row) => ({
          id: text(row.id),
          name: text(row.name),
        })),
        positions: positions
          .filter((row) => row.status === 'active')
          .map((row) => {
            const unit = unitsById.get(text(row.unitId));
            return {
              id: text(row.id),
              name: text(row.name),
              subjectId: unit ? text(unit.subjectId) : '',
              subjectName: unit
                ? text(subjectsById.get(text(unit.subjectId))?.name)
                : '',
            };
          }),
      },
    };
  }
  async save(
    c: DatabaseConnection,
    input: { values: JsonObject; version: number; requestId: string },
    actor: PeopleActor,
  ) {
    const values = normalizeParameterValues(peopleApprovalGroup, input.values),
      chains = parseApprovalChains(
        values.approvalChains,
      ) as ParsedApprovalChains,
      checklists = parseChecklists(values.checklists);
    for (const type of approvalChangeTypes)
      for (const stage of chains[type].stages) {
        for (const selection of stage.selections) {
          if (selection.type === 'role') {
            if (
              !(await this.permissionSets
                .withTransaction(c)
                .get(selection.referenceId))
            )
              return peopleFail(
                'PEOPLE_APPROVAL_REFERENCE_MISSING',
                stage.title,
              );
            continue;
          }
          if (selection.type === 'user') {
            if (!(await this.account(c, selection.referenceId)))
              return peopleFail(
                'PEOPLE_APPROVAL_REFERENCE_MISSING',
                stage.title,
              );
            continue;
          }
          const position = await c.repository('orgPositions').findOne({
            filter: { id: selection.referenceId, status: 'active' },
          });
          if (!position)
            return peopleFail('PEOPLE_APPROVAL_REFERENCE_MISSING', stage.title);
        }
        for (const subjectId of stage.subjectIds)
          if (
            !(await c.repository('orgSubjects').exists({
              filter: { id: subjectId, status: 'active' },
            }))
          )
            return peopleFail('PEOPLE_APPROVAL_REFERENCE_MISSING', stage.title);
      }
    const saved = await this.parameters.save(
      {
        scope: PEOPLE_APPROVAL_SCOPE,
        group: peopleApprovalGroup,
        values: { approvalChains: chains, checklists },
        expectedRevision: input.version,
        requestId: input.requestId,
        actorId: actor.id,
        at: new Date().toISOString(),
      },
      c,
    );
    return { revision: saved.revision, values: saved.values };
  }
}
