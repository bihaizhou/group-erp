import { z } from 'zod';
import {
  decimalText,
  normalizeDecimal,
  positiveDecimal,
} from './material-model.js';

export const supplyChainModules = ['procurement', 'requisitions'] as const;
// Public A2 catalog resources remain the two registered domains; B callers
// have their own action-scoped facades and reuse this admission service.
export type SupplyChainModule =
  (typeof supplyChainModules)[number] | 'sales' | 'warehouse';
const id = z.string().uuid();
const quantity = decimalText.refine(positiveDecimal);
export const materialOptionsQuery = z.strictObject({
  subjectId: id,
  q: z.string().trim().max(200).optional(),
  materialNameId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const materialSelectionInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('known'),
    subjectId: id,
    skuId: id,
    quantity,
    unitId: id,
    unitRuleId: id.optional(),
  }),
  z.strictObject({
    kind: z.literal('unknown'),
    subjectId: id,
    originalName: z.string().trim().min(1).max(200),
    originalSpecification: z.string().trim().min(1).max(6000),
    requestedUnitText: z.string().trim().min(1).max(100),
    quantity,
  }),
]);
export type MaterialSelectionInput = z.infer<typeof materialSelectionInput>;
export const materialOptionsMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  nameCandidates: z.array(z.object({ id, name: z.string() })),
  ambiguous: z.boolean(),
  aliasMatch: z.object({
    status: z.enum(['none', 'unique', 'ambiguous']),
    skuId: id.nullable(),
  }),
});
export const materialSelectionOutput = z.discriminatedUnion(
  'identificationStatus',
  [
    z.object({
      identificationStatus: z.literal('unidentified'),
      subjectId: id,
      originalName: z.string(),
      originalSpecification: z.string(),
      requestedUnitText: z.string(),
      requestedQuantity: decimalText,
      skuId: z.null(),
      baseQuantity: z.null(),
    }),
    z.object({
      identificationStatus: z.literal('identified'),
      subjectId: id,
      requestedQuantity: decimalText,
      skuId: id,
      skuRevision: z.number().int(),
      materialNameId: id,
      managementModeSnapshot: z.enum(['stock', 'nonStock']),
      unitId: id,
      unitRuleId: id.nullable(),
      unitRuleRevision: z.number().int().nullable(),
      numeratorSnapshot: decimalText,
      denominatorSnapshot: decimalText,
      baseUnitId: id,
      baseQuantity: decimalText,
      materialSnapshot: z.object({
        code: z.string(),
        name: z.string(),
        standardName: z.string(),
        attributeValues: z.record(z.string(), z.string()),
        unitName: z.string(),
        baseUnitName: z.string(),
      }),
    }),
  ],
);

export class SupplyChainError extends Error {
  constructor(
    public readonly reason: string,
    public readonly field?: string,
  ) {
    super(reason);
  }
}
export function supplyChainFail(reason: string, field?: string): never {
  throw new SupplyChainError(reason, field);
}

const scale = 1_000_000n;
const maxQuantity = 10n ** 24n - 1n;
function scaled(value: string): bigint {
  const [whole, fraction = ''] = decimalText.parse(value).split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
}
function precisionAllows(value: bigint, precision: number): boolean {
  return (
    Number.isInteger(precision) &&
    precision >= 0 &&
    precision <= 6 &&
    value % 10n ** BigInt(6 - precision) === 0n
  );
}

export function exactBaseQuantity(
  amount: string,
  numerator: string,
  denominator: string,
  unitPrecision: number,
  basePrecision: number,
): string {
  const quantityValue = scaled(amount);
  const numeratorValue = scaled(numerator);
  const denominatorValue = scaled(denominator);
  if (quantityValue <= 0n || !precisionAllows(quantityValue, unitPrecision))
    return supplyChainFail('SUPPLY_QUANTITY_PRECISION', 'quantity');
  if (numeratorValue <= 0n || denominatorValue <= 0n)
    return supplyChainFail('SUPPLY_INVALID_UNIT', 'unitRuleId');
  const dividend = quantityValue * numeratorValue;
  if (dividend % denominatorValue !== 0n)
    return supplyChainFail('SUPPLY_QUANTITY_PRECISION', 'quantity');
  const result = dividend / denominatorValue;
  if (result > maxQuantity)
    return supplyChainFail('SUPPLY_QUANTITY_OVERFLOW', 'quantity');
  if (!precisionAllows(result, basePrecision))
    return supplyChainFail('SUPPLY_QUANTITY_PRECISION', 'quantity');
  return normalizeDecimal(
    `${result / scale}.${String(result % scale).padStart(6, '0')}`,
  );
}
