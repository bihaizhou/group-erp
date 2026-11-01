// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  exactBaseQuantity,
  materialSelectionInput,
} from '../../server/providers/supply-chain-model.js';
import {
  assertCurrentMaterialSource,
  type MaterialSourceIdentity,
  type CurrentMaterialSource,
} from '../../server/providers/material-source-contract.js';

describe('exact demand quantities', () => {
  it('preserves packaging ratios and decimal values without floating-point rounding', () => {
    expect(exactBaseQuantity('10', '12', '1', 0, 0)).toBe('120');
    expect(exactBaseQuantity('0.1', '0.2', '1', 6, 6)).toBe('0.02');
    expect(exactBaseQuantity('3', '1', '3', 0, 0)).toBe('1');
    expect(exactBaseQuantity('999999999999999999.999999', '1', '1', 6, 6)).toBe(
      '999999999999999999.999999',
    );
    expect(exactBaseQuantity('1.000000', '1', '1', 0, 0)).toBe('1');
  });
  it('rejects fractional packaging, inexact conversions, overflow and invalid ratios', () => {
    for (const args of [
      ['1.5', '12', '1', 0, 0],
      ['1', '1', '3', 0, 6],
      ['1', '1', '2', 0, 0],
      ['999999999999999999', '2', '1', 0, 0],
      ['0', '1', '1', 0, 0],
      ['1', '0', '1', 0, 0],
      ['1', '1', '0', 0, 0],
    ] as const)
      expect(() => exactBaseQuantity(...args)).toThrow();
    expect(
      materialSelectionInput.safeParse({
        kind: 'unknown',
        subjectId: randomUUID(),
        originalName: 'Gravel',
        originalSpecification: 'As specified',
        requestedUnitText: 'm³',
        quantity: '0',
      }).success,
    ).toBe(false);
  });
});

describe('material source contract', () => {
  const expected: MaterialSourceIdentity = {
    sourceKind: 'purchaseRequestLine',
    sourceDocumentId: randomUUID(),
    sourceLineId: randomUUID(),
    subjectId: randomUUID(),
    inputRevision: 2,
    governanceEpoch: 1,
    governanceAttempt: 1,
  };
  const current = (): CurrentMaterialSource => ({
    identity: { ...expected },
    documentStatus: 'pending',
    lineStatus: 'active',
    activeSourceLinkId: 'link',
    linkId: 'link',
    linkStatus: 'pending',
    canConfirm: true,
  });
  it('allows parallel approval stages with the exact same source identity', () => {
    for (const documentStatus of ['draft', 'pending', 'approved'] as const)
      expect(() =>
        assertCurrentMaterialSource(expected, { ...current(), documentStatus }),
      ).not.toThrow();
  });
  it('rejects every stale identity component and replacement source pointer', () => {
    for (const key of Object.keys(
      expected,
    ) as (keyof MaterialSourceIdentity)[]) {
      const value = current();
      value.identity = {
        ...value.identity,
        [key]:
          typeof expected[key] === 'number'
            ? Number(expected[key]) + 1
            : key === 'sourceKind'
              ? 'materialIssueRequestLine'
              : randomUUID(),
      };
      expect(() => assertCurrentMaterialSource(expected, value)).toThrow(
        'SUPPLY_SOURCE_STALE',
      );
    }
    expect(() =>
      assertCurrentMaterialSource(expected, {
        ...current(),
        activeSourceLinkId: 'replacement',
      }),
    ).toThrow('SUPPLY_SOURCE_STALE');
  });
  it('rejects cancelled, already handled and revoked sources', () => {
    for (const linkStatus of [
      'offered',
      'applied',
      'invalidated',
      'needsInformation',
    ] as const)
      expect(() =>
        assertCurrentMaterialSource(expected, { ...current(), linkStatus }),
      ).toThrow('SUPPLY_SOURCE_STALE');
    expect(() =>
      assertCurrentMaterialSource(expected, {
        ...current(),
        documentStatus: 'cancelled',
      }),
    ).toThrow('SUPPLY_SOURCE_STALE');
    expect(() =>
      assertCurrentMaterialSource(expected, {
        ...current(),
        lineStatus: 'cancelled',
      }),
    ).toThrow('SUPPLY_SOURCE_STALE');
    expect(() =>
      assertCurrentMaterialSource(expected, {
        ...current(),
        canConfirm: false,
      }),
    ).toThrow('SUPPLY_FORBIDDEN');
  });
});
