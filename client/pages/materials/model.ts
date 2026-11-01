export const kinds = [
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
export type Kind = (typeof kinds)[number];
export type Attribute = {
  key: string;
  title: string;
  type: 'text' | 'number' | 'option';
  required: boolean;
  identity: boolean;
  unit?: string;
  options?: string[];
};
export type Row = {
  id: string;
  name: string;
  code: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  updatedAt: string;
  workflow?: {
    available: { name: string; allowed: boolean }[];
    history: {
      id: string;
      transition: string;
      at?: string;
      actor?: { id: string };
      input?: { reason?: string };
    }[];
  };
  [key: string]: unknown;
};
export type Options = Record<
  string,
  { rows: Row[]; total: number; truncated: boolean }
>;
export type FieldSpec = {
  key: string;
  type?: 'text' | 'number' | 'boolean' | 'textarea' | 'select' | 'ref';
  source?: string;
  choices?: string[];
  required?: boolean;
};
export const governed: readonly Kind[] = [
  'skus',
  'unitRules',
  'references',
  'requests',
];
export const large: readonly Kind[] = ['skus', 'templates', 'requests'];
export const fields: Record<Kind, FieldSpec[]> = {
  names: [{ key: 'templateId', type: 'ref', source: 'templates' }],
  templates: [],
  skus: [
    { key: 'materialNameId', type: 'ref', source: 'names', required: true },
    { key: 'baseUnitId', type: 'ref', source: 'units', required: true },
    {
      key: 'managementMode',
      type: 'select',
      choices: ['stock', 'nonStock'],
      required: true,
    },
  ],
  units: [
    {
      key: 'unitType',
      type: 'select',
      choices: ['count', 'mass', 'length', 'area', 'volume', 'package'],
      required: true,
    },
    { key: 'precision', type: 'number', required: true },
  ],
  unitRules: [
    { key: 'skuId', type: 'ref', source: 'skus', required: true },
    { key: 'unitId', type: 'ref', source: 'units', required: true },
    { key: 'numerator', required: true },
    { key: 'denominator', required: true },
  ],
  references: [
    {
      key: 'sourceType',
      type: 'select',
      choices: ['alias', 'legacyCode'],
      required: true,
    },
    {
      key: 'targetKind',
      type: 'select',
      choices: ['names', 'skus'],
      required: true,
    },
    { key: 'targetId', type: 'ref', required: true },
    { key: 'subjectId', type: 'ref', source: 'orgSubjects' },
  ],
  tags: [
    {
      key: 'appliesTo',
      type: 'select',
      choices: ['names', 'skus', 'both'],
      required: true,
    },
  ],
  tagLinks: [
    { key: 'tagId', type: 'ref', source: 'tags', required: true },
    {
      key: 'targetKind',
      type: 'select',
      choices: ['names', 'skus'],
      required: true,
    },
    { key: 'targetId', type: 'ref', required: true },
  ],
  requests: [
    { key: 'subjectId', type: 'ref', source: 'orgSubjects', required: true },
    { key: 'specification', type: 'textarea', required: true },
    { key: 'proposedUnit' },
    { key: 'usage', type: 'textarea', required: true },
  ],
  subjectSettings: [
    { key: 'subjectId', type: 'ref', source: 'orgSubjects', required: true },
    { key: 'skuId', type: 'ref', source: 'skus', required: true },
    { key: 'canPurchase', type: 'boolean' },
    { key: 'canSell', type: 'boolean' },
  ],
  warehouses: [
    { key: 'subjectId', type: 'ref', source: 'orgSubjects', required: true },
    { key: 'responsiblePositionId', type: 'ref', source: 'orgPositions' },
  ],
};
export function kindFromPath(path: string): Kind {
  const match = path.match(/\/materials\/([^/]+)/)?.[1];
  return (
    kinds.find((kind) => kind === match) ??
    (path.includes('/settings/warehouses') ? 'warehouses' : 'skus')
  );
}
export const pathFor = (kind: Kind) =>
  kind === 'warehouses'
    ? '/functions/warehouse/settings/warehouses'
    : `/functions/warehouse/materials${kind === 'skus' ? '' : `/${kind}`}`;
export const pageId = (kind: Kind | 'history') =>
  kind === 'skus' ? 'warehouse-materials' : `warehouse-material-${kind}`;
export const statuses = (kind: Kind) =>
  kind === 'requests'
    ? ['draft', 'pending', 'resolved', 'withdrawn']
    : governed.includes(kind)
      ? ['draft', 'pending', 'active', 'inactive']
      : ['active', 'inactive'];
export const text = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
export function referenceIds(values: Record<string, unknown>) {
  return [
    ...new Set(
      Object.entries(values)
        .filter(
          ([key, value]) =>
            key.endsWith('Id') &&
            typeof value === 'string' &&
            /^[0-9a-f-]{36}$/i.test(value),
        )
        .map(([, value]) => String(value)),
    ),
  ];
}
export const canEdit = (kind: Kind, row: Row) =>
  !governed.includes(kind) ||
  row.status === 'draft' ||
  (row.status === 'active' && kind !== 'requests');
export const actionPermission = (kind: Kind, action: string) =>
  kind === 'requests'
    ? ['return', 'resolve'].includes(action)
      ? 'review'
      : 'update'
    : governed.includes(kind) && action !== 'submit'
      ? 'review'
      : 'update';
