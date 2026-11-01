import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { SearchCheckIcon } from 'lucide-react';
import { StatusBadge } from '#components/status-badge';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';

type Domain = 'organization' | 'people' | 'materials' | 'suppliers';
interface Target {
  domain: Domain;
  kind: string;
  id?: string;
  subjectId?: string;
  busy?: boolean;
}
type Impact =
  | {
      visibility: 'authorized';
      total: number;
      hasMore: boolean;
      items: {
        id: string;
        code: string;
        status: 'draft' | 'pending' | 'approved';
      }[];
    }
  | { visibility: 'restricted'; items: []; hasMore: false };
const kinds: Record<Domain, readonly string[]> = {
  organization: ['subjects', 'units', 'positions', 'regions'],
  people: ['employees', 'changes'],
  materials: [
    'names',
    'templates',
    'skus',
    'units',
    'unitRules',
    'subjectSettings',
  ],
  suppliers: ['identity', 'applicability', 'company'],
};

/** Auxiliary read-only information; never changes the parent's dirty state or submit behavior. */
export function PurchaseReferenceNotice(target: Target) {
  if (
    !target.id ||
    !kinds[target.domain].includes(target.kind) ||
    (target.domain === 'suppliers' &&
      target.kind === 'company' &&
      !target.subjectId)
  )
    return null;
  return (
    <NoticeBody
      key={`${target.domain}:${target.kind}:${target.id}:${target.subjectId ?? ''}`}
      {...target}
    />
  );
}
function NoticeBody({ domain, kind, id, subjectId, busy }: Target) {
  const api = useApiClient(),
    { t } = useTranslation(),
    headingId = useId();
  const query = useQuery({
    queryKey: ['purchase-reference-impact', domain, kind, id, subjectId],
    queryFn: ({ signal }) =>
      api.request<{ data: Impact }>({
        path: 'procurement/referenceImpacts',
        query: {
          domain,
          kind,
          id,
          ...(domain === 'suppliers' && kind === 'company'
            ? { subjectId }
            : {}),
        },
        signal,
      }),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const error = query.error,
    data = query.data?.data;
  const terminal =
    error instanceof ApiClientError
      ? error.status === 403
        ? 'forbidden'
        : error.status === 404
          ? 'unavailable'
          : error.reason === 'PURCHASE_REFERENCE_TOO_BROAD'
            ? 'tooBroad'
            : undefined
      : undefined;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={query.isFetching}
      className='flex min-w-0 flex-col gap-3 rounded-lg border p-4'
      data-purchase-references
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h3 id={headingId} className='text-base font-medium'>
          {t('purchaseReferences.title')}
        </h3>
        {query.isFetching && data && !error && (
          <span className='text-xs text-muted-foreground'>
            {t('purchaseReferences.updating')}
          </span>
        )}
      </div>
      {query.isPending ? (
        <div
          role='status'
          aria-label={t('purchaseReferences.loading')}
          className='flex flex-col gap-2'
        >
          <Skeleton className='h-4 w-3/4' />
          <Skeleton className='h-4 w-1/2' />
          <span className='sr-only'>{t('purchaseReferences.loading')}</span>
        </div>
      ) : error ? (
        error instanceof ApiClientError && error.status === 401 ? (
          <SessionExpiredAlert />
        ) : (
          <Alert variant='destructive'>
            <AlertDescription className='flex flex-col gap-2'>
              <p>{t(`purchaseReferences.${terminal ?? 'failed'}`)}</p>
              {!terminal && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={busy || query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {t('purchaseReferences.retry')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )
      ) : data?.visibility === 'restricted' ? (
        <p className='text-sm text-muted-foreground'>
          {t('purchaseReferences.restricted')}
        </p>
      ) : data?.visibility === 'authorized' ? (
        data.total === 0 ? (
          <Empty className='gap-2 p-2'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <SearchCheckIcon />
              </EmptyMedia>
              <EmptyTitle>{t('purchaseReferences.empty')}</EmptyTitle>
              <EmptyDescription>
                {t('purchaseReferences.emptyHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className='text-sm text-muted-foreground'>
              {t('purchaseReferences.count', { count: data.total })}
            </p>
            <ul className='flex flex-col gap-2'>
              {data.items.map((item) => (
                <li
                  key={item.id}
                  className='flex min-w-0 flex-wrap items-center gap-2 text-sm'
                >
                  <span className='min-w-0 [overflow-wrap:anywhere]'>
                    {item.code}
                  </span>
                  <StatusBadge
                    size='sm'
                    tone={
                      item.status === 'approved'
                        ? 'success'
                        : item.status === 'pending'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {t(`procurement.requestUi.${item.status}`)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
            {data.hasMore && (
              <p className='text-xs text-muted-foreground'>
                {t('purchaseReferences.more')}
              </p>
            )}
          </>
        )
      ) : null}
      <p className='text-xs text-muted-foreground'>
        {t(`purchaseReferences.${domain}`)}
      </p>
      <p className='text-xs text-muted-foreground'>
        {t('purchaseReferences.help')}
      </p>
    </section>
  );
}
