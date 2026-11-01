import { describe, expect, it } from 'vitest';
import {
  MODULE_DASHBOARDS,
  withDashboardGrants,
} from '../../database/main/migrations/202611010011_module_dashboard_pages.js';
import { MODULE_DASHBOARD_ANCHORS } from '../../database/main/seeds/202611010011_module_dashboard_pages.js';

const grant = (id: string) => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});
const ids = (grants: ReturnType<typeof withDashboardGrants>) =>
  grants
    .filter((item) => item.resource?.type === 'page')
    .map((item) => item.resource?.id);

describe('module dashboard page grants', () => {
  it('grants a module dashboard to roles with its primary page', () => {
    expect(
      ids(
        withDashboardGrants([
          grant('people-employees'),
          grant('warehouse-inbounds'),
          grant('procurement-requests'),
          grant('sales-orders'),
          grant('requisitions-requests'),
          grant('production-shift-reports'),
          grant('warehouse-materials'),
        ]),
      ),
    ).toEqual([
      'people-employees',
      'warehouse-inbounds',
      'procurement-requests',
      'sales-orders',
      'requisitions-requests',
      'production-shift-reports',
      'warehouse-materials',
      'people-personnel-overview',
      'materials-overview',
      'warehouse-overview',
      'procurement-overview',
      'sales-overview',
      'requisitions-overview',
      'production-overview',
    ]);
  });

  it('leaves roles that only reach secondary resources unchanged', () => {
    for (const page of [
      'warehouse-inventory',
      'warehouse-counts',
      'warehouse-transfers',
      'procurement-suppliers',
      'sales-customers',
      'requisitions-purposes',
      'people-overview',
    ]) {
      const grants = [grant(page)];
      expect(withDashboardGrants(grants)).toBe(grants);
    }
  });

  it('does not duplicate an existing dashboard grant', () => {
    const grants = [grant('sales-overview')];
    expect(withDashboardGrants(grants)).toBe(grants);
  });

  it('keeps migration and fresh-install anchors in sync', () => {
    expect(MODULE_DASHBOARD_ANCHORS).toEqual(MODULE_DASHBOARDS);
  });
});
