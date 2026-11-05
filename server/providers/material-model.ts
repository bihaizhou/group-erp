import { z } from 'zod';

export const materialKinds = [
  'names',
  'templates',
  'skus',
  'units',
  'unitRules',
  'references',
  'tags',
  'tagLinks',
  'requests',
  'subjectSettings',
  'warehouses',
] as const;
export type MaterialKind = (typeof materialKinds)[number];
export const materialTables: Record<MaterialKind, string> = {
  names: 'materialNames',
  templates: 'materialAttributeTemplates',
  skus: 'materialSkus',
  units: 'measureUnits',
  unitRules: 'materialUnitRules',
  references: 'materialReferences',
  tags: 'materialTags',
  tagLinks: 'materialTagLinks',
  requests: 'materialRequests',
  subjectSettings: 'materialSubjectSettings',
  warehouses: 'warehouses',
};
export const materialWorkflowKinds: readonly MaterialKind[] = [
  'skus',
  'unitRules',
  'references',
  'requests',
];
export const materialScopedKinds: readonly MaterialKind[] = [
  'requests',
  'subjectSettings',
  'warehouses',
];
const ref = z.string().uuid();
const optionalRef = ref.nullable().optional();
const text = z.string().trim().max(6000);
const base = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,63}$/)
    .optional(),
  name: z.string().trim().min(1).max(200),
  notes: text.optional(),
};
export const materialAttribute = z.strictObject({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  title: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'number', 'option']),
  required: z.boolean(),
  identity: z.boolean(),
  unit: z.string().trim().max(40).optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});
export const decimalText = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/);
export function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = decimalText.parse(value).split('.');
  const tail = fraction.replace(/0+$/, '');
  return whole + (tail ? `.${tail}` : '');
}
export function positiveDecimal(value: string): boolean {
  return BigInt(value.replace('.', '')) > 0n;
}
export const materialSchemas = {
  names: z.strictObject({ ...base, templateId: optionalRef }),
  templates: z.strictObject({
    ...base,
    fields: z.array(materialAttribute).max(50),
  }),
  skus: z.strictObject({
    ...base,
    materialNameId: ref,
    baseUnitId: ref,
    managementMode: z.enum(['stock', 'nonStock']),
    attributeValues: z.record(z.string(), z.string().max(1000)),
    requestId: ref.optional(),
  }),
  units: z.strictObject({
    ...base,
    unitType: z.enum(['count', 'mass', 'length', 'area', 'volume', 'package']),
    precision: z.number().int().min(0).max(6),
  }),
  unitRules: z.strictObject({
    ...base,
    skuId: ref,
    unitId: ref,
    numerator: decimalText,
    denominator: decimalText,
    // exact: the ratio is a posting fact (1 box = 12 each). reference: the
    // ratio only estimates a counted stock unit from a measured purchase unit.
    conversionMode: z.enum(['exact', 'reference']).default('exact'),
    variancePercent: decimalText.default('3'),
  }),
  references: z.strictObject({
    ...base,
    targetKind: z.enum(['names', 'skus']),
    targetId: ref,
    sourceType: z.enum(['alias', 'legacyCode']),
    subjectId: optionalRef,
  }),
  tags: z.strictObject({
    ...base,
    appliesTo: z.enum(['names', 'skus', 'both']),
  }),
  tagLinks: z.strictObject({
    ...base,
    tagId: ref,
    targetKind: z.enum(['names', 'skus']),
    targetId: ref,
  }),
  requests: z.strictObject({
    ...base,
    subjectId: ref,
    specification: text.min(1),
    proposedUnit: z.string().trim().max(100).optional(),
    usage: text.min(1),
  }),
  subjectSettings: z.strictObject({
    ...base,
    subjectId: ref,
    skuId: ref,
    canPurchase: z.boolean(),
    canSell: z.boolean(),
  }),
  warehouses: z.strictObject({
    ...base,
    subjectId: ref,
    responsiblePositionId: optionalRef,
  }),
};
export const materialQuery = z.strictObject({
  q: z.string().trim().max(200).optional(),
  status: z.string().max(30).optional(),
  subjectId: ref.optional(),
  skuId: ref.optional(),
  materialNameId: ref.optional(),
  baseUnitId: ref.optional(),
  templateId: ref.optional(),
  unitId: ref.optional(),
  tagId: ref.optional(),
  responsiblePositionId: ref.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z
    .enum(['updatedAt', '-updatedAt', 'createdAt', '-createdAt'])
    .default('-updatedAt'),
});
export type MaterialQuery = z.infer<typeof materialQuery>;
export type MaterialRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  revision: number;
  lifecycleVersion: number;
  createdBy: string;
  [key: string]: unknown;
};
export type MaterialActor = { id: string; name?: string };
export class MaterialError extends Error {
  constructor(
    public readonly reason: string,
    public readonly field?: string,
  ) {
    super(reason);
  }
}
export function materialFail(reason: string, field?: string): never {
  throw new MaterialError(reason, field);
}
export function materialView(row: Record<string, unknown>) {
  const {
    revision,
    identityKey: _identityKey,
    searchKey: _searchKey,
    searchText: _searchText,
    ...rest
  } = row;
  return {
    ...rest,
    version: Number(revision ?? 0),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  };
}
export const materialDependencies: Record<MaterialKind, MaterialKind[]> = {
  names: ['templates'],
  templates: [],
  skus: [
    'names',
    'templates',
    'units',
    'requests',
    'references',
    'tags',
    'tagLinks',
  ],
  units: [],
  unitRules: ['skus', 'units'],
  references: ['names', 'skus'],
  tags: [],
  tagLinks: ['tags', 'names', 'skus'],
  requests: ['skus', 'names', 'templates', 'units'],
  subjectSettings: ['skus'],
  warehouses: [],
};
export const materialColumns: Record<MaterialKind, string[]> = {
  names: ['templateId'],
  templates: ['fields'],
  skus: [
    'materialNameId',
    'baseUnitId',
    'managementMode',
    'attributeValues',
    'identityKey',
    'searchText',
  ],
  units: ['unitType', 'precision'],
  unitRules: [
    'skuId',
    'unitId',
    'numerator',
    'denominator',
    'conversionMode',
    'variancePercent',
  ],
  references: [
    'targetKind',
    'targetId',
    'sourceType',
    'subjectId',
    'searchKey',
  ],
  tags: ['appliesTo'],
  tagLinks: ['tagId', 'targetKind', 'targetId'],
  requests: [
    'subjectId',
    'specification',
    'proposedUnit',
    'usage',
    'resolvedSkuId',
  ],
  subjectSettings: ['subjectId', 'skuId', 'canPurchase', 'canSell'],
  warehouses: ['subjectId', 'responsiblePositionId'],
};
export const materialBaseColumns = [
  'id',
  'code',
  'name',
  'notes',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
];
