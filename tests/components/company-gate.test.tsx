import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { CompanyGate } from '../../client/company/company-gate.js';
import enUS from '../../client/locales/en-US.js';

const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));

const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const first = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'CO',
    name: 'Company One',
  },
  second = {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'CZ',
    name: 'Company Two',
  };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid='location'>{location.search}</output>;
}

function mount(
  entry: string,
  companies = [first, second],
  defaultCompanyId: string | null = null,
) {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path === 'account/context'
        ? { data: { employeeId: null, defaultCompanyId } }
        : { data: companies, meta: { total: companies.length } },
    ),
  );
  return render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[entry]}>
          <CompanyGate endpoint='procurement/requestCompanies'>
            <p>page body</p>
          </CompanyGate>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}

beforeEach(() => {
  api.request.mockReset();
});

it('opens in the first authorised company instead of asking', async () => {
  mount('/functions/procurement/requests');
  expect(await screen.findByText('page body')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `subjectId=${first.id}`,
    ),
  );
});

it('mounts the page for a company in the URL', async () => {
  mount(`/functions/procurement/requests?subjectId=${first.id}`);
  expect(await screen.findByText('page body')).toBeVisible();
});

it('selects the only company without asking', async () => {
  mount('/functions/procurement/requests', [first]);
  expect(await screen.findByText('page body')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `subjectId=${first.id}`,
    ),
  );
});

it('uses the account home company when the module authorises it', async () => {
  mount('/functions/procurement/requests', [first, second], second.id);
  expect(await screen.findByText('page body')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `subjectId=${second.id}`,
    ),
  );
});

it('falls back to the first company when the home company is not authorised', async () => {
  mount(
    '/functions/procurement/requests',
    [first, second],
    '00000000-0000-4000-8000-000000000099',
  );
  expect(await screen.findByText('page body')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `subjectId=${first.id}`,
    ),
  );
});

it('replaces a company this module cannot use', async () => {
  mount(
    '/functions/procurement/requests?subjectId=00000000-0000-4000-8000-000000000099',
  );
  expect(await screen.findByText('page body')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      `subjectId=${first.id}`,
    ),
  );
});

it('says there is no company instead of showing an empty picker', async () => {
  mount('/functions/procurement/requests', []);
  expect(
    await screen.findByText('No company yet', {
      selector: '[data-slot=empty-title]',
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Select a company/i }),
  ).not.toBeInTheDocument();
});
