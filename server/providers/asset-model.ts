import { z } from 'zod';

export const assetStatuses = [
  'in_stock',
  'assigned',
  'maintenance',
  'scrapped',
] as const;
export type AssetStatus = (typeof assetStatuses)[number];

export const assetActions = ['assign', 'return', 'scrap'] as const;
export type AssetAction = (typeof assetActions)[number];

const id = z.string().uuid();
const version = z.number().int().min(1);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const decimal = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d{1,19}(\.\d{1,6})?$/.test(value), {
    message: 'INVALID_DECIMAL',
  });

export const assetCompanyQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AssetCompanyQuery = z.infer<typeof assetCompanyQuery>;

export const assetQuery = z
  .object({
    subjectId: id.optional(),
    status: z.enum(assetStatuses).optional(),
    custodianEmployeeId: id.optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(20),
  })
  .strict();
export type AssetQuery = z.infer<typeof assetQuery>;

export const assetCreate = z
  .object({
    subjectId: id.optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    name: z.string().trim().min(1).max(200),
    category: optionalText(100),
    custodianEmployeeId: id.optional().nullable(),
    location: optionalText(200),
    acquiredOn: z.string().date().optional().nullable(),
    originalCost: decimal.optional().nullable(),
    currency: z.string().trim().length(8).optional().nullable(),
    sourceDocumentId: id.optional().nullable(),
    notes: optionalText(2000),
  })
  .strict();
export type AssetCreate = z.infer<typeof assetCreate>;

export const assetUpdate = z
  .object({
    version,
    name: z.string().trim().min(1).max(200).optional(),
    category: optionalText(100),
    location: optionalText(200),
    acquiredOn: z.string().date().optional().nullable(),
    originalCost: decimal.optional().nullable(),
    currency: z.string().trim().length(8).optional().nullable(),
    sourceDocumentId: id.optional().nullable(),
    notes: optionalText(2000),
  })
  .strict();
export type AssetUpdate = z.infer<typeof assetUpdate>;

export const assetAssign = z
  .object({
    version,
    employeeId: id,
    location: optionalText(200),
    note: optionalText(1000),
  })
  .strict();
export type AssetAssign = z.infer<typeof assetAssign>;

export const assetReturn = z
  .object({
    version,
    location: optionalText(200),
    note: optionalText(1000),
  })
  .strict();
export type AssetReturn = z.infer<typeof assetReturn>;

export const assetScrapRequest = z
  .object({
    version,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type AssetScrapRequest = z.infer<typeof assetScrapRequest>;

export const assetScrapDecision = z
  .object({
    version,
    approve: z.boolean(),
    note: optionalText(1000),
  })
  .strict();
export type AssetScrapDecision = z.infer<typeof assetScrapDecision>;

export const assetIdParams = z.object({ id }).strict();
export const assetEmployeeParams = z.object({ employeeId: id }).strict();
