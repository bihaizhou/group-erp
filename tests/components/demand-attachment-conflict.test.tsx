import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import filePlugin from '@nocobase/app-plugin-file/client';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import PurchaseForm from '../../client/pages/procurement/requests/request-form.js';
import IssueForm from '../../client/pages/requisitions/requests/request-form.js';
const { api } = vi.hoisted(() => ({ api: { request: vi.fn() } }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useService: () => ({ repository: () => ({}) }),
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: true, isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh: vi.fn() }),
}));
const fileLocales = filePlugin().locales;
if (!fileLocales)
  throw new Error(
    'The installed file plugin must provide its locale resources.',
  );
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
  namespaces: {
    '@nocobase/app-plugin-file':
      typeof fileLocales === 'function' ? await fileLocales() : fileLocales,
  },
});
const id = '00000000-0000-4000-8000-000000000001',
  companyId = '00000000-0000-4000-8000-000000000002';
const files = ['origin', 'local', 'server'].map((name, index) => ({
  id: `00000000-0000-4000-8000-00000000001${index}`,
  filename: `attachment-${name}.png`,
  ext: 'png',
  mimeType: 'image/png',
  size: 1,
  disk: 'local',
  key: name,
  contentUrl: `/uploads/${name}.png`,
  createdAt: '2026-10-18',
  updatedAt: '2026-10-18',
}));
const link = (index: number) => ({
  fileId: files[index].id,
  lineId: null,
  shareWithGovernance: false,
});
interface Call {
  path: string;
  method?: string;
  json?: {
    content?: { attachments: { fileId: string }[] };
    version?: number;
    reason?: string;
    requestKey?: string;
  };
}
beforeEach(() => {
  api.request.mockReset();
});
for (const domain of ['procurement', 'requisitions'] as const)
  it(`${domain} compares attachment names and keeps uploaded IDs through an explicit 409 merge`, async () => {
    const company = { id: companyId, code: 'CO', name: 'Company' };
    let row = {
      id,
      code: 'REQUEST-TEST',
      subjectId: companyId,
      requesterEmployeeId: null,
      recipientEmployeeId: null,
      requestingUnitId: null,
      suggestedSupplierId: null,
      purposeId: null,
      usage: 'Purpose',
      notes: '',
      neededOn: null,
      status: 'draft',
      revision: 1,
      lifecycleVersion: 1,
      contentVersion: 1,
      reviewRound: 0,
      createdBy: 'applicant',
      lineCount: 0,
      identificationStatus: 'unidentified',
      lines: [],
      attachments: [link(0)],
      versions: [],
      reviewTasks: [],
      display: {
        company,
        requester: null,
        recipient: null,
        purpose: null,
        supplier: null,
        unit: null,
        creator: null,
        submitter: null,
        accounts: {},
        relatedRequests: [],
      },
    };
    let writes = 0,
      uploads = 0;
    api.request.mockImplementation((call: Call) => {
      if (call.path === 'supplyChainFiles/findMany')
        return Promise.resolve({ data: files });
      if (call.path === 'supplyChainFiles/uploadOne') {
        uploads++;
        return Promise.resolve({
          data: { record: files[1], createdTargets: [] },
        });
      }
      if (call.path.endsWith('/capabilities'))
        return Promise.resolve({
          data: {
            recordRevision: row.revision,
            lifecycleVersion: row.lifecycleVersion,
            actions: { update: { visible: true, enabled: true, reason: null } },
          },
        });
      if (call.path === `${domain}/requests/${id}`) {
        if (call.method === 'PATCH') {
          if (++writes === 1) {
            row = {
              ...row,
              revision: 2,
              lifecycleVersion: 2,
              attachments: [link(0), link(2)],
            };
            return Promise.reject(
              new ApiClientError('Opaque conflict', {
                status: 409,
                reason:
                  domain === 'procurement'
                    ? 'PURCHASE_VERSION_CONFLICT'
                    : 'ISSUE_VERSION_CONFLICT',
                method: 'PATCH',
                url: call.path,
              }),
            );
          }
          return Promise.resolve({
            data: {
              ...row,
              ...call.json?.content,
              revision: 3,
              lifecycleVersion: 3,
            },
          });
        }
        return Promise.resolve({ data: row });
      }
      return Promise.resolve({
        data: call.path.endsWith('Companies') ? [company] : [],
        meta: {
          page: 1,
          pageSize: 20,
          total: call.path.endsWith('Companies') ? 1 : 0,
        },
      });
    });
    const Form = domain === 'procurement' ? PurchaseForm : IssueForm;
    const router = createMemoryRouter(
      [
        {
          path: '/requests',
          element: <Outlet />,
          children: [{ path: 'edit/:requestId', element: <Form /> }],
        },
      ],
      { initialEntries: [`/requests/edit/${id}?subjectId=${companyId}`] },
    );
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const view = render(
      <TestI18nProvider runtime={runtime}>
        <QueryClientProvider client={cache}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </TestI18nProvider>,
    );
    const form = await screen
        .findByRole('button', { name: 'Save', exact: true })
        .then((button) => button.closest('form')!),
      user = userEvent.setup();
    await waitFor(() =>
      expect(
        within(form).getByRole('button', {
          name: 'Choose attachments',
          exact: true,
        }),
      ).toBeEnabled(),
    );
    await user.upload(
      view.container.querySelector<HTMLInputElement>(
        '[data-demand-attachment-upload] input[type=file]',
      )!,
      new File(['x'], files[1].filename, { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(
        within(form).getByRole('button', {
          name: `Preview: ${files[1].filename}`,
          exact: true,
        }),
      ).toBeVisible(),
    );
    await user.type(
      within(form).getByRole('textbox', { name: /Reason for changes/u }),
      'Add supporting files',
    );
    await user.click(
      within(form).getByRole('button', { name: 'Save', exact: true }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Compare latest version',
        exact: true,
      }),
    );
    const local = await screen.findByRole('radio', {
        name: /attachment-local.png/u,
      }),
      remote = screen.getByRole('radio', { name: /attachment-server.png/u });
    expect(local).toBeVisible();
    expect(remote).toBeVisible();
    expect(local.closest('fieldset')).toHaveTextContent('Demand attachments');
    await user.click(local);
    await user.click(
      screen.getByRole('button', { name: 'Apply reviewed merge', exact: true }),
    );
    expect(
      within(form).getByRole('textbox', { name: /Reason for changes/u }),
    ).toHaveValue('Add supporting files');
    await user.click(
      within(form).getByRole('button', { name: 'Save', exact: true }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/requests'),
    );
    const sent = api.request.mock.calls
      .map(([call]) => call as Call)
      .filter((call) => call.method === 'PATCH');
    expect(sent).toHaveLength(2);
    expect(sent[1].json?.version).toBe(2);
    expect(sent[1].json?.reason).toBe('Add supporting files');
    expect(
      sent[1].json?.content?.attachments.map((file) => file.fileId),
    ).toEqual([files[0].id, files[1].id]);
    expect(uploads).toBe(1);
  });
