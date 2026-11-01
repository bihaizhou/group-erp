import { useParams, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { formatStockQuantity } from '#lib/stock-quantity';
import { useExecutionQuery, ui } from './hooks.js';
import { Loading, ErrorNotice, EmptyState } from './controls.js';
import {
  pageFor,
  type ExecutionRecord,
  type StoredLine,
  type Page,
  type ReviewContext,
  type Snapshot,
} from './model.js';
import { FrozenReviewContext } from './review-context.js';
type ReadLine = {
  id: string;
  quantity?: string;
  baseQuantity?: string;
  materialSnapshot: Snapshot;
};
export default function ExecutionReadonly() {
  const { t, i18n } = useTranslation(),
    { id: routeId, documentId, versionId, relatedId } = useParams(),
    id = documentId ?? routeId,
    config = pageFor(useResolvedPath('.').pathname);
  const version = useExecutionQuery<
    Page<{
      id: string;
      contentVersion: number;
      payload?: { head?: Partial<ExecutionRecord>; lines?: StoredLine[] };
      review?: ReviewContext;
    }>
  >(`${config.api}/${id}/versions/${versionId}`, {}, !!id && !!versionId);
  const record = useExecutionQuery<{ data: ExecutionRecord }>(
    `${config.api}/${id}`,
    {},
    !!id && !versionId,
  );
  const stored = version.data?.data[0],
    allocation = record.data?.data.allocations?.items.find(
      (value) => value.id === relatedId,
    ),
    sources = record.data?.data.lines.filter(
      (line) => line.sourceSnapshot?.id === relatedId,
    ),
    source = sources?.[0]?.sourceSnapshot;
  const lines: ReadLine[] = versionId
    ? (stored?.payload?.lines ?? [])
    : allocation
      ? [
          {
            id: allocation.id,
            baseQuantity: allocation.source.baseQuantity,
            materialSnapshot: allocation.source.materialSnapshot,
          },
        ]
      : (sources ?? []).map((line) => ({
          ...line,
          quantity: line.sourceSnapshot?.quantity,
          baseQuantity: line.sourceSnapshot?.baseQuantity,
        }));
  const heading = versionId
    ? t(ui('versionNumber'), { version: stored?.contentVersion ?? '—' })
    : (allocation?.source.code ?? source?.code ?? t(ui('sourceBasis')));
  const error = versionId ? version.error : record.error,
    pending = versionId ? version.isPending : record.isPending;
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader title={heading} description={t(ui('readOnly'))} />
        {error ? (
          <ErrorNotice
            error={error}
            retry={() => {
              if (versionId) void version.refetch();
              else void record.refetch();
            }}
          />
        ) : pending ? (
          <Loading kind='detail' />
        ) : versionId ? (
          !stored?.payload ? (
            <EmptyState type='restricted' />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {stored.payload.head?.code ?? t(ui('details'))}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className='grid gap-4 sm:grid-cols-2'>
                    {[
                      ['occurredOn', stored.payload.head?.occurredOn],
                      ['reason', stored.payload.head?.reason],
                      ['notes', stored.payload.head?.notes],
                    ].map(([key, value]) => (
                      <div key={key}>
                        <dt className='text-sm text-muted-foreground'>
                          {t(ui(key!))}
                        </dt>
                        <dd className='mt-1 whitespace-pre-wrap break-words text-sm'>
                          {value || '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
              <FrozenReviewContext context={stored.review} />
              <ReadOnlyLines lines={lines} locale={i18n.language} />
            </>
          )
        ) : !source && !allocation ? (
          <EmptyState type='restricted' />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t(ui('sourceBasis'))}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className='text-sm'>
                  {t(ui('source'))}: {allocation?.source.code ?? source?.code}
                </p>
                <p className='mt-2 text-sm text-muted-foreground'>
                  {t(ui('sourceBasisHint'))}
                </p>
                {allocation && (
                  <p className='mt-2 text-sm'>
                    {t(ui('allocatedQuantity'))}:{' '}
                    {formatStockQuantity(
                      allocation.baseQuantity,
                      i18n.language,
                    )}{' '}
                    {allocation.source.materialSnapshot.baseUnitName ?? ''}
                  </p>
                )}
              </CardContent>
            </Card>
            <ReadOnlyLines lines={lines} locale={i18n.language} />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function ReadOnlyLines({
  lines,
  locale,
}: {
  lines: ReadLine[];
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(ui('lines'))}</CardTitle>
      </CardHeader>
      <CardContent>
        {!lines.length ? (
          <EmptyState type='noLines' />
        ) : (
          <div className='overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(ui('material'))}</TableHead>
                  <TableHead>{t(ui('quantity'))}</TableHead>
                  <TableHead>{t(ui('baseQuantity'))}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <p className='font-medium'>
                        {line.materialSnapshot?.name ?? '—'}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {line.materialSnapshot?.code ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {line.quantity
                        ? formatStockQuantity(line.quantity, locale)
                        : '—'}{' '}
                      {line.materialSnapshot?.unitName ?? ''}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {line.baseQuantity
                        ? formatStockQuantity(line.baseQuantity, locale)
                        : '—'}{' '}
                      {line.materialSnapshot?.baseUnitName ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
