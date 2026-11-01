import { z } from 'zod';

export const issuePurposeColumns = [
  'id',
  'subjectId',
  'code',
  'name',
  'description',
  'status',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
];
export const issuePurposeContent = z.strictObject({
  subjectId: z.string().uuid(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(6000).default(''),
});
export const issuePurposeMutation = z.strictObject({
  version: z.number().int().min(1),
  lifecycleVersion: z.number().int().min(0),
  requestKey: z.string().uuid(),
  reason: z.string().trim().min(1).max(3000),
});
export const issuePurposeCreate = z.strictObject({
  content: issuePurposeContent,
  requestKey: z.string().uuid(),
});
export const issuePurposeUpdate = issuePurposeMutation.extend({
  content: issuePurposeContent,
});
export const issuePurposeQuery = z.strictObject({
  subjectId: z.string().uuid(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z
    .enum(['updatedAt', '-updatedAt', 'code', '-code'])
    .default('-updatedAt'),
});
export const issuePurposeView = issuePurposeContent
  .extend({
    id: z.string().uuid(),
    status: z.enum(['active', 'inactive']),
    revision: z.number().int(),
    lifecycleVersion: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .catchall(z.unknown());
