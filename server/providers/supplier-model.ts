import { z } from 'zod';

const id = z.string().uuid();
const normalizedCode = z
  .string()
  .normalize('NFKC')
  .trim()
  .toUpperCase()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9._/-]*$/u);
const registrationCode = z
  .string()
  .normalize('NFKC')
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/gu, ''))
  .pipe(z.string().max(128))
  .nullable()
  .transform((v) => v || null);
export const supplierIdentityFields = {
  code: normalizedCode,
  name: z.string().trim().min(1).max(200),
  registrationCode: registrationCode.default(null),
};
const notes = z.string().trim().max(2000).default('');
export const supplierCreate = z.strictObject({
  ...supplierIdentityFields,
  subjectId: id,
  notes,
  requestKey: id,
});
export const supplierLink = z.strictObject({
  subjectId: id,
  partnerId: id,
  notes,
  requestKey: id,
});
export const supplierMutation = z.strictObject({
  version: z.number().int().min(1),
  reason: z.string().trim().min(1).max(1000),
  requestKey: id,
});
export const supplierRelationshipUpdate = supplierMutation.extend({ notes });
export const supplierIdentityUpdate = supplierMutation.extend(
  supplierIdentityFields,
);
export const supplierPage = z.strictObject({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const supplierQuery = supplierPage.extend({
  subjectId: id,
  status: z.enum(['active', 'inactive']).optional(),
  orderBy: z.enum(['updatedAt', '-updatedAt']).default('-updatedAt'),
});
export const supplierParams = z.strictObject({ id });
export const supplierMeta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export const supplierIdentityView = z.object({
  id,
  code: z.string(),
  name: z.string(),
  registrationCode: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  revision: z.number(),
  updatedAt: z.string(),
});
export const supplierView = z.object({
  id,
  partnerId: id,
  subjectId: id,
  notes: z.string(),
  partnerRole: z.literal('supplier'),
  status: z.enum(['active', 'inactive']),
  revision: z.number(),
  updatedAt: z.string(),
  identity: supplierIdentityView,
});
export const supplierCompanyView = z.object({
  id,
  code: z.string(),
  name: z.string(),
});
export const supplierAuditView = z.object({
  id,
  kind: z.string(),
  recordId: id,
  subjectId: id.nullable(),
  actorId: z.string(),
  operation: z.string(),
  reason: z.string(),
  beforeValue: z.json().nullable(),
  afterValue: z.json(),
  createdAt: z.string(),
});
export type SupplierQuery = z.infer<typeof supplierQuery>;
export type SupplierPage = z.infer<typeof supplierPage>;
export type SupplierCreate = z.infer<typeof supplierCreate>;
export type SupplierLink = z.infer<typeof supplierLink>;
export type SupplierMutation = z.infer<typeof supplierMutation>;
export type SupplierRelationshipUpdate = z.infer<
  typeof supplierRelationshipUpdate
>;
export type SupplierIdentityUpdate = z.infer<typeof supplierIdentityUpdate>;

export const supplierIdentityColumns = [
  'id',
  'code',
  'name',
  'registrationCode',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
];
export const supplierSettingColumns = [
  'id',
  'partnerId',
  'subjectId',
  'partnerRole',
  'notes',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
];
export const supplierAuditColumns = [
  'id',
  'kind',
  'recordId',
  'subjectId',
  'actorId',
  'operation',
  'reason',
  'beforeValue',
  'afterValue',
  'createdAt',
];
