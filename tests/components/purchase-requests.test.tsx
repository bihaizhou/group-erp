import { usePurchaseRefresh } from '../../client/pages/procurement/requests/hooks.js';
import {
  render,
  renderHook,
  act,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import { CompanyGate } from '../../client/company/company-gate.js';
import RequestList from '../../client/pages/procurement/requests/index.js';
import RequestForm from '../../client/pages/procurement/requests/request-form.js';
import RequestDetail, {
  RequestInformation,
} from '../../client/pages/procurement/requests/detail/index.js';
import PurchaseAction from '../../client/pages/procurement/requests/detail/action.js';
import MaterialPicker from '../../client/pages/procurement/requests/material-picker.js';
import { PurchaseReviewSettingsPanel } from '../../client/pages/review-settings/purchase-panel.js';
import {
  rootPath,
  type PurchaseRequest,
  type Action,
} from '../../client/pages/procurement/requests/model.js';
const { api, toast, denied, signIn } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: { show: vi.fn() },
  denied: new Set<string>(),
  signIn: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useService: () => ({ repository: () => ({}) }),
  useApiClient: () => api,
  useToaster: () => toast,
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({
    resource,
    action,
  }: {
    resource: { id: string };
    action: string;
  }) => ({ can: !denied.has(`${resource.id}:${action}`), isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh: signIn }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const companyId = '00000000-0000-4000-8000-000000000001',
  requestId = '00000000-0000-4000-8000-000000000002',
  employeeId = '00000000-0000-4000-8000-000000000003',
  unitId = '00000000-0000-4000-8000-000000000004';
const company = { id: companyId, code: 'CO', name: 'Company One' },
  otherCompany = {
    id: '00000000-0000-4000-8000-000000000098',
    code: 'CO-2',
    name: 'Company Two',
  },
  employee = { id: employeeId, code: 'EMP', name: 'Applicant' },
  unit = { id: unitId, code: 'UNIT', name: 'Department' };
const original: PurchaseRequest = {
  id: requestId,
  code: 'PR-TEST',
  subjectId: companyId,
  requesterEmployeeId: null,
  requestingUnitId: null,
  suggestedSupplierId: null,
  usage: 'Original purpose',
  notes: 'Original notes',
  neededOn: null,
  createdBy: 'applicant',
  status: 'draft',
  revision: 1,
  lifecycleVersion: 1,
  contentVersion: 1,
  reviewRound: 0,
  lineCount: 0,
  identificationStatus: 'unidentified',
  updatedAt: '2026-10-18T00:00:00Z',
  submittedVersionId: null,
  supersedesId: null,
  lines: [],
  versions: [],
  reviewTasks: [],
  display: {
    company,
    requester: null,
    unit: null,
    supplier: null,
    creator: null,
    submitter: null,
    accounts: {},
    relatedRequests: [],
  },
};
let row: PurchaseRequest;
const page = (data: unknown[], total = data.length) => ({
  data,
  meta: {
    page: 1,
    pageSize: 20,
    total,
    businessDate: '2026-10-18',
    timeZone: 'Asia/Shanghai',
  },
});
const fail = (status: number, reason?: string) =>
  new ApiClientError('Failure', {
    status,
    reason,
    method: 'POST',
    url: '/isolated',
    payload: { error: { reason } },
  });
interface Call {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, string | number>;
}
function base(v: Call): Promise<unknown> {
  if (v.path === 'supplyChainFiles/findMany' || v.path.endsWith('/sources'))
    return Promise.resolve({ data: [] });
  if (v.path.endsWith('/capabilities')) {
    const from: Record<Action, string[]> = {
      update: ['draft'],
      submit: ['draft'],
      approve: ['pending'],
      return: ['pending'],
      withdraw: ['pending'],
      revise: ['approved'],
      cancel: ['draft', 'pending', 'approved'],
      reassign: ['pending'],
      copy: ['cancelled'],
    };
    return Promise.resolve({
      data: {
        recordRevision: row.revision,
        lifecycleVersion: row.lifecycleVersion,
        actions: Object.fromEntries(
          Object.entries(from).map(([key, states]) => [
            key,
            {
              visible: true,
              enabled: states.includes(row.status),
              reason: states.includes(row.status)
                ? null
                : 'PURCHASE_ACTION_UNAVAILABLE',
            },
          ]),
        ),
      },
    });
  }
  if (v.path === 'procurement/requestCompanies')
    return Promise.resolve(page([company, otherCompany]));
  if (v.path === 'procurement/requestIdentity')
    return Promise.resolve({
      data: {
        employee,
        companies: [
          {
            ...company,
            primary: true,
            units: [
              {
                ...unit,
                positionId: 'position',
                positionCode: 'POS',
                positionName: 'Position',
                primary: true,
              },
            ],
          },
        ],
        default: { subjectId: companyId, unitId },
      },
    });
  if (v.path === 'procurement/settings/companies')
    return Promise.resolve(page([company]));
  if (v.path === 'procurement/requestOptions')
    return Promise.resolve(page([v.query?.kind === 'units' ? unit : employee]));
  if (v.path === 'procurement/requestSupplierOptions')
    return Promise.resolve(page([]));
  if (v.path === 'procurement/settings/options')
    return Promise.resolve(
      page([{ id: 'reviewer', code: 'REV', name: 'Reviewer' }]),
    );
  if (v.path === 'procurement/settings')
    return Promise.resolve({
      data: {
        subjectId: companyId,
        revision: 1,
        values: {
          reviewerSelections: [
            { group: 1, type: 'user', referenceId: 'reviewer' },
          ],
          allowParallelGovernance: true,
          requireProject: false,
        },
        fields: [
          {
            key: 'reviewerSelections',
            type: 'reviewers',
            title: 'Review positions or accounts',
          },
          {
            key: 'allowParallelGovernance',
            type: 'boolean',
            title: 'Allow review alongside material governance',
          },
        ],
        references: [
          {
            id: 'reviewer',
            group: 1,
            type: 'user',
            referenceId: 'reviewer',
            code: 'REV',
            name: 'Reviewer',
            availability: 'inactive',
          },
        ],
      },
    });
  if (v.path.endsWith('/history')) return Promise.resolve(page([]));
  if (v.path === 'procurement/requests' && !v.method)
    return Promise.resolve(page([row]));
  if (v.path.startsWith('procurement/requests/') && !v.method)
    return Promise.resolve({ data: row });
  if (v.method) {
    const content = v.json?.content as Partial<PurchaseRequest> | undefined;
    return Promise.resolve({
      data: {
        ...row,
        ...content,
        revision: row.revision + 1,
        lifecycleVersion: row.lifecycleVersion + 1,
      },
    });
  }
  return Promise.resolve(page([]));
}
function mount(path = `${rootPath}?subjectId=${companyId}`) {
  const picker = { path: 'lines/:lineId/select', element: <MaterialPicker /> };
  const router = createMemoryRouter(
    [
      {
        path: rootPath,
        element: (
          <CompanyGate endpoint='procurement/requestCompanies'>
            <RequestList />
          </CompanyGate>
        ),
        children: [
          { path: 'new', element: <RequestForm />, children: [picker] },
          {
            path: 'edit/:requestId',
            element: <RequestForm />,
            children: [picker],
          },
          {
            path: ':requestId',
            element: <RequestDetail />,
            children: [
              { path: 'edit', element: <RequestForm />, children: [picker] },
              { path: 'copy', element: <RequestForm />, children: [picker] },
              { path: 'actions/:transition', element: <PurchaseAction /> },
            ],
          },
        ],
      },
      {
        path: '/functions/procurement/settings',
        element: <PurchaseReviewSettingsPanel />,
      },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return Object.assign(router, { queryClient });
}
const form = () =>
  document.querySelector<HTMLFormElement>('#purchase-request-form')!;
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })),
  });
  row = structuredClone(original);
  denied.clear();
  denied.add('procurement.requests:readAll');
  denied.add('procurement.requests:merge');
  api.request.mockReset();
  api.request.mockImplementation(base);
  toast.show.mockReset();
});
it('opens in the first authorised company and scopes requests to it', async () => {
  mount(rootPath);
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) =>
          v.path === 'procurement/requests' && v.query?.subjectId === companyId,
      ),
    ).toBe(true),
  );
  expect(
    api.request.mock.calls.some(
      ([v]) => v.path === 'procurement/requests' && !v.query?.subjectId,
    ),
  ).toBe(false);
});
it('defaults the new form to the caller identity and removes other companies', async () => {
  const user = userEvent.setup();
  mount(`${rootPath}/new?subjectId=${otherCompany.id}`);
  await screen.findByRole('button', { name: 'Save draft' });
  expect(screen.getByText(company.name)).toBeVisible();
  expect(screen.queryByText(otherCompany.name)).not.toBeInTheDocument();
  expect(screen.getByText(new RegExp(employee.name))).toBeVisible();
  expect(screen.getAllByText(new RegExp(unit.name)).length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  const sent = api.request.mock.calls
    .map(([value]) => value)
    .find(
      (value) =>
        value.path === 'procurement/requests' && value.method === 'POST',
    );
  expect(sent.json.content.subjectId).toBe(companyId);
  expect(sent.json.content.requesterEmployeeId).toBe(employeeId);
  expect(sent.json.content.requestingUnitId).toBe(unitId);
});

it('defaults a group reader to submitted requests across companies', async () => {
  denied.delete('procurement.requests:readAll');
  mount(rootPath);
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([value]) =>
          value.path === 'procurement/requests' &&
          value.query?.submitted === 'true' &&
          !value.query?.subjectId,
      ),
    ).toBe(true),
  );
});

it('shows why an account without an effective employment cannot create', async () => {
  api.request.mockImplementation((value) =>
    value.path === 'procurement/requestIdentity'
      ? Promise.resolve({
          data: { employee: null, companies: [], default: null },
        })
      : base(value),
  );
  mount(`${rootPath}/new?subjectId=${companyId}`);
  expect(
    await screen.findByText(/This account has no active employment/),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
});

it('saves a company-only draft without a reason and retries the same payload/key after a network failure', async () => {
  let writes = 0;
  api.request.mockImplementation((v) =>
    v.path === 'procurement/requests' && v.method === 'POST'
      ? ++writes === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: row })
      : base(v),
  );
  const router = mount(`${rootPath}/new?subjectId=${companyId}&q=kept`),
    user = userEvent.setup();
  await screen.findByRole('button', { name: 'Save draft' });
  await user.type(
    within(form()).getByRole('textbox', { name: /Purpose/ }),
    'Typed demand',
  );
  await user.click(within(form()).getByRole('button', { name: 'Save draft' }));
  await screen.findByText('The request failed. Try again; your input is kept.');
  expect(within(form()).getByRole('textbox', { name: /Purpose/ })).toHaveValue(
    'Typed demand',
  );
  await user.click(within(form()).getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(rootPath));
  const sent = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.path === 'procurement/requests' && v.method === 'POST');
  expect(sent).toHaveLength(2);
  expect(sent[0].json.requestKey).toBe(sent[1].json.requestKey);
  expect(sent[0].json).not.toHaveProperty('reason');
  expect(router.state.location.search).toContain('q=kept');
});
it('requires a visible edit reason, focuses its error, and sends both versions', async () => {
  const user = userEvent.setup();
  mount(`${rootPath}/${requestId}/edit?subjectId=${companyId}`);
  const reason = await screen.findByRole('textbox', {
    name: /Reason for changes/,
  });
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  expect(reason).toHaveFocus();
  expect(api.request.mock.calls.some(([v]) => v.method === 'PATCH')).toBe(
    false,
  );
  await user.type(reason, 'Correct purchasing needs');
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(api.request.mock.calls.some(([v]) => v.method === 'PATCH')).toBe(
      true,
    ),
  );
  const sent = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'PATCH');
  expect(sent.json).toMatchObject({
    version: 1,
    lifecycleVersion: 1,
    reason: 'Correct purchasing needs',
  });
});
it('does not clear an edit form after saving fails with 404 and prevents another write', async () => {
  api.request.mockImplementation((v) =>
    v.method === 'PATCH' ? Promise.reject(fail(404)) : base(v),
  );
  const user = userEvent.setup();
  mount(`${rootPath}/edit/${requestId}?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for changes/ }),
    'Keep this reason',
  );
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await screen.findByText(
    'This request does not exist or is unavailable. Return to the list.',
  );
  expect(
    within(form()).getByRole('textbox', { name: /Reason for changes/ }),
  ).toHaveValue('Keep this reason');
  expect(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'PATCH'),
  ).toHaveLength(1);
});
it('copies only after an explicit copy reason and retains the source versions', async () => {
  row = { ...row, status: 'cancelled' };
  const user = userEvent.setup();
  mount(`${rootPath}/${requestId}/copy?subjectId=${companyId}`);
  const reason = await screen.findByRole('textbox', {
    name: /Reason for copying/,
  });
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  expect(reason).toHaveFocus();
  await user.type(reason, 'Replacement request');
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.path.endsWith('/copy') && v.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(
    api.request.mock.calls
      .map(([v]) => v)
      .find((v) => v.path.endsWith('/copy') && v.method === 'POST').json,
  ).toMatchObject({
    reason: 'Replacement request',
    version: 1,
    lifecycleVersion: 1,
  });
});
it('keeps full precision and original unknown descriptions while switching the line to a known material', async () => {
  const user = userEvent.setup();
  mount(`${rootPath}/new?subjectId=${companyId}`);
  await user.click(await screen.findByRole('button', { name: 'Add line' }));
  const line = screen.getByRole('group', { name: 'Line 1' });
  await user.type(
    within(line).getByRole('textbox', { name: 'Original name *' }),
    'Original gloves',
  );
  await user.type(
    within(line).getByRole('textbox', { name: 'Original specification *' }),
    'Thick red',
  );
  await user.type(
    within(line).getByRole('textbox', { name: 'Unit description *' }),
    'pair',
  );
  await user.type(
    within(line).getByRole('textbox', { name: 'Requested quantity *' }),
    '999999999999999999.123456',
  );
  await user.click(
    within(line).getByRole('radio', { name: 'Existing material' }),
  );
  await user.click(within(line).getByRole('button', { name: 'Line details' }));
  expect(
    within(line).getByRole('textbox', { name: 'Original name' }),
  ).toHaveValue('Original gloves');
  expect(
    within(line).getByRole('textbox', { name: 'Requested quantity *' }),
  ).toHaveValue('999999999999999999.123456');
});
it('retains inactive selected reviewers and uses a single complete rules save', async () => {
  const user = userEvent.setup();
  mount(`/functions/procurement/settings?subjectId=${companyId}`);
  await screen.findAllByText(/REV · Reviewer/);
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(api.request.mock.calls.some(([v]) => v.method === 'PUT')).toBe(true),
  );
  const body = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'PUT').json;
  expect(body.values).toMatchObject({
    reviewerSelections: [{ group: 1, type: 'user', referenceId: 'reviewer' }],
    allowParallelGovernance: true,
    requireProject: false,
  });
});
it('renders configuration read-only without a save button', async () => {
  denied.add('procurement.settings:update');
  mount(`/functions/procurement/settings?subjectId=${companyId}`);
  await screen.findAllByText(/REV · Reviewer/);
  expect(
    screen.queryByRole('button', { name: 'Save', exact: true }),
  ).not.toBeInTheDocument();
  expect(api.request.mock.calls.some(([v]) => v.method === 'PUT')).toBe(false);
});
it('requires confirmation for cancellation and keeps the reason until it is confirmed', async () => {
  const user = userEvent.setup();
  mount(`${rootPath}/${requestId}/actions/cancel?subjectId=${companyId}`);
  const dialog = await screen.findByRole('dialog', {
    name: 'Cancel purchase request "PR-TEST"',
  });
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Reason *' }),
    'No longer needed',
  );
  await user.click(
    dialog.querySelector<HTMLButtonElement>('button[type=submit]')!,
  );
  const confirmation = await screen.findByRole('alertdialog');
  expect(
    api.request.mock.calls.some(
      ([v]) => v.path.endsWith('/cancel') && v.method === 'POST',
    ),
  ).toBe(false);
  await user.click(
    within(confirmation).getByRole('button', { name: 'Confirm cancellation' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.path.endsWith('/cancel') && v.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(
    api.request.mock.calls
      .map(([v]) => v)
      .find((v) => v.path.endsWith('/cancel') && v.method === 'POST').json
      .reason,
  ).toBe('No longer needed');
});
it('marks an unavailable department inline and focuses the affected reference without losing the draft', async () => {
  row = {
    ...row,
    requesterEmployeeId: employeeId,
    requestingUnitId: unitId,
    display: { ...row.display, requester: employee, unit },
  };
  api.request.mockImplementation((v) =>
    v.method === 'PATCH'
      ? Promise.reject(fail(400, 'PURCHASE_UNIT_UNAVAILABLE'))
      : base(v),
  );
  const user = userEvent.setup();
  mount(`${rootPath}/edit/${requestId}?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for changes/ }),
    'Keep entered reason',
  );
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(document.getElementById('purchase-requestingUnitId')).toHaveFocus(),
  );
  expect(document.getElementById('purchase-requestingUnitId')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(
    within(form()).getByRole('textbox', { name: /Reason for changes/ }),
  ).toHaveValue('Keep entered reason');
});

it('keeps cached totals correct when saving an existing off-page request or moving a draft to another company', async () => {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const listKey = [
    'purchase',
    'requests',
    { subjectId: companyId, page: 1, pageSize: 20, orderBy: '-updatedAt' },
  ];
  cache.setQueryData(listKey, {
    data: [{ ...row, id: 'another' }],
    meta: { page: 1, pageSize: 20, total: 40 },
  });
  cache.setQueryData(['purchase', `requests/${row.id}`, {}], { data: row });
  const { result } = renderHook(() => usePurchaseRefresh(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  await act(() =>
    result.current({ ...row, notes: 'Saved elsewhere', revision: 2 }),
  );
  expect(
    cache.getQueryData<{ meta: { total: number } }>(listKey)?.meta.total,
  ).toBe(40);
  expect(
    cache.getQueryData<{ data: PurchaseRequest[] }>(listKey)?.data[0].id,
  ).toBe(row.id);
  const companyB = '00000000-0000-4000-8000-000000000099',
    otherKey = [
      'purchase',
      'requests',
      { subjectId: companyB, page: 1, pageSize: 20, orderBy: '-updatedAt' },
    ];
  cache.setQueryData(otherKey, {
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  await act(() => result.current({ ...row, subjectId: companyB, revision: 3 }));
  expect(
    cache.getQueryData<{ meta: { total: number } }>(listKey)?.meta.total,
  ).toBe(39);
  expect(
    cache.getQueryData<{ meta: { total: number } }>(otherKey)?.meta.total,
  ).toBe(1);
  expect(
    cache
      .getQueryData<{ data: PurchaseRequest[] }>(listKey)
      ?.data.some((v) => v.id === row.id),
  ).toBe(false);
});

it('disables saving and retains local inputs when record action availability is revoked during editing', async () => {
  const user = userEvent.setup(),
    router = mount(`${rootPath}/edit/${requestId}?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for changes/ }),
    'Unsaved local explanation',
  );
  api.request.mockImplementation((v) =>
    v.path.endsWith('/capabilities') ? Promise.reject(fail(403)) : base(v),
  );
  await act(() =>
    router.queryClient.invalidateQueries({
      queryKey: ['purchase', `requests/${requestId}/capabilities`],
      refetchType: 'active',
    }),
  );
  await waitFor(() =>
    expect(
      within(form()).getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled(),
  );
  expect(
    within(form()).getByRole('textbox', { name: /Reason for changes/ }),
  ).toHaveValue('Unsaved local explanation');
  expect(api.request.mock.calls.some(([v]) => v.method === 'PATCH')).toBe(
    false,
  );
});

it('distinguishes missing historical names from empty fields without borrowing current reference names', () => {
  render(
    <TestI18nProvider runtime={runtime}>
      <RequestInformation
        row={row}
        snapshot={{
          id: 'legacy',
          contentVersion: 1,
          createdAt: row.updatedAt,
          payload: { head: row, lines: [] },
        }}
      />
    </TestI18nProvider>,
  );
  expect(screen.getAllByText('Name not recorded')).toHaveLength(3);
  expect(screen.queryByText('Company One')).not.toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

it('focuses the retained line editor region after a server-side material reference rejection', async () => {
  api.request.mockImplementation((v) =>
    v.method === 'PATCH'
      ? Promise.reject(fail(400, 'PURCHASE_MATERIAL_CHANGED'))
      : base(v),
  );
  const user = userEvent.setup();
  mount(`${rootPath}/edit/${requestId}?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for changes/ }),
    'Retain this explanation',
  );
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(document.getElementById('purchase-lines')).toHaveFocus(),
  );
  expect(document.getElementById('purchase-lines')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(
    within(form()).getByRole('textbox', { name: /Reason for changes/ }),
  ).toHaveValue('Retain this explanation');
});

it('marks a retained department for explicit reselection after the requester changes', async () => {
  row = {
    ...row,
    requesterEmployeeId: employeeId,
    requestingUnitId: unitId,
    display: { ...row.display, requester: employee, unit },
  };
  const other = {
    id: '00000000-0000-4000-8000-000000000005',
    code: 'EMP2',
    name: 'Other Applicant',
  };
  api.request.mockImplementation((v) =>
    v.path === 'procurement/requestOptions' && v.query?.kind === 'employees'
      ? Promise.resolve(page([employee, other]))
      : base(v),
  );
  const user = userEvent.setup();
  mount(`${rootPath}/edit/${requestId}?subjectId=${companyId}`);
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for changes/ }),
    'Changed requester',
  );
  await user.click(
    within(form()).getByRole('radio', { name: /Other Applicant/ }),
  );
  expect(within(form()).getByText(/The requester changed/)).toBeVisible();
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  expect(api.request.mock.calls.some(([v]) => v.method === 'PATCH')).toBe(
    false,
  );
  expect(document.getElementById('purchase-requestingUnitId')).toHaveFocus();
  await user.click(
    await within(form()).findByRole('radio', { name: /UNIT.*Department/ }),
  );
  expect(
    within(form()).queryByText(/The requester changed/),
  ).not.toBeInTheDocument();
  await user.click(
    within(form()).getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(api.request.mock.calls.some(([v]) => v.method === 'PATCH')).toBe(
      true,
    ),
  );
});

it('keeps rejected company rules and focuses their inline error region', async () => {
  api.request.mockImplementation((v) =>
    v.method === 'PUT'
      ? Promise.reject(fail(400, 'PURCHASE_REVIEW_REFERENCE_UNAVAILABLE'))
      : base(v),
  );
  const user = userEvent.setup();
  mount(`/functions/procurement/settings?subjectId=${companyId}`);
  await user.click(
    await screen.findByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(document.getElementById('purchase-review-rules')).toHaveFocus(),
  );
  expect(document.getElementById('purchase-review-rules')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(
    document.getElementById('purchase-review-rules-error'),
  ).toHaveTextContent(/unavailable/i);
  expect(screen.getByRole('radio', { name: /Reviewer/ })).toBeChecked();
});
