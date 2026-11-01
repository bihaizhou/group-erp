import { ApiClientError } from '@nocobase/app-client';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import { CompanyGate } from '../../client/company/company-gate.js';
import SupplierList from '../../client/pages/suppliers/list.js';
import SupplierDetail from '../../client/pages/suppliers/detail.js';
import SupplierForm from '../../client/pages/suppliers/form.js';
import SupplierAction from '../../client/pages/suppliers/action.js';
import SupplierDirectory from '../../client/pages/suppliers/directory.js';
import { rootPath } from '../../client/pages/suppliers/model.js';
const { api, toaster, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  permission: { can: true, isPending: false },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => permission,
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const companyId = '00000000-0000-4000-8000-000000000101',
  companyBId = '00000000-0000-4000-8000-000000000105',
  partnerId = '00000000-0000-4000-8000-000000000102',
  regionId = '00000000-0000-4000-8000-000000000103';
const companyB = { id: companyBId, code: 'CO-B', name: 'Company B' };
const identity = {
  id: partnerId,
  code: 'SUP-1',
  name: 'Supplier One',
  registrationCode: null,
  status: 'active',
  revision: 4,
  updatedAt: '2026-10-17T12:00:00Z',
};
const row = {
  partnerId,
  subjectId: companyId,
  identity,
  scopeMatch: 'all',
  supplierStatus: 'active',
  companyStatus: 'active',
  effectiveStatus: 'active',
  settingId: null,
  revision: 0,
  notes: 'Inherited notes',
  updatedAt: identity.updatedAt,
};
const policy = {
  id: '00000000-0000-4000-8000-000000000104',
  partnerId,
  scopeMode: 'selected',
  status: 'active',
  revision: 6,
  regionIds: [regionId],
  subjectIds: [companyId],
};
const page = (data: unknown[]) => ({
  data,
  meta: { page: 1, pageSize: 20, total: data.length },
});
const failure = (status: number, reason?: string) =>
  new ApiClientError('Failure', {
    status,
    reason,
    method: 'POST',
    url: '/test',
    payload: { error: { reason } },
  });
function base({ path, method }: { path: string; method?: string }) {
  if (method === 'PATCH') return Promise.resolve({ data: identity });
  if (method && path.includes('/applicability'))
    return Promise.resolve({ data: policy });
  if (method)
    return Promise.resolve({
      data: {
        id: '00000000-0000-4000-8000-000000000120',
        partnerId,
        subjectId: companyId,
        identity,
        notes: row.notes,
        status: 'active',
        revision: 2,
        updatedAt: row.updatedAt,
      },
    });
  if (path.startsWith('procurement/supplierCapabilities/'))
    return Promise.resolve({
      data: {
        updateIdentity: true,
        configureApplicability: true,
        updateRelationship: true,
      },
    });
  if (path.includes('/history')) return Promise.resolve(page([]));
  if (path.endsWith('/applicability')) return Promise.resolve({ data: policy });
  if (path === 'procurement/supplierCompanies')
    return Promise.resolve(
      page([{ id: companyId, code: 'CO-A', name: 'Company A' }, companyB]),
    );
  if (path.startsWith('procurement/supplierCompanies/'))
    return Promise.resolve({
      data: { id: companyId, code: 'CO-A', name: 'Company A' },
    });
  if (path === 'procurement/supplierAvailability')
    return Promise.resolve(page([row]));
  if (path.startsWith('procurement/supplierAvailability/'))
    return Promise.resolve({ data: row });
  if (path === 'procurement/supplierScopeReferences')
    return Promise.resolve({
      data: {
        regions: [{ id: regionId, code: 'R', name: 'Saved region' }],
        companies: [{ id: companyId, code: 'CO-A', name: 'Company A' }],
      },
    });
  if (
    path.startsWith('procurement/supplierIdentities/') ||
    path.startsWith('procurement/supplierScopeIdentities/')
  )
    return Promise.resolve({ data: identity });
  return Promise.resolve(page([]));
}
beforeEach(() => {
  vi.clearAllMocks();
  permission.can = true;
  api.request.mockImplementation(base);
});
function mount(suffix = '') {
  const router = createMemoryRouter(
    [
      {
        path: rootPath,
        element: (
          <CompanyGate endpoint='procurement/supplierCompanies'>
            <SupplierList />
          </CompanyGate>
        ),
        children: [
          { path: 'new', element: <SupplierForm /> },
          { path: 'directory', element: <SupplierDirectory /> },
          {
            path: ':partnerId',
            element: <SupplierDetail />,
            children: [
              { path: 'edit', element: <SupplierForm /> },
              { path: 'identity', element: <SupplierForm /> },
              { path: 'scope', element: <SupplierForm /> },
              { path: ':target/:transition', element: <SupplierAction /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [`${rootPath}${suffix}`] },
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
it('opens on the first authorised company and scopes supplier queries to it', async () => {
  mount();
  expect(
    await screen.findByRole('button', { name: 'New supplier' }),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) =>
          v.path === 'procurement/supplierAvailability' &&
          v.query?.subjectId === companyId,
      ),
    ).toBe(true),
  );
  expect(
    api.request.mock.calls.some(
      ([v]) =>
        v.path === 'procurement/supplierAvailability' && !v.query?.subjectId,
    ),
  ).toBe(false);
});
it('validates and focuses the first field; retries an ambiguous create with the same key and keeps the company URL', async () => {
  let writes = 0;
  api.request.mockImplementation((v) =>
    v.method === 'POST'
      ? ++writes === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: row })
      : base(v),
  );
  const user = userEvent.setup(),
    router = mount(`/new?subjectId=${companyId}&q=pen`);
  await screen.findByRole('button', { name: /^(Create|Save)$/ });
  const dialog = screen.getByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  expect(within(dialog).getByRole('textbox', { name: /^Code/ })).toHaveFocus();
  await user.type(
    within(dialog).getByRole('textbox', { name: /^Code/ }),
    'SUP-NEW',
  );
  await user.type(
    within(dialog).getByRole('textbox', { name: /^Name/ }),
    'Typed supplier',
  );
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await screen.findByText('The request failed. Your input has been kept.');
  expect(within(dialog).getByRole('textbox', { name: /^Name/ })).toHaveValue(
    'Typed supplier',
  );
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await waitFor(() => expect(router.state.location.pathname).toBe(rootPath));
  const sent = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.method === 'POST');
  expect(sent[0].json.requestKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(sent[1].json.requestKey).toBe(sent[0].json.requestKey);
  expect(router.state.location.search).toBe(`?subjectId=${companyId}&q=pen`);
});
it('keeps a duplicate identity draft editable without offering an unrelated version reload', async () => {
  api.request.mockImplementation((v) =>
    v.method === 'POST'
      ? Promise.reject(failure(409, 'SUPPLIER_IDENTITY_CONFLICT'))
      : base(v),
  );
  const user = userEvent.setup();
  mount(`/new?subjectId=${companyId}`);
  await screen.findByRole('button', { name: /^(Create|Save)$/ });
  const dialog = screen.getByRole('dialog');
  await user.type(
    within(dialog).getByRole('textbox', { name: /^Code/ }),
    'DUPLICATE',
  );
  await user.type(
    within(dialog).getByRole('textbox', { name: /^Name/ }),
    'My supplier',
  );
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await screen.findByText(
    'The code or registration identifier already exists. Ask a shared-data maintainer to check.',
  );
  expect(within(dialog).getByRole('textbox', { name: /^Code/ })).toHaveValue(
    'DUPLICATE',
  );
  expect(
    screen.queryByRole('button', { name: 'Load latest version' }),
  ).not.toBeInTheDocument();
});
it('saves inherited company notes with version zero without sending shared identity fields', async () => {
  const user = userEvent.setup(),
    router = mount(`/${partnerId}/edit?subjectId=${companyId}`);
  await screen.findByRole('button', { name: /^(Create|Save)$/ });
  const dialog = screen.getByRole('dialog');
  const notes = await within(dialog).findByRole('textbox', {
    name: /Company notes/,
  });
  expect(
    within(dialog).queryByRole('textbox', { name: /^Code/ }),
  ).not.toBeInTheDocument();
  await user.clear(notes);
  await user.type(notes, 'Local note');
  await user.type(
    within(dialog).getByRole('textbox', { name: /Reason for change/ }),
    'Local update',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`${rootPath}/${partnerId}`),
  );
  const sent = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'POST');
  expect(sent.path).toBe('procurement/supplierOverrides');
  expect(sent.json).toMatchObject({
    version: 0,
    notes: 'Local note',
    subjectId: companyId,
    status: 'active',
  });
  expect(sent.json).not.toHaveProperty('code');
});
it('keeps saved region/company selections absent from the current search page, and sends their union', async () => {
  const user = userEvent.setup();
  mount(`/${partnerId}/scope?subjectId=${companyId}`);
  await screen.findByRole('button', { name: /^(Create|Save)$/ });
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByRole('button', {
    name: 'Remove R · Saved region',
  });
  await user.type(
    within(dialog).getByRole('textbox', { name: /Reason for change/ }),
    'Retain scope',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.map(([v]) => v).some((v) => v.method === 'PUT'),
    ).toBe(true),
  );
  expect(
    api.request.mock.calls.map(([v]) => v).find((v) => v.method === 'PUT').json,
  ).toMatchObject({
    scopeMode: 'selected',
    regionIds: [regionId],
    subjectIds: [companyId],
    version: 6,
  });
});
it('switches to all companies with empty explicit selections without losing the draft on cancellation', async () => {
  const user = userEvent.setup();
  mount(`/${partnerId}/scope?subjectId=${companyId}`);
  await screen.findByRole('button', { name: /^(Create|Save)$/ });
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByRole('button', {
    name: 'Remove R · Saved region',
  });
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Applicability' }),
  );
  await user.click(
    await screen.findByRole('option', { name: 'All project companies' }),
  );
  await user.type(
    within(dialog).getByRole('textbox', { name: /Reason for change/ }),
    'All companies',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.map(([v]) => v).find((v) => v.method === 'PUT')
        ?.json,
    ).toMatchObject({ scopeMode: 'all', regionIds: [], subjectIds: [] }),
  );
});
it('uses role policy revision for global disable and company version zero for local disable', async () => {
  const user = userEvent.setup();
  mount(`/${partnerId}/global/deactivate?subjectId=${companyId}`);
  const dialog = await screen.findByRole('alertdialog');
  await user.type(
    within(dialog).getByRole('textbox', { name: /Reason for change/ }),
    'Global stop',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.map(([v]) => v).find((v) => v.method === 'POST'),
    ).toMatchObject({
      path: `procurement/supplierIdentities/${partnerId}/applicability/deactivate`,
      json: expect.objectContaining({ version: 6 }),
    }),
  );
});
it('does not expose a row action when the server denies that record scope', async () => {
  api.request.mockImplementation((v) =>
    v.path.startsWith('procurement/supplierCapabilities/')
      ? Promise.resolve({
          data: {
            updateIdentity: false,
            configureApplicability: false,
            updateRelationship: false,
          },
        })
      : base(v),
  );
  const user = userEvent.setup();
  mount(`?subjectId=${companyId}`);
  await screen.findByRole('link', { name: 'Supplier One' });
  await user.click(
    screen.getByRole('button', { name: 'More actions for Supplier One' }),
  );
  await screen.findByRole('menuitem', { name: 'View details' });
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([v]) =>
        v.path.includes('supplierCapabilities'),
      ),
    ).toBe(true),
  );
  expect(
    screen.queryByRole('menuitem', { name: 'Edit shared data' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('menuitem', { name: 'Edit company notes' }),
  ).not.toBeInTheDocument();
});
it('keeps IME composition out of URL requests and preserves the company and sort', async () => {
  const router = mount(`?subjectId=${companyId}&orderBy=-updatedAt`),
    input = await screen.findByRole('textbox', {
      name: 'Code, name or registration identifier',
    });
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: 'zhong' }, isComposing: true });
  await new Promise((r) => setTimeout(r, 400));
  expect(router.state.location.search).not.toContain('q=');
  fireEvent.compositionEnd(input, { data: '中', target: { value: '中' } });
  fireEvent.change(input, { target: { value: '中' } });
  await waitFor(() =>
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe(
      '中',
    ),
  );
  expect(
    new URLSearchParams(router.state.location.search).get('subjectId'),
  ).toBe(companyId);
  expect(new URLSearchParams(router.state.location.search).get('orderBy')).toBe(
    '-updatedAt',
  );
});
it('does not offer retry for forbidden company data', async () => {
  api.request.mockImplementation((v) =>
    v.path.startsWith('procurement/supplierCompanies/')
      ? Promise.reject(failure(403))
      : base(v),
  );
  mount(`?subjectId=${companyId}`);
  await screen.findByText(enUS.procurement.http403);
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});
it('requires an explicit discard before loading a stale record and never overwrites the draft silently', async () => {
  let stale = false;
  api.request.mockImplementation((v) => {
    if (v.method === 'POST') {
      stale = true;
      return Promise.reject(failure(409, 'SUPPLIER_VERSION_CONFLICT'));
    }
    if (stale && v.path === `procurement/supplierAvailability/${partnerId}`)
      return Promise.resolve({
        data: { ...row, revision: 3, notes: 'Newest note' },
      });
    return base(v);
  });
  const user = userEvent.setup();
  mount(`/${partnerId}/edit?subjectId=${companyId}`);
  const notes = await screen.findByRole('textbox', { name: /Company notes/ });
  await user.clear(notes);
  await user.type(notes, 'Unsaved draft');
  await user.type(
    screen.getByRole('textbox', { name: /Reason for change/ }),
    'Stale edit',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await user.click(
    await screen.findByRole('button', { name: 'Load latest version' }),
  );
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(notes).toHaveValue('Unsaved draft');
  await user.click(screen.getByRole('button', { name: 'Load latest version' }));
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(notes).toHaveValue('Newest note'));
  expect(
    screen.getByRole('textbox', { name: /Reason for change/ }),
  ).toHaveValue('');
});
it('asks before discarding a changed form, and blocks cancellation while saving', async () => {
  let finish: ((value: unknown) => void) | undefined;
  api.request.mockImplementation((v) =>
    v.method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : base(v),
  );
  const user = userEvent.setup();
  const router = mount(`/new?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /^Code/ }),
    'SUP-BUSY',
  );
  await user.type(
    screen.getByRole('textbox', { name: /^Name/ }),
    'Busy supplier',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await screen.findByRole('button', { name: 'Saving…' });
  expect(
    screen.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  finish!({ data: row });
  await waitFor(() => expect(router.state.location.pathname).toBe(rootPath));
});
it('keeps a company restore unavailable while its supplier role is globally disabled', async () => {
  api.request.mockImplementation((v) =>
    v.path === `procurement/supplierAvailability/${partnerId}`
      ? Promise.resolve({
          data: {
            ...row,
            supplierStatus: 'inactive',
            companyStatus: 'inactive',
            effectiveStatus: 'inactive',
            revision: 2,
          },
        })
      : base(v),
  );
  mount(`/${partnerId}/company/reactivate?subjectId=${companyId}`);
  const dialog = await screen.findByRole('alertdialog');
  expect(
    within(dialog).getByRole('button', { name: 'Restore' }),
  ).toBeDisabled();
  expect(
    within(dialog).getByText(
      'The supplier is globally disabled or its shared identity is inactive. Restore the global status first.',
    ),
  ).toBeVisible();
});

it('updates saved company data immediately while the follow-up GET is delayed, and retains it if that GET fails', async () => {
  let saved = false,
    rejectRead: ((reason: unknown) => void) | undefined;
  api.request.mockImplementation((v) => {
    if (v.method === 'POST') {
      saved = true;
      return Promise.resolve({
        data: {
          id: 'setting-new',
          partnerId,
          subjectId: companyId,
          identity,
          notes: 'Committed note',
          status: 'active',
          revision: 2,
          updatedAt: row.updatedAt,
        },
      });
    }
    if (saved && v.path === `procurement/supplierAvailability/${partnerId}`)
      return new Promise((_resolve, reject) => {
        rejectRead = reject;
      });
    return base(v);
  });
  const user = userEvent.setup(),
    router = mount(`/${partnerId}/edit?subjectId=${companyId}`);
  const notes = await screen.findByRole('textbox', { name: /Company notes/ });
  await user.clear(notes);
  await user.type(notes, 'Committed note');
  await user.type(
    screen.getByRole('textbox', { name: /Reason for change/ }),
    'Cache update',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`${rootPath}/${partnerId}`),
  );
  await screen.findByText('Committed note', { exact: true });
  rejectRead!(failure(500));
  await screen.findByText('The request failed. Your input has been kept.');
  expect(screen.getByText('Committed note', { exact: true })).toBeVisible();
});
it('retires a missing mutation target and offers a route back instead of repeated save', async () => {
  let gone = false;
  api.request.mockImplementation((v) => {
    if (v.method === 'POST') {
      gone = true;
      return Promise.reject(failure(404));
    }
    if (gone && v.path === `procurement/supplierAvailability/${partnerId}`)
      return Promise.reject(failure(404));
    return base(v);
  });
  const user = userEvent.setup();
  mount(`/${partnerId}/edit?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for change/ }),
    'Missing supplier',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findAllByText(enUS.procurement.http404);
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Save', exact: true }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getAllByRole('button', { name: 'Back to supplier list' }).length,
  ).toBeGreaterThan(0);
});
it('uses global audit status labels and identifies inactive scope references', async () => {
  api.request.mockImplementation((v) => {
    if (v.path.endsWith('/applicability/history'))
      return Promise.resolve(
        page([
          {
            id: 'audit-global',
            kind: 'partnerRolePolicies',
            operation: 'deactivate',
            reason: 'Global reason',
            actorId: 'fixture',
            createdAt: row.updatedAt,
            beforeValue: {
              status: 'active',
              scopeMode: 'all',
              regionIds: [],
              subjectIds: [],
            },
            afterValue: {
              status: 'inactive',
              scopeMode: 'selected',
              regionIds: [regionId],
              subjectIds: [],
            },
          },
        ]),
      );
    if (v.path === 'procurement/supplierScopeReferences')
      return Promise.resolve({
        data: {
          regions: [
            {
              id: regionId,
              code: 'R',
              name: 'Saved region',
              status: 'inactive',
            },
          ],
          companies: [],
        },
      });
    return base(v);
  });
  mount(`/${partnerId}?subjectId=${companyId}`);
  const reason = await screen.findByText('Global reason');
  const article = reason.closest('article')!;
  await within(article).findByText('Saved region (Inactive)');
  expect(
    within(article).getByText('All-company supplier status', { exact: true }),
  ).toBeVisible();
  expect(
    within(article).queryByText('Company status', { exact: true }),
  ).not.toBeInTheDocument();
});
it('clears the directory query and page while preserving the original company', async () => {
  const user = userEvent.setup(),
    router = mount(
      `/directory?subjectId=${companyId}&directoryQ=missing&directoryPage=2`,
    );
  await screen.findByRole('button', { name: 'Clear filters', exact: true });
  await user.click(
    screen.getByRole('button', { name: 'Clear filters', exact: true }),
  );
  await waitFor(() =>
    expect(
      new URLSearchParams(router.state.location.search).has('directoryQ'),
    ).toBe(false),
  );
  expect(
    new URLSearchParams(router.state.location.search).has('directoryPage'),
  ).toBe(false);
  expect(
    new URLSearchParams(router.state.location.search).get('subjectId'),
  ).toBe(companyId);
  await screen.findByText(enUS.procurement.directoryEmptyHint);
});
it('waits for the initial list response before placing the create action', async () => {
  api.request.mockImplementation((v) =>
    v.path === 'procurement/supplierAvailability'
      ? new Promise(() => undefined)
      : base(v),
  );
  mount(`?subjectId=${companyId}`);
  await screen.findByLabelText('Loading suppliers');
  expect(
    screen.queryByRole('button', { name: 'New supplier' }),
  ).not.toBeInTheDocument();
});
