import { describe, expect, it } from 'vitest';
import {
  currentEmploymentRow,
  currentPrimaryRow,
  isCurrentRow,
  type Data,
  type Row,
} from '../../client/pages/people/model.js';

function row(id: string, personId: string | null, data: Data): Row {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    status: 'active',
    version: 1,
    lifecycleVersion: 0,
    subjectId: null,
    personId,
    positionId: null,
    grade: null,
    data,
    snapshot: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const on = '2026-10-30';

describe('current personnel rows', () => {
  it('matches the server business-day rule', () => {
    expect(isCurrentRow(row('a', 'p', { startDate: '2026-01-01' }), on)).toBe(
      true,
    );
    expect(
      isCurrentRow(
        row('b', 'p', { startDate: '2026-01-01', endDate: '2026-10-31' }),
        on,
      ),
    ).toBe(true);
    // Ending today means the person is no longer current that same day.
    expect(
      isCurrentRow(row('c', 'p', { startDate: '2026-01-01', endDate: on }), on),
    ).toBe(false);
    expect(
      isCurrentRow(
        row('d', 'p', { startDate: '2026-01-01', endDate: '2026-10-29' }),
        on,
      ),
    ).toBe(false);
    // A future assignment only becomes current on its start date.
    expect(isCurrentRow(row('e', 'p', { startDate: '2026-11-01' }), on)).toBe(
      false,
    );
    expect(isCurrentRow(row('f', 'p', { startDate: '2026-01-01' }), '')).toBe(
      false,
    );
  });

  it('finds the live employment of the selected person only', () => {
    const rows = [
      row('closed', 'p', { startDate: '2025-01-01', endDate: '2026-03-01' }),
      row('other', 'q', { startDate: '2026-01-01' }),
      row('live', 'p', { startDate: '2026-03-01', endDate: null }),
    ];
    expect(currentEmploymentRow(rows, 'p', on)?.id).toBe('live');
    expect(currentEmploymentRow(rows, 'missing', on)).toBeUndefined();
  });

  it('finds the live primary assignment and ignores part-time or ended ones', () => {
    const rows = [
      row('primary-old', 'p', {
        type: 'primary',
        startDate: '2025-01-01',
        endDate: '2026-02-01',
      }),
      row('part', 'p', { type: 'partTime', startDate: '2026-01-01' }),
      row('someone-else', 'q', { type: 'primary', startDate: '2026-01-01' }),
      row('primary-live', 'p', {
        type: 'primary',
        startDate: '2026-02-01',
        endDate: null,
      }),
    ];
    expect(currentPrimaryRow(rows, 'p', on)?.id).toBe('primary-live');
    expect(currentPrimaryRow(rows, 'part-only', on)).toBeUndefined();
  });
});
