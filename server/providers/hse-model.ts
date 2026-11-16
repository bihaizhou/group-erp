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
export const hseInspectionTypes = [
  'routine',
  'special',
  'comprehensive',
  'follow_up',
] as const;
export const hseInspectionStatuses = ['planned', 'completed'] as const;
export const hseWorkPermitTypes = [
  'hot_work',
  'confined_space',
  'work_at_height',
  'lifting',
  'electrical',
  'excavation',
  'other',
] as const;
export const hseWorkPermitStatuses = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'closed',
] as const;
export const hseTrainingCourseTypes = [
  'safety',
  'fire',
  'occupational',
  'emergency',
  'special_operation',
  'other',
] as const;
export const hseTrainingStatuses = ['completed', 'expired'] as const;
export const hseActionSourceTypes = [
  'inspection',
  'hazard',
  'incident',
  'permit',
  'training',
  'other',
] as const;
export const hseActionStatuses = ['open', 'completed', 'verified'] as const;

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

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date',
  });
const checklist = z.array(z.string().trim().min(1).max(500)).min(1).max(200);
const riskMeasures = z
  .array(z.string().trim().min(1).max(1000))
  .min(1)
  .max(200);

export const hseInspectionCreate = z.object({
  subjectId,
  unitId: optionalId,
  type: z.enum(hseInspectionTypes),
  plannedAt: civilDate,
  inspectorId: z.string().trim().max(200).nullable().optional(),
  checklist,
});

export const hseInspectionUpdate = z.object({
  version,
  type: z.enum(hseInspectionTypes).optional(),
  plannedAt: civilDate.optional(),
  inspectorId: z.string().trim().max(200).nullable().optional(),
  checklist: checklist.optional(),
});

export const hseInspectionTransition = z.object({
  version,
  action: z.literal('complete'),
  findingsCount: z.coerce.number().int().min(0).max(100000).default(0),
  note: z.string().trim().max(2000).optional(),
});

export const hseInspectionQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseInspectionStatuses).optional(),
  type: z.enum(hseInspectionTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseWorkPermitCreate = z.object({
  subjectId,
  unitId: optionalId,
  permitNo: z.string().trim().min(1).max(64),
  type: z.enum(hseWorkPermitTypes),
  workDescription: z.string().trim().min(1).max(1000),
  location: z.string().trim().min(1).max(200),
  contractorId: optionalId,
  validFrom: z.string().min(10).max(40),
  validTo: z.string().min(10).max(40),
  riskMeasures,
  gasTest: z.record(z.string(), z.unknown()).nullable().optional(),
  linkedMaintenanceOrderId: optionalId,
});

export const hseWorkPermitUpdate = z.object({
  version,
  unitId: optionalId,
  workDescription: z.string().trim().min(1).max(1000).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  contractorId: optionalId,
  validFrom: z.string().min(10).max(40).optional(),
  validTo: z.string().min(10).max(40).optional(),
  riskMeasures: riskMeasures.optional(),
  gasTest: z.record(z.string(), z.unknown()).nullable().optional(),
  linkedMaintenanceOrderId: optionalId,
});

export const hseWorkPermitTransition = z.object({
  version,
  action: z.enum(['submit', 'approve', 'reject', 'close']),
  note: z.string().trim().max(2000).optional(),
});

export const hseWorkPermitQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseWorkPermitStatuses).optional(),
  type: z.enum(hseWorkPermitTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseTrainingRecordCreate = z.object({
  subjectId,
  personId: z.string().min(1).max(36),
  courseType: z.enum(hseTrainingCourseTypes),
  courseName: z.string().trim().min(1).max(200),
  completedAt: civilDate,
  score: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  certificateId: z.string().max(36).nullable().optional(),
  status: z.enum(hseTrainingStatuses).default('completed'),
});

export const hseTrainingRecordUpdate = z.object({
  version,
  courseType: z.enum(hseTrainingCourseTypes).optional(),
  courseName: z.string().trim().min(1).max(200).optional(),
  completedAt: civilDate.optional(),
  score: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  certificateId: z.string().max(36).nullable().optional(),
});

export const hseTrainingRecordQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseTrainingStatuses).optional(),
  courseType: z.enum(hseTrainingCourseTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const hseActionCreate = z.object({
  subjectId,
  unitId: optionalId,
  sourceType: z.enum(hseActionSourceTypes),
  sourceId: z.string().trim().min(1).max(36),
  description: z.string().trim().min(1).max(500),
  ownerId: z.string().trim().max(200).nullable().optional(),
  ownerName: z.string().trim().min(1).max(100),
  dueAt,
});

export const hseActionUpdate = z.object({
  version,
  unitId: optionalId,
  description: z.string().trim().min(1).max(500).optional(),
  ownerId: z.string().trim().max(200).nullable().optional(),
  ownerName: z.string().trim().min(1).max(100).optional(),
  dueAt,
});

export const hseActionTransition = z.object({
  version,
  action: z.enum(['complete', 'verify']),
  note: z.string().trim().max(2000).optional(),
});

export const hseActionQuery = z.object({
  subjectId: z.string().max(36).optional(),
  status: z.enum(hseActionStatuses).optional(),
  sourceType: z.enum(hseActionSourceTypes).optional(),
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
export type HseInspectionCreate = z.infer<typeof hseInspectionCreate>;
export type HseInspectionUpdate = z.infer<typeof hseInspectionUpdate>;
export type HseInspectionTransition = z.infer<typeof hseInspectionTransition>;
export type HseInspectionQuery = z.infer<typeof hseInspectionQuery>;
export type HseWorkPermitCreate = z.infer<typeof hseWorkPermitCreate>;
export type HseWorkPermitUpdate = z.infer<typeof hseWorkPermitUpdate>;
export type HseWorkPermitTransition = z.infer<typeof hseWorkPermitTransition>;
export type HseWorkPermitQuery = z.infer<typeof hseWorkPermitQuery>;
export type HseTrainingRecordCreate = z.infer<typeof hseTrainingRecordCreate>;
export type HseTrainingRecordUpdate = z.infer<typeof hseTrainingRecordUpdate>;
export type HseTrainingRecordQuery = z.infer<typeof hseTrainingRecordQuery>;
export type HseActionCreate = z.infer<typeof hseActionCreate>;
export type HseActionUpdate = z.infer<typeof hseActionUpdate>;
export type HseActionTransition = z.infer<typeof hseActionTransition>;
export type HseActionQuery = z.infer<typeof hseActionQuery>;
