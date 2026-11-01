export const kinds = [
  'subjects',
  'units',
  'positions',
  'sectors',
  'regions',
  'relations',
] as const;
export type OrgKind = (typeof kinds)[number];
export interface OrgRecord {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  [field: string]: string | number | null;
}
export interface OrgOptions {
  [kind: string]: { rows: OrgRecord[]; total: number; truncated: boolean };
}
export interface OrgList {
  data: OrgRecord[];
  meta: { page: number; pageSize: number; total: number };
}
export type Field = {
  key: string;
  required?: boolean;
  type?: 'text' | 'textarea' | 'number' | 'date';
  relation?: OrgKind;
  choices?: string[];
};
const base: Field[] = [
  { key: 'name', required: true },
  { key: 'code', required: true },
];
const tail: Field[] = [
  { key: 'sortOrder', type: 'number' },
  { key: 'notes', type: 'textarea' },
];
export const fields: Record<OrgKind, Field[]> = {
  sectors: [...base, { key: 'parentId', relation: 'sectors' }, ...tail],
  regions: [...base, { key: 'parentId', relation: 'regions' }, ...tail],
  subjects: [
    ...base,
    { key: 'shortName' },
    {
      key: 'type',
      required: true,
      choices: ['group', 'company', 'sharedService'],
    },
    { key: 'registrationCountry' },
    { key: 'registrationNumber' },
    { key: 'parentId', relation: 'subjects' },
    { key: 'sectorId', relation: 'sectors' },
    { key: 'regionId', relation: 'regions' },
    ...tail,
  ],
  units: [
    ...base,
    {
      key: 'type',
      required: true,
      choices: [
        'department',
        'center',
        'division',
        'projectDepartment',
        'other',
      ],
    },
    { key: 'subjectId', required: true, relation: 'subjects' },
    { key: 'parentId', relation: 'units' },
    { key: 'leaderPositionId', relation: 'positions' },
    { key: 'duties', type: 'textarea' },
    ...tail,
  ],
  positions: [
    ...base,
    {
      key: 'productionRole',
      choices: ['support', 'production'],
    },
    { key: 'unitId', required: true, relation: 'units' },
    { key: 'reportsToId', relation: 'positions' },
    { key: 'duties', type: 'textarea' },
    { key: 'requirements', type: 'textarea' },
    ...tail,
  ],
  relations: [
    ...base,
    {
      key: 'type',
      required: true,
      choices: ['management', 'service', 'collaboration'],
    },
    { key: 'sourceKind', required: true, choices: ['subjects', 'units'] },
    { key: 'sourceId', required: true },
    { key: 'targetKind', required: true, choices: ['subjects', 'units'] },
    { key: 'targetId', required: true },
    { key: 'startDate', required: true, type: 'date' },
    { key: 'endDate', type: 'date' },
    ...tail,
  ],
};
export const isSmall = (kind: OrgKind) =>
  kind === 'sectors' || kind === 'regions';
export const selectPopupClass =
  'w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal';

export function sectionForField(
  field: Field,
): 'basic' | 'ownership' | 'responsibilities' {
  if (['duties', 'requirements', 'notes', 'sortOrder'].includes(field.key))
    return 'responsibilities';
  if (
    field.relation ||
    [
      'sourceKind',
      'sourceId',
      'targetKind',
      'targetId',
      'startDate',
      'endDate',
      'sectorId',
      'regionId',
    ].includes(field.key)
  )
    return 'ownership';
  return 'basic';
}
