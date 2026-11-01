export const kinds = [
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
export type Kind = (typeof kinds)[number];
export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value };
export type Data = Record<string, Value>;
export type Row = {
  id: string;
  code: string;
  name: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  subjectId: string | null;
  personId: string | null;
  positionId: string | null;
  grade: number | null;
  data: Data;
  snapshot: Data | null;
  createdAt: string;
  updatedAt: string;
  currentStaffing?: Record<string, number>;
  workflow?: {
    available: {
      name: string;
      allowed: boolean;
      blockers: { code: string }[];
    }[];
    history: { transition: string; actorId: string; at: string; input: Data }[];
  };
  // Present on personnel changes: the approval chain around the current round.
  approval?: {
    round: number;
    status: string;
    currentStage: number | null;
    stages: {
      stageIndex: number;
      key: string;
      title: string;
      mode: 'any' | 'all';
      status: string;
      candidates: { id: string; name: string }[];
      decisions: {
        actorId: string;
        actorName: string;
        decision: 'approve' | 'return';
        reason: string;
        at: string;
      }[];
      decidedAt: string | null;
    }[];
  };
};
export type Options = Record<
  string,
  { rows: Row[]; total: number; truncated: boolean }
>;
export type Section<T = Row> = {
  rows: T[];
  total: number;
  truncated: boolean;
};
export type AuditRow = {
  id: string;
  kind: string;
  recordId: string;
  recordName: string;
  personId: string | null;
  subjectId: string | null;
  operation: string;
  actorName: string;
  reason: string;
  beforeValue: Data | null;
  afterValue: Data | null;
  createdAt: string;
};
export type Career = {
  person: Row;
  asOf: string;
  employments: Section;
  assignments: Section;
  changes: Section;
  audits: Section<AuditRow> | null;
};
export type FieldSpec = {
  key: string;
  type?: 'text' | 'long' | 'date' | 'number' | 'select' | 'boolean';
  required?: boolean;
  source?: string;
  choices?: string[];
  min?: number;
  max?: number;
};
const text = (key: string, required = false): FieldSpec => ({
  key,
  type: 'long',
  required,
});
const select = (key: string, choices: string[]): FieldSpec => ({
  key,
  type: 'select',
  choices,
  required: true,
});
export const fields: Record<Kind, FieldSpec[]> = {
  employees: [
    { key: 'subjectId', source: 'orgSubjects', required: true },
    { key: 'location' },
    text('education'),
    text('experience'),
    { key: 'accountId', source: 'accounts' },
  ],
  employments: [
    { key: 'personId', source: 'employees' },
    { key: 'subjectId', source: 'orgSubjects' },
    select('type', ['employee', 'contractor', 'intern', 'other']),
    { key: 'startDate', type: 'date' },
    { key: 'endDate', type: 'date' },
    { key: 'probationEnd', type: 'date' },
  ],
  assignments: [
    { key: 'personId', source: 'employees' },
    { key: 'subjectId', source: 'orgSubjects' },
    { key: 'positionId', source: 'orgPositions' },
    select('type', ['primary', 'partTime']),
    { key: 'startDate', type: 'date' },
    { key: 'endDate', type: 'date' },
    { key: 'location' },
  ],
  changes: [
    { key: 'personId', source: 'employees', required: true },
    select('type', [
      'entry',
      'transfer',
      'partTime',
      'endPartTime',
      'exit',
      'regularize',
    ]),
    { key: 'effectiveDate', type: 'date', required: true },
    { key: 'targetSubjectId', source: 'orgSubjects' },
    { key: 'targetPositionId', source: 'orgPositions' },
    { key: 'changeEmployer', type: 'boolean' },
    { key: 'assignmentId', source: 'assignments' },
    select('employmentType', ['employee', 'contractor', 'intern', 'other']),
    { key: 'probationEnd', type: 'date' },
    { key: 'location' },
    text('explanation', true),
  ],
  dimensions: [
    select('category', ['common', 'professional', 'management', 'specialist']),
    text('definition', true),
    text('evidence', true),
    text('applicability'),
  ],
  models: [
    { key: 'positionId', source: 'orgPositions', required: true },
    text('description'),
  ],
  profiles: [
    { key: 'personId', source: 'employees', required: true },
    { key: 'grade', type: 'number', min: 1, max: 5 },
    { key: 'modelId', source: 'models' },
    { key: 'targetModelId', source: 'models' },
    text('strengths'),
    text('improvements'),
    text('careerDirection'),
    text('potential'),
    text('potentialEvidence'),
    text('toValidate'),
  ],
  evaluations: [
    { key: 'personId', source: 'employees', required: true },
    { key: 'period', required: true },
    { key: 'evaluationDate', type: 'date', required: true },
    { key: 'modelId', source: 'models', required: true },
    text('summary'),
  ],
  developmentPlans: [
    { key: 'personId', source: 'employees', required: true },
    text('goal', true),
    text('measures', true),
    { key: 'owner', required: true },
    { key: 'dueDate', type: 'date', required: true },
    text('progress'),
    text('result'),
  ],
  workforcePlans: [
    { key: 'subjectId', source: 'orgSubjects', required: true },
    { key: 'period', required: true },
    { key: 'baselineDate', type: 'date', required: true },
    text('basis', true),
    { key: 'previousId', source: 'workforcePlans' },
    text('progress'),
  ],
};
export const repeats: Partial<Record<Kind, Record<string, FieldSpec[]>>> = {
  models: {
    items: [
      { key: 'dimensionId', source: 'dimensions', required: true },
      { key: 'target', type: 'number', required: true, min: 1, max: 5 },
      select('source', ['common', 'position', 'development']),
    ],
  },
  profiles: {
    extraItems: [
      { key: 'dimensionId', source: 'dimensions', required: true },
      { key: 'target', type: 'number', required: true, min: 1, max: 5 },
      select('source', ['common', 'position', 'development']),
    ],
    performance: [
      { key: 'period', required: true },
      { key: 'result', required: true },
      text('evidence'),
    ],
    achievements: [
      { key: 'date', type: 'date', required: true },
      { key: 'title', required: true },
      text('contribution'),
      text('result'),
      text('evidence'),
    ],
  },
  workforcePlans: {
    items: [
      { key: 'positionId', source: 'orgPositions', required: true },
      { key: 'requested', type: 'number', required: true, min: 0 },
      { key: 'dueDate', type: 'date', required: true },
      select('approach', ['recruit', 'transfer', 'develop']),
      { key: 'owner', required: true },
      { key: 'cost', type: 'number', min: 0 },
      text('basis', true),
    ],
  },
};
export const statuses: Record<Kind, string[]> = {
  employees: ['active', 'inactive'],
  employments: ['active'],
  assignments: ['active'],
  changes: ['draft', 'pending', 'approved', 'effective', 'cancelled'],
  dimensions: ['active', 'inactive'],
  models: ['active', 'inactive'],
  profiles: ['active'],
  evaluations: [
    'draft',
    'selfReviewed',
    'managerReviewed',
    'confirmed',
    'cancelled',
  ],
  developmentPlans: ['draft', 'active', 'completed', 'cancelled'],
  workforcePlans: [
    'draft',
    'companyConfirmed',
    'pending',
    'approved',
    'superseded',
    'cancelled',
  ],
};
export const workflows: Kind[] = [
  'changes',
  'evaluations',
  'developmentPlans',
  'workforcePlans',
];
export const readOnly: Kind[] = ['employments', 'assignments'];
export const smallForms: Kind[] = ['models'];
export function kindFromPath(path: string): Kind {
  const matches = path.split('/').filter((v) => kinds.includes(v as Kind));
  return (matches.at(-1) ?? 'profiles') as Kind;
}
export function emptyData(kind: Kind): Data {
  const data: Data = {};
  for (const f of fields[kind]) {
    if (['personId', 'subjectId', 'positionId'].includes(f.key)) continue;
    data[f.key] =
      f.type === 'boolean'
        ? false
        : f.source
          ? null
          : f.type === 'number'
            ? null
            : f.choices
              ? f.choices[0]
              : '';
  }
  if (kind === 'employees') data.photoId = null;
  if (kind === 'dimensions') data.standards = ['', '', '', '', ''];
  for (const key of Object.keys(repeats[kind] ?? {})) data[key] = [];
  if (kind === 'evaluations') data.ratings = [];
  if (kind === 'changes') {
    data.employmentId = null;
    data.targetSubjectId = null;
    data.targetPositionId = null;
    data.assignmentId = null;
    data.probationEnd = null;
  }
  return data;
}
export const topFields = ['subjectId', 'personId', 'positionId'];
export function recordValue(row: Row, key: string): Value {
  return topFields.includes(key)
    ? row[key as 'subjectId' | 'personId' | 'positionId']
    : (row.data[key] ?? null);
}

export function textValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ? value.toString()
      : value instanceof Date
        ? value.toISOString()
        : '';
}

// Business-day test shared with the server so the form never treats a closed
// assignment as the person's current one.
export function isCurrentRow(row: Row, on: string): boolean {
  if (!on) return false;
  const startDate = textValue(row.data.startDate),
    endDate = textValue(row.data.endDate);
  return startDate <= on && (!endDate || endDate > on);
}
export function currentEmploymentRow(
  rows: Row[],
  personId: string,
  on: string,
): Row | undefined {
  return rows.find((row) => row.personId === personId && isCurrentRow(row, on));
}
export function currentPrimaryRow(
  rows: Row[],
  personId: string,
  on: string,
): Row | undefined {
  return rows.find(
    (row) =>
      row.personId === personId &&
      textValue(row.data.type) === 'primary' &&
      isCurrentRow(row, on),
  );
}
