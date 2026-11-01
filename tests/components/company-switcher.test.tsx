import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import { CompanySwitcher } from '../../client/layouts/components/company-switcher.js';
import { useDeclareCompanyScope } from '../../client/company/company-route-scope.js';

const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));

const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const companies = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'CO',
    name: 'Company One',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'CO-2',
    name: 'Company Two',
  },
];

function Location() {
  const location = useLocation();
  return <output>{location.search}</output>;
}

function Scope({ endpoint }: { endpoint: string }) {
  const { pathname } = useLocation();
  useDeclareCompanyScope(pathname, endpoint);
  return null;
}

function mount(path: string, endpoint?: string) {
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          {endpoint && <Scope endpoint={endpoint} />}
          <CompanySwitcher />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}

beforeEach(() => {
  api.request.mockReset();
  api.request.mockResolvedValue({ data: companies, meta: { total: 2 } });
});

it('shows the current company and switches the page URL', async () => {
  const user = userEvent.setup();
  mount(
    '/functions/procurement/requests?subjectId=00000000-0000-4000-8000-000000000001',
    'procurement/requestCompanies',
  );
  const trigger = await screen.findByRole('button', { name: 'Switch company' });
  expect(trigger).toHaveTextContent('CO · Company One');
  await user.click(trigger);
  await user.click(
    await screen.findByRole('menuitem', { name: /CO-2 · Company Two/ }),
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'subjectId=00000000-0000-4000-8000-000000000002',
    ),
  );
});

it('keeps the settings editor subject in sync when present', async () => {
  const user = userEvent.setup();
  mount(
    '/functions/sales/settings/edit/salesOrders?subjectId=00000000-0000-4000-8000-000000000001&reviewSubjectId=00000000-0000-4000-8000-000000000001',
    'warehouse/settings/companies',
  );
  await user.click(
    await screen.findByRole('button', { name: 'Switch company' }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: /CO-2 · Company Two/ }),
  );
  await waitFor(() => {
    const search = screen.getByRole('status').textContent ?? '';
    expect(search).toContain('subjectId=00000000-0000-4000-8000-000000000002');
    expect(search).toContain(
      'reviewSubjectId=00000000-0000-4000-8000-000000000002',
    );
  });
});

it('renders nothing outside company-scoped pages', () => {
  mount('/functions/warehouse/warehouses');
  expect(
    screen.queryByRole('button', { name: 'Switch company' }),
  ).not.toBeInTheDocument();
});
