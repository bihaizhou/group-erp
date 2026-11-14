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
  subjectName: string | null;
  production: {
    reports: number;
    processed: string;
    metal: string;
    sand: string;
    metalRate: string | null;
  } | null;
  warehouse: {
    receiptDraft: number;
    receiptPending: number;
    receiptPosted: number;
    stockMetal: string;
    stockSand: string;
    stockConfigured: boolean;
  } | null;
  hse: {
    incidentsOpen: number;
    hazardsOpen: number;
    hazardsOverdue: number;
    certificatesExpiring90: number;
  } | null;
  sales: { openOrders: number; shippedToday: number } | null;
  procurement: { openOrders: number; receivedToday: number } | null;
  people: { active: number; production: number } | null;
  issues: { open: number; overdue: number };
  maintenance: { openOrders: number } | null;
  downtime: { open: number; minutesToday: number } | null;
  units: OperationsUnit[];
  notes: {
    salesConnected: boolean;
    procurementConnected: boolean;
    peopleConnected: boolean;
    peopleScope: 'active_primary_assignment';
    maskedSources?: string[];
    truncated?: string[];
  };
};
export type OperationsPosition = {
  id: string;
  name: string;
  subjectId: string;
};
export type OperationsOptions = {
  subjects: OperationsSubject[];
  positions: OperationsPosition[];
};
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
  ownerId: string | null;
  dueAt: string;
  businessDate?: string | null;
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
  progressPct: number;
  varianceValue: string | null;
  status: 'no_data' | 'on_track' | 'behind' | 'achieved' | 'not_started';
  version: number;
  updatedAt: string;
};

export type OperationsTargets = {
  items: OperationsTarget[];
  total: number;
};

export type OperationsCompanyOverview = {
  date: string;
  items: OperationsOverview[];
};
