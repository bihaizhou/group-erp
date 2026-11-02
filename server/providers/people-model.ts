import { z } from 'zod';

export const peopleKinds = [
  'employees',
  'employments',
  'assignments',
  'changes',
  'dimensions',
  'models',
  'profiles',
  'evaluations',
  'developmentPlans',
  'workforcePlans',
] as const;
export type PeopleKind = (typeof peopleKinds)[number];
export const peopleTables: Record<PeopleKind, string> = {
  employees: 'personnelEmployees',
  employments: 'personnelEmployments',
  assignments: 'personnelAssignments',
  changes: 'personnelChanges',
  dimensions: 'hrDimensions',
  models: 'hrModels',
  profiles: 'hrProfiles',
  evaluations: 'hrEvaluations',
  developmentPlans: 'hrDevelopmentPlans',
  workforcePlans: 'hrWorkforcePlans',
};
export const workflowKinds: PeopleKind[] = [
  'changes',
  'evaluations',
  'developmentPlans',
  'workforcePlans',
];
export const personnelKinds: PeopleKind[] = [
  'employees',
  'employments',
  'assignments',
  'changes',
];
const note = z.string().trim().max(6000).default('');
// Cleared reference and date inputs travel as empty strings; treat them as null.
const blankToNull = (value: unknown) => (value === '' ? null : value);
const optionalId = z
  .preprocess(blankToNull, z.string().uuid().nullable())
  .default(null);
const date = z.iso.date();
const optionalDate = z
  .preprocess(blankToNull, z.iso.date().nullable())
  .default(null);
const score = z.number().min(1).max(5).multipleOf(0.1).nullable();
export const dimensionItem = z.strictObject({
  dimensionId: z.string().uuid(),
  target: z.number().min(1).max(5),
  source: z.enum(['common', 'position', 'development']).default('position'),
});
export const ratingItem = z.strictObject({
  dimensionId: z.string().uuid(),
  selfScore: score.default(null),
  managerScore: score.default(null),
  confirmedScore: score.default(null),
  evidence: note,
});
export const workforceItem = z.strictObject({
  positionId: z.string().uuid(),
  requested: z.number().int().min(0).max(100000),
  approved: z.number().int().min(0).max(100000).nullable().default(null),
  dueDate: date,
  approach: z.enum(['recruit', 'transfer', 'develop']),
  cost: z.number().min(0).max(1e12).default(0),
  basis: z.string().trim().min(1).max(3000),
  owner: z.string().trim().max(200).default(''),
});
export const workforceTaskResult = z.strictObject({
  positionId: z.string().uuid(),
  owner: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'inProgress', 'completed']),
  result: z.string().trim().max(6000).default(''),
  assignmentIds: z.array(z.string().uuid()).max(100).default([]),
});
export const peopleDataSchemas = {
  employees: z.strictObject({
    location: note,
    education: note,
    experience: note,
    accountId: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .default(null)
      .transform((value) => value || null),
    photoId: optionalId,
  }),
  employments: z.strictObject({
    type: z.enum(['employee', 'contractor', 'intern', 'other']),
    startDate: date,
    endDate: optionalDate,
    probationEnd: optionalDate,
    contractEnd: optionalDate,
  }),
  assignments: z.strictObject({
    type: z.enum(['primary', 'partTime']),
    startDate: date,
    endDate: optionalDate,
    location: note,
  }),
  changes: z.strictObject({
    type: z.enum([
      'entry',
      'transfer',
      'partTime',
      'endPartTime',
      'exit',
      'regularize',
    ]),
    effectiveDate: date,
    targetSubjectId: optionalId,
    targetPositionId: optionalId,
    employmentId: optionalId,
    assignmentId: optionalId,
    changeEmployer: z.boolean().default(false),
    employmentType: z
      .enum(['employee', 'contractor', 'intern', 'other'])
      .default('employee'),
    probationEnd: optionalDate,
    contractEnd: optionalDate,
    location: note,
    explanation: z.string().trim().min(1).max(3000),
  }),
  dimensions: z.strictObject({
    category: z.enum(['common', 'professional', 'management', 'specialist']),
    definition: z.string().trim().min(1).max(3000),
    standards: z.array(z.string().trim().min(1).max(1000)).length(5),
    evidence: z.string().trim().min(1).max(3000),
    applicability: note,
  }),
  models: z.strictObject({
    items: z.array(dimensionItem).min(1).max(24),
    description: note,
  }),
  profiles: z.strictObject({
    grade: z.number().int().min(1).max(5).nullable().default(null),
    modelId: optionalId,
    targetModelId: optionalId,
    extraItems: z.array(dimensionItem).max(24).default([]),
    strengths: note,
    improvements: note,
    achievements: z
      .array(
        z.strictObject({
          date,
          title: z.string().trim().min(1).max(200),
          contribution: note,
          result: note,
          evidence: note,
        }),
      )
      .max(30)
      .default([]),
    performance: z
      .array(
        z.strictObject({
          period: z.string().trim().min(1).max(100),
          result: z.string().trim().min(1).max(100),
          evidence: note,
        }),
      )
      .max(12)
      .default([]),
    careerDirection: note,
    potential: note,
    potentialEvidence: note,
    toValidate: note,
  }),
  evaluations: z.strictObject({
    period: z.string().trim().min(1).max(100),
    evaluationDate: date,
    modelId: z.string().uuid(),
    ratings: z.array(ratingItem).min(1).max(24),
    summary: note,
  }),
  developmentPlans: z.strictObject({
    goal: z.string().trim().min(1).max(3000),
    measures: z.string().trim().min(1).max(6000),
    owner: z.string().trim().min(1).max(200),
    dueDate: date,
    progress: note,
    result: note,
  }),
  workforcePlans: z.strictObject({
    period: z.string().trim().min(1).max(100),
    baselineDate: date,
    basis: z.string().trim().min(1).max(6000),
    previousId: optionalId,
    items: z.array(workforceItem).min(1).max(100),
    progress: note,
    taskResults: z.array(workforceTaskResult).max(100).default([]),
  }),
};
export const peopleInputBase = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,63}$/),
  name: z.string().trim().min(1).max(200),
  subjectId: optionalId,
  personId: optionalId,
  positionId: optionalId,
};
export const peopleQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: z.string().max(32).optional(),
  subjectId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  kind: z.enum(peopleKinds).optional(),
  recordId: z.string().uuid().optional(),
  orderBy: z
    .enum([
      'updatedAt',
      '-updatedAt',
      'createdAt',
      '-createdAt',
      'grade',
      '-grade',
    ])
    .default('-updatedAt'),
});
export type PeopleQuery = z.infer<typeof peopleQuery>;
export type PeopleRow = {
  id: string;
  code: string;
  name: string;
  subjectId: string | null;
  personId: string | null;
  positionId: string | null;
  status: string;
  revision: number;
  data: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  lifecycleVersion: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  [key: string]: unknown;
};
export type PeopleActor = {
  id: string;
  name?: string;
  review?: boolean;
  companyReview?: boolean;
  bindAccounts?: boolean;
  system?: boolean;
};
export class PeopleError extends Error {
  constructor(
    public readonly reason: string,
    public readonly field?: string,
  ) {
    super(reason);
  }
}
export const peopleFail = (reason: string, field?: string): never => {
  throw new PeopleError(reason, field);
};
export function peopleView(row: Record<string, unknown>) {
  const { revision, lifecycleVersion, ...rest } = row;
  return {
    ...rest,
    version: Number(revision),
    lifecycleVersion: Number(lifecycleVersion),
    createdAt: new Date(row.createdAt as string).toISOString(),
    updatedAt: new Date(row.updatedAt as string).toISOString(),
  };
}

export function scalar(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'boolean'
      ? value.toString()
      : value instanceof Date
        ? value.toISOString()
        : '';
}
