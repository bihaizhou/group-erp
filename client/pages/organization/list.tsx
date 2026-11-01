import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useOptions, useRecord, useOrgError } from './hooks.js';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import {
  Building2,
  MoreHorizontalIcon,
  PlusIcon,
  ArrowDownUpIcon,
} from 'lucide-react';
import { StatusBadge } from '#components/status-badge';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '#components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useUrlSearch } from '#hooks/use-url-search';
import { OrgContext } from './context.js';
import { type OrgKind, type OrgRecord, type OrgList } from './model.js';
import { ErrorNotice, Loading, OrgStatus, OrgSelect } from './shared.js';

export default function OrgListPage({ kind }: { kind: OrgKind }) {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const search = useUrlSearch({ resetParams: ['page'] });
  const params = search.searchParams;
  const [statusRecord, setStatusRecord] = useState<OrgRecord | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canWrite = useCan({
    resource: { type: 'settings', id: 'organization' },
    action: 'update',
  }).can;
  const options = useOptions();
  const query = Object.fromEntries(
    [...params].filter(
      ([k, v]) =>
        [
          'q',
          'status',
          'subjectId',
          'unitId',
          'sectorId',
          'regionId',
          'page',
          'orderBy',
        ].includes(k) && v,
    ),
  );
  const data = useQuery({
    queryKey: ['org-list', kind, params.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.request<OrgList>({ path: `organization/${kind}`, query, signal }),
  });
  const rows = data.data?.data ?? [];
  const total = data.data?.meta.total ?? 0;
  const filtered = Boolean(
    search.search ||
    ['status', 'subjectId', 'unitId', 'sectorId', 'regionId'].some((k) =>
      params.has(k),
    ),
  );
  const action = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon />
      {t('org.new', { kind: t(`org.${kind}`) })}
    </Button>
  );
  const filters =
    kind === 'subjects'
      ? ['sectorId', 'regionId']
      : kind === 'units'
        ? ['subjectId']
        : kind === 'positions'
          ? ['unitId']
          : [];
  const filterKinds: Record<string, string> = {
    sectorId: 'sectors',
    regionId: 'regions',
    subjectId: 'subjects',
    unitId: 'units',
  };
  const label = (row: OrgRecord) => {
    const key =
      kind === 'subjects'
        ? 'parentId'
        : kind === 'units'
          ? 'subjectId'
          : kind === 'positions'
            ? 'unitId'
            : 'parentId';
    const relatedKind =
      kind === 'units' || kind === 'subjects'
        ? 'subjects'
        : kind === 'positions'
          ? 'units'
          : kind;
    return (
      options.data?.data[relatedKind]?.rows.find((r) => r.id === row[key])
        ?.name ?? '—'
    );
  };
  return (
    <OrgContext.Provider value={kind}>
      <PageContainer>
        <PageHeader
          title={t(`org.${kind}`)}
          description={t('org.description')}
          actions={
            canWrite && data.data && (total > 0 || filtered)
              ? action
              : undefined
          }
        />
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            ref={searchRef}
            className='w-full sm:max-w-xs'
            placeholder={t('org.search')}
            aria-label={t('org.search')}
            {...search.inputProps}
          />
          <div className='w-full sm:w-40'>
            <OrgSelect
              label={t('org.fields.status')}
              value={params.get('status') ?? ''}
              items={[
                { value: '', label: t('org.all') },
                { value: 'active', label: t('org.active') },
                { value: 'inactive', label: t('org.inactive') },
              ]}
              onChange={(value) =>
                search.updateParams((p) => {
                  if (value) p.set('status', value);
                  else p.delete('status');
                  p.delete('page');
                })
              }
            />
          </div>
          {filters.map((field) => (
            <div className='w-full sm:w-40' key={field}>
              <OrgSelect
                label={t(`org.fields.${field}`)}
                value={params.get(field) ?? ''}
                items={[
                  {
                    value: '',
                    label: `${t('org.all')}${t(`org.fields.${field}`)}`,
                  },
                  ...(options.data?.data[filterKinds[field]]?.rows ?? []).map(
                    (r) => ({ value: r.id, label: r.name }),
                  ),
                ]}
                onChange={(value) =>
                  search.updateParams((p) => {
                    if (value) p.set(field, value);
                    else p.delete(field);
                    p.delete('page');
                  })
                }
              />
            </div>
          ))}
          {filtered ? (
            <Button
              variant='ghost'
              onClick={() => {
                search.clear((p) =>
                  ['status', ...filters, 'page'].forEach((k) => p.delete(k)),
                );
                searchRef.current?.focus();
              }}
            >
              {t('org.clear')}
            </Button>
          ) : null}
          {data.isFetching && data.data ? (
            <span className='text-xs text-muted-foreground' role='status'>
              {t('org.loading')}
            </span>
          ) : null}
        </div>
        {options.isError ? (
          <ErrorNotice
            error={options.error}
            retry={() => void options.refetch()}
          />
        ) : null}
        {Object.values(options.data?.data ?? {}).some((v) => v.truncated) ? (
          <p className='text-sm text-muted-foreground'>
            {t('org.cap', { limit: 1000 })}
          </p>
        ) : null}
        {data.isError ? (
          <ErrorNotice error={data.error} retry={() => void data.refetch()} />
        ) : !data.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty className='min-h-48 border border-dashed'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Building2 />
              </EmptyMedia>
              <EmptyTitle>
                {t(filtered ? 'org.noResults' : 'org.empty', {
                  kind: t(`org.${kind}`),
                })}
              </EmptyTitle>
              <EmptyDescription>
                {t(
                  filtered
                    ? 'org.noResultsDescription'
                    : canWrite
                      ? 'org.emptyDescription'
                      : 'org.askAdmin',
                )}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {filtered ? (
                <Button
                  variant='outline'
                  onClick={() =>
                    search.clear((p) =>
                      ['status', ...filters, 'page'].forEach((k) =>
                        p.delete(k),
                      ),
                    )
                  }
                >
                  {t('org.clear')}
                </Button>
              ) : canWrite ? (
                action
              ) : null}
            </EmptyContent>
          </Empty>
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('org.fields.name')}</TableHead>
                  <TableHead>{t('org.fields.code')}</TableHead>
                  <TableHead>{t('org.fields.type')}</TableHead>
                  <TableHead>{t('org.ownership')}</TableHead>
                  <TableHead>{t('org.fields.status')}</TableHead>
                  <TableHead>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        search.updateParams((p) => {
                          p.set(
                            'orderBy',
                            p.get('orderBy') === 'updatedAt'
                              ? '-updatedAt'
                              : 'updatedAt',
                          );
                          p.delete('page');
                        })
                      }
                      aria-label={t('org.sortTime')}
                    >
                      <ArrowDownUpIcon />
                      {t('org.fields.updatedAt')}
                      {params.get('orderBy') === 'updatedAt' ? ' ↑' : ' ↓'}
                    </Button>
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        className='font-medium text-primary hover:underline'
                        to={{ pathname: row.id, search: location.search }}
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>{row.code}</TableCell>
                    <TableCell>
                      {row.type ? (
                        <StatusBadge size='sm'>
                          {t(`org.types.${String(row.type)}`)}
                        </StatusBadge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {kind === 'relations'
                        ? `${options.data?.data[String(row.sourceKind)]?.rows.find((r) => r.id === row.sourceId)?.name ?? '—'} → ${options.data?.data[String(row.targetKind)]?.rows.find((r) => r.id === row.targetId)?.name ?? '—'}`
                        : label(row)}
                    </TableCell>
                    <TableCell>
                      <OrgStatus status={row.status} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {new Date(row.updatedAt).toLocaleString(i18n.language)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant='ghost'
                              size='icon-sm'
                              aria-label={t('org.actions', { name: row.name })}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align='end'
                          className='w-auto min-w-40'
                        >
                          <DropdownMenuItem
                            render={
                              <Link
                                to={{
                                  pathname: row.id,
                                  search: location.search,
                                }}
                              />
                            }
                          >
                            {t('org.view')}
                          </DropdownMenuItem>
                          {canWrite ? (
                            <>
                              <DropdownMenuItem
                                render={
                                  <Link
                                    to={{
                                      pathname: `edit/${row.id}`,
                                      search: location.search,
                                    }}
                                  />
                                }
                              >
                                {t('org.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant={
                                  row.status === 'active'
                                    ? 'destructive'
                                    : 'default'
                                }
                                onClick={() => setStatusRecord(row)}
                              >
                                {t(
                                  row.status === 'active'
                                    ? 'org.disable'
                                    : 'org.enable',
                                )}
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {data.data && total > 0 ? (
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'>
            <span>
              {t('org.page', {
                page: data.data.meta.page,
                pages: Math.max(1, Math.ceil(total / 20)),
                total: total.toLocaleString(i18n.language),
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={data.data.meta.page <= 1 || data.isFetching}
                onClick={() =>
                  search.updateParams((p) =>
                    p.set('page', String(data.data.meta.page - 1)),
                  )
                }
              >
                {t('org.previous')}
              </Button>
              <Button
                variant='outline'
                disabled={data.data.meta.page * 20 >= total || data.isFetching}
                onClick={() =>
                  search.updateParams((p) =>
                    p.set('page', String(data.data.meta.page + 1)),
                  )
                }
              >
                {t('org.next')}
              </Button>
            </div>
          </div>
        ) : null}
        {statusRecord ? (
          <StatusDialog
            kind={kind}
            initial={statusRecord}
            close={() => {
              setStatusRecord(null);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
          />
        ) : null}
        <Outlet />
      </PageContainer>
    </OrgContext.Provider>
  );
}

function StatusDialog({
  kind,
  initial,
  close,
}: {
  kind: OrgKind;
  initial: OrgRecord;
  close: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const cache = useQueryClient();
  const toast = useToaster();
  const record = useRecord(kind, initial.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const errorText = useOrgError();
  const latest = record.isError ? undefined : record.data?.data;
  const status = initial.status === 'active' ? 'inactive' : 'active';
  const submit = async () => {
    if (!reason.trim() || !latest || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: OrgRecord }>({
        path: `organization/${kind}/${latest.id}/setStatus`,
        method: 'POST',
        json: { version: latest.version, status, reason: reason.trim() },
      });
      cache.setQueryData(['org', kind, latest.id], result);
      void cache.invalidateQueries({ queryKey: ['org-list'] });
      void cache.invalidateQueries({ queryKey: ['org-options'] });
      void cache.invalidateQueries({ queryKey: ['org-history'] });
      toast.show({
        type: 'success',
        title: t('org.statusSaved', { name: latest.name }),
      });
      close();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 404) {
        void cache.invalidateQueries({ queryKey: ['org-list'] });
        void record.refetch();
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <AlertDialogContent className='flex flex-col overflow-y-hidden'>
        <AlertDialogHeader className='shrink-0'>
          <AlertDialogTitle>
            {t('org.statusTitle', {
              action: t(status === 'active' ? 'org.enable' : 'org.disable'),
              name: initial.name,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              status === 'active'
                ? 'org.enableConsequence'
                : 'org.disableConsequence',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {record.isError ? (
            <ErrorNotice
              error={record.error}
              retry={() => void record.refetch()}
            />
          ) : null}
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{errorText(error)}</AlertDescription>
            </Alert>
          ) : null}
          <form
            id='org-status-form'
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className='flex flex-col gap-2'
          >
            <PurchaseReferenceNotice
              domain='organization'
              kind={kind}
              id={latest?.id}
              busy={pending}
            />
            <Label htmlFor='status-reason'>{t('org.fields.reason')} *</Label>
            <Input
              id='status-reason'
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              maxLength={1000}
            />
          </form>
        </div>
        <AlertDialogFooter className='shrink-0'>
          <Button variant='outline' onClick={close} disabled={pending}>
            {t('org.cancel')}
          </Button>
          <Button
            variant={status === 'inactive' ? 'destructive' : 'default'}
            disabled={!latest || !reason.trim() || pending || record.isFetching}
            type='submit'
            form='org-status-form'
          >
            {pending
              ? t('org.loading')
              : t(status === 'active' ? 'org.enable' : 'org.disable')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
