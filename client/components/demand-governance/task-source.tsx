import { useSourceReason } from '#hooks/use-source-reason';
import { DemandAttachments } from '#components/demand-attachments/index';
import { SourceLoading, SourceError } from './controls.js';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { LongText } from '#components/long-text';
import { SourceBadge } from './index.js';
import { sourceUi } from './hooks.js';
import type { Source } from './model.js';
export function GovernanceTaskSource({ taskId }: { taskId: string }) {
  const sourceReason = useSourceReason();
  const { t } = useTranslation(),
    api = useApiClient(),
    permission = useCan({
      resource: { type: 'composite', id: 'materials.sources' },
      action: 'read',
    });
  const query = useQuery({
    queryKey: ['material-source', taskId],
    enabled: permission.can,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{ data: Source[] }>({
        path: `materials/requests/${taskId}/sources`,
        signal,
      }),
  });
  const terminal =
    query.error instanceof ApiClientError &&
    [401, 403, 404].includes(query.error.status);
  const source = terminal || !permission.can ? undefined : query.data?.data[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(sourceUi('sourceDemand'))}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {!permission.can ? (
          <p className='text-sm text-muted-foreground'>
            {t(sourceUi('http403'))}
          </p>
        ) : (
          <>
            {query.error && (
              <SourceError
                error={query.error}
                retry={() => void query.refetch()}
              />
            )}
            {query.isFetching && !query.isPending && (
              <p role='status' className='text-sm text-muted-foreground'>
                {t(sourceUi('refreshing'))}
              </p>
            )}
            {query.isPending ? (
              <SourceLoading />
            ) : source ? (
              <>
                <p className='font-medium'>
                  {source.purchaseRequestLineId
                    ? t(sourceUi('sourcePurchase'))
                    : t(sourceUi('sourceIssue'))}{' '}
                  · {source.inputSnapshot.documentCode ?? '—'} ·{' '}
                  {t(sourceUi('lineTitle'), {
                    number: source.inputSnapshot.lineNo ?? '—',
                  })}
                </p>
                <SourceBadge status={source.status} />
                <dl className='grid gap-4 text-sm'>
                  {[
                    ['originalName', source.inputSnapshot.originalName],
                    [
                      'originalSpecification',
                      source.inputSnapshot.originalSpecification,
                    ],
                    [
                      'quantity',
                      `${source.inputSnapshot.quantity} ${source.inputSnapshot.requestedUnitText}`,
                    ],
                    ['usage', source.inputSnapshot.usage],
                    ['handler', source.display?.handler],
                  ].map(([key, value]) => (
                    <div
                      key={key}
                      className='grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4'
                    >
                      <dt className='text-muted-foreground'>
                        {t(sourceUi(key!))}
                      </dt>
                      <dd>
                        <LongText>{value || '—'}</LongText>
                      </dd>
                    </div>
                  ))}
                </dl>
                <LongText>
                  {sourceReason(source.invalidatedReason || source.reason)}
                </LongText>
                <p className='text-sm text-muted-foreground'>
                  {t(sourceUi('sourceEditHint'))}
                </p>
                <DemandAttachments
                  domain={
                    source.purchaseRequestLineId
                      ? 'procurement'
                      : 'requisitions'
                  }
                  governanceTaskId={taskId}
                />
              </>
            ) : !query.error ? (
              <p>{t(sourceUi('standaloneHint'))}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
