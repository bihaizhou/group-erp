import { z } from 'zod';

export const kinds = [
  'subjects',
  'units',
  'positions',
  'sectors',
  'regions',
  'relations',
] as const;
export type OrgKind = (typeof kinds)[number];
export const tables: Record<OrgKind, string> = {
  subjects: 'orgSubjects',
  units: 'orgUnits',
  positions: 'orgPositions',
  sectors: 'orgSectors',
  regions: 'orgRegions',
  relations: 'orgRelations',
};
const ref = z.string().uuid().nullable().optional();
const text = z.string().trim().max(6000).nullable().optional();
const base = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,63}$/),
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(999999).default(0),
  notes: text,
};
export const inputSchemas = {
  sectors: z.strictObject({ ...base, parentId: ref }),
  regions: z.strictObject({ ...base, parentId: ref }),
  subjects: z.strictObject({
    ...base,
    type: z.enum(['group', 'company', 'sharedService']),
    shortName: z.string().trim().max(100).nullable().optional(),
    parentId: ref,
    sectorId: ref,
    regionId: ref,
    registrationCountry: z.string().trim().max(100).nullable().optional(),
    registrationNumber: z.string().trim().max(100).nullable().optional(),
  }),
  units: z.strictObject({
    ...base,
    type: z.enum([
      'department',
      'center',
      'division',
      'projectDepartment',
      'other',
    ]),
    subjectId: z.string().uuid(),
    parentId: ref,
    leaderPositionId: ref,
    duties: text,
  }),
  positions: z.strictObject({
    ...base,
    unitId: z.string().uuid(),
    reportsToId: ref,
    duties: text,
    requirements: text,
    productionRole: z.enum(['production', 'support']).optional(),
  }),
  relations: z.strictObject({
    ...base,
    type: z.enum(['management', 'service', 'collaboration']),
    sourceKind: z.enum(['subjects', 'units']),
    sourceId: z.string().uuid(),
    targetKind: z.enum(['subjects', 'units']),
    targetId: z.string().uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable().optional(),
  }),
};
export type OrgRecord = {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  version: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  [field: string]: unknown;
};
export type OrgInput = Record<string, unknown>;
export type Actor = { id: string; name: string };
export class OrganizationError extends Error {
  constructor(
    public readonly reason: string,
    public readonly field?: string,
  ) {
    super(reason);
  }
}
export const orgResource = { type: 'settings', id: 'organization' } as const;
