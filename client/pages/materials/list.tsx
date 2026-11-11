import { useEffect, useRef } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router';
import { MoreHorizontal, Plus, PackageSearch, ArrowDownUp } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '#components/ui/alert';
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
import {
  kindFromPath,
  fields,
  referenceIds,
  statuses,
  canEdit,
  text,
  type Row,
} from './model.js';
import { useMaterialCan, useMaterialOptions } from './hooks.js';
import {
  Loading,
  ErrorNotice,
  Refresh,
  MaterialSelect,
  OverflowText,
} from './controls.js';
export default function MaterialList() {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    location = useLocation(),
    kind = kindFromPath(location.pathname);
  const read = useMaterialCan(kind, 'read'),
    write = useMaterialCan(kind),
    requestMaterial = useMaterialCan('requests'),
    catalog = kind === 'skus' && !read.can;
  const search = useUrlSearch({ resetParams: ['page'] }),
    searchRef = useRef<HTMLInputElement>(null),
    params = search.searchParams;
  // A saved link must never turn an obsolete classification filter into an
  // unfiltered result. Keep the invalid state explicit until the user clears it.
  const retiredFilter = params.has('categoryId') || params.has('parentId');
  const query = Object.fromEntries(
    [...params].filter(
      ([key, v]) =>
        [
          'q',
          'status',
          'subjectId',
          'skuId',
          'materialNameId',
          'baseUnitId',
          'templateId',
          'unitId',
          'tagId',
          'responsiblePositionId',
          'page',
          'orderBy',
        ].includes(key) && v,
    ),
  );
  const data = useQuery({
    retry: false,
    enabled: !read.isPending && !retiredFilter,
    queryKey: ['material-list', catalog ? 'catalog' : kind, params.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (retiredFilter)
        throw new Error(t('materials.retiredFilterDescription'));
      return api.request<{
        data: Row[];
        meta: {
          total: number;
          page: number;
          pageSize: number;
          ambiguous?: boolean;
          nameCandidates?: { id: string; name: string }[];
        };
      }>({ path: `materials/${catalog ? 'catalog' : kind}`, query, signal });
    },
  });
  const rows = data.data?.data ?? [],
    total = data.data?.meta.total ?? 0,
    page = data.data?.meta.page ?? 1;
  const options = useMaterialOptions(
    catalog ? 'catalog' : kind,
    '',
    [
      ...new Set([
        ...rows.flatMap(referenceIds),
        ...referenceIds(Object.fromEntries(params)),
      ]),
    ].slice(0, 100),
    !read.isPending && (catalog || read.can),
  );
  const relatedField =
    kind === 'skus'
      ? { key: 'tagId', source: 'tags' }
      : fields[kind].find((field) => field.type === 'ref' && field.source);
  const relatedValue = relatedField ? (params.get(relatedField.key) ?? '') : '';
  const filtered = Boolean(
    search.search || params.get('status') || relatedValue || retiredFilter,
  );
  const update = (key: string, value: string) =>
    search.updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key !== 'page') p.delete('page');
    });
  useEffect(() => {
    if (data.data && page > 1 && rows.length === 0 && total > 0)
      update('page', String(Math.ceil(total / 20)));
  });
  const clear = () => {
    search.clear((p) => {
      p.delete('status');
      p.delete('categoryId');
      p.delete('parentId');
      for (const key of [
        'subjectId',
        'skuId',
        'materialNameId',
        'baseUnitId',
        'templateId',
        'unitId',
        'tagId',
        'responsiblePositionId',
      ])
        p.delete(key);
      p.delete('page');
    });
    searchRef.current?.focus();
  };
  const link = (path: string) => ({ pathname: path, search: location.search });
  const add = (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <Plus />
      {kind === 'skus'
        ? t('materials.createSku')
        : t('materials.create', { kind: t(`materials.kinds.${kind}`) })}
    </Button>
  );
  const refField = fields[kind].find((field) => field.type === 'ref'),
    enumField = fields[kind].find((field) => field.type === 'select');
  const summary = (row: Row) =>
    kind === 'skus'
      ? Object.entries((row.attributeValues ?? {}) as Record<string, string>)
          .map(([, value]) => value)
          .join(' · ') || '—'
      : refField
        ? (options.data?.data[
            refField.source ?? text(row.targetKind)
          ]?.rows.find((v) => v.id === row[refField.key])?.name ?? '—')
        : enumField
          ? t(`materials.enums.${text(row[enumField.key])}`)
          : kind === 'templates'
            ? t('materials.attributeCount', {
                count: Array.isArray(row.fields) ? row.fields.length : 0,
              })
            : '—';
  return (
    <PageContainer>
      <PageHeader
        title={t(`materials.kinds.${kind}`)}
        description={t(
          catalog
            ? 'materials.catalogDescription'
            : `materials.descriptions.${kind}`,
        )}
        actions={
          <>
            {!retiredFilter &&
            data.data &&
            (rows.length > 0 || filtered) &&
            write.can
              ? add
              : null}
            {!retiredFilter ? (
              <Refresh
                busy={data.isFetching}
                onClick={() => {
                  void data.refetch();
                  void options.refetch();
                }}
              />
            ) : null}
          </>
        }
      />
      <ReadOnlyNotice canManage={write.can} />
      {options.isError && !retiredFilter ? (
        <ErrorNotice
          error={options.error}
          retry={() => void options.refetch()}
        />
      ) : null}
      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full sm:max-w-xs'>
          <Label htmlFor='material-search' className='sr-only'>
            {t('materials.search')}
          </Label>
          <Input
            ref={searchRef}
            id='material-search'
            placeholder={t('materials.search')}
            {...search.inputProps}
          />
        </div>
        {!catalog ? (
          <div className='w-full sm:w-40'>
            <MaterialSelect
              label={t('materials.fields.status')}
              value={params.get('status') ?? ''}
              onChange={(v) => update('status', v)}
              items={[
                { value: '', label: t('materials.allStatuses') },
                ...statuses(kind).map((value) => ({
                  value,
                  label: t(`materials.states.${value}`),
                })),
              ]}
            />
          </div>
        ) : null}
        {relatedField ? (
          <div className='w-full sm:w-48'>
            <MaterialSelect
              label={t(`materials.fields.${relatedField.key}`)}
              value={relatedValue}
              onChange={(value) => update(relatedField.key, value)}
              items={[
                { value: '', label: t('materials.allRelated') },
                ...(
                  options.data?.data[relatedField.source ?? '']?.rows ?? []
                ).map((value) => ({ value: value.id, label: value.name })),
              ]}
            />
          </div>
        ) : null}
        {filtered ? (
          <Button variant='ghost' onClick={clear}>
            {t('materials.clear')}
          </Button>
        ) : null}
        {!retiredFilter ? (
          <span className='text-sm text-muted-foreground'>
            {t('materials.total', { count: total })}
          </span>
        ) : null}
      </div>
      {!retiredFilter && data.data?.meta.nameCandidates?.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('materials.nameCandidates', {
            names: data.data.meta.nameCandidates
              .map((value) => value.name)
              .join('、'),
          })}
        </p>
      ) : null}
      {!retiredFilter && catalog && filtered && data.data?.meta.ambiguous ? (
        <p className='text-sm text-muted-foreground'>
          {t('materials.ambiguous')}
        </p>
      ) : null}
      {retiredFilter ? (
        <Alert variant='destructive'>
          <AlertTitle>{t('materials.retiredFilterTitle')}</AlertTitle>
          <AlertDescription>
            {t('materials.retiredFilterDescription')}
          </AlertDescription>
        </Alert>
      ) : data.isError ? (
        <ErrorNotice error={data.error} retry={() => void data.refetch()} />
      ) : !data.data ? (
        <Loading variant='list' />
      ) : total === 0 ? (
        <Empty className='min-h-48 border border-dashed'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <PackageSearch />
            </EmptyMedia>
            <EmptyTitle>
              {t(filtered ? 'materials.noResults' : 'materials.empty')}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                filtered
                  ? 'materials.noResultsDescription'
                  : write.can
                    ? 'materials.emptyDescription'
                    : 'materials.readOnlyEmpty',
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant='outline' onClick={clear}>
                {t('materials.clear')}
              </Button>
            ) : write.can ? (
              add
            ) : null}
            {kind === 'skus' && filtered ? (
              requestMaterial.can ? (
                <Button
                  nativeButton={false}
                  variant={write.can ? 'outline' : 'default'}
                  render={<Link to={link('newRequest')} />}
                >
                  {t('materials.requestMissing')}
                </Button>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('materials.contactMaintainer')}
                </p>
              )
            ) : null}
          </EmptyContent>
        </Empty>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('materials.fields.name')}</TableHead>
                <TableHead>{t('materials.fields.code')}</TableHead>
                <TableHead>
                  {t(
                    kind === 'skus'
                      ? 'materials.attributes'
                      : 'materials.related',
                  )}
                </TableHead>
                <TableHead>{t('materials.fields.status')}</TableHead>
                <TableHead
                  aria-sort={
                    (params.get('orderBy') ?? '-updatedAt') === 'updatedAt'
                      ? 'ascending'
                      : 'descending'
                  }
                >
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() =>
                      update(
                        'orderBy',
                        params.get('orderBy') === 'updatedAt'
                          ? '-updatedAt'
                          : 'updatedAt',
                      )
                    }
                  >
                    {t('materials.fields.updatedAt')}
                    <ArrowDownUp />
                    {(params.get('orderBy') ?? '-updatedAt').startsWith('-')
                      ? '↓'
                      : '↑'}
                  </Button>
                </TableHead>
                <TableHead>
                  <span className='sr-only'>{t('materials.actionsLabel')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {/* Bound long names so status, code and actions remain scannable; OverflowText reveals only real overflow. */}
                    <Link
                      className='block max-w-64 truncate font-medium text-primary underline-offset-4 hover:underline'

                      to={link(row.id)}
                    >
                      <OverflowText
                        className='block truncate'
                        text={row.name}
                      />
                    </Link>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {row.code}
                  </TableCell>
                  <TableCell>
                    {enumField && !refField && kind !== 'skus' ? (
                      <StatusBadge tone='info'>{summary(row)}</StatusBadge>
                    ) : (
                      <OverflowText
                        className='block max-w-64 truncate'
                        text={summary(row)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={
                        row.status === 'active' || row.status === 'resolved'
                          ? 'success'
                          : row.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(`materials.states.${row.status}`)}
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
                            aria-label={t('materials.recordActions', {
                              name: row.name,
                            })}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='w-auto min-w-40'
                      >
                        <DropdownMenuItem render={<Link to={link(row.id)} />}>
                          {t('materials.view')}
                        </DropdownMenuItem>
                        {write.can && canEdit(kind, row) ? (
                          <DropdownMenuItem
                            render={<Link to={link(`edit/${row.id}`)} />}
                          >
                            {t('materials.edit')}
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
      {!retiredFilter && total > 20 ? (
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button
            variant='outline'
            disabled={page <= 1 || data.isFetching}
            onClick={() => update('page', String(page - 1))}
          >
            {t('materials.previous')}
          </Button>
          <span className='text-sm'>
            {t('materials.page', { page, pages: Math.ceil(total / 20) })}
          </span>
          <Button
            variant='outline'
            disabled={page * 20 >= total || data.isFetching}
            onClick={() => update('page', String(page + 1))}
          >
            {t('materials.next')}
          </Button>
        </div>
      ) : null}
      <Outlet />
    </PageContainer>
  );
}
