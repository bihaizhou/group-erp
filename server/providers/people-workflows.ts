import {
  defineLifecycle,
  type LifecycleRecord,
  type JsonObject,
  type TransitionHookContext,
} from '@nocobase/lifecycle';
import {
  peopleApprovalDefaults,
  peopleApprovalGroup,
} from './people-approval.js';
import type { PeopleActor, PeopleKind, PeopleRow } from './people-model.js';

interface WorkflowTypes {
  record: LifecycleRecord & PeopleRow;
  state: string;
  parameters: JsonObject;
  services: {
    allowed(
      record: PeopleRow,
      actor: PeopleActor,
      transition: string,
    ): Promise<boolean>;
    transitioned(
      context: TransitionHookContext<WorkflowTypes>,
      kind: PeopleKind,
    ): Promise<void>;
    prepare(
      record: PeopleRow,
      input: JsonObject,
      transition: string,
      actor: PeopleActor,
    ): Promise<Record<string, unknown>>;
  };
}
function transition(
  from: string | string[],
  to: string,
  name: string,
  kind: PeopleKind,
) {
  return {
    from,
    to,
    guard: async ({
      record,
      actor,
      services,
    }: {
      record: WorkflowTypes['record'];
      actor: PeopleActor;
      services: WorkflowTypes['services'];
    }) =>
      (await services.allowed(record, actor, name)) || {
        code: 'PEOPLE_ACTION_DENIED',
        message: 'Action is not allowed.',
      },
    set: async ({
      record,
      input,
      services,
      actor,
    }: {
      record: WorkflowTypes['record'];
      input: JsonObject;
      services: WorkflowTypes['services'];
      actor: PeopleActor;
    }) => ({
      ...(await services.prepare(record, input, name, actor)),
      revision: Number(record.revision) + 1,
      updatedAt: new Date(),
    }),
    onTransition: async (context: TransitionHookContext<WorkflowTypes>) =>
      context.services.transitioned(context, kind),
  };
}
export const peopleLifecycles = {
  changes: defineLifecycle<WorkflowTypes>({
    name: 'personnelChanges',
    collection: 'personnelChanges',
    initial: 'draft',
    parameters: peopleApprovalDefaults,
    parameterConfiguration: {
      readMode: 'live',
      groups: [peopleApprovalGroup],
    },
    states: [
      'draft',
      'pending',
      'approved',
      { name: 'effective', final: true },
      { name: 'cancelled', final: true },
    ],
    transitions: {
      edit: {
        ...transition('draft', 'draft', 'edit', 'changes'),
        manual: false,
      },
      submit: transition('draft', 'pending', 'submit', 'changes'),
      withdraw: transition('pending', 'draft', 'withdraw', 'changes'),
      return: transition('pending', 'draft', 'return', 'changes'),
      approve: transition('pending', 'approved', 'approve', 'changes'),
      cancel: transition(
        ['draft', 'pending', 'approved'],
        'cancelled',
        'cancel',
        'changes',
      ),
      apply: {
        ...transition('approved', 'effective', 'apply', 'changes'),
        manual: false,
      },
    },
  }),
  evaluations: defineLifecycle<WorkflowTypes>({
    name: 'hrEvaluations',
    collection: 'hrEvaluations',
    initial: 'draft',
    states: [
      'draft',
      'selfReviewed',
      'managerReviewed',
      { name: 'confirmed', final: true },
      { name: 'cancelled', final: true },
    ],
    transitions: {
      edit: {
        ...transition('draft', 'draft', 'edit', 'evaluations'),
        manual: false,
      },
      selfAssess: transition(
        'draft',
        'selfReviewed',
        'selfAssess',
        'evaluations',
      ),
      managerAssess: transition(
        'selfReviewed',
        'managerReviewed',
        'managerAssess',
        'evaluations',
      ),
      confirm: transition(
        'managerReviewed',
        'confirmed',
        'confirm',
        'evaluations',
      ),
      return: transition(
        ['selfReviewed', 'managerReviewed'],
        'draft',
        'return',
        'evaluations',
      ),
      cancel: transition(
        ['draft', 'selfReviewed', 'managerReviewed'],
        'cancelled',
        'cancel',
        'evaluations',
      ),
    },
  }),
  developmentPlans: defineLifecycle<WorkflowTypes>({
    name: 'hrDevelopmentPlans',
    collection: 'hrDevelopmentPlans',
    initial: 'draft',
    states: [
      'draft',
      'active',
      { name: 'completed', final: true },
      { name: 'cancelled', final: true },
    ],
    transitions: {
      edit: {
        ...transition('draft', 'draft', 'edit', 'developmentPlans'),
        manual: false,
      },
      activate: transition('draft', 'active', 'activate', 'developmentPlans'),
      progress: transition('active', 'active', 'progress', 'developmentPlans'),
      complete: transition(
        'active',
        'completed',
        'complete',
        'developmentPlans',
      ),
      cancel: transition(
        ['draft', 'active'],
        'cancelled',
        'cancel',
        'developmentPlans',
      ),
    },
  }),
  workforcePlans: defineLifecycle<WorkflowTypes>({
    name: 'hrWorkforcePlans',
    collection: 'hrWorkforcePlans',
    initial: 'draft',
    states: [
      'draft',
      'companyConfirmed',
      'pending',
      'approved',
      { name: 'superseded', final: true },
      { name: 'cancelled', final: true },
    ],
    transitions: {
      edit: {
        ...transition('draft', 'draft', 'edit', 'workforcePlans'),
        manual: false,
      },
      submit: transition(
        'draft',
        'companyConfirmed',
        'submit',
        'workforcePlans',
      ),
      companyConfirm: transition(
        'companyConfirmed',
        'pending',
        'companyConfirm',
        'workforcePlans',
      ),
      return: transition(
        ['companyConfirmed', 'pending'],
        'draft',
        'return',
        'workforcePlans',
      ),
      approve: transition('pending', 'approved', 'approve', 'workforcePlans'),
      progress: transition(
        'approved',
        'approved',
        'progress',
        'workforcePlans',
      ),
      supersede: {
        ...transition('approved', 'superseded', 'supersede', 'workforcePlans'),
        manual: false,
      },
      cancel: transition(
        ['draft', 'companyConfirmed', 'pending'],
        'cancelled',
        'cancel',
        'workforcePlans',
      ),
    },
  }),
};
export type PeopleWorkflowContext = TransitionHookContext<WorkflowTypes>;
