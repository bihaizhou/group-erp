import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import PeopleList from '../../client/pages/people/list.js';
import PeopleForm from '../../client/pages/people/form.js';
import type { Row } from '../../client/pages/people/model.js';

const { api, toaster, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  permission: { can: true, isPending: false, error: undefined },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => permission,
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const row: Row = {
  id: '00000000-0000-4000-8000-000000000111',
  code: 'E-TEST',
  name: 'Test talent card',
  subjectId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000112',
  positionId: null,
  status: 'active',
  grade: 3,
  version: 1,
  lifecycleVersion: 0,
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
  snapshot: null,
  data: {
    grade: 3,
    modelId: null,
    targetModelId: null,
    extraItems: [],
    strengths: '',
    improvements: '',
    achievements: [],
    performance: [],
    careerDirection: '',
    potential: '',
    potentialEvidence: '',
    toValidate: '',
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  permission.can = true;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (path === 'people/options')
        return {
          data: {
            orgSubjects: {
              rows: [
                {
                  id: row.subjectId,
                  code: 'GROUP',
                  name: 'Test group',
                  status: 'active',
                },
              ],
              total: 1,
              truncated: false,
            },
            employees: {
              rows: [
                {
                  id: row.personId,
                  code: row.code,
                  name: 'Test employee',
                  status: 'active',
                },
              ],
              total: 1,
              truncated: false,
            },
            models: { rows: [], total: 0, truncated: false },
            dimensions: { rows: [], total: 0, truncated: false },
          },
        };
      if (path === `people/profiles/${row.id}`)
        return { data: method === 'PATCH' ? { ...row, version: 2 } : row };
      return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    },
  );
});
function mount(path = '/human-resources/profiles') {
  const router = createMemoryRouter(
    [
      {
        path: '/human-resources/profiles',
        element: <PeopleList kind='profiles' />,
        children: [
          { path: 'edit/:recordId', element: <PeopleForm /> },
          { path: 'new', element: <PeopleForm /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={cache}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return router;
}
it('shows one create action in a true empty state and none without maintenance permission', async () => {
  permission.can = false;
  mount();
  await screen.findByText('No Employee talent cards yet');
  expect(
    screen.queryByRole('button', { name: 'New Employee talent cards' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(enUS.people.readOnlyEmpty)).toBeVisible();
});
it('validates simple employee levels and retains the user input until a successful save', async () => {
  const router = mount(`/human-resources/profiles/edit/${row.id}`),
    user = userEvent.setup();
  const grade = await screen.findByLabelText('Employee level');
  await user.clear(grade);
  await user.type(grade, '6');
  await user.type(
    screen.getByLabelText('Reason or comment *'),
    'Reviewed capabilities',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(screen.getByText(enUS.people.invalid)).toBeVisible();
  expect(
    api.request.mock.calls.some(([value]) => value.method === 'PATCH'),
  ).toBe(false);
  await user.clear(grade);
  await user.type(grade, '4');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([value]) => value.method === 'PATCH' && value.json.data.grade === 4,
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/human-resources/profiles'),
  );
  expect(toaster.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'success' }),
  );
});
it('keeps Chinese composition out of requests until the committed search term is ready', async () => {
  mount();
  const input = await screen.findByPlaceholderText(enUS.people.search);
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: 'zhang' }, isComposing: true });
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(
    api.request.mock.calls.some(([value]) => value.query?.q === 'zhang'),
  ).toBe(false);
  fireEvent.compositionEnd(input, { data: '张' });
  fireEvent.change(input, { target: { value: '张' } });
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([value]) => value.query?.q === '张'),
    ).toBe(true),
  );
});
