// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SupplyChainError,
  referenceBaseQuantity,
  theoreticalBaseQuantity,
} from '../../server/providers/supply-chain-model.js';

const fail = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as SupplyChainError;
  }
  throw new Error('Expected a supply-chain failure');
};

describe('reference conversion helpers', () => {
  it('estimates a counted quantity from a measured quantity without rounding into stock', () => {
    expect(theoreticalBaseQuantity('10', '1.4154', '1', 3, 0)).toBe('14');
    expect(theoreticalBaseQuantity('9.87', '1.4154', '1', 3, 0)).toBe('14');
    expect(theoreticalBaseQuantity('10', '1.4154', '1', 3, 2)).toBe('14.15');
  });

  it('accepts a counted quantity inside the tolerance and rejects a deviation', () => {
    expect(referenceBaseQuantity('14', '9.87', '1.4154', '1', 3, 0, '3'))
      .toBe('14');
    expect(referenceBaseQuantity('14', '10', '1.4154', '1', 3, 0, '3'))
      .toBe('14');
    expect(
      fail(() =>
        referenceBaseQuantity('13', '9.87', '1.4154', '1', 3, 0, '3'),
      ).reason,
    ).toBe('SUPPLY_REFERENCE_VARIANCE_EXCEEDED');
  });

  it('keeps counted precision, measured precision and tolerance bounds explicit', () => {
    expect(
      fail(() =>
        referenceBaseQuantity('14.5', '9.87', '1.4154', '1', 3, 0, '3'),
      ).reason,
    ).toBe('SUPPLY_QUANTITY_PRECISION');
    expect(
      fail(() =>
        referenceBaseQuantity('14', '9.8765', '1.4154', '1', 3, 0, '3'),
      ).reason,
    ).toBe('SUPPLY_QUANTITY_PRECISION');
    expect(
      fail(() =>
        referenceBaseQuantity('14', '9.87', '1.4154', '1', 3, 0, '150'),
      ).reason,
    ).toBe('SUPPLY_REFERENCE_VARIANCE_INVALID');
  });
});
