export type HseOption = { id: string; name: string };
export type HseUnitOption = HseOption & { subjectId: string };
export type HseOptions = {
  subjects: HseOption[];
  units: HseUnitOption[];
  permissions: { manage: boolean; approve: boolean };
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
  rootCause: string;
  actions: string;
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

export type HseOverview = {
  businessDate: string;
  scope: 'company' | 'group';
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
