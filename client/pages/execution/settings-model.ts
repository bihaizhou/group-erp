export type ReviewKind =
  | 'purchaseOrders'
  | 'salesOrders'
  | 'stockDocuments'
  | 'stockTransfers'
  | 'stockCounts';
export interface ReviewSelection {
  group: number;
  type: 'position' | 'user';
  referenceId: string;
}
export interface ReviewReference extends ReviewSelection {
  code: string | null;
  name: string | null;
  availability: string;
}
export interface ReviewSettings {
  subjectId: string;
  kind: ReviewKind;
  revision: number;
  values: { reviewerSelections: ReviewSelection[] };
  references: ReviewReference[];
  schemaVersion: number;
  readMode: 'snapshot';
  fields?: { key: string; type: 'reviewers' | 'boolean'; title: string }[];
}
