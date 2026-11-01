import { describe, expect, it } from 'vitest';
import {
  MODULE_REVIEW_PAGES,
  withModuleReviewGrants,
} from '../../database/main/migrations/202611010009_module_review_settings_pages.js';

const grant = (id: string) => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});
const ids = (grants: ReturnType<typeof withModuleReviewGrants>) =>
  grants
    .filter((item) => item.resource?.type === 'page')
    .map((item) => item.resource?.id);

describe('module review settings grants', () => {
  it('keeps an old module grant on that module only', () => {
    expect(
      ids(withModuleReviewGrants([grant('procurement-settings')])),
    ).toEqual(['procurement-settings', 'procurement-review-settings']);
  });

  it('narrows the shared page when an old module grant exists', () => {
    expect(
      ids(
        withModuleReviewGrants([
          grant('review-settings'),
          grant('warehouse-settings'),
        ]),
      ),
    ).toEqual([
      'review-settings',
      'warehouse-settings',
      'warehouse-review-settings',
    ]);
  });

  it('expands the shared page to all modules when there is no old grant', () => {
    expect(ids(withModuleReviewGrants([grant('review-settings')]))).toEqual([
      'review-settings',
      ...MODULE_REVIEW_PAGES.map((module) => module.page),
    ]);
  });

  it('does not duplicate a module page that already exists', () => {
    const grants = [grant('procurement-review-settings')];
    expect(withModuleReviewGrants(grants)).toBe(grants);
  });
});
