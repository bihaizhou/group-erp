import { ApiClientError } from '@nocobase/app-client';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import Action from '../../client/pages/execution/action.js';
import type { ExecutionRecord } from '../../client/pages/execution/model.js';
const { api, toast } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: { show: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toast,
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: true, isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh: vi.fn() }),
}));
const runtime = await createTestI18nRuntime({
    application: { namespace: 'group-erp', resources: enUS },
  }),
  id = '00000000-0000-4000-8000-000000000731';
const row = {
  id,
  code: 'WH-731',
  subjectId: '00000000-0000-4000-8000-000000000732',
  warehouseId: '00000000-0000-4000-8000-000000000733',
  kind: 'initial',
  occurredOn: '2026-10-19',
  reason: 'Opening',
  notes: '',
  status: 'draft',
  revision: 1,
  lifecycleVersion: 1,
  contentVersion: 1,
  updatedAt: '2026-10-19T00:00:00Z',
  lines: [],
  display: {
    company: { id: 'c', name: 'East company' },
    warehouse: { id: 'w', name: 'East warehouse' },
    destinationWarehouse: null,
    partner: null,
  },
} satisfies ExecutionRecord;
const failure = (status: number, reason?: string) =>
  new ApiClientError('Failure', {
    status,
    reason,
    method: 'POST',
    url: '/test',
    payload: { error: { reason } },
  });
const capability = {
  data: {
    recordRevision: 1,
    lifecycleVersion: 1,
    actions: { post: { visible: true, enabled: true } },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
});
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: '/functions/warehouse/inbounds/:id',
        element: (
          <>
            <p>Document background</p>
            <Outlet />
          </>
        ),
        children: [{ path: 'actions/:action', element: <Action /> }],
      },
    ],
    {
      initialEntries: [
        `/functions/warehouse/inbounds/${id}/actions/post?subjectId=${row.subjectId}`,
      ],
    },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return router;
}
async function confirm() {
  const user = userEvent.setup(),
    dialog = await screen.findByRole('dialog');
  await user.type(
    await within(dialog).findByLabelText(/Business reason/u),
    'Opening verified',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Post', exact: true }),
  );
  const confirmation = await screen.findByRole('alertdialog');
  await user.click(
    within(confirmation).getByRole('button', { name: 'Post', exact: true }),
  );
}
it('a committed action with failed refresh offers only GET recovery and never repeats the posting', async () => {
  let wrote = false,
    recover = false;
  api.request.mockImplementation(({ path, method }) => {
    if (method === 'POST') {
      wrote = true;
      return Promise.resolve({
        data: { id, status: 'posted', revision: 2, lifecycleVersion: 2 },
      });
    }
    if (path.endsWith('/capabilities')) return Promise.resolve(capability);
    if (wrote && !recover) return Promise.reject(failure(500));
    return Promise.resolve({
      data: { ...row, status: wrote ? 'posted' : 'draft' },
    });
  });
  const router = mount();
  await confirm();
  expect(
    await screen.findByText(
      'The action succeeded. The latest view could not be loaded. Read it again to continue.',
    ),
  ).toBeVisible();
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: 'Post', exact: true }),
  ).not.toBeInTheDocument();
  recover = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Read latest record' }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      `/functions/warehouse/inbounds/${id}`,
    ),
  );
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(1);
});
it('409 retains the reason, does not refetch or retry automatically, and requires a fresh explicit confirmation', async () => {
  let latest = false;
  api.request.mockImplementation(({ path, method }) => {
    if (method === 'POST')
      return Promise.reject(failure(409, 'STOCK_VERSION_CONFLICT'));
    if (path.endsWith('/capabilities')) return Promise.resolve(capability);
    return Promise.resolve({ data: { ...row, revision: latest ? 2 : 1 } });
  });
  mount();
  await confirm();
  await screen.findByText(
    'Someone changed this record. Read the latest version and review your changes before saving.',
  );
  const gets = api.request.mock.calls.filter(([v]) => !v.method).length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(api.request.mock.calls.filter(([v]) => !v.method)).toHaveLength(gets);
  expect(screen.getByLabelText(/Business reason/u)).toHaveValue(
    'Opening verified',
  );
  expect(
    screen.getByRole('button', { name: 'Post', exact: true }),
  ).toBeDisabled();
  latest = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Read latest record' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Post', exact: true }),
    ).toBeEnabled(),
  );
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole('button', { name: 'Post', exact: true }),
  );
  await screen.findByRole('alertdialog');
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(1);
});
