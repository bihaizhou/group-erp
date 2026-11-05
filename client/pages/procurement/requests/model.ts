import type { DemandAttachment } from '#components/demand-attachments/model';
import { randomUuid } from '#lib/random-id';
export const rootPath = '/functions/procurement/requests';
export const transitions = [
  'submit',
  'approve',
  'return',
  'withdraw',
  'revise',
  'cancel',
  'reassign',
] as const;
export type Transition = (typeof transitions)[number];
export type Action = Transition | 'update' | 'copy';
export type State = 'draft' | 'pending' | 'approved' | 'cancelled';
export interface Choice {
  id: string;
  code: string;
  name: string;
  availability?: string;
}
export interface Page<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    businessDate?: string;
    timeZone?: string;
  };
}
export type Selection =
  | {
      kind: 'known';
      subjectId: string;
      skuId: string;
      quantity: string;
      unitId: string;
      unitRuleId?: string;
    }
  | {
      kind: 'unknown';
      subjectId: string;
      originalName: string;
      originalSpecification: string;
      requestedUnitText: string;
      quantity: string;
    };
export interface DemandLine {
  id: string;
  selection: Selection;
  originalName: string;
  originalSpecification: string;
  usage: string;
  notes: string;
}
export interface Content {
  attachments?: DemandAttachment[];
  subjectId: string;
  requesterEmployeeId: string | null;
  requestingUnitId: string | null;
  usage: string;
  neededOn: string | null;
  suggestedSupplierId: string | null;
  projectId: null;
  notes: string;
  lines: DemandLine[];
}
export interface MaterialSnapshot {
  code: string;
  name: string;
  standardName: string;
  attributeValues: Record<string, string>;
  unitName: string;
  baseUnitName: string;
}
export interface Preview {
  identificationStatus: string;
  requestedQuantity: string;
  baseQuantity: string | null;
  materialSnapshot?: MaterialSnapshot;
  numeratorSnapshot?: string;
  denominatorSnapshot?: string;
  unitRuleId?: string | null;
}
export interface StoredLine extends Preview {
  revision: number;
  inputRevision: number;
  activeSourceLinkId: string | null;
  id: string;
  status: string;
  lineNo: number;
  selectionInput: DemandLine;
  originalName: string;
  originalSpecification: string;
  requestedUnitText: string;
  usage: string;
  notes: string;
}
export interface Submission {
  id: string;
  contentVersion: number;
  createdAt: string;
  payload: {
    attachments?: DemandAttachment[];
    head: Omit<
      PurchaseRequest,
      'lines' | 'versions' | 'reviewTasks' | 'display'
    >;
    company?: Choice;
    requester?: Choice;
    unit?: Choice;
    lines: StoredLine[];
    parameterSnapshot?: {
      values: Rules;
      sources: Record<string, { revision: number }>;
    };
  };
}
export interface ReviewTask {
  id: string;
  round: number;
  versionId: string;
  createdAt: string | null;
  candidates: string[];
  status: 'pending' | 'approved' | 'returned' | 'closed' | 'reassigned';
  decidedBy: string | null;
  reason: string;
  decidedAt: string | null;
}
export interface PurchaseRequest {
  attachments?: DemandAttachment[];
  supplierSnapshot?: unknown;
  recentHistory?: Audit[];
  id: string;
  code: string;
  subjectId: string;
  requesterEmployeeId: string | null;
  requestingUnitId: string | null;
  suggestedSupplierId: string | null;
  usage: string;
  notes: string;
  neededOn: string | null;
  createdBy: string;
  status: State;
  revision: number;
  lifecycleVersion: number;
  contentVersion: number;
  reviewRound: number;
  lineCount: number;
  identificationStatus: 'identified' | 'unidentified';
  updatedAt: string;
  submittedVersionId: string | null;
  supersedesId: string | null;
  lines: StoredLine[];
  versions: Submission[];
  reviewTasks: ReviewTask[];
  display: {
    company: Choice | null;
    requester: Choice | null;
    unit: Choice | null;
    supplier: Choice | null;
    creator: Choice | null;
    submitter: Choice | null;
    accounts: Record<string, Choice | null>;
    relatedRequests: {
      id: string;
      code: string;
      relation: 'source' | 'copy';
    }[];
  };
}
export interface IdentityUnit {
  id: string;
  code: string;
  name: string;
  positionId: string;
  positionCode: string;
  positionName: string;
  primary: boolean;
}
export interface IdentityCompany extends Choice {
  primary: boolean;
  units: IdentityUnit[];
}
export interface PurchaseIdentity {
  employee: Choice | null;
  companies: IdentityCompany[];
  default: { subjectId: string; unitId: string | null } | null;
}
export interface MergeSource {
  requestId: string;
  requestCode: string;
  subjectId: string;
  companyName: string;
  lineId: string;
  lineNo: number;
  requestedQuantity: string;
  requestedUnit: string;
  baseQuantity: string | null;
  baseUnit: string | null;
  neededOn: string | null;
  usage: string;
}
export interface MergeGroup {
  key: string;
  kind: 'known' | 'unknown';
  material: {
    skuId: string | null;
    code: string;
    name: string;
    specification: string;
    unitId: string | null;
    unitName: string;
  };
  quantity: string;
  sources: MergeSource[];
}
export interface Capabilities {
  recordRevision: number;
  lifecycleVersion: number;
  actions: Record<
    Action,
    { visible: boolean; enabled: boolean; reason: string | null }
  >;
}
export interface Audit {
  id: string;
  operation: string;
  reason: string;
  actorId: string;
  actor: Choice | null;
  createdAt: string;
}
export interface ReviewerSelection {
  group: number;
  type: 'position' | 'user';
  referenceId: string;
}
export interface Rules {
  reviewerSelections: ReviewerSelection[];
  allowParallelGovernance: boolean;
  requireProject: false;
}
export interface Settings {
  subjectId: string;
  revision: number;
  values: Rules;
  references: (Choice & ReviewerSelection)[];
  fields?: { key: string; type: 'reviewers' | 'boolean'; title: string }[];
}
export const blankContent = (subjectId = ''): Content => ({
  subjectId,
  requesterEmployeeId: null,
  requestingUnitId: null,
  usage: '',
  neededOn: null,
  suggestedSupplierId: null,
  projectId: null,
  notes: '',
  lines: [],
});
export const newLine = (subjectId: string): DemandLine => ({
  id: randomUuid(),
  selection: {
    kind: 'unknown',
    subjectId,
    originalName: '',
    originalSpecification: '',
    requestedUnitText: '',
    quantity: '',
  },
  originalName: '',
  originalSpecification: '',
  usage: '',
  notes: '',
});
export const requestContent = (row: PurchaseRequest): Content => ({
  attachments: structuredClone(row.attachments ?? []),
  subjectId: row.subjectId,
  requesterEmployeeId: row.requesterEmployeeId,
  requestingUnitId: row.requestingUnitId,
  usage: row.usage,
  neededOn: row.neededOn,
  suggestedSupplierId: row.suggestedSupplierId,
  projectId: null,
  notes: row.notes,
  lines: row.lines
    .filter((l) => l.status === 'active')
    .map((l) => structuredClone(l.selectionInput)),
});
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function validateContent(
  c: Content,
  reason?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!c.subjectId) errors.subjectId = 'required';
  for (const key of ['usage', 'notes'] as const)
    if (c[key].length > 6000) errors[key] = 'tooLarge';
  if (reason !== undefined && (!reason.trim() || reason.trim().length > 3000))
    errors.reason = 'reasonLength';
  if (c.lines.length > 100) errors.lines = 'lineLimit';
  for (const line of c.lines) {
    const s = line.selection;
    const add = (field: string, error: string) => {
      errors[`line-${line.id}-${field}`] = error;
    };
    if (s.kind === 'known' && (!s.skuId || !s.unitId))
      add('selection', 'invalidReference');
    if (s.kind === 'unknown') {
      for (const [field, max] of [
        ['originalName', 200],
        ['originalSpecification', 6000],
        ['requestedUnitText', 100],
      ] as const) {
        if (!s[field].trim()) add(field, 'required');
        else if (s[field].trim().length > max) add(field, 'tooLarge');
      }
    }
    if (
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s.quantity) ||
      !/[1-9]/.test(s.quantity)
    )
      add('quantity', 'invalidQuantity');
    else if (s.quantity.split('.')[0].length > 18) add('quantity', 'overflow');
    else if ((s.quantity.split('.')[1]?.length ?? 0) > 6)
      add('quantity', 'precision');
    for (const [field, max] of [
      ['originalName', 200],
      ['originalSpecification', 6000],
      ['usage', 6000],
      ['notes', 6000],
    ] as const)
      if (line[field].length > max) add(`detail-${field}`, 'tooLarge');
  }
  return errors;
}
export interface Conflict {
  key: string;
  label: string;
  base: unknown;
  local: unknown;
  server: unknown;
  retired?: boolean;
}
/** Three-way content merge; both line values and order have explicit conflicts. */
export function compareContent(
  base: Content,
  local: Content,
  server: Content,
  retiredIds: string[] = [],
): { merged: Content; conflicts: Conflict[] } {
  const merged = structuredClone(server),
    conflicts: Conflict[] = [];
  const choose = (
    key: string,
    label: string,
    b: unknown,
    l: unknown,
    r: unknown,
    retired = false,
  ): unknown => {
    if (same(l, b)) return r;
    if (!retired && (same(r, b) || same(l, r))) return l;
    conflicts.push({ key, label, base: b, local: l, server: r, retired });
    return r;
  };
  for (const key of Object.keys(base).filter(
    (k) => k !== 'lines',
  ) as (keyof Omit<Content, 'lines'>)[]) {
    Object.assign(merged, {
      [key]: choose(
        `head:${key}`,
        (
          {
            subjectId: 'company',
            requesterEmployeeId: 'requester',
            requestingUnitId: 'unit',
            suggestedSupplierId: 'supplier',
          } as Record<string, string>
        )[key] ?? key,
        base[key],
        local[key],
        server[key],
      ),
    });
  }
  const b = new Map(base.lines.map((l) => [l.id, l])),
    l = new Map(local.lines.map((l) => [l.id, l])),
    r = new Map(server.lines.map((l) => [l.id, l]));
  const ids = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])];
  const lines = new Map<string, DemandLine>();
  for (const id of ids) {
    const line = choose(
      `line:${id}`,
      'lines',
      b.get(id),
      l.get(id),
      r.get(id),
      retiredIds.includes(id) && !!l.get(id),
    );
    if (line) lines.set(id, line as DemandLine);
  }
  const order = choose(
    'order',
    'lineOrder',
    [...b.keys()],
    [...l.keys()],
    [...r.keys()],
  ) as string[];
  merged.lines = [...new Set([...order, ...lines.keys()])].flatMap((id) =>
    lines.has(id) ? [lines.get(id)!] : [],
  );
  return { merged, conflicts };
}
export function applyContentMerge(
  comparison: ReturnType<typeof compareContent>,
  choices: Record<string, 'local' | 'server'>,
): Content {
  const merged = structuredClone(comparison.merged);
  let order: string[] | undefined;
  for (const item of comparison.conflicts) {
    if (!choices[item.key]) throw new Error('Unresolved content conflict');
    const value = choices[item.key] === 'local' ? item.local : item.server;
    if (item.key.startsWith('head:'))
      Object.assign(merged, { [item.key.slice(5)]: value });
    else if (item.key === 'order') order = value as string[];
    else {
      const id = item.key.slice(5);
      merged.lines = merged.lines.filter((l) => l.id !== id);
      if (value) {
        const line = structuredClone(value) as DemandLine;
        if (item.retired && choices[item.key] === 'local')
          line.id = randomUuid();
        merged.lines.push(line);
      }
    }
  }
  if (order) {
    const rank = new Map(order.map((id, i) => [id, i]));
    merged.lines.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return merged;
}
