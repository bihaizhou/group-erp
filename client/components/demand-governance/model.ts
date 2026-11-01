export type DemandDomain = 'procurement' | 'requisitions';
export const sourceActions = [
  'requestGovernance',
  'confirmMaterial',
  'rejectMaterial',
  'takeOverSource',
] as const;
export type SourceAction = (typeof sourceActions)[number];
export type SourceStatus =
  'pending' | 'needsInformation' | 'offered' | 'applied' | 'invalidated';
export interface Source {
  id: string;
  requestId: string;
  purchaseRequestLineId: string | null;
  materialIssueRequestLineId: string | null;
  sourceDocumentId: string;
  revision: number;
  sourceAttempt: number;
  status: SourceStatus;
  proposedSkuId: string | null;
  sourceHandlerId: string;
  reason: string;
  invalidatedReason: string;
  inputSnapshot: {
    documentCode?: string;
    lineNo?: number;
    originalName: string;
    originalSpecification: string;
    quantity: string;
    requestedUnitText: string;
    usage: string;
  };
  resolutionSnapshot: { code: string; name: string; baseUnitId: string } | null;
  display?: { handler: string | null; requester: string | null };
  createdAt: string;
  updatedAt: string;
}
export interface SourceLine {
  id: string;
  lineNo: number;
  revision: number;
  inputRevision: number;
  status: string;
  activeSourceLinkId: string | null;
  identificationStatus: string;
  originalName: string;
  originalSpecification: string;
  requestedQuantity: string;
  requestedUnitText: string;
}
export interface Demand {
  id: string;
  code: string;
  revision: number;
  lifecycleVersion: number;
  subjectId: string;
  status: string;
  lines: SourceLine[];
}
export interface SourceCapabilities {
  recordRevision: number;
  lifecycleVersion: number;
  actions: Record<
    string,
    { visible: boolean; enabled: boolean; reason: string | null }
  >;
}
export interface SourcePage {
  data: Source[];
  meta: { page: number; pageSize: number; total: number };
}
export interface Candidate {
  id: string;
  code: string;
  name: string;
  baseUnitId: string;
  baseUnitName?: string;
  packages?: {
    id: string;
    unitId: string;
    unitName: string;
    name: string;
    numerator: string;
    denominator: string;
  }[];
}
