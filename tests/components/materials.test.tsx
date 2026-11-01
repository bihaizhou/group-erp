import { ApiClientError } from '@nocobase/app-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import MaterialList from '../../client/pages/materials/list.js';
import MaterialForm from '../../client/pages/materials/form.js';
import MaterialAction from '../../client/pages/materials/action.js';
import MaterialHistory from '../../client/pages/materials/history.js';
const { api, toaster, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  permission: { can: true, isPending: false, error: undefined },
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
beforeEach(() => {
  vi.clearAllMocks();
  // LAN HTTP exposes getRandomValues, but not the secure-context-only randomUUID.
  vi.stubGlobal('crypto', {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  });
  permission.can = true;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (path === 'materials/options')
        return {
          data: { names: { rows: [], total: 0, truncated: false } },
        };
      if (path === 'materials/templates' && method === 'POST')
        return {
          data: {
            id: 'template-id',
            name: 'Pen dimensions',
            status: 'active',
            version: 1,
          },
        };
      if (path === 'materials/names' && method === 'POST')
        return {
          data: {
            id: '00000000-0000-4000-8000-000000000111',
            name: 'Office supplies',
            version: 1,
            status: 'active',
          },
        };
      return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function mount(path = '/functions/warehouse/materials/names') {
  const router = createMemoryRouter(
    [
      {
        path: '/functions/warehouse/materials/history',
        element: <MaterialHistory />,
      },
      {
        path: '/functions/warehouse/materials/names',
        element: <MaterialList />,
        children: [
          { path: 'new', element: <MaterialForm /> },
          {
            path: ':recordId/actions/:transition',
            element: <MaterialAction />,
          },
        ],
      },
      {
        path: '/functions/warehouse/materials/templates',
        element: <MaterialList />,
        children: [
          { path: 'new', element: <MaterialForm /> },
          { path: 'edit/:recordId', element: <MaterialForm /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: 3 } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return router;
}
it('shows one create entry in an empty list and preserves filters when closing the form', async () => {
  const user = userEvent.setup(),
    router = mount('/functions/warehouse/materials/names?status=active');
  await screen.findByText('No matching records');
  await user.click(screen.getByRole('button', { name: 'New Standard names' }));
  expect(router.state.location.search).toBe('?status=active');
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/functions/warehouse/materials/names',
    ),
  );
  expect(router.state.location.search).toBe('?status=active');
});
it('validates required input and creates a standard name without a category without a manually assigned code', async () => {
  const user = userEvent.setup(),
    router = mount('/functions/warehouse/materials/names/new');
  await screen.findByRole('button', { name: 'Create' });
  await user.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('This field is required.')).toBeVisible();
  await user.type(
    screen.getByRole('textbox', { name: /^Name/ }),
    'Office supplies',
  );
  await user.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/functions/warehouse/materials/names',
    ),
  );
  const call = api.request.mock.calls.find(
    ([arg]) => arg.method === 'POST',
  )?.[0];
  expect(call.json).toMatchObject({
    name: 'Office supplies',
    templateId: null,
  });
  expect(call.json.code).toBeUndefined();
  expect(toaster.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'success' }),
  );
});
it('keeps read-only controls hidden', async () => {
  permission.can = false;
  mount();
  await screen.findByText('No records yet');
  expect(
    screen.queryByRole('button', { name: 'New Standard names' }),
  ).not.toBeInTheDocument();
});

it('keeps retired category audit records readable without restoring a category workflow', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'history-entry',
        recordName: 'Office supplies',
        kind: 'categories',
        operation: 'edit',
        reason: 'edit',
        actorName: 'Maintainer',
        createdAt: '2026-10-17T00:00:00Z',
        beforeValue: {
          name: 'Office supplies',
          parentId: 'former-parent',
          sortOrder: 1,
        },
        afterValue: {
          name: 'Office supplies',
          parentId: 'new-parent',
          sortOrder: 2,
        },
      },
    ],
    meta: { total: 1, page: 1 },
  });
  mount('/functions/warehouse/materials/history');
  await screen.findByText(/Historical records/);
  await userEvent.setup().click(screen.getByText('View change details'));
  expect(screen.getByText('Former parent category')).toBeVisible();
  expect(screen.getByText('Former sort order')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'New Categories' }),
  ).not.toBeInTheDocument();
});

it('rejects a saved category filter without loading an unfiltered list and recovers by clearing it', async () => {
  const user = userEvent.setup();
  const router = mount(
    '/functions/warehouse/materials/names?categoryId=retired&page=3',
  );
  await screen.findByText('This filter is no longer available');
  expect(
    screen.queryByRole('button', { name: 'Refresh', exact: true }),
  ).not.toBeInTheDocument();
  expect(
    api.request.mock.calls.some(([arg]) => arg.path === 'materials/names'),
  ).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await screen.findByText('No records yet');
  expect(router.state.location.search).toBe('');
  expect(
    screen.getByRole('textbox', { name: 'Search name, code or specification' }),
  ).toHaveFocus();
  expect(
    api.request.mock.calls.some(([arg]) => arg.path === 'materials/names'),
  ).toBe(true);
});

it('keeps a new record editable after a unique-code conflict and retries with corrected input', async () => {
  const user = userEvent.setup(),
    router = mount('/functions/warehouse/materials/names/new');
  const create = await screen.findByRole('button', { name: 'Create' });
  await waitFor(() => expect(create).toBeEnabled());
  await user.type(
    screen.getByRole('textbox', { name: /^Name/ }),
    'New standard name',
  );
  await user.type(screen.getByRole('textbox', { name: 'Code' }), 'EXISTING');
  api.request.mockRejectedValueOnce(
    new ApiClientError('Conflict', {
      status: 409,
      reason: 'MATERIAL_CODE_EXISTS',
      method: 'POST',
      url: '/materials/names',
      payload: { error: { fieldViolations: [{ field: 'code' }] } },
    }),
  );
  await user.click(create);
  await screen.findAllByText('This code already exists.');
  expect(create).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Reload latest record' }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByRole('textbox', { name: 'Code' }));
  await user.type(screen.getByRole('textbox', { name: 'Code' }), 'CORRECTED');
  await user.click(create);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/functions/warehouse/materials/names',
    ),
  );
  expect(
    api.request.mock.calls.filter(([arg]) => arg.method === 'POST'),
  ).toHaveLength(2);
});

it('creates template attributes over HTTP and keeps the remaining row after removing one', async () => {
  const user = userEvent.setup(),
    router = mount('/functions/warehouse/materials/templates/new');
  await user.type(
    await screen.findByRole('textbox', { name: /^Name/ }),
    'Pen dimensions',
  );
  await user.click(screen.getByRole('button', { name: 'Add attribute' }));
  await user.type(screen.getByLabelText(/Attribute key/), 'color');
  await user.type(screen.getByLabelText(/Display name/), 'Color');
  await user.click(screen.getByRole('button', { name: 'Add attribute' }));
  await user.type(screen.getAllByLabelText(/Attribute key/)[1], 'tip');
  await user.type(screen.getAllByLabelText(/Display name/)[1], 'Tip');
  await user.click(screen.getByRole('button', { name: 'Remove attribute 1' }));
  expect(screen.getByLabelText(/Attribute key/)).toHaveValue('tip');
  expect(screen.getByLabelText(/Display name/)).toHaveValue('Tip');
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/functions/warehouse/materials/templates',
    ),
  );
  expect(
    api.request.mock.calls.find(([arg]) => arg.method === 'POST')?.[0].json,
  ).toMatchObject({
    name: 'Pen dimensions',
    fields: [{ key: 'tip', title: 'Tip', type: 'text', identity: true }],
  });
});

it('opens an existing template with attributes when randomUUID is unavailable', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'materials/templates/template-id')
      return {
        data: {
          id: 'template-id',
          name: 'Existing dimensions',
          code: 'DIM',
          status: 'active',
          version: 1,
          fields: [
            {
              key: 'color',
              title: 'Color',
              type: 'text',
              required: true,
              identity: true,
            },
          ],
        },
      };
    if (path === 'materials/options') return { data: {} };
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
  mount('/functions/warehouse/materials/templates/edit/template-id');
  expect(await screen.findByLabelText(/Attribute key/)).toHaveValue('color');
  expect(screen.getByLabelText(/Display name/)).toHaveValue('Color');
});

it('opens lifecycle actions over HTTP and reuses the request key when retrying a failed operation', async () => {
  let attempts = 0;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') {
        if (++attempts === 1) throw new Error('Temporary failure');
        return {
          data: {
            id: 'name-id',
            name: 'Standard name',
            status: 'inactive',
            version: 2,
            lifecycleVersion: 1,
          },
        };
      }
      if (path === 'materials/names/name-id')
        return {
          data: {
            id: 'name-id',
            name: 'Standard name',
            status: 'active',
            version: 1,
            lifecycleVersion: 0,
            workflow: {
              available: [{ name: 'deactivate', allowed: true }],
              history: [],
            },
          },
        };
      if (path === 'materials/options') return { data: {} };
      return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
    },
  );
  const user = userEvent.setup();
  mount('/functions/warehouse/materials/names/name-id/actions/deactivate');
  await user.type(
    await screen.findByRole('textbox', { name: /Reason/ }),
    'No longer needed',
  );
  const submit = screen.getByRole('button', {
    name: 'Deactivate',
    exact: true,
  });
  await user.click(submit);
  await screen.findByText('The request failed. Please try again.');
  await user.click(submit);
  await waitFor(() => expect(attempts).toBe(2));
  const calls = api.request.mock.calls.filter(([arg]) => arg.method === 'POST');
  expect(calls[0][0].json.requestKey).toMatch(/^[a-f0-9]{32}$/);
  expect(calls[1][0].json.requestKey).toBe(calls[0][0].json.requestKey);
});
