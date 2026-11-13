import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '#components/ui/collapsible';
import { DateRangePicker } from '#components/date-picker';
import { useUrlSearch } from '#hooks/use-url-search';
import { ui, usePurchaseQuery } from './hooks.js';
import {
  ErrorNotice,
  Loading,
  Pagination,
  PurchaseSelect,
  RefreshButton,
} from './controls.js';
import { rootPath, type Choice, type MergeGroup, type Page } from './model.js';

const dateValue = (value: string | null) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : '';

export function MergePanel({
  companies,
  businessDate,
}: {
  companies: Choice[];
  businessDate?: string;
}) {
  const { t, i18n } = useTranslation();
  const { searchParams: params, updateParams } = useUrlSearch({
    resetParams: ['mergePage'],
  });
  const company = params.get('mergeCompany') ?? '',
    page = Math.max(1, Math.trunc(Number(params.get('mergePage'))) || 1),
    pageSize =
      [20, 50, 100].find(
        (value) => String(value) === params.get('mergePageSize'),
      ) ?? 20,
    from = dateValue(params.get('mergeFrom')),
    to = dateValue(params.get('mergeTo')),
    query = {
      ...(company ? { subjectId: company } : {}),
      page,
      pageSize,
      ...(from ? { neededFrom: from } : {}),
      ...(to ? { neededTo: to } : {}),
    },
    result = usePurchaseQuery<Page<MergeGroup>>('merge', query);
  const total = result.data?.meta.total ?? 0,
    rows = result.data?.data ?? [];
  const update = (name: string, value: string) =>
    updateParams((next) => {
      if (value) next.set(name, value);
      else next.delete(name);
      next.delete('mergePage');
    });
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full sm:w-48'>
          <PurchaseSelect
            label={t(ui('company'))}
            value={company || 'all'}
            items={[
              { value: 'all', label: t(ui('allCompanies')) },
              ...companies.map((item) => ({
                value: item.id,
                label: [item.code, item.name].filter(Boolean).join(' · '),
              })),
            ]}
            onChange={(value) =>
              update('mergeCompany', value === 'all' ? '' : value)
            }
          />
        </div>
        <DateRangePicker
          from={from}
          to={to}
          businessDate={businessDate}
          onChange={(nextFrom, nextTo) =>
            updateParams((next) => {
              for (const [name, value] of [
                ['mergeFrom', nextFrom],
                ['mergeTo', nextTo],
              ] as const) {
                if (value) next.set(name, value);
                else next.delete(name);
              }
              next.delete('mergePage');
            })
          }
        />
        <RefreshButton
          busy={result.isFetching}
          onClick={() => void result.refetch()}
        />
      </div>
      {result.error ? (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      ) : null}
      {result.isPending ? (
        <Loading kind='table' />
      ) : (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(ui('mergeMaterial'))}</TableHead>
                <TableHead className='w-20'>{t(ui('mergeUnit'))}</TableHead>
                <TableHead className='w-32 text-right'>
                  {t(ui('mergeQuantity'))}
                </TableHead>
                <TableHead className='w-40'>{t(ui('mergeSources'))}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((group) => (
                  <TableRow key={group.key}>
                    <TableCell>
                      <div className='font-medium'>{group.material.name}</div>
                      <div className='text-xs text-muted-foreground'>
                        {[group.material.code, group.material.specification]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </TableCell>
                    <TableCell>{group.material.unitName}</TableCell>
                    <TableCell className='text-right font-medium tabular-nums'>
                      {group.quantity} {group.material.unitName}
                    </TableCell>
                    <TableCell>
                      <Collapsible>
                        <CollapsibleTrigger
                          render={
                            <Button variant='link' size='sm' className='px-0' />
                          }
                        >
                          {t(ui('mergeSourceCount'), {
                            count: group.sources.length,
                          })}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className='mt-2 grid gap-1 text-sm'>
                            {group.sources.map((source) => (
                              <li key={source.lineId}>
                                <Link
                                  className='font-medium text-primary underline-offset-4 hover:underline'
                                  to={`${rootPath}/${source.requestId}?subjectId=${source.subjectId}`}
                                >
                                  {source.requestCode}
                                </Link>{' '}
                                <span className='text-muted-foreground'>
                                  {source.companyName}
                                </span>
                                {' · '}
                                {source.requestedQuantity}{' '}
                                {source.requestedUnit}
                                {source.neededOn
                                  ? ` · ${new Date(
                                      `${source.neededOn}T12:00:00`,
                                    ).toLocaleDateString(i18n.language)}`
                                  : ''}
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='h-24 text-center text-muted-foreground'
                  >
                    {t(ui('mergeEmpty'))}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='w-full sm:w-44'>
          <PurchaseSelect
            label={t(ui('perPage'), { size: pageSize })}
            value={String(pageSize)}
            items={[20, 50, 100].map((size) => ({
              value: String(size),
              label: t(ui('perPage'), { size }),
            }))}
            onChange={(value) => update('mergePageSize', value)}
          />
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          busy={result.isFetching}
          onPage={(next) =>
            updateParams((current) => current.set('mergePage', String(next)))
          }
        />
      </div>
    </div>
  );
}
