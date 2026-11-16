import { z } from 'zod';

export const hseIncidentTypes = [
  'injury',
  'near_miss',
  'fire',
  'chemical',
  'environmental',
  'property',
  'other',
] as const;
export const hseIncidentSeverities = [
  'minor',
  'moderate',
  'major',
  'fatality',
] as const;
export const hseIncidentStatuses = [
  'reported',
  'investigating',
  'rectifying',
  'verifying',
  'closed',
] as const;
export const hseHazardSources = [
  'inspection',
  'walkthrough',
  'report',
  'plc',
  'other',
] as const;
export const hseHazardLevels = ['general', 'major'] as const;
export const hseHazardStatuses = [
  'open',
  'rectifying',
  'verifying',
  'closed',
] as const;
export const hseCertificateTypes = [
  'pollution',
  'hazardous_waste',
  'fire',
  'safety',
  'occupational',
  'special_operation',
  'other',
] as const;
export const hseCertificateStatuses = [
  'active',
  'expiring',
  'expired',
  'revoked',
] as const;

const optionalId = z.string().min(1).max(36).nullable().optional();
const subjectId = z.string().min(1).max(36).optional();
const version = z.number().int().positive();
const ownerId = z.string().max(36).nullable().optional();
/** A civil date that must be a real YYYY-MM-DD, not just ten characters. */
const dueAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date',
  })
  .nullable()
  .optional();

export const hseIncidentCreate = z.object({
  subjectId,
  unitId: optionalId,
  occurredAt: z.string().min(10).max(40),
  type: z.enum(hseIncidentTypes),
  severity: z.enum(hseIncidentSeverities),
  location: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  injuryCount: z.coerce.number().int().min(0).max(100000).default(0),
  lostDays: z.coerce.number().int().min(0).max(100000).default(0),
  environmentalRelease: z.boolean().default(false),
});

export const hseIncidentUpdate = z.object({
  version,
  severity: z.enum(hseIncidentSeverities).optional(),
  investigatorId: z.string().trim().max(200).nullable().optional(),
  ownerId,
  dueAt,
  rootCause: z.string().max(5000).optional(),
  actions: z.string().max(5000).optional(),
  injuryCount: z.coerce.number().int().min(0).max(100000).optional(),
  lostDays: z.coerce.number().int().min(0).max(100000).optional(),
  environmentalRelease: z.boolean().optional(),
});

export const hseIncidentTransition = z.object({
  version,
  action: z.enum(['investigate', 'rectify', 'submit', 'verify', 'return']),
  investigatorId: z.string().trim().min(1).max(200).optional(),
  ownerId,
  dueAt,
  rootCause: z.string().max(5000).optional(),
  actions: z.string().max(5000).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const hseOverviewQuery = z.object({
  subjectId: z.string().max(36).optional(),
  horizonDays: z.coerce.number().int().min(1).max(365).default(90),
});

export const hseIncidentQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseIncidentStatuses).optional(),
  type: z.enum(hseIncidentTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseHazardCreate = z.object({
  subjectId,
  unitId: optionalId,
  source: z.enum(hseHazardSources),
  level: z.enum(hseHazardLevels),
  description: z.string().trim().min(1).max(500),
  location: z.string().trim().min(1).max(200),
  discoveredAt: z.string().min(10).max(10),
  ownerId,
  ownerName: z.string().trim().min(1).max(100),
  dueAt,
  rectification: z.string().max(5000).default(''),
  sourceRef: z.string().trim().max(64).nullable().optional(),
  inspectorId: optionalId,
});

export const hseHazardUpdate = z.object({
  version,
  level: z.enum(hseHazardLevels).optional(),
  ownerId,
  ownerName: z.string().trim().min(1).max(100).optional(),
  dueAt,
  rectification: z.string().max(5000).optional(),
  sourceRef: z.string().trim().max(64).nullable().optional(),
  inspectorId: optionalId,
});

export const hseHazardTransition = z.object({
  version,
  action: z.enum([
    'startRectification',
    'submitVerification',
    'verify',
    'return',
  ]),
  ownerId,
  dueAt,
  rectification: z.string().max(5000).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const hseHazardQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseHazardStatuses).optional(),
  level: z.enum(hseHazardLevels).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseIncidentExportQuery = hseIncidentQuery.omit({
  page: true,
  pageSize: true,
});

export const hseHazardExportQuery = hseHazardQuery.omit({
  page: true,
  pageSize: true,
});


export const hseCertificateCreate = z.object({
  subjectId,
  holderType: z.enum(['company', 'person']).default('company'),
  holderId: z.string().max(200).nullable().optional(),
  holderName: z.string().trim().min(1).max(200),
  certType: z.enum(hseCertificateTypes),
  certNo: z.string().trim().min(1).max(100),
  issuedAt: z.string().min(10).max(10).nullable().optional(),
  expiresAt: z.string().min(10).max(10),
  authority: z.string().max(200).default(''),
  fileId: z.string().max(64).nullable().optional(),
});

export const hseCertificateUpdate = z.object({
  version,
  holderName: z.string().trim().min(1).max(200).optional(),
  certNo: z.string().trim().min(1).max(100).optional(),
  issuedAt: z.string().min(10).max(10).nullable().optional(),
  expiresAt: z.string().min(10).max(10).optional(),
  authority: z.string().max(200).optional(),
  fileId: z.string().max(64).nullable().optional(),
});

export const hseCertificateTransition = z.object({
  version,
  action: z.enum(['renew', 'revoke', 'reinstate']),
  expiresAt: z.string().min(10).max(10).optional(),
  issuedAt: z.string().min(10).max(10).nullable().optional(),
  authority: z.string().max(200).optional(),
  note: z.string().trim().min(1).max(2000),
});

export const hseCertificateQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseCertificateStatuses).optional(),
  type: z.enum(hseCertificateTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseIdParams = z.object({ id: z.string().min(1).max(36) });

export type HseIncidentCreate = z.infer<typeof hseIncidentCreate>;
export type HseIncidentUpdate = z.infer<typeof hseIncidentUpdate>;
export type HseIncidentTransition = z.infer<typeof hseIncidentTransition>;
export type HseIncidentQuery = z.infer<typeof hseIncidentQuery>;
export type HseHazardCreate = z.infer<typeof hseHazardCreate>;
export type HseHazardUpdate = z.infer<typeof hseHazardUpdate>;
export type HseHazardTransition = z.infer<typeof hseHazardTransition>;
export type HseHazardQuery = z.infer<typeof hseHazardQuery>;
export type HseCertificateCreate = z.infer<typeof hseCertificateCreate>;
export type HseCertificateUpdate = z.infer<typeof hseCertificateUpdate>;
export type HseCertificateTransition = z.infer<typeof hseCertificateTransition>;
export type HseCertificateQuery = z.infer<typeof hseCertificateQuery>;
