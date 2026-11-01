import { expect, it } from 'vitest';
import {
  blankContent,
  compareContent,
  applyContentMerge,
  validateContent,
  newLine,
} from '../../client/pages/procurement/requests/model.js';
const subjectId = '00000000-0000-4000-8000-000000000001';
it('merges independent remote and local changes without overwriting either', () => {
  const base = blankContent(subjectId),
    local = { ...base, usage: 'Local demand' },
    server = { ...base, notes: 'Remote notes' };
  const comparison = compareContent(base, local, server);
  expect(comparison.conflicts).toEqual([]);
  expect(applyContentMerge(comparison, {})).toMatchObject({
    usage: 'Local demand',
    notes: 'Remote notes',
  });
});
it('requires explicit choices for a field changed by both parties', () => {
  const base = blankContent(subjectId),
    comparison = compareContent(
      base,
      { ...base, usage: 'Local' },
      { ...base, usage: 'Server' },
    );
  expect(() => applyContentMerge(comparison, {})).toThrow(
    'Unresolved content conflict',
  );
  expect(applyContentMerge(comparison, { 'head:usage': 'local' }).usage).toBe(
    'Local',
  );
  expect(applyContentMerge(comparison, { 'head:usage': 'server' }).usage).toBe(
    'Server',
  );
});
it('retains a remotely cancelled line only as a new identity after explicit conflict resolution', () => {
  const line = newLine(subjectId),
    base = { ...blankContent(subjectId), lines: [line] },
    local = { ...base, lines: [{ ...line, notes: 'Local correction' }] },
    server = { ...base, lines: [] };
  const comparison = compareContent(base, local, server, [line.id]);
  const choices = Object.fromEntries(
    comparison.conflicts.map((c) => [c.key, 'local' as const]),
  );
  const merged = applyContentMerge(comparison, choices);
  expect(merged.lines).toHaveLength(1);
  expect(merged.lines[0].id).not.toBe(line.id);
  expect(merged.lines[0].notes).toBe('Local correction');
});
it('detects independent changes to line order and supports exact decimal strings', () => {
  const one = newLine(subjectId),
    two = newLine(subjectId),
    three = newLine(subjectId),
    base = { ...blankContent(subjectId), lines: [one, two, three] };
  const result = compareContent(
    base,
    { ...base, lines: [two, one, three] },
    { ...base, lines: [one, three, two] },
  );
  expect(result.conflicts.some((c) => c.key === 'order')).toBe(true);
  const valid = {
    ...one,
    selection: {
      kind: 'unknown' as const,
      subjectId,
      originalName: 'gloves',
      originalSpecification: 'model',
      requestedUnitText: 'pair',
      quantity: '999999999999999999.123456',
    },
  };
  expect(validateContent({ ...base, lines: [valid] })).toEqual({});
  expect(JSON.parse(JSON.stringify(valid)).selection.quantity).toBe(
    '999999999999999999.123456',
  );
});
