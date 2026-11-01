import { z } from 'zod';

export const operationsOverviewQuery = z.object({
  subjectId: z.string().length(36).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type OperationsOverviewQuery = z.infer<typeof operationsOverviewQuery>;

export const operationsIssueSourceTypes = [
  'production',
  'warehouse',
  'sales',
  'procurement',
  'people',
  'hse',
  'other',
] as const;
export const operationsIssueSeverities = ['low', 'medium', 'high'] as const;
export const operationsIssueStatuses = [
  'open',
  'in_progress',
  'closed',
] as const;

export const operationsIssueQuery = z.object({
  subjectId: z.string().length(36).optional(),
  status: z.enum(operationsIssueStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OperationsIssueQuery = z.infer<typeof operationsIssueQuery>;

export const operationsIssueInput = z.object({
  subjectId: z.string().length(36),
  unitId: z.string().length(36).optional(),
  sourceType: z.enum(operationsIssueSourceTypes).default('other'),
  sourceId: z.string().length(36).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  severity: z.enum(operationsIssueSeverities).default('medium'),
  ownerName: z.string().trim().min(1).max(200),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type OperationsIssueInput = z.infer<typeof operationsIssueInput>;

export const operationsIssueUpdate = z.object({
  version: z.number().int().min(1),
  status: z.enum(operationsIssueStatuses).optional(),
  severity: z.enum(operationsIssueSeverities).optional(),
  ownerName: z.string().trim().min(1).max(200).optional(),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  resolution: z.string().trim().max(2000).optional(),
});
export type OperationsIssueUpdate = z.infer<typeof operationsIssueUpdate>;

export const operationsTargetMetrics = [
  'processed',
  'metal',
  'sand',
  'metalRate',
] as const;
export type OperationsTargetMetric = (typeof operationsTargetMetrics)[number];

export const operationsTargetQuery = z.object({
  subjectId: z.string().length(36).optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type OperationsTargetQuery = z.infer<typeof operationsTargetQuery>;

export const operationsTargetInput = z.object({
  subjectId: z.string().length(36),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  metric: z.enum(operationsTargetMetrics),
  targetValue: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/),
});
export type OperationsTargetInput = z.infer<typeof operationsTargetInput>;
