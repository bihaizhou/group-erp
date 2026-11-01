export type OperationsSubject = { id: string; name: string };
export type OperationsUnit = {
  unitId: string;
  unitName: string;
  reports: number;
  processed: string;
  metal: string;
  sand: string;
  metalRate: string | null;
};
export type OperationsOverview = {
  date: string;
  subjectId: string | null;
  subjectName: string;
  production: {
    reports: number;
    processed: string;
    metal: string;
    sand: string;
    metalRate: string | null;
  };
  warehouse: {
    receiptDraft: number;
    receiptPending: number;
    receiptPosted: number;
    stockMetal: string;
    stockSand: string;
    stockConfigured: boolean;
  };
  hse: {
    incidentsOpen: number;
    hazardsOpen: number;
    hazardsOverdue: number;
    certificatesExpiring90: number;
  };
  sales: { openOrders: number; shippedToday: number };
  procurement: { openOrders: number; receivedToday: number };
  people: { active: number; production: number };
  issues: { open: number; overdue: number };
  maintenance: { openOrders: number };
  downtime: { open: number; minutesToday: number };
  units: OperationsUnit[];
  notes: {
    salesConnected: boolean;
    procurementConnected: boolean;
    peopleConnected: boolean;
    peopleScope: 'active_primary_assignment';
  };
};
export type OperationsOptions = { subjects: OperationsSubject[] };
export type OperationsIssue = {
  id: string;
  code: string;
  subjectId: string;
  unitId: string | null;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string;
  severity: string;
  ownerName: string;
  dueAt: string;
  status: string;
  resolution: string;
  version: number;
  closedAt: string | null;
};
export type OperationsIssuePage = {
  items: OperationsIssue[];
  total: number;
  page: number;
  pageSize: number;
};

export type OperationsTarget = {
  id: string;
  subjectId: string;
  period: string;
  metric: string;
  targetValue: string;
  actualValue: string | null;
  achievementPct: string | null;
  varianceValue: string | null;
  status: 'no_data' | 'behind' | 'achieved';
  version: number;
  updatedAt: string;
};

export type OperationsTargets = { items: OperationsTarget[] };

export type OperationsCompanyOverview = {
  date: string;
  items: OperationsOverview[];
};
