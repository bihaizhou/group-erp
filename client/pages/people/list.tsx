import { textValue } from './model.js';
import { useRef } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router';
import {
  MoreHorizontalIcon,
  PlusIcon,
  UsersRound,
  ArrowDownUp,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { useFieldAccess } from '../../hooks/use-field-access.js';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
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
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useUrlSearch } from '#hooks/use-url-search';
import { usePeopleOptions, usePeopleCan } from './hooks.js';
import {
  PeopleLoading,
  PeopleErrorNotice,
  PeopleSelect,
  PeopleRefresh,
} from './controls.js';
import { readOnly, statuses, workflows, type Kind, type Row } from './model.js';

export default function PeopleList({ kind }: { kind: Kind }) {
  const fieldAccess = useFieldAccess();
  const gradeVisible =
    fieldAccess.access('people.employee.grade', 'grade') !== 'hidden';
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    location = useLocation();
  const canWrite = usePeopleCan(kind) && !readOnly.includes(kind),
    options = usePeopleOptions(kind);
  const search = useUrlSearch({ resetParams: ['page'] }),
    searchRef = useRef<HTMLInputElement>(null);
  const params = search.searchParams;
  const query = Object.fromEntries(
    [...params].filter(
      ([k, v]) =>
        ['q', 'status', 'subjectId', 'page', 'orderBy'].includes(k) && v,
    ),
  );
  if (query.status === 'all') delete query.status;
  // Talent cards follow the employee lifecycle: show the active ones first.
  else if (kind === 'profiles' && !query.status) query.status = 'active';
  const data = useQuery({
    retry: false,
    queryKey: ['people-list', kind, params.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.request<{
        data: Row[];
        meta: { page: number; pageSize: number; total: number };
      }>({ path: `people/${kind}`, query, signal }),
  });
  const rows = data.data?.data ?? [],
    total = data.data?.meta.total ?? 0,
    page = data.data?.meta.page ?? 1;
  const filtered = Boolean(
    search.search || params.get('status') || params.get('subjectId'),
  );
  const clear = () => {
    search.clear((p) => {
      p.delete('status');
      p.delete('subjectId');
      p.delete('page');
    });
    searchRef.current?.focus();
  };
  const optionName = (source: string, id: unknown) =>
    options.data?.data[source]?.rows.find((v) => v.id === id)?.name ?? '—';
  const link = (path: string) => ({ pathname: path, search: location.search });
  const add = (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <PlusIcon />
      {t('people.newRecord', { kind: t(`people.${kind}`) })}
    </Button>
  );
  const updateFilter = (key: string, value: string) =>
    search.updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key !== 'page') p.delete('page');
    });
  const sort = (field: string) =>
    search.updateParams((p) =>
      p.set('orderBy', p.get('orderBy') === `-${field}` ? field : `-${field}`),
    );
  return (
    <PageContainer>
      <PageHeader
        title={t(`people.${kind}`)}
        description={t(`people.descriptions.${kind}`)}
        actions={
          <>
            {data.data && (rows.length > 0 || filtered) && canWrite
              ? add
              : null}
            <PeopleRefresh
              busy={data.isFetching || options.isFetching}
              onClick={() => {
                void data.refetch();
                void options.refetch();
              }}
            />
          </>
        }
      />
      <ReadOnlyNotice canManage={canWrite} />
      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full sm:max-w-xs'>
          <Label htmlFor={`people-search-${kind}`} className='sr-only'>
            {t('people.search')}
          </Label>
          <Input
            ref={searchRef}
            id={`people-search-${kind}`}
            placeholder={t('people.search')}
            {...search.inputProps}
          />
        </div>
        <div className='w-full sm:w-40'>
          <PeopleSelect
            label={t('people.fields.status')}
            value={
              params.get('status') ?? (kind === 'profiles' ? 'active' : 'all')
            }
            onChange={(v) => updateFilter('status', v)}
            items={[
              { value: 'all', label: t('people.allStatuses') },
              ...statuses[kind].map((value) => ({
                value,
                label: t(`people.states.${textValue(value)}`),
              })),
            ]}
          />
        </div>
        {kind !== 'dimensions' ? (
          <div className='w-full sm:w-40'>
            <PeopleSelect
              label={t('people.fields.subjectId')}
              value={params.get('subjectId') ?? ''}
              onChange={(v) => updateFilter('subjectId', v)}
              items={[
                { value: '', label: t('people.allCompanies') },
                ...(options.data?.data.orgSubjects?.rows ?? []).map((v) => ({
                  value: v.id,
                  label: v.name,
                })),
              ]}
            />
          </div>
        ) : null}
        {filtered ? (
          <Button variant='ghost' onClick={clear}>
            {t('people.clearFilters')}
          </Button>
        ) : null}
        <span className='text-sm text-muted-foreground'>
          {t('people.total', { count: total })}
        </span>
      </div>
      {options.data &&
      Object.values(options.data.data).some((v) => v.truncated) ? (
        <p className='text-sm text-muted-foreground'>
          {t('people.optionCap', { limit: 1000 })}
        </p>
      ) : null}
      {data.isError || options.isError ? (
        <PeopleErrorNotice
          error={data.error ?? options.error}
          retry={() => {
            void data.refetch();
            void options.refetch();
          }}
        />
      ) : !data.data ? (
        <PeopleLoading />
      ) : rows.length === 0 ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <UsersRound />
            </EmptyMedia>
            <EmptyTitle>
              {t(filtered ? 'people.noResults' : 'people.empty', {
                kind: t(`people.${kind}`),
              })}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                filtered
                  ? 'people.noResultsDescription'
                  : canWrite
                    ? 'people.emptyDescription'
                    : 'people.readOnlyEmpty',
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={clear}>
                {t('people.clearFilters')}
              </Button>
            ) : canWrite ? (
              add
            ) : null}
          </EmptyContent>
        </Empty>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('people.fields.name')}</TableHead>
                <TableHead>{t('people.fields.code')}</TableHead>
                <TableHead>{t('people.fields.subjectId')}</TableHead>
                {kind === 'profiles' ? (
                  gradeVisible ? (
                    <TableHead className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => sort('grade')}
                      >
                        {t('people.fields.grade')}
                        <ArrowDownUp />
                        {params.get('orderBy')?.includes('grade')
                          ? params.get('orderBy')?.startsWith('-')
                            ? '↓'
                            : '↑'
                          : null}
                      </Button>
                    </TableHead>
                  ) : null
                ) : (
                  <TableHead>{t('people.fields.personId')}</TableHead>
                )}
                <TableHead>{t('people.fields.status')}</TableHead>
                <TableHead>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => sort('updatedAt')}
                  >
                    {t('people.fields.updatedAt')}
                    <ArrowDownUp />
                    {(params.get('orderBy') ?? '-updatedAt').includes(
                      'updatedAt',
                    )
                      ? (params.get('orderBy') ?? '-updatedAt').startsWith('-')
                        ? '↓'
                        : '↑'
                      : null}
                  </Button>
                </TableHead>
                <TableHead>
                  <span className='sr-only'>{t('people.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      className='block max-w-64 truncate font-medium text-primary underline-offset-4 hover:underline'
                      title={row.name}
                      to={link(row.id)}
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>
                    <span
                      className='block max-w-48 truncate'
                      title={optionName('orgSubjects', row.subjectId)}
                    >
                      {optionName('orgSubjects', row.subjectId)}
                    </span>
                  </TableCell>
                  {kind === 'profiles' ? (
                    gradeVisible ? (
                      <TableCell className='text-right tabular-nums'>
                        {row.grade === null
                          ? '—'
                          : t('people.gradeValue', { grade: row.grade })}
                      </TableCell>
                    ) : null
                  ) : (
                    <TableCell>
                      {optionName('employees', row.personId)}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge
                      tone={
                        [
                          'active',
                          'confirmed',
                          'effective',
                          'approved',
                          'completed',
                        ].includes(row.status)
                          ? 'success'
                          : row.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(`people.states.${row.status}`)}
                    </StatusBadge>
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
                            aria-label={t('people.recordActions', {
                              name: row.name,
                            })}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='w-auto min-w-40'
                      >
                        <DropdownMenuItem render={<Link to={link(row.id)} />}>
                          {t('people.view')}
                        </DropdownMenuItem>
                        {canWrite &&
                        (!workflows.includes(kind) ||
                          row.status === 'draft') ? (
                          <DropdownMenuItem
                            render={<Link to={link(`edit/${row.id}`)} />}
                          >
                            {t('people.edit')}
                          </DropdownMenuItem>
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
      {total > 20 ? (
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button
            variant='outline'
            disabled={page <= 1 || data.isFetching}
            onClick={() => updateFilter('page', textValue(page - 1))}
          >
            {t('people.previous')}
          </Button>
          <span className='text-sm'>
            {t('people.page', { page, pages: Math.ceil(total / 20) })}
          </span>
          <Button
            variant='outline'
            disabled={page * 20 >= total || data.isFetching}
            onClick={() =>
              search.updateParams((p) => p.set('page', textValue(page + 1)))
            }
          >
            {t('people.next')}
          </Button>
        </div>
      ) : null}
      <Outlet />
    </PageContainer>
  );
}
