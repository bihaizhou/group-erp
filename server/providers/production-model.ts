import { z } from 'zod';
import { positiveDecimal } from './material-model.js';

export const attendanceStatuses = [
  'present',
  'absent',
  'leave',
  'rest',
] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const productionShifts = ['day', 'night'] as const;
export type ProductionShift = (typeof productionShifts)[number];

export const attendanceQuery = z.strictObject({
  unitId: z.string().uuid(),
  workDate: z.iso.date(),
  shift: z.enum(productionShifts),
});

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const attendanceRecordInput = z.strictObject({
  personId: z.string().uuid(),
  positionId: z.string().uuid(),
  status: z.enum(attendanceStatuses),
  absenceReason: nullableText(200),
  overtimeMinutes: z.number().int().min(0).max(1440).default(0),
  overtimeContent: nullableText(500),
});

export const attendanceSave = z.strictObject({
  unitId: z.string().uuid(),
  workDate: z.iso.date(),
  shift: z.enum(productionShifts),
  records: z.array(attendanceRecordInput).max(500),
});

export const productionScheduleStatuses = ['draft', 'published'] as const;
export type ProductionScheduleStatus =
  (typeof productionScheduleStatuses)[number];

export const productionScheduleParams = z.strictObject({
  unitId: z.string().uuid(),
  scheduleDate: z.iso.date(),
  shift: z.enum(productionShifts),
});

export const productionScheduleSave = z.strictObject({
  unitId: z.string().uuid(),
  scheduleDate: z.iso.date(),
  shift: z.enum(productionShifts),
  personIds: z.array(z.string().uuid()).max(500).default([]),
  notes: nullableText(2000),
});

export const productionScheduleId = z.object({ id: z.string().uuid() });

export const equipmentCriticalities = ['high', 'normal', 'low'] as const;
export const equipmentStatuses = ['active', 'maintenance', 'retired'] as const;
export const maintenanceTypes = ['repair', 'preventive', 'inspection'] as const;
export const maintenancePriorities = ['high', 'normal', 'low'] as const;
export const maintenanceStatuses = [
  'reported',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export const equipmentQuery = z.strictObject({
  unitId: z.string().uuid().optional(),
});
export const equipmentInput = z.strictObject({
  unitId: z.string().uuid(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  category: nullableText(64),
  criticality: z.enum(equipmentCriticalities).default('normal'),
  status: z.enum(equipmentStatuses).default('active'),
  location: nullableText(200),
  commissionedOn: z.iso.date().nullable().optional(),
  notes: nullableText(2000),
});
export const equipmentUpdate = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  category: nullableText(64),
  criticality: z.enum(equipmentCriticalities).optional(),
  status: z.enum(equipmentStatuses).optional(),
  location: nullableText(200),
  commissionedOn: z.iso.date().nullable().optional(),
  notes: nullableText(2000),
  version: z.number().int().positive(),
});
export const equipmentParams = z.object({ id: z.string().uuid() });

export const maintenanceQuery = z.strictObject({
  unitId: z.string().uuid().optional(),
  status: z.enum(maintenanceStatuses).optional(),
});
export const maintenanceInput = z.strictObject({
  unitId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  type: z.enum(maintenanceTypes).default('repair'),
  priority: z.enum(maintenancePriorities).default('normal'),
  description: z.string().trim().min(1).max(2000),
  assigneeName: nullableText(100),
  reportedAt: z.iso.datetime({ offset: true }).optional(),
});
export const maintenanceUpdate = z.strictObject({
  status: z.enum(maintenanceStatuses).optional(),
  assigneeName: nullableText(100),
  cause: nullableText(2000),
  solution: nullableText(2000),
  downtimeMinutes: z.number().int().min(0).max(100000).optional(),
  version: z.number().int().positive(),
});
export const maintenanceParams = z.object({ id: z.string().uuid() });

export const maintenancePlanTypes = ['preventive', 'inspection'] as const;
export const maintenancePlanStatuses = ['active', 'paused'] as const;

export const maintenancePlanQuery = z.strictObject({
  unitId: z.string().uuid().optional(),
});

export const maintenancePlanInput = z.strictObject({
  unitId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(maintenancePlanTypes).default('preventive'),
  intervalDays: z.number().int().min(1).max(3650),
  nextDueOn: z.iso.date(),
  checklist: nullableText(4000),
  assigneeName: nullableText(100),
});

export const maintenancePlanUpdate = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(maintenancePlanTypes).optional(),
  intervalDays: z.number().int().min(1).max(3650).optional(),
  nextDueOn: z.iso.date().optional(),
  checklist: nullableText(4000),
  assigneeName: nullableText(100),
  status: z.enum(maintenancePlanStatuses).optional(),
  version: z.number().int().positive(),
});

export const maintenancePlanParams = z.object({ id: z.string().uuid() });
export type MaintenancePlanInput = z.infer<typeof maintenancePlanInput>;
export type MaintenancePlanUpdate = z.infer<typeof maintenancePlanUpdate>;
export type EquipmentInput = z.infer<typeof equipmentInput>;
export type EquipmentUpdate = z.infer<typeof equipmentUpdate>;
export type MaintenanceInput = z.infer<typeof maintenanceInput>;
export type MaintenanceUpdate = z.infer<typeof maintenanceUpdate>;

export const overtimeTypes = ['planned', 'temporary', 'holiday'] as const;
export type OvertimeType = (typeof overtimeTypes)[number];
export const overtimeStatuses = [
  'submitted',
  'approved',
  'rejected',
  'cancelled',
] as const;
export const overtimeCompensations = ['time_off', 'pay', 'none'] as const;

export const overtimeCandidatesQuery = z.strictObject({
  unitId: z.string().uuid(),
  businessDate: z.iso.date(),
});

export const overtimeQuery = z.strictObject({
  unitId: z.string().uuid().optional(),
  businessDate: z.iso.date().optional(),
  status: z.enum(overtimeStatuses).optional(),
});

export const overtimeInput = z.strictObject({
  unitId: z.string().uuid(),
  personId: z.string().uuid(),
  businessDate: z.iso.date(),
  hours: z.number().min(0.5).max(24).multipleOf(0.5),
  type: z.enum(overtimeTypes).default('temporary'),
  reason: z.string().trim().min(1).max(500),
  compensation: z.enum(overtimeCompensations).default('none'),
});

export const overtimeDecision = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  version: z.number().int().positive(),
  reason: nullableText(500),
});

export const overtimeParams = z.object({ id: z.string().uuid() });
export type OvertimeInput = z.infer<typeof overtimeInput>;
export type OvertimeDecision = z.infer<typeof overtimeDecision>;

export const downtimeCategories = [
  'equipment',
  'production',
  'utility',
  'material',
  'quality',
  'other',
] as const;
export const downtimeImpacts = ['stop', 'speed_loss', 'other'] as const;
export const downtimeStatuses = ['open', 'closed', 'cancelled'] as const;

export const downtimeQuery = z.strictObject({
  unitId: z.string().uuid().optional(),
  date: z.iso.date().optional(),
  status: z.enum(downtimeStatuses).optional(),
});

export const downtimeInput = z.strictObject({
  unitId: z.string().uuid(),
  equipmentId: z.string().uuid().nullable().optional(),
  startedAt: z.string().trim().min(1).max(40),
  category: z.enum(downtimeCategories).default('equipment'),
  impact: z.enum(downtimeImpacts).default('stop'),
  description: z.string().trim().min(1).max(1000),
});

export const downtimeClose = z.strictObject({
  endedAt: z.string().trim().min(1).max(40),
  resolution: z.string().trim().min(1).max(1000),
  version: z.number().int().positive(),
});

export const downtimeCancel = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
});

export const downtimeParams = z.object({ id: z.string().uuid() });
export type DowntimeInput = z.infer<typeof downtimeInput>;
export type DowntimeClose = z.infer<typeof downtimeClose>;
export type DowntimeCancel = z.infer<typeof downtimeCancel>;

export const productionOutputTypes = ['metal', 'sand'] as const;
export type ProductionOutputType = (typeof productionOutputTypes)[number];

export const unitSetupParams = z.object({ unitId: z.string().uuid() });

export const unitSetupInput = z.strictObject({
  lineCode: nullableText(64),
  processType: nullableText(64),
  designCapacityTpd: z.number().int().min(0).max(100000).nullable().optional(),
  commissionDate: z.iso.date().nullable().optional(),
  region: nullableText(100),
  gatewayKey: nullableText(100),
  fuxaPageKey: nullableText(200),
  status: z.enum(['active', 'inactive']).default('active'),
  outputs: z
    .array(
      z.strictObject({
        outputType: z.enum(productionOutputTypes),
        skuId: z.string().uuid(),
        defaultWarehouseId: z.string().uuid().nullable().optional(),
        notes: nullableText(1000),
      }),
    )
    .max(productionOutputTypes.length)
    .default([]),
});

export type AttendanceQuery = z.infer<typeof attendanceQuery>;
export type AttendanceRecordInput = z.infer<typeof attendanceRecordInput>;
export type AttendanceSave = z.infer<typeof attendanceSave>;
export type UnitSetupInput = z.infer<typeof unitSetupInput>;

export const shiftReportStatuses = ['draft', 'confirmed', 'void'] as const;
export type ShiftReportStatus = (typeof shiftReportStatuses)[number];

const reportQuantity = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/);
const positiveReportQuantity = reportQuantity.refine(positiveDecimal, {
  message: 'Quantity must be positive.',
});

export const shiftReportParams = z.object({ id: z.string().uuid() });

export const shiftReportQuery = z.strictObject({
  unitId: z.string().uuid(),
  reportDate: z.iso.date().optional(),
  status: z.enum(shiftReportStatuses).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const shiftReportInput = z.strictObject({
  unitId: z.string().uuid(),
  reportDate: z.iso.date(),
  shift: z.enum(productionShifts),
  processedQuantity: reportQuantity,
  metalQuantity: reportQuantity,
  sandQuantity: reportQuantity,
  tailingsQuantity: reportQuantity.default('0'),
  runtimeMinutes: z.number().int().min(0).max(1440).default(0),
  downtimeMinutes: z.number().int().min(0).max(1440).default(0),
  notes: nullableText(2000),
});

export const shiftReportUpdate = shiftReportInput
  .omit({ unitId: true, reportDate: true, shift: true })
  .extend({ version: z.number().int().min(1) });

export const shiftReportMutation = z.strictObject({
  version: z.number().int().min(1),
});

export const shiftReportVoid = z.strictObject({
  version: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});

export const shiftReportInputSources = ['manual', 'issue'] as const;
export type ShiftReportInputSource = (typeof shiftReportInputSources)[number];

export const shiftReportInputCreate = z
  .strictObject({
    version: z.number().int().min(1),
    sourceType: z.enum(shiftReportInputSources).default('manual'),
    skuId: z.string().uuid(),
    quantity: positiveReportQuantity,
    note: nullableText(1000),
    issueRequestId: z.string().uuid().nullable().default(null),
    issueRequestLineId: z.string().uuid().nullable().default(null),
    stockDocumentId: z.string().uuid().nullable().default(null),
    stockDocumentLineId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'manual') {
      if (!value.note) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'Manual consumption requires a reason.',
        });
      }
      if (value.stockDocumentId || value.stockDocumentLineId) {
        ctx.addIssue({
          code: 'custom',
          path: ['stockDocumentId'],
          message: 'Manual consumption cannot reference an issue document.',
        });
      }
      return;
    }
    if (!value.stockDocumentId || !value.stockDocumentLineId) {
      ctx.addIssue({
        code: 'custom',
        path: ['stockDocumentId'],
        message: 'Issue consumption requires an issue document line.',
      });
    }
    if (!value.issueRequestId || !value.issueRequestLineId) {
      ctx.addIssue({
        code: 'custom',
        path: ['issueRequestId'],
        message: 'Issue consumption requires an approved issue request.',
      });
    }
  });

export const shiftReportInputUpdate = z.strictObject({
  version: z.number().int().min(1),
  quantity: positiveReportQuantity,
  note: nullableText(1000),
});

export const shiftReportInputParams = z.object({
  id: z.string().uuid(),
  inputId: z.string().uuid(),
});

export const shiftReportInputDelete = z.strictObject({
  version: z.number().int().min(1),
});

export type ShiftReportInput = z.infer<typeof shiftReportInput>;
export type ShiftReportLineInput = z.infer<typeof shiftReportInputCreate>;
export type ShiftReportLineUpdate = z.infer<typeof shiftReportInputUpdate>;
export type ShiftReportLineDelete = z.infer<typeof shiftReportInputDelete>;
export type ShiftReportUpdate = z.infer<typeof shiftReportUpdate>;
export type ShiftReportVoid = z.infer<typeof shiftReportVoid>;
export type ShiftReportQuery = z.infer<typeof shiftReportQuery>;
