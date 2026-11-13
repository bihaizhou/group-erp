import { usePartnerConfig } from './partner-domain.js';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import {
  MoreHorizontal,
  Plus,
  RefreshCw,
  Truck,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { StatusBadge } from '#components/status-badge';
import { useUrlSearch } from '#hooks/use-url-search';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
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
import { OverflowText } from '../materials/controls.js';
import { useSupplierQuery, useSupplierCan, useCapabilities } from './hooks.js';
import {
  SupplierLoading,
  SupplierError,
  SupplierSelect,
  SupplierStatus,
  Pagination,
} from './controls.js';
import {
  pageNumber,
  type Page,
  type Availability,
  type Choice,
} from './model.js';
const COLUMN_WIDTHS: Record<string, string> = {
  name: 'min-w-44',
  code: 'min-w-24',
  registrationCode: 'min-w-28',
  scopeMatch: 'min-w-24',
  identityStatus: 'min-w-28',
  supplierStatus: 'min-w-28',
  companyStatus: 'min-w-28',
  effectiveStatus: 'min-w-32',
  updatedAt: 'min-w-40',
};

export default function SupplierList() {
  const { rootPath, role: partnerRole } = usePartnerConfig();
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ resetParams: ['page'] });
  const subjectId = search.searchParams.get('subjectId') ?? '',
    page = pageNumber(search.searchParams.get('page'));
  const status = ['active', 'inactive'].includes(
    search.searchParams.get('status') ?? '',
  )
    ? search.searchParams.get('status')!
    : '';
  const orderBy = [
    'code',
    '-code',
    'name',
    '-name',
    'updatedAt',
    '-updatedAt',
  ].includes(search.searchParams.get('orderBy') ?? '')
    ? search.searchParams.get('orderBy')!
    : 'code';
  const addRole = useSupplierCan('addRole');
  const read = useSupplierCan('read'),
    create = useSupplierCan('create'),
    identity = useSupplierCan('updateIdentity'),
    scope = useSupplierCan('configureApplicability');
  const company = useSupplierQuery<{ data: Choice }>(
    `supplierCompanies/${subjectId}`,
    {},
    Boolean(subjectId && read.can),
  );
  const result = useSupplierQuery<Page<Availability>>(
    'supplierAvailability',
    {
      subjectId,
      q: search.search,
      page,
      pageSize: 20,
      orderBy,
      ...(status ? { status } : {}),
    },
    Boolean(subjectId && read.can && company.data),
  );
  const inputRef = useRef<HTMLInputElement>(null),
    previousPathRef = useRef(location.pathname);
  useEffect(() => {
    if (
      previousPathRef.current !== location.pathname &&
      location.pathname === rootPath
    )
      inputRef.current?.focus();
    previousPathRef.current = location.pathname;
  }, [location.pathname, rootPath]);
  const setParam = (key: string, value: string) =>
    search.updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      p.delete('page');
    });
  const link = (pathname: string) => ({ pathname, search: location.search });
  const filtered = Boolean(search.search || status),
    empty =
      result.isSuccess && !result.data.data.length && !filtered && page === 1;
  const newButton = (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <Plus />
      {t('procurement.create')}
    </Button>
  );
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('procurement.suppliers')}
          description={t('procurement.description')}
          actions={
            <>
              {partnerRole === 'customer' && addRole.can && (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={<Link to={link('attach')} />}
                >
                  {t('procurement.attachRole')}
                </Button>
              )}
              {(identity.can || scope.can) && (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={<Link to={link('directory')} />}
                >
                  {t('procurement.directory')}
                </Button>
              )}
              {subjectId &&
                company.data &&
                result.data &&
                create.can &&
                !empty &&
                newButton}
              {subjectId && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='outline'
                        size='icon'
                        disabled={result.isFetching}
                        aria-label={t('procurement.refresh')}
                        onClick={() => void result.refetch()}
                      />
                    }
                  >
                    <RefreshCw
                      className={result.isFetching ? 'animate-spin' : undefined}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{t('procurement.refresh')}</TooltipContent>
                </Tooltip>
              )}
            </>
          }
        />
        <ReadOnlyNotice canManage={create.can} />
        {read.can && (
          <>
            <div className='flex flex-col gap-3 sm:flex-row sm:flex-wrap'>
              <Input
                ref={inputRef}
                aria-label={t('procurement.search')}
                placeholder={t('procurement.search')}
                maxLength={200}
                className='w-full sm:max-w-xs'
                {...search.inputProps}
              />
              <div className='sm:w-40'>
                <SupplierSelect
                  label={t('procurement.effectiveStatus')}
                  value={status || 'any'}
                  onChange={(v) => setParam('status', v === 'any' ? '' : v)}
                  items={['any', 'active', 'inactive'].map((v) => ({
                    value: v,
                    label: t(`procurement.${v === 'any' ? 'anyStatus' : v}`),
                  }))}
                />
              </div>
              {/* Allow the longest translated ordering label while the toolbar wraps on mobile. */}
              <div className='sm:w-44'>
                <SupplierSelect
                  label={t('procurement.sort')}
                  value={orderBy}
                  onChange={(v) => setParam('orderBy', v)}
                  items={[
                    ['code', 'codeOrder'],
                    ['-updatedAt', 'newest'],
                    ['updatedAt', 'oldest'],
                  ].map(([value, key]) => ({
                    value,
                    label: t(`procurement.${key}`),
                  }))}
                />
              </div>
              {filtered && (
                <Button
                  variant='ghost'
                  onClick={() =>
                    search.clear((p) => {
                      p.delete('status');
                      p.delete('page');
                    })
                  }
                >
                  {t('procurement.clear')}
                </Button>
              )}
            </div>
            {company.error ? (
              <SupplierError
                error={company.error}
                retry={() => void company.refetch()}
              />
            ) : subjectId && (company.isPending || result.isPending) ? (
              <SupplierLoading />
            ) : result.error ? (
              <SupplierError
                error={result.error}
                retry={() => void result.refetch()}
              />
            ) : result.data ? (
              result.data.data.length ? (
                <>
                  <div className='rounded-lg border'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            'name',
                            'code',
                            'registrationCode',
                            'scopeMatch',
                            'identityStatus',
                            'supplierStatus',
                            'companyStatus',
                            'effectiveStatus',
                            'updatedAt',
                          ].map((key) => (
                            <TableHead
                              key={key}
                              className={COLUMN_WIDTHS[key]}
                              aria-sort={
                                ['updatedAt', 'code', 'name'].includes(key)
                                  ? orderBy.replace(/^-/u, '') === key
                                    ? orderBy.startsWith('-')
                                      ? 'descending'
                                      : 'ascending'
                                    : 'none'
                                  : undefined
                              }
                            >
                              {['updatedAt', 'code', 'name'].includes(key) ? (
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  onClick={() =>
                                    setParam(
                                      'orderBy',
                                      orderBy.replace(/^-/u, '') === key
                                        ? orderBy.startsWith('-')
                                          ? key
                                          : `-${key}`
                                        : key === 'updatedAt'
                                          ? '-updatedAt'
                                          : key,
                                    )
                                  }
                                >
                                  {t(`procurement.${key}`)}
                                  {orderBy.replace(/^-/u, '') === key ? (
                                    <ArrowDown
                                      aria-hidden='true'
                                      className={
                                        orderBy.startsWith('-')
                                          ? undefined
                                          : 'rotate-180'
                                      }
                                    />
                                  ) : (
                                    <ArrowUpDown aria-hidden='true' />
                                  )}
                                </Button>
                              ) : (
                                t(`procurement.${key}`)
                              )}
                            </TableHead>
                          ))}
                          <TableHead>
                            <span className='sr-only'>
                              {t('procurement.detail')}
                            </span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.data.data.map((row) => (
                          <TableRow key={row.partnerId}>
                            <TableCell>
                              <Link
                                to={link(row.partnerId)}
                                className='font-medium underline-offset-4 hover:underline'
                              >
                                <OverflowText
                                  text={row.identity.name}
                                  className='block max-w-64 truncate'
                                />
                              </Link>
                            </TableCell>
                            <TableCell className='font-mono text-xs'>
                              {row.identity.code}
                            </TableCell>
                            <TableCell>
                              {row.identity.registrationCode || '—'}
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone='info'>
                                {t(`procurement.match.${row.scopeMatch}`)}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              <SupplierStatus value={row.identity.status} />
                            </TableCell>
                            <TableCell>
                              <SupplierStatus value={row.supplierStatus} />
                            </TableCell>
                            <TableCell>
                              <SupplierStatus value={row.companyStatus} />
                            </TableCell>
                            <TableCell>
                              <SupplierStatus value={row.effectiveStatus} />
                            </TableCell>
                            <TableCell className='whitespace-nowrap'>
                              {new Intl.DateTimeFormat(i18n.language, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              }).format(new Date(row.updatedAt))}
                            </TableCell>
                            <TableCell>
                              <SupplierRowMenu row={row} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={page}
                    total={result.data.meta.total}
                    onPage={(v) =>
                      search.updateParams((p) => p.set('page', String(v)))
                    }
                    busy={result.isFetching}
                  />
                </>
              ) : (
                <Empty className='min-h-48 border border-dashed'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Truck />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t(empty ? 'procurement.empty' : 'procurement.noResults')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        empty
                          ? create.can
                            ? 'procurement.emptyHint'
                            : 'procurement.emptyReadOnlyHint'
                          : 'procurement.noResultsHint',
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {empty ? (
                      create.can && newButton
                    ) : (
                      <Button
                        variant='outline'
                        onClick={() =>
                          search.clear((p) => {
                            p.delete('status');
                            p.delete('page');
                          })
                        }
                      >
                        {t('procurement.clear')}
                      </Button>
                    )}
                  </EmptyContent>
                </Empty>
              )
            ) : null}
          </>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
export function SupplierRowMenu({ row }: { row: Availability }) {
  const { rootPath } = usePartnerConfig();
  const { t } = useTranslation(),
    location = useLocation(),
    [open, setOpen] = useState(false);
  // Resolve row-scoped capabilities only when opened, never N requests per list.
  const capability = useCapabilities(
      open ? row.partnerId : undefined,
      row.subjectId,
    ),
    can = capability.data?.data;
  const item = (path: string, key: string) => (
    <DropdownMenuItem
      render={
        <Link
          to={{
            pathname: `${rootPath}/${row.partnerId}/${path}`,
            search: location.search,
          }}
        />
      }
    >
      {t(`procurement.${key}`)}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('procurement.more', { name: row.identity.name })}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-auto min-w-40'>
        {item('', 'detail')}
        {can?.updateRelationship && item('edit', 'editCompany')}
        {can?.updateIdentity && item('identity', 'editIdentity')}
        {can?.configureApplicability && item('scope', 'editScope')}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
