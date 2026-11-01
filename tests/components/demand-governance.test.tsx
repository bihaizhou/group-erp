import { render, screen, act, waitFor } from '@testing-library/react';
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
import { DemandSourceAction } from '../../client/components/demand-governance/action.js';
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({
    session: { user: { id: 'applicant' } },
    refresh: vi.fn(),
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const id = '00000000-0000-4000-8000-000000000001',
  lineOne = '00000000-0000-4000-8000-000000000002',
  lineTwo = '00000000-0000-4000-8000-000000000003';
let failRead = false,
  sourceState = 'offered';
function base({ path, method }: { path: string; method?: string }) {
  if (path.endsWith('/capabilities'))
    return Promise.resolve({
      data: {
        recordRevision: 1,
        lifecycleVersion: 1,
        actions: { confirmMaterial: { visible: true, enabled: true } },
      },
    });
  if (path.endsWith('/sources'))
    return failRead
      ? Promise.reject(
          new ApiClientError('Opaque network detail', {
            status: 500,
            method: 'GET',
            url: path,
          }),
        )
      : Promise.resolve({
          data: [lineOne, lineTwo].map((line, index) => ({
            id: `source-${index}`,
            requestId: `task-${index}`,
            purchaseRequestLineId: line,
            materialIssueRequestLineId: null,
            sourceDocumentId: id,
            revision: 1,
            status: sourceState,
            sourceAttempt: 1,
            proposedSkuId: `sku-${index}`,
            sourceHandlerId: 'applicant',
            reason: '',
            inputSnapshot: {},
            resolutionSnapshot: {
              code: `SKU-${index}`,
              name: index ? 'Second candidate' : 'First candidate',
            },
            display: { handler: 'Applicant' },
          })),
        });
  if (path.includes('/requestMaterialOptions/'))
    return Promise.resolve({
      data: {
        id: path.split('/').at(-1),
        code: 'SKU',
        name: path.endsWith('sku-1') ? 'Second candidate' : 'First candidate',
        baseUnitId: 'each',
        baseUnitName: 'piece',
        packages: [],
      },
    });
  if (path.endsWith('/requestMaterialSelections'))
    return Promise.resolve({
      data: { baseQuantity: '20', materialSnapshot: { baseUnitName: 'piece' } },
    });
  if (path === `procurement/requests/${id}` && !method)
    return Promise.resolve({
      data: {
        id,
        code: 'PR-TEST',
        revision: 1,
        lifecycleVersion: 1,
        subjectId: 'company',
        status: 'approved',
        lines: [lineOne, lineTwo].map((line, index) => ({
          id: line,
          lineNo: index + 1,
          revision: 1,
          inputRevision: 1,
          status: 'active',
          identificationStatus: 'awaitingConfirmation',
          originalName: `Original ${index + 1}`,
          originalSpecification: 'Specification',
          requestedQuantity: '20',
          requestedUnitText: 'piece',
        })),
      },
    });
  return Promise.resolve({ data: {} });
}
beforeEach(() => {
  failRead = false;
  sourceState = 'offered';
  api.request.mockReset();
  api.request.mockImplementation(base);
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const route = `/requests/${id}/lines/${lineOne}/governance/confirmMaterial`;
  const router = createMemoryRouter(
    [
      {
        path: '/requests/:requestId/lines/:lineId/governance/:sourceAction',
        element: <DemandSourceAction domain='procurement' />,
      },
    ],
    { initialEntries: [route] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={cache}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
  return { cache, router };
}
it('keeps the typed reason through a failed background source read and recovers without a mutation', async () => {
  const { cache } = mount(),
    user = userEvent.setup();
  const reason = await screen.findByRole('textbox', { name: /Reason/u });
  await user.type(reason, 'Check the actual package');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm material', exact: true }),
    ).toBeEnabled(),
  );
  failRead = true;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ['purchase', `requests/${id}/sources`],
    });
  });
  await screen.findByText(enUS.materialSources.failed);
  expect(reason).toHaveValue('Check the actual package');
  expect(
    screen.getByRole('button', { name: 'Confirm material', exact: true }),
  ).toBeDisabled();
  failRead = false;
  await user.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm material', exact: true }),
    ).toBeEnabled(),
  );
  expect(reason).toHaveValue('Check the actual package');
  expect(
    api.request.mock.calls.filter(([call]) =>
      call.path.endsWith('/confirmMaterial'),
    ),
  ).toHaveLength(0);
});
it('disables a stale candidate even when the parent-level action remains authorized', async () => {
  sourceState = 'invalidated';
  mount();
  await screen.findByRole('textbox', { name: /Reason/u });
  expect(
    screen.getByRole('button', { name: 'Confirm material', exact: true }),
  ).toBeDisabled();
  expect(screen.getByText(enUS.materialSources.notEligible)).toBeVisible();
});
it('changing line parameters loads the new candidate and starts a new form', async () => {
  const { router } = mount(),
    user = userEvent.setup();
  await screen.findByText('SKU · First candidate');
  await user.type(
    screen.getByRole('textbox', { name: /Reason/u }),
    'Previous line reason',
  );
  await act(async () => {
    await router.navigate(
      `/requests/${id}/lines/${lineTwo}/governance/confirmMaterial`,
    );
  });
  await screen.findByText('SKU · Second candidate');
  expect(screen.getByRole('textbox', { name: /Reason/u })).toHaveValue('');
});
