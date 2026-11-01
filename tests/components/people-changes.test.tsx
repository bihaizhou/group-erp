import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
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

const personId = '00000000-0000-4000-8000-000000000201',
  subjectId = '00000000-0000-4000-8000-000000000202',
  unitId = '00000000-0000-4000-8000-000000000203',
  positionId = '00000000-0000-4000-8000-000000000204';

function row(id: string, person: string | null, data: Row['data']): Row {
  return {
    id,
    code: id,
    name: id,
    status: 'active',
    version: 1,
    lifecycleVersion: 0,
    subjectId,
    personId: person,
    positionId: null,
    grade: null,
    data,
    snapshot: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const options = {
  meta: { businessDate: '2026-10-30', timeZone: 'Asia/Shanghai' },
  data: {
    changes: { rows: [], total: 0, truncated: false },
    employees: {
      rows: [
        {
          ...row(personId, personId, {}),
          code: 'E001',
          name: 'Zhang San',
        },
      ],
      total: 1,
      truncated: false,
    },
    employments: {
      rows: [
        row('EMP-1', personId, {
          type: 'employee',
          startDate: '2026-01-01',
          endDate: null,
        }),
      ],
      total: 1,
      truncated: false,
    },
    assignments: {
      rows: [
        {
          ...row('ASG-1', personId, {
            type: 'primary',
            startDate: '2026-01-01',
            endDate: null,
          }),
          positionId,
        },
      ],
      total: 1,
      truncated: false,
    },
    orgSubjects: {
      rows: [
        {
          id: subjectId,
          code: 'GROUP',
          name: 'Qinwang Group',
          status: 'active',
        },
      ],
      total: 1,
      truncated: false,
    },
    orgUnits: {
      rows: [
        {
          id: unitId,
          code: 'HQ',
          name: 'Group HQ',
          status: 'active',
          subjectId,
        },
      ],
      total: 1,
      truncated: false,
    },
    orgPositions: {
      rows: [
        {
          id: positionId,
          code: 'QWKJ-OPS',
          name: 'Operations manager',
          status: 'active',
          unitId,
        },
      ],
      total: 1,
      truncated: false,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  permission.can = true;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (path === 'people/options') return structuredClone(options);
      if (path === 'people/changes' && method === 'POST')
        return { data: row('CHG-1', personId, { type: 'exit' }) };
      return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    },
  );
});

function mount() {
  const router = createMemoryRouter(
    [
      {
        path: '/human-resources/changes/new',
        element: <PeopleForm />,
      },
      { path: '/human-resources/changes', element: <div>list</div> },
    ],
    { initialEntries: ['/human-resources/changes/new'] },
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

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
  return user;
}

it('prefills the current company and position when a transfer is prepared', async () => {
  mount();
  await choose('Employee', 'Zhang San · E001');
  await choose('Type', 'Transfer');
  expect(
    await screen.findByRole('combobox', { name: 'Target company' }),
  ).toHaveTextContent('Qinwang Group');
  expect(
    screen.getByRole('combobox', { name: 'Target position' }),
  ).toHaveTextContent('Operations manager');
});

it('shows the current company and position read-only for an exit', async () => {
  mount();
  await choose('Type', 'Exit');
  await choose('Employee', 'Zhang San · E001');
  expect(screen.queryByRole('combobox', { name: 'Target company' })).toBeNull();
  expect(
    screen.queryByRole('combobox', { name: 'Target position' }),
  ).toBeNull();
  expect(screen.getByText('Current company')).toBeVisible();
  expect(screen.getByText('Qinwang Group')).toBeVisible();
  expect(screen.getByText('Current position')).toBeVisible();
  expect(screen.getByText('Operations manager')).toBeVisible();
});
