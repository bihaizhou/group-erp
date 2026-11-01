export type ProductionOption = {
  id: string;
  code?: string;
  name: string;
  type?: 'group' | 'company' | 'sharedService';
};
export type ProductionUnitOption = ProductionOption & { subjectId: string };
export type ProductionOptions = {
  subjects: ProductionOption[];
  units: ProductionUnitOption[];
};

export type AttendanceStatus =
  'present' | 'absent' | 'leave' | 'rest' | 'unrecorded';

export type AttendanceRow = {
  id: string;
  personId: string;
  personName: string;
  positionId: string;
  positionName: string;
  status: AttendanceStatus;
  absenceReason: string | null;
  overtimeMinutes: number;
  overtimeContent: string | null;
};

export type AttendanceSummary = {
  expected: number;
  present: number;
  absent: number;
  leave: number;
  rest: number;
  unrecorded: number;
  overtimePeople: number;
  overtimeMinutes: number;
};

export type AttendanceRoster = {
  unit: { id: string; name: string };
  subjectName: string;
  workDate: string;
  shift: 'day' | 'night';
  rows: AttendanceRow[];
  summary: AttendanceSummary;
};

export type ProductionSetupUnit = {
  id: string;
  code: string;
  name: string;
  subjectId: string;
};

export type ProductionUnitProfile = {
  unitId: string;
  lineCode: string | null;
  processType: string | null;
  designCapacityTpd: number | null;
  commissionDate: string | null;
  region: string | null;
  gatewayKey: string | null;
  fuxaPageKey: string | null;
  status: string;
};

export type ProductionOutputMapping = {
  unitId: string;
  outputType: 'metal' | 'sand';
  skuId: string;
  skuCode: string | null;
  skuName: string | null;
  defaultWarehouseId: string | null;
  warehouseName: string | null;
  notes: string | null;
};

export type ProductionSetup = {
  units: ProductionSetupUnit[];
  profiles: ProductionUnitProfile[];
  outputs: ProductionOutputMapping[];
  skus: { id: string; code: string; name: string }[];
  warehouses: { id: string; code: string; name: string; subjectId: string }[];
};

export type ShiftReportStatus = 'draft' | 'confirmed' | 'void';

export type ShiftReportOutput = {
  id: string;
  outputType: 'metal' | 'sand';
  skuId: string;
  warehouseId: string | null;
  quantity: string;
  stockDocumentId: string | null;
  stockDocumentStatus: string | null;
};

export type ShiftReportCorrectionOutput = {
  outputType: 'metal' | 'sand';
  skuId: string;
  warehouseId: string | null;
  quantity: string;
  stockDocumentId: string | null;
};

export type ShiftReportInputLine = {
  id: string;
  reportId: string;
  skuId: string;
  skuCode: string | null;
  skuName: string | null;
  quantity: string;
  unitId: string;
  unit: string | null;
  sourceType: 'manual' | 'issue';
  issueRequestId: string | null;
  issueRequestLineId: string | null;
  stockDocumentId: string | null;
  stockDocumentLineId: string | null;
  stockDocumentCode: string | null;
  stockDocumentStatus: string | null;
  note: string | null;
  version: number;
};

export type ShiftReportInputOptions = {
  materials: {
    id: string;
    code: string;
    name: string;
    unitId: string;
    unit: string | null;
    managementMode: string | null;
  }[];
  issueDocuments: {
    id: string;
    code: string;
    occurredOn: string;
    warehouseId: string;
    issueRequestId: string | null;
    lines: {
      id: string;
      skuId: string;
      skuCode: string | null;
      skuName: string | null;
      quantity: string;
      unitId: string;
      unit: string | null;
      issueRequestId: string | null;
      issueRequestLineId: string | null;
    }[];
  }[];
};

export type ShiftReportCorrection = {
  revision: number;
  voidedAt: string;
  voidedBy: string;
  reason: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  values: {
    processedQuantity: string;
    metalQuantity: string;
    sandQuantity: string;
    tailingsQuantity: string;
    runtimeMinutes: number;
    downtimeMinutes: number;
    notes: string | null;
  };
  inputs?: {
    skuId: string;
    skuCode: string | null;
    skuName: string | null;
    quantity: string;
    unit: string | null;
    sourceType: 'manual' | 'issue';
    stockDocumentId: string | null;
    note: string | null;
  }[];
  outputs: ShiftReportCorrectionOutput[];
};

export type ShiftReport = {
  id: string;
  subjectId: string;
  unitId: string;
  unitName?: string;
  subjectName?: string;
  reportDate: string;
  shift: 'day' | 'night';
  status: ShiftReportStatus;
  processedQuantity: string;
  metalQuantity: string;
  sandQuantity: string;
  tailingsQuantity: string;
  runtimeMinutes: number;
  downtimeMinutes: number;
  notes: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  correctionHistory: ShiftReportCorrection[];
  version: number;
  updatedAt: string;
  inputs?: ShiftReportInputLine[];
  outputs?: ShiftReportOutput[];
};

export type ShiftReportPage = {
  data: ShiftReport[];
  meta: { page: number; pageSize: number; total: number };
};

export type ProductionScheduleStatus = 'draft' | 'published';

export type ProductionSchedulePerson = {
  personId: string;
  personName: string;
  positionId: string;
  positionName: string;
  assigned: boolean;
};

export type ProductionSchedule = {
  id: string;
  subjectId: string;
  unitId: string;
  scheduleDate: string;
  shift: 'day' | 'night';
  status: ProductionScheduleStatus;
  notes: string | null;
  version: number;
  updatedAt: string;
};

export type ProductionSchedulePayload = {
  schedule: ProductionSchedule | null;
  unit: { id: string; name: string };
  subjectName: string;
  scheduleDate: string;
  shift: 'day' | 'night';
  people: ProductionSchedulePerson[];
  summary: { planned: number; assigned: number };
};

export type EquipmentCriticality = 'high' | 'normal' | 'low';
export type EquipmentStatus = 'active' | 'maintenance' | 'retired';
export type MaintenanceType = 'repair' | 'preventive' | 'inspection';
export type MaintenancePriority = 'high' | 'normal' | 'low';
export type MaintenanceStatus =
  'reported' | 'in_progress' | 'completed' | 'cancelled';

export type ProductionEquipment = {
  id: string;
  subjectId: string;
  unitId: string;
  code: string;
  name: string;
  category: string | null;
  criticality: EquipmentCriticality;
  status: EquipmentStatus;
  location: string | null;
  commissionedOn: string | null;
  notes: string | null;
  version: number;
  updatedAt: string;
};

export type MaintenancePlanType = 'preventive' | 'inspection';
export type MaintenancePlanStatus = 'active' | 'paused';
export type MaintenanceDueStatus = 'ok' | 'due_soon' | 'overdue' | 'paused';

export type ProductionMaintenancePlan = {
  id: string;
  subjectId: string;
  unitId: string;
  equipmentId: string;
  equipmentName: string;
  name: string;
  type: MaintenancePlanType;
  intervalDays: number;
  nextDueOn: string;
  checklist: string | null;
  assigneeName: string | null;
  status: MaintenancePlanStatus;
  dueStatus: MaintenanceDueStatus;
  lastCompletedOn: string | null;
  lastOrderId: string | null;
  openOrderId: string | null;
  openOrderNo: string | null;
  version: number;
  updatedAt: string;
};

export type ProductionMaintenanceOrder = {
  id: string;
  subjectId: string;
  unitId: string;
  equipmentId: string;
  equipmentName: string;
  planId: string | null;
  orderNo: string;
  type: MaintenanceType;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  reportedBy: string;
  reportedAt: string;
  assigneeName: string | null;
  description: string;
  cause: string | null;
  solution: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  downtimeMinutes: number;
  version: number;
  updatedAt: string;
};

export type OvertimeType = 'planned' | 'temporary' | 'holiday';
export type OvertimeStatus =
  'submitted' | 'approved' | 'rejected' | 'cancelled';
export type OvertimeCompensation = 'time_off' | 'pay' | 'none';

export type ProductionOvertime = {
  id: string;
  requestNo: string;
  subjectId: string;
  unitId: string;
  unitName: string;
  personId: string;
  personName: string;
  positionId: string;
  positionName: string;
  businessDate: string;
  hours: string;
  type: OvertimeType;
  reason: string;
  compensation: OvertimeCompensation;
  status: OvertimeStatus;
  approverId: string | null;
  approverName: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  version: number;
};

export type DowntimeCategory =
  'equipment' | 'production' | 'utility' | 'material' | 'quality' | 'other';
export type DowntimeImpact = 'stop' | 'speed_loss' | 'other';
export type DowntimeStatus = 'open' | 'closed' | 'cancelled';

export type ProductionDowntime = {
  id: string;
  eventNo: string;
  subjectId: string;
  unitId: string;
  unitName: string;
  equipmentId: string | null;
  equipmentName: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  category: DowntimeCategory;
  impact: DowntimeImpact;
  status: DowntimeStatus;
  description: string;
  resolution: string | null;
  reportedBy: string;
  closedBy: string | null;
  version: number;
};

export type ProductionDowntimePage = {
  events: ProductionDowntime[];
  summary: { open: number; closed: number; minutes: number };
};
