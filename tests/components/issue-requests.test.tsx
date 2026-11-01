import {
  render,
  act,
  screen,
  within,
  waitFor,
  fireEvent,
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
import RequestList from '../../client/pages/requisitions/requests/index.js';
import RequestForm from '../../client/pages/requisitions/requests/request-form.js';
import Purposes from '../../client/pages/requisitions/purposes/index.js';
import PurposeDetail from '../../client/pages/requisitions/purposes/detail.js';
import PurposeForm from '../../client/pages/requisitions/purposes/form.js';
import { IssueReviewSettingsPanel } from '../../client/pages/review-settings/issue-panel.js';
import { rootPath } from '../../client/pages/requisitions/requests/model.js';
const { api, toast, denied } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: { show: vi.fn() },
  denied: new Set<string>(),
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
  useAuthentication: () => ({ refresh: vi.fn() }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const companyId = '00000000-0000-4000-8000-000000000001',
  employeeId = '00000000-0000-4000-8000-000000000002',
  purposeId = '00000000-0000-4000-8000-000000000003';
const company = { id: companyId, code: 'CO', name: 'Company' },
  employee = { id: employeeId, code: 'EMP', name: 'Applicant' };
const purpose = {
  id: purposeId,
  subjectId: companyId,
  code: 'REPAIR',
  name: 'Equipment repair',
  description: 'Repair work',
  status: 'active',
  revision: 1,
  lifecycleVersion: 0,
  updatedAt: '2026-10-18T00:00:00Z',
  company,
};
const page = (data: unknown[]) => ({
  data,
  meta: {
    page: 1,
    pageSize: 20,
    total: data.length,
    businessDate: '2026-10-18',
    timeZone: 'Asia/Shanghai',
  },
});
interface Call {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, unknown>;
}
function base(v: Call): Promise<unknown> {
  if (v.path === 'supplyChainFiles/findMany' || v.path.endsWith('/sources'))
    return Promise.resolve({ data: [] });
  if (
    ['requisitions/requestCompanies', 'requisitions/purposeCompanies'].includes(
      v.path,
    )
  )
    return Promise.resolve(page([company]));
  if (v.path === 'requisitions/requestOptions')
    return Promise.resolve(page([employee]));
  if (v.path === 'requisitions/requestPurposeOptions')
    return Promise.resolve(page([purpose]));
  if (v.path === 'requisitions/purposes')
    return Promise.resolve(page([purpose]));
  if (v.path === `requisitions/purposes/${purposeId}` && !v.method)
    return Promise.resolve({ data: purpose });
  if (v.method)
    return Promise.resolve({
      data: {
        ...purpose,
        ...(v.json?.content as object),
        id: 'new-request',
        code: 'IR-UI',
        lines: [],
        display: { company, relatedRequests: [] },
        revision: 2,
        lifecycleVersion: 1,
        subjectId: companyId,
        usage: '',
        notes: '',
        neededOn: null,
        status: 'draft',
        identificationStatus: 'unidentified',
      },
    });
  return Promise.resolve(page([]));
}
function mount(path = `${rootPath}?subjectId=${companyId}`) {
  const router = createMemoryRouter(
    [
      {
        path: rootPath,
        element: <RequestList />,
        children: [{ path: 'new', element: <RequestForm /> }],
      },
      {
        path: '/functions/requisitions/settings',
        element: <IssueReviewSettingsPanel />,
      },
      {
        path: '/functions/requisitions/purposes',
        element: <Purposes />,
        children: [
          { path: 'new', element: <PurposeForm /> },
          {
            path: ':purposeId',
            element: <PurposeDetail />,
            children: [
              { path: 'edit', element: <PurposeForm /> },
              { path: 'actions/:transition', element: <PurposeForm /> },
            ],
          },
        ],
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
  return router;
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    })),
  });
  denied.clear();
  api.request.mockReset();
  api.request.mockImplementation(base);
  toast.show.mockReset();
});
it('shows the issue empty state with exactly one create action and hides it without permission', async () => {
  denied.add('requisitions.requests:create');
  mount();
  expect(
    await screen.findByText(enUS.requisitions.requestUi.emptyTitle),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: enUS.requisitions.requestUi.create }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(enUS.requisitions.requestUi.emptyReadOnly),
  ).toBeVisible();
});
it('saves a real recipient and purpose selected from compact pickers and preserves the same key on retry', async () => {
  let writes = 0;
  api.request.mockImplementation((v: Call) =>
    v.path === 'requisitions/requests' && v.method
      ? ++writes === 1
        ? Promise.reject(new TypeError('Network failure'))
        : base(v)
      : base(v),
  );
  const router = mount(`${rootPath}/new?subjectId=${companyId}`),
    user = userEvent.setup();
  await waitFor(() =>
    expect(document.querySelector('#issue-request-form')).not.toBeNull(),
  );
  const form = () =>
    document.querySelector<HTMLFormElement>('#issue-request-form')!;
  await user.click(
    form().querySelector<HTMLButtonElement>('#issue-recipientEmployeeId')!,
  );
  await user.click(
    await screen.findByRole('radio', { name: 'EMP · Applicant' }),
  );
  await user.click(
    form().querySelector<HTMLButtonElement>('#issue-purposeId')!,
  );
  await user.click(
    await screen.findByRole('radio', { name: 'REPAIR · Equipment repair' }),
  );
  await user.type(
    within(form()).getByLabelText('Notes'),
    'Keep this explanation',
  );
  await user.click(within(form()).getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(writes).toBe(1));
  expect(within(form()).getByLabelText('Notes')).toHaveValue(
    'Keep this explanation',
  );
  await user.click(within(form()).getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(rootPath));
  const payloads = api.request.mock.calls
    .map(([v]) => v as Call)
    .filter((v) => v.path === 'requisitions/requests' && v.method)
    .map((v) => v.json!);
  expect(payloads).toHaveLength(2);
  expect(payloads[0].requestKey).toBe(payloads[1].requestKey);
  expect(payloads[1].content).toMatchObject({
    recipientEmployeeId: employeeId,
    purposeId,
    notes: 'Keep this explanation',
  });
  expect(payloads[1].content).not.toHaveProperty('suggestedSupplierId');
});
it('keeps an edited purpose and reason visible after permission is denied', async () => {
  api.request.mockImplementation((v: Call) =>
    v.path === `requisitions/purposes/${purposeId}` && v.method
      ? Promise.reject(
          new ApiClientError('Denied', {
            status: 403,
            method: 'PATCH',
            url: '/isolated',
          }),
        )
      : base(v),
  );
  mount(
    `/functions/requisitions/purposes/${purposeId}/edit?subjectId=${companyId}`,
  );
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Name *');
  await user.type(input, ' corrected');
  await user.type(screen.getByLabelText('Reason *'), 'Maintenance correction');
  const dialog = input.closest('[role=dialog]')! as HTMLElement;
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await screen.findByText(enUS.requisitions.requestUi.forbidden);
  expect(input).toHaveValue('Equipment repair corrected');
  expect(screen.getByLabelText('Reason *')).toHaveValue(
    'Maintenance correction',
  );
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
});
it('keeps Chinese composition inside the compact reference picker until committed', async () => {
  mount(`${rootPath}/new?subjectId=${companyId}`);
  const user = userEvent.setup();
  await waitFor(() =>
    expect(document.querySelector('#issue-recipientEmployeeId')).not.toBeNull(),
  );
  await user.click(
    document.querySelector<HTMLButtonElement>('#issue-recipientEmployeeId')!,
  );
  const search = await screen.findByRole('textbox', {
    name: /Recipient.*Search by code or name/u,
  });
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: 'zhang' } });
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(
    api.request.mock.calls.some(
      ([v]) =>
        v.path === 'requisitions/requestOptions' && v.query.q === 'zhang',
    ),
  ).toBe(false);
  fireEvent.compositionEnd(search, { data: '张', target: { value: '张' } });
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.path === 'requisitions/requestOptions' && v.query.q === '张',
      ),
    ).toBe(true),
  );
});

it('retains a new issue draft when its create permission is revoked while open', async () => {
  const router = mount(`${rootPath}/new?subjectId=${companyId}`),
    user = userEvent.setup();
  await waitFor(() =>
    expect(document.querySelector('#issue-notes')).not.toBeNull(),
  );
  await user.type(
    document.querySelector<HTMLTextAreaElement>('#issue-notes')!,
    'Retain this draft',
  );
  denied.add('requisitions.requests:create');
  await act(() =>
    router.navigate(`${rootPath}/new?subjectId=${companyId}&access=changed`),
  );
  expect(document.querySelector('#issue-notes')).toHaveValue(
    'Retain this draft',
  );
  expect(
    within(
      document.querySelector<HTMLFormElement>('#issue-request-form')!,
    ).getByRole('button', { name: 'Save draft' }),
  ).toBeDisabled();
});

it('marks each invalid unknown field, focuses its first input and clears the corrected field error', async () => {
  mount(`${rootPath}/new?subjectId=${companyId}`);
  const user = userEvent.setup();
  const form = await waitFor(() => {
    const f = document.querySelector<HTMLFormElement>('#issue-request-form');
    expect(f).not.toBeNull();
    return f!;
  });
  await user.click(within(form).getByRole('button', { name: 'Add line' }));
  await user.click(within(form).getByRole('button', { name: 'Save draft' }));
  const name = within(form).getByLabelText('Original name *');
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(
    form.querySelectorAll(
      'input[aria-invalid="true"],textarea[aria-invalid="true"]',
    ),
  ).toHaveLength(4);
  await user.type(name, 'Repair glove');
  expect(name).toHaveAttribute('aria-invalid', 'false');
  expect(
    api.request.mock.calls.some(
      ([v]) => v.method === 'POST' && v.path === 'requisitions/requests',
    ),
  ).toBe(false);
});
it('keeps keyboard focus on an existing rule control when conditions or groups are removed', async () => {
  api.request.mockImplementation((v: Call) =>
    v.path === 'requisitions/settings'
      ? Promise.resolve({
          data: {
            subjectId: companyId,
            revision: 1,
            values: {
              reviewerSelections: [
                { group: 1, type: 'user', referenceId: employeeId },
                { group: 1, type: 'user', referenceId: 'second-reviewer' },
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
                ...employee,
                type: 'user',
                referenceId: employeeId,
                group: 1,
                availability: 'active',
              },
            ],
          },
        })
      : base(v),
  );
  mount(`/functions/requisitions/settings?subjectId=${companyId}`);
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole('button', { name: 'Remove condition' }))[0],
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add condition' })).toHaveFocus(),
  );
  await user.click(
    screen.getByRole('button', { name: 'Remove candidate group' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Add candidate group' }),
    ).toHaveFocus(),
  );
  expect(api.request.mock.calls.some(([v]) => v.method === 'PUT')).toBe(false);
});
