import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import ProcurementReviewSettingsPage from '../../client/pages/review-settings/procurement-page.js';
import RequisitionsReviewSettingsPage from '../../client/pages/review-settings/requisitions-page.js';
import SalesReviewSettingsPage from '../../client/pages/review-settings/sales-page.js';
import WarehouseReviewSettingsPage from '../../client/pages/review-settings/warehouse-page.js';

vi.mock('../../client/pages/review-settings/purchase-panel.js', () => ({
  PurchaseReviewSettingsPanel: () => <p>purchase panel</p>,
}));
vi.mock('../../client/pages/review-settings/issue-panel.js', () => ({
  IssueReviewSettingsPanel: () => <p>issue panel</p>,
}));
vi.mock('../../client/pages/execution/settings.js', () => ({
  QuantitySettingsSection: ({ kinds }: { kinds: string[] }) => (
    <p>quantity panel {kinds.join(',')}</p>
  ),
}));

const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>{children}</MemoryRouter>
    </TestI18nProvider>
  );
}
const copy = enUS.reviewSettings;

describe('module review settings pages', () => {
  it('renders procurement settings inside the procurement module', () => {
    render(<ProcurementReviewSettingsPage />, { wrapper: Wrapper });
    expect(
      screen.getByRole('heading', { level: 1, name: copy.procurement }),
    ).toBeVisible();
    expect(screen.getByText('purchase panel')).toBeVisible();
  });

  it('renders requisition settings inside the requisition module', () => {
    render(<RequisitionsReviewSettingsPage />, { wrapper: Wrapper });
    expect(
      screen.getByRole('heading', { level: 1, name: copy.requisitions }),
    ).toBeVisible();
    expect(screen.getByText('issue panel')).toBeVisible();
  });

  it('renders the sales approval card inside the sales module', () => {
    render(<SalesReviewSettingsPage />, { wrapper: Wrapper });
    expect(
      screen.getByRole('heading', { level: 1, name: copy.sales }),
    ).toBeVisible();
    expect(screen.getByText('quantity panel salesOrders')).toBeVisible();
  });

  it('renders the warehouse approval cards inside the warehouse module', () => {
    render(<WarehouseReviewSettingsPage />, { wrapper: Wrapper });
    expect(
      screen.getByRole('heading', { level: 1, name: copy.warehouse }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'quantity panel stockDocuments,stockTransfers,stockCounts',
      ),
    ).toBeVisible();
  });
});
