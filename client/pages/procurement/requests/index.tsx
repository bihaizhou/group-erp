import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { AccessDenied } from '#components/access-denied';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ClipboardList,
  Plus,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';
import { DateRangePicker } from '#components/date-picker';
import { useUrlSearch } from '#hooks/use-url-search';
import { useCurrentCompany } from '../../../company/use-company-scope.js';
import {
  ui,
  usePurchaseCan,
  usePurchaseIdentity,
  usePurchaseQuery,
  usePurchaseReturnFocus,
  useRequestKey,
} from './hooks.js';
import {
  Loading,
  ErrorNotice,
  PurchaseSelect,
  PurchaseStatus,
  Identification,
  Pagination,
  RefreshButton,
} from './controls.js';
import { OverflowText } from '../../materials/controls.js';
import { ServerTable } from './server-table.js';
import { MergePanel } from './merge-panel.js';
import type { Choice, Page, PurchaseRequest } from './model.js';

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
export default function RequestsPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    read = usePurchaseCan('read'),
    readAll = usePurchaseCan('readAll'),
    merge = usePurchaseCan('merge'),
    create = usePurchaseCan('create'),
    edit = usePurchaseCan('update'),
    identity = usePurchaseIdentity(),
    unrestricted = useCan('unrestricted'),
    currentCompany = useCurrentCompany(),
    api = useApiClient(),
    toaster = useToaster(),
    key = useRequestKey();
  const [selection, setSelection] = useState<{
      key: string;
      ids: ReadonlySet<string>;
    }>({ key: '', ids: EMPTY_SELECTION }),
    [bulkOpen, setBulkOpen] = useState(false),
    [bulkReason, setBulkReason] = useState(''),
    [bulkBusy, setBulkBusy] = useState(false);
  const selected =
      selection.key === location.search ? selection.ids : EMPTY_SELECTION,
    setSelected = (ids: ReadonlySet<string>) =>
      setSelection({ key: location.search, ids });
  const hasPosition =
    !!identity.data?.data.employee &&
    identity.data.data.companies.some((company) => company.units.length > 0);
  usePurchaseReturnFocus(useResolvedPath('.').pathname, 'purchase-search');
  const {
    searchParams: params,
    search,
    inputProps,
    updateParams,
    clear,
  } = useUrlSearch({ resetParams: ['page'] });
  const tab = params.get('tab') === 'merge' && merge.can ? 'merge' : 'list',
    group = tab === 'list' && readAll.can && params.get('scope') !== 'company',
    subjectId = readAll.can
      ? (params.get('subjectId') ?? '')
      : (currentCompany?.id ?? params.get('subjectId') ?? ''),
    listSubjectId = group ? '' : subjectId,
    page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1),
    pageSize =
      [20, 50, 100].find((v) => String(v) === params.get('pageSize')) ?? 20;
  const orderBy = ['updatedAt', '-updatedAt', 'neededOn', '-neededOn'].includes(
    params.get('orderBy') ?? '',
  )
    ? params.get('orderBy')!
    : '-updatedAt';
  const selectedStatus = ['draft', 'pending', 'approved', 'cancelled'].includes(
      params.get('status') ?? '',
    )
      ? params.get('status')!
      : '',
    status = group && selectedStatus === 'draft' ? '' : selectedStatus,
    identification = ['identified', 'unidentified'].includes(
      params.get('identification') ?? '',
    )
      ? params.get('identification')!
      : '';
  const date = (name: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name)! : '';
  const query = {
    ...(listSubjectId ? { subjectId: listSubjectId } : {}),
    q: search,
    page,
    pageSize,
    orderBy,
    submitted: group ? 'true' : 'false',
    ...(status ? { status } : {}),
    ...(identification ? { identification } : {}),
    mine: params.get('mine') === 'true' ? 'true' : 'false',
    ...(date('neededFrom') ? { neededFrom: date('neededFrom') } : {}),
    ...(date('neededTo') ? { neededTo: date('neededTo') } : {}),
  };
  const result = usePurchaseQuery<Page<PurchaseRequest>>(
      'requests',
      query,
      tab === 'list' && (group || !!subjectId) && read.can,
      true,
    ),
    companies = usePurchaseQuery<Page<Choice>>(
      'requestCompanies',
      { page: 1, pageSize: 100 },
      read.can,
    );
  const change = (name: string, value: string) =>
    updateParams((p) => {
      if (value) p.set(name, value);
      else p.delete(name);
      p.delete('page');
    });
  const selectCompany = (value: string) =>
    updateParams((p) => {
      if (value) {
        p.set('subjectId', value);
        p.set('scope', 'company');
      } else {
        p.set('scope', 'group');
      }
      p.delete('page');
    });
  const hasFilters = !!(
    search ||
    status ||
    identification ||
    params.get('mine') === 'true' ||
    date('neededFrom') ||
    date('neededTo') ||
    (readAll.can && !group)
  );
  const clearFilters = () =>
    clear((p) => {
      for (const name of [
        'status',
        'identification',
        'mine',
        'neededFrom',
        'neededTo',
        'page',
      ])
        p.delete(name);
    });
  const unavailable =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const total = result.data?.meta.total ?? 0,
    rows = unavailable ? undefined : result.data?.data;
  useEffect(() => {
    if (result.data && page > Math.max(1, Math.ceil(total / pageSize)))
      updateParams((p) =>
        p.set('page', String(Math.max(1, Math.ceil(total / pageSize)))),
      );
  }, [result.data, total, page, pageSize, updateParams]);
  const newButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus />
      {t(ui('create'))}
    </Button>
  );
  const bulkTargets = (rows ?? []).filter(
    (row) => selected.has(row.id) && row.status === 'draft',
  );
  const runBulkSubmit = async () => {
    if (bulkBusy || !bulkTargets.length) return;
    setBulkBusy(true);
    const reason = bulkReason.trim() || t(ui('bulkSubmit'));
    let ok = 0;
    let failed = 0;
    for (const row of bulkTargets) {
      const body = {
        version: row.revision,
        lifecycleVersion: row.lifecycleVersion,
        reason,
        requestKey: key.for({
          id: row.id,
          version: row.revision,
          lifecycleVersion: row.lifecycleVersion,
          reason,
        }),
      };
      try {
        await api.request({
          path: `procurement/requests/${row.id}/submit`,
          method: 'POST',
          json: body,
        });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setBulkOpen(false);
    setBulkReason('');
    setSelected(EMPTY_SELECTION);
    void result.refetch();
    toaster.show({
      type: failed ? 'warning' : 'success',
      title: failed
        ? t(ui('bulkPartial'), { ok, failed })
        : t(ui('bulkDone'), { count: ok }),
    });
  };
  const columns: ColumnDef<PurchaseRequest>[] = (() => {
    const truncate = (value: string) => (
      <OverflowText text={value || '—'} className='block max-w-xs truncate' />
    );
    const sort = (field: string, label: string) => (
      <Button
        size='sm'
        variant='ghost'
        onClick={() =>
          change('orderBy', orderBy === field ? `-${field}` : field)
        }
        aria-label={`${t(ui(label))} · ${t(ui(orderBy === field ? 'sortDescending' : 'sortAscending'))}`}
      >
        {t(ui(label))}
        {orderBy.replace('-', '') === field ? (
          orderBy.startsWith('-') ? (
            <ArrowDown />
          ) : (
            <ArrowUp />
          )
        ) : null}
      </Button>
    );
    return [
      {
        id: 'code',
        header: t(ui('code')),
        cell: ({ row }) => (
          <Link
            className='font-medium text-primary underline-offset-4 hover:underline'
            to={{ pathname: row.original.id, search: location.search }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'company',
        header: t(ui('company')),
        cell: ({ row }) => truncate(row.original.display.company?.name ?? ''),
      },
      {
        id: 'requester',
        header: t(ui('requester')),
        cell: ({ row }) => truncate(row.original.display.requester?.name ?? ''),
      },
      {
        id: 'unit',
        header: t(ui('unit')),
        cell: ({ row }) => truncate(row.original.display.unit?.name ?? ''),
      },
      {
        id: 'usage',
        header: t(ui('usage')),
        cell: ({ row }) => truncate(row.original.usage),
      },
      {
        id: 'neededOn',
        header: () => sort('neededOn', 'neededOn'),
        cell: ({ row }) =>
          row.original.neededOn
            ? new Date(`${row.original.neededOn}T12:00:00`).toLocaleDateString(
                i18n.language,
              )
            : '—',
      },
      {
        id: 'status',
        header: t(ui('reviewState')),
        cell: ({ row }) => <PurchaseStatus state={row.original.status} />,
      },
      {
        id: 'identification',
        header: t(ui('identificationState')),
        cell: ({ row }) => (
          <Identification value={row.original.identificationStatus} />
        ),
      },
      {
        id: 'updatedAt',
        header: () => sort('updatedAt', 'updatedAt'),
        cell: ({ row }) =>
          new Date(row.original.updatedAt).toLocaleString(i18n.language),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t(ui('actionsFor'), { code: row.original.code })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-auto min-w-40'>
              <DropdownMenuItem
                render={
                  <Link
                    to={{ pathname: row.original.id, search: location.search }}
                  />
                }
              >
                {t(ui('view'))}
              </DropdownMenuItem>
              {edit.can && row.original.status === 'draft' && (
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `edit/${row.original.id}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t(ui('edit'))}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  })();
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t(ui('title'))}
          description={t(ui('description'))}
          actions={
            <>
              {merge.can ? (
                <>
                  <Button
                    variant={tab === 'list' ? 'default' : 'outline'}
                    onClick={() =>
                      updateParams((p) => {
                        p.delete('tab');
                        p.delete('page');
                      })
                    }
                  >
                    {t(ui('title'))}
                  </Button>
                  <Button
                    variant={tab === 'merge' ? 'default' : 'outline'}
                    onClick={() =>
                      updateParams((p) => {
                        p.set('tab', 'merge');
                        p.delete('page');
                      })
                    }
                  >
                    {t(ui('mergedList'))}
                  </Button>
                </>
              ) : null}
              {tab === 'list' &&
              create.can &&
              hasPosition &&
              rows &&
              (total > 0 || hasFilters)
                ? newButton
                : null}
              {tab === 'list' ? (
                <RefreshButton
                  busy={result.isFetching || companies.isFetching}
                  onClick={() => {
                    if ((group || subjectId) && read.can) void result.refetch();
                    void companies.refetch();
                  }}
                />
              ) : null}
            </>
          }
        />
        <ReadOnlyNotice canManage={edit.can} />
        {unrestricted.can && !hasPosition ? (
          <Alert>
            <AlertDescription>{t(ui('superAdminHint'))}</AlertDescription>
          </Alert>
        ) : null}
        {identity.isPending ? (
          <Loading kind='table' />
        ) : identity.error ? (
          <ErrorNotice
            error={identity.error}
            retry={() => void identity.refetch()}
          />
        ) : !hasPosition && !unrestricted.can ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t(ui('noProcurementPositionHint'))}
            </AlertDescription>
          </Alert>
        ) : tab === 'merge' ? (
          <MergePanel
            companies={companies.data?.data ?? []}
            businessDate={companies.data?.meta.businessDate}
          />
        ) : read.isPending ? (
          <Loading kind='table' />
        ) : !read.can ? (
          <AccessDenied title={t(ui('forbidden'))} />
        ) : (
          <>
            <div className='flex flex-wrap items-end gap-3'>
              <Input
                {...inputProps}
                id='purchase-search'
                aria-label={t(ui('search'))}
                placeholder={t(ui('search'))}
                maxLength={200}
                className='w-full sm:max-w-sm'
              />
              {readAll.can ? (
                <div className='w-full sm:w-40'>
                  <PurchaseSelect
                    label={t(ui('company'))}
                    value={group ? 'all' : subjectId}
                    items={[
                      { value: 'all', label: t(ui('allCompanies')) },
                      ...(companies.data?.data ?? []).map((item) => ({
                        value: item.id,
                        label: [item.code, item.name]
                          .filter(Boolean)
                          .join(' · '),
                      })),
                    ]}
                    onChange={(v) => selectCompany(v === 'all' ? '' : v)}
                  />
                </div>
              ) : null}
              <div className='w-full sm:w-auto'>
                <PurchaseSelect
                  label={t(ui('reviewState'))}
                  value={status || 'all'}
                  items={(group
                    ? ['all', 'pending', 'approved', 'cancelled']
                    : ['all', 'draft', 'pending', 'approved', 'cancelled']
                  ).map((value) => ({
                    value,
                    label: t(ui(value === 'all' ? 'allStatuses' : value)),
                  }))}
                  onChange={(v) => change('status', v === 'all' ? '' : v)}
                />
              </div>
              <div className='w-full sm:w-40'>
                <PurchaseSelect
                  label={t(ui('identificationState'))}
                  value={identification || 'all'}
                  items={['all', 'identified', 'unidentified'].map((value) => ({
                    value,
                    label: t(ui(value === 'all' ? 'allIdentification' : value)),
                  }))}
                  onChange={(v) =>
                    change('identification', v === 'all' ? '' : v)
                  }
                />
              </div>
              <div className='w-full sm:w-40'>
                <PurchaseSelect
                  label={t(ui('allRequests'))}
                  value={query.mine}
                  items={[
                    { value: 'false', label: t(ui('allRequests')) },
                    { value: 'true', label: t(ui('myRequests')) },
                  ]}
                  onChange={(v) => change('mine', v)}
                />
              </div>
              <DateRangePicker
                from={date('neededFrom')}
                to={date('neededTo')}
                businessDate={companies.data?.meta.businessDate}
                onChange={(from, to) =>
                  updateParams((p) => {
                    for (const [k, v] of [
                      ['neededFrom', from],
                      ['neededTo', to],
                    ]) {
                      if (v) p.set(k, v);
                      else p.delete(k);
                    }
                    p.delete('page');
                  })
                }
              />
              {hasFilters && (
                <Button variant='outline' onClick={clearFilters}>
                  {t(ui('clearFilters'))}
                </Button>
              )}
            </div>
            {result.error && (
              <ErrorNotice
                error={result.error}
                description={rows ? t(ui('refreshFailed')) : undefined}
                retry={() => void result.refetch()}
              />
            )}{' '}
            {unavailable ? null : !rows ? (
              result.error ? null : (
                <Loading kind='table' />
              )
            ) : total === 0 && !hasFilters ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyTitle>{t(ui('emptyTitle'))}</EmptyTitle>
                  <EmptyDescription>
                    {t(ui(create.can ? 'emptyHint' : 'emptyReadOnly'))}
                  </EmptyDescription>
                </EmptyHeader>
                {create.can && hasPosition && (
                  <EmptyContent>{newButton}</EmptyContent>
                )}
              </Empty>
            ) : (
              <div
                aria-busy={result.isFetching}
                className='flex flex-col gap-4'
              >
                {selected.size > 0 ? (
                  <div className='flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm'>
                    <span className='font-medium'>
                      {t(ui('bulkSelected'), { count: selected.size })}
                    </span>
                    <Button
                      size='sm'
                      disabled={!bulkTargets.length}
                      title={bulkTargets.length ? undefined : t(ui('bulkNone'))}
                      onClick={() => setBulkOpen(true)}
                    >
                      {t(ui('bulkSubmit'))}
                      {bulkTargets.length ? ` (${bulkTargets.length})` : ''}
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setSelected(EMPTY_SELECTION)}
                    >
                      {t(ui('bulkClear'))}
                    </Button>
                  </div>
                ) : null}
                <ServerTable
                  rows={rows}
                  columns={columns}
                  selection={{
                    selected,
                    label: t(ui('bulkSelectRow')),
                    selectAllLabel: t(ui('bulkSelectAll')),
                    onToggle: (id, checked) => {
                      const next = new Set(selected);
                      if (checked) next.add(id);
                      else next.delete(id);
                      setSelected(next);
                    },
                    onToggleAll: (checked) => {
                      const next = new Set(selected);
                      for (const row of rows) {
                        if (checked) next.add(row.id);
                        else next.delete(row.id);
                      }
                      setSelected(next);
                    },
                  }}
                  total={total}
                  page={page}
                  pageSize={pageSize}
                  sorting={[
                    {
                      id: orderBy.replace('-', ''),
                      desc: orderBy.startsWith('-'),
                    },
                  ]}
                  empty={
                    <div className='flex flex-col items-center gap-2'>
                      <span>{t(ui('noResults'))}</span>
                      <Button variant='link' onClick={clearFilters}>
                        {t(ui('clearFilters'))}
                      </Button>
                    </div>
                  }
                />
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div className='w-full sm:w-auto'>
                    <PurchaseSelect
                      label={t(ui('perPage'), { size: pageSize })}
                      value={String(pageSize)}
                      items={[20, 50, 100].map((n) => ({
                        value: String(n),
                        label: t(ui('perPage'), { size: n }),
                      }))}
                      onChange={(v) => change('pageSize', v)}
                    />
                  </div>
                  <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    busy={result.isFetching}
                    onPage={(p) =>
                      updateParams((next) => next.set('page', String(p)))
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
        <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>
                {t(ui('bulkSubmit'))} ({bulkTargets.length})
              </DialogTitle>
              <DialogDescription>{t(ui('bulkReasonHint'))}</DialogDescription>
            </DialogHeader>
            <div className='grid gap-2'>
              <Label htmlFor='purchase-bulk-reason'>
                {t(ui('bulkReason'))}
              </Label>
              <Textarea
                id='purchase-bulk-reason'
                rows={3}
                maxLength={3000}
                value={bulkReason}
                onChange={(event) => setBulkReason(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                disabled={bulkBusy}
                onClick={() => setBulkOpen(false)}
              >
                {t(ui('cancel'))}
              </Button>
              <Button disabled={bulkBusy} onClick={() => void runBulkSubmit()}>
                {bulkBusy ? t(ui('submitting')) : t(ui('bulkSubmit'))}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContainer>
      <Outlet />
    </>
  );
}
