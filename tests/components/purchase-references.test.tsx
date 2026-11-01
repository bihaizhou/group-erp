import { ApiClientError } from '@nocobase/app-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import { PurchaseReferenceNotice } from '../../client/components/purchase-reference-notice.js';
const { api, refresh } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
const restricted = {
  data: { visibility: 'restricted', items: [], hasMore: false },
};
const visible = {
  data: {
    visibility: 'authorized',
    total: 6,
    hasMore: true,
    items: [{ id: 'request', code: 'PR-visible', status: 'pending' }],
  },
};
const failure = (status: number, reason?: string) =>
  new ApiClientError('failure', {
    status,
    reason,
    method: 'GET',
    url: '/test',
    payload: { error: { reason } },
  });
function setup(
  node = <PurchaseReferenceNotice domain='materials' kind='skus' id='sku' />,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrap = (value: React.ReactNode) => (
    <TestI18nProvider runtime={runtime}>
      <QueryClientProvider client={client}>{value}</QueryClientProvider>
    </TestI18nProvider>
  );
  return { ...render(wrap(node)), wrap, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockResolvedValue(restricted);
});
it('skips new records and unsupported kinds', () => {
  setup(
    <>
      <PurchaseReferenceNotice domain='people' kind='cards' id='card' />
      <PurchaseReferenceNotice domain='organization' kind='units' />
    </>,
  );
  expect(api.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
it('shows only authorized codes and totals without links, and an explicit bound', async () => {
  api.request.mockResolvedValue(visible);
  setup();
  expect(await screen.findByText('PR-visible')).toBeVisible();
  expect(
    screen.getByText('6 open purchase requests you can view'),
  ).toBeVisible();
  expect(screen.getByText('Pending review')).toBeVisible();
  expect(screen.getByText(/Showing up to 5/)).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('uses a compact empty state and keeps restricted existence opaque', async () => {
  api.request.mockResolvedValueOnce({
    data: { visibility: 'authorized', total: 0, items: [], hasMore: false },
  });
  const view = setup();
  expect(
    await screen.findByText('No visible open purchase references'),
  ).toBeVisible();
  expect(
    screen.getByText('Check your changes and enter the reason to continue.'),
  ).toBeVisible();
  view.rerender(
    view.wrap(
      <PurchaseReferenceNotice domain='materials' kind='skus' id='other' />,
    ),
  );
  expect(
    await screen.findByText(/outside your viewing permissions/),
  ).toBeVisible();
  expect(screen.queryByText(/0 open/)).not.toBeInTheDocument();
});
it('separates company contexts, cancels old requests, and never shows the old response in a new target', async () => {
  let resolveOld!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const view = setup(
    <PurchaseReferenceNotice
      domain='suppliers'
      kind='company'
      id='partner'
      subjectId='a'
    />,
  );
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
  const signal = api.request.mock.calls[0][0].signal as AbortSignal;
  view.rerender(
    view.wrap(
      <PurchaseReferenceNotice
        domain='suppliers'
        kind='company'
        id='partner'
        subjectId='b'
      />,
    ),
  );
  expect(signal.aborted).toBe(true);
  expect(
    await screen.findByText(/outside your viewing permissions/),
  ).toBeVisible();
  resolveOld(visible);
  expect(screen.queryByText('PR-visible')).not.toBeInTheDocument();
  expect(api.request.mock.calls[1][0].query).toMatchObject({ subjectId: 'b' });
});
it('retries a failed check without losing input, composition or focus, and disables retry while saving', async () => {
  api.request.mockRejectedValueOnce(failure(500));
  const content = (busy: boolean) => (
    <>
      <input aria-label='Reason' />
      <PurchaseReferenceNotice
        domain='people'
        kind='employees'
        id='person'
        busy={busy}
      />
    </>
  );
  const view = setup(content(true));
  const button = await screen.findByRole('button', {
    name: 'Retry',
  });
  expect(button).toBeDisabled();
  view.rerender(view.wrap(content(false)));
  const input = screen.getByRole('textbox', { name: 'Reason' });
  await userEvent.type(input, 'Review ');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'Review 交接' } });
  fireEvent.compositionEnd(input, { data: '交接' });
  input.focus();
  // Programmatic retry models a background refresh without moving the active input.
  void view.client.refetchQueries({ queryKey: ['purchase-reference-impact'] });
  expect(
    await screen.findByText(/outside your viewing permissions/),
  ).toBeVisible();
  expect(input).toHaveValue('Review 交接');
  expect(input).toHaveFocus();
});
it.each([
  [403, undefined, /Contact an administrator/],
  [404, undefined, /Close this form/],
  [400, 'PURCHASE_REFERENCE_TOO_BROAD', /too many records/],
] as const)(
  'explains terminal %s without offering retry',
  async (status, reason, copy) => {
    api.request.mockRejectedValue(failure(status, reason));
    setup();
    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.request).toHaveBeenCalledTimes(1);
  },
);
it('leaves reauthentication to an explicit user action on 401', async () => {
  api.request.mockRejectedValue(failure(401));
  setup();
  const button = await screen.findByRole('button', { name: /sign in again/i });
  expect(refresh).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(refresh).toHaveBeenCalledOnce();
});
