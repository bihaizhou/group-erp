export type Status = 'active' | 'inactive';
export interface Identity {
  id: string;
  code: string;
  name: string;
  registrationCode: string | null;
  status: Status;
  revision: number;
  updatedAt: string;
}
export interface Availability {
  partnerId: string;
  subjectId: string;
  identity: Identity;
  scopeMatch: 'all' | 'region' | 'company';
  supplierStatus: Status;
  companyStatus: Status;
  effectiveStatus: Status;
  settingId: string | null;
  revision: number;
  notes: string;
  updatedAt: string;
}
export interface Relationship {
  id: string;
  partnerId: string;
  subjectId: string;
  notes: string;
  status: Status;
  revision: number;
  updatedAt: string;
  identity: Identity;
}
export type SupplierSaved = Identity | Applicability | Relationship;
export interface Applicability {
  id: string;
  partnerId: string;
  scopeMode: 'all' | 'selected';
  status: Status;
  revision: number;
  regionIds: string[];
  subjectIds: string[];
}
export interface Choice {
  id: string;
  code: string;
  name: string;
  status?: string;
}
export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}
export interface Capabilities {
  updateIdentity: boolean;
  configureApplicability: boolean;
  updateRelationship: boolean;
}
export interface Audit {
  kind: string;
  id: string;
  operation: string;
  actorId: string;
  actorName?: string;
  reason: string;
  createdAt: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
}
export const rootPath = '/functions/procurement/suppliers';
export const pageNumber = (value: string | null) =>
  /^\d{1,6}$/.test(value ?? '')
    ? Math.max(1, Math.min(100000, Number(value)))
    : 1;
