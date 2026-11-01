import { describe, expect, it } from 'vitest';
import { withProductionDailyGrant } from '../../database/main/migrations/202611010010_production_daily_page.js';

const grant = (id: string) => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});

describe('production daily page grant', () => {
  it('adds the daily page when any production data page is granted', () => {
    for (const source of [
      'production-schedules',
      'production-attendance',
      'production-shift-reports',
      'production-downtime',
      'production-overtime',
    ]) {
      const next = withProductionDailyGrant([grant(source)]);
      expect(next.map((item) => item.resource?.id)).toContain(
        'production-daily',
      );
    }
  });

  it('does not grant the page to unrelated roles or duplicate it', () => {
    expect(withProductionDailyGrant([grant('production-setup')])).toHaveLength(
      1,
    );
    const once = withProductionDailyGrant([grant('production-shift-reports')]);
    expect(withProductionDailyGrant(once)).toBe(once);
  });
});
