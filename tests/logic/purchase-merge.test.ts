// @vitest-environment node
import { expect, test } from 'vitest';
import { buildPurchaseMerge } from '../../server/providers/purchase-merge.js';

const company = new Map([
  ['company-a', { code: 'A', name: 'Company A' }],
  ['company-b', { code: 'B', name: 'Company B' }],
]);
const request = (id: string, subjectId: string, status = 'approved') => ({
  id,
  code: `PR-${id}`,
  subjectId,
  status,
  neededOn: '2026-11-20',
});
const line = (values: Record<string, unknown>) => ({
  status: 'active',
  lineNo: 1,
  requestedQuantity: '1',
  requestedUnitText: 'unit',
  identificationStatus: 'unidentified',
  ...values,
});
const known = (values: Record<string, unknown>) =>
  line({
    identificationStatus: 'identified',
    skuId: 'sku-1',
    unitId: 'unit-box',
    baseUnitId: 'unit-each',
    baseQuantity: '24',
    materialSnapshot: {
      code: 'MAT-1',
      name: 'Gloves',
      standardName: 'Nitrile',
      unitName: 'box',
      baseUnitName: 'each',
    },
    ...values,
  });

test('sums known material base quantities and keeps a different base unit separate', () => {
  const groups = buildPurchaseMerge(
    [
      request('a', 'company-a'),
      request('b', 'company-b'),
      request('c', 'company-a'),
    ],
    [
      known({ id: 'a1', requestId: 'a', subjectId: 'company-a' }),
      known({
        id: 'b1',
        requestId: 'b',
        subjectId: 'company-b',
        baseQuantity: '36',
      }),
      known({
        id: 'c1',
        requestId: 'c',
        subjectId: 'company-a',
        baseUnitId: 'unit-pack',
        baseQuantity: '5',
        materialSnapshot: {
          code: 'MAT-1',
          name: 'Gloves',
          standardName: 'Nitrile',
          unitName: 'pack',
          baseUnitName: 'pack',
        },
      }),
    ],
    company,
  );
  expect(groups).toHaveLength(2);
  expect(groups[0].quantity).toBe('60');
  expect(groups[0].sources.map((source) => source.requestId)).toEqual([
    'a',
    'b',
  ]);
  expect(groups[1].quantity).toBe('5');
});

test('groups unknown needs by normalized name, specification and unit only', () => {
  const groups = buildPurchaseMerge(
    [
      request('a', 'company-a'),
      request('b', 'company-b'),
      request('c', 'company-a'),
    ],
    [
      line({
        id: 'a1',
        requestId: 'a',
        subjectId: 'company-a',
        originalName: '  Gloves ',
        originalSpecification: 'M-1',
        requestedUnitText: 'pair',
        requestedQuantity: '10',
      }),
      line({
        id: 'b1',
        requestId: 'b',
        subjectId: 'company-b',
        originalName: 'gloves',
        originalSpecification: 'm-1',
        requestedUnitText: 'PAIR',
        requestedQuantity: '20',
      }),
      line({
        id: 'c1',
        requestId: 'c',
        subjectId: 'company-a',
        originalName: 'Gloves',
        originalSpecification: 'M-1',
        requestedUnitText: 'box',
        requestedQuantity: '2',
      }),
    ],
    company,
  );
  expect(groups).toHaveLength(2);
  expect(groups.map((group) => group.quantity).sort()).toEqual(['2', '30']);
  expect(
    groups.find((group) => group.material.unitName === 'box'),
  ).toBeTruthy();
});

test('ignores non-approved requests and is stable when recomputed', () => {
  const requests = [
    request('a', 'company-a'),
    request('b', 'company-b', 'pending'),
    request('c', 'company-a', 'cancelled'),
  ];
  const lines = [
    line({
      id: 'a1',
      requestId: 'a',
      subjectId: 'company-a',
      originalName: 'Gloves',
      originalSpecification: 'M-1',
      requestedUnitText: 'pair',
      requestedQuantity: '10',
    }),
    line({
      id: 'b1',
      requestId: 'b',
      subjectId: 'company-b',
      originalName: 'Gloves',
      originalSpecification: 'M-1',
      requestedUnitText: 'pair',
      requestedQuantity: '100',
    }),
    line({
      id: 'c1',
      requestId: 'c',
      subjectId: 'company-a',
      originalName: 'Gloves',
      originalSpecification: 'M-1',
      requestedUnitText: 'pair',
      requestedQuantity: '100',
    }),
  ];
  const first = buildPurchaseMerge(requests, lines, company),
    second = buildPurchaseMerge(requests, lines, company);
  expect(first).toEqual(second);
  expect(first).toHaveLength(1);
  expect(first[0].quantity).toBe('10');
  expect(first[0].sources).toHaveLength(1);
});
