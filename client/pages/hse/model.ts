export type HseOption = { id: string; name: string };
export type HseUnitOption = HseOption & { subjectId: string };
export type HseEmployeeOption = HseOption & { code: string; subjectId: string };
export type HseOptions = {
  subjects: HseOption[];
  units: HseUnitOption[];
  employees: HseEmployeeOption[];
  permissions: { manage: boolean; approve: boolean; report: boolean };
};

export type HseHistoryEntry = {
  at: string;
  by: string;
  action: string;
  from?: string;
  to?: string;
  note?: string;
};

export type HseIncident = {
  id: string;
  incidentNo: string;
  subjectId: string;
  subjectName: string;
  unitId: string | null;
  occurredAt: string;
  type: string;
  severity: string;
  location: string;
  description: string;
  injuryCount: number;
  lostDays: number;
  environmentalRelease: boolean;
  investigatorId: string | null;
  ownerId: string | null;
  ownerName: string;
  dueAt: string | null;
  rootCause: string;
  actions: string;
  rectifiedBy: string | null;
  rectifiedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  status: string;
  version: number;
  history: HseHistoryEntry[];
};

export type HseHazard = {
  id: string;
  subjectId: string;
  subjectName: string;
  unitId: string | null;
  source: string;
  level: string;
  description: string;
  location: string;
  discoveredAt: string;
  sourceRef: string | null;
  inspectorId: string | null;
  ownerId: string | null;
  ownerName: string;
  dueAt: string | null;
  status: string;
  rectification: string;
  rectifiedBy: string | null;
  rectifiedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  version: number;
  history: HseHistoryEntry[];
};

export type HseCertificate = {
  id: string;
  subjectId: string;
  subjectName: string;
  holderType: string;
  holderName: string;
  certType: string;
  certNo: string;
  issuedAt: string | null;
  expiresAt: string;
  authority: string;
  status: string;
  revokedBy: string | null;
  revokedAt: string | null;
  revokedReason: string;
  version: number;
  history: HseHistoryEntry[];
};

export type HseInspection = {
  id: string;
  subjectId: string;
  subjectName: string;
  unitId: string | null;
  type: string;
  plannedAt: string;
  completedAt: string | null;
  inspectorId: string | null;
  inspectorName: string;
  checklist: string[];
  findingsCount: number;
  status: string;
  version: number;
};

export type HseWorkPermit = {
  id: string;
  subjectId: string;
  subjectName: string;
  unitId: string | null;
  permitNo: string;
  type: string;
  workDescription: string;
  location: string;
  contractorId: string | null;
  applicantId: string;
  validFrom: string;
  validTo: string;
  riskMeasures: string[];
  gasTest: Record<string, unknown> | null;
  approverId: string | null;
  approvedAt: string | null;
  status: string;
  linkedMaintenanceOrderId: string | null;
  version: number;
};

export type HseTrainingRecord = {
  id: string;
  subjectId: string;
  subjectName: string;
  personId: string;
  personName: string;
  courseType: string;
  courseName: string;
  completedAt: string;
  score: number | null;
  certificateId: string | null;
  status: string;
  version: number;
};

export type HseAction = {
  id: string;
  subjectId: string;
  subjectName: string;
  unitId: string | null;
  sourceType: string;
  sourceId: string;
  description: string;
  ownerId: string | null;
  ownerName: string;
  dueAt: string | null;
  status: string;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  version: number;
};

export type HseOverview = {
  businessDate: string;
  scope: 'company' | 'group';
  horizonDays: number;
  counts: {
    incidentsOpen: number;
    incidentsLti: number;
    hazardsOpen: number;
    hazardsOverdue: number;
    certificatesExpiring90: number;
  };
  recentIncidents: HseIncident[];
  recentHazards: HseHazard[];
  expiringCertificates: {
    id: string;
    subjectName: string;
    holderName: string;
    certType: string;
    expiresAt: string;
  }[];
};

export type HsePage<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};

export const incidentTypeKeys = [
  'injury',
  'near_miss',
  'fire',
  'chemical',
  'environmental',
  'property',
  'other',
] as const;
export const incidentSeverityKeys = [
  'minor',
  'moderate',
  'major',
  'fatality',
] as const;
export const incidentStatusKeys = [
  'reported',
  'investigating',
  'rectifying',
  'verifying',
  'closed',
] as const;
export const hazardSourceKeys = [
  'inspection',
  'walkthrough',
  'report',
  'plc',
  'other',
] as const;
export const hazardLevelKeys = ['general', 'major'] as const;
export const certificateTypeKeys = [
  'pollution',
  'hazardous_waste',
  'fire',
  'safety',
  'occupational',
  'special_operation',
  'other',
] as const;
export const certificateStatusKeys = [
  'active',
  'expiring',
  'expired',
  'revoked',
] as const;
export const hazardStatusKeys = [
  'open',
  'rectifying',
  'verifying',
  'closed',
] as const;
export const inspectionTypeKeys = [
  'routine',
  'special',
  'comprehensive',
  'follow_up',
] as const;
export const inspectionStatusKeys = ['planned', 'completed'] as const;
export const workPermitTypeKeys = [
  'hot_work',
  'confined_space',
  'work_at_height',
  'lifting',
  'electrical',
  'excavation',
  'other',
] as const;
export const workPermitStatusKeys = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'closed',
] as const;
export const trainingCourseTypeKeys = [
  'safety',
  'fire',
  'occupational',
  'emergency',
  'special_operation',
  'other',
] as const;
export const trainingStatusKeys = ['completed', 'expired'] as const;
export const actionSourceTypeKeys = [
  'inspection',
  'hazard',
  'incident',
  'permit',
  'training',
  'other',
] as const;
export const actionStatusKeys = ['open', 'completed', 'verified'] as const;
