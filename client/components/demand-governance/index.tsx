import { History } from 'lucide-react';
import { useSourceReason } from '#hooks/use-source-reason';
import { SourceLoading, SourceError } from './controls.js';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '#components/ui/collapsible';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '#components/ui/empty';
import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { Pagination } from '#pages/procurement/requests/controls';
import {
  sourceActions,
  type Demand,
  type DemandDomain,
  type Source,
  type SourceLine,
  type SourceCapabilities,
  type SourcePage,
} from './model.js';
import { sourceUi, useSources, useDemandQuery } from './hooks.js';
interface SourceContext {
  domain: DemandDomain;
  request: Demand;
  sources: Source[];
  readonly: boolean;
  current: boolean;
  capabilities?: SourceCapabilities;
}
const Context = createContext<SourceContext | null>(null);
export function DemandGovernance({
  domain,
  request,
  readonly = false,
  children,
}: {
  domain: DemandDomain;
  request: Demand;
  readonly?: boolean;
  children: ReactNode;
}) {
  const sources = useSources(domain, request.id),
    caps = useDemandQuery<{ data: SourceCapabilities }>(
      domain,
      `requests/${request.id}/capabilities`,
      !readonly,
    ),
    { t } = useTranslation();
  const current =
    !sources.error &&
    !sources.isFetching &&
    !caps.error &&
    !caps.isFetching &&
    caps.data?.data.recordRevision === request.revision &&
    caps.data.data.lifecycleVersion === request.lifecycleVersion;
  return (
    <Context
      value={{
        domain,
        request,
        readonly,
        current,
        sources: sources.data?.data ?? [],
        capabilities: caps.data?.data,
      }}
    >
      {sources.error && (
        <SourceError
          error={sources.error}
          retry={() => void sources.refetch()}
        />
      )}
      {sources.isPending && <SourceLoading />}
      {sources.isFetching && !sources.isPending && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t(sourceUi('refreshing'))}
        </p>
      )}
      {children}
    </Context>
  );
}
export function SourceBadge({ status }: { status: Source['status'] }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        status === 'applied'
          ? 'success'
          : status === 'offered'
            ? 'info'
            : status === 'invalidated'
              ? 'neutral'
              : 'warning'
      }
    >
      {t(sourceUi(`states.${status}`))}
    </StatusBadge>
  );
}
export function DemandGovernanceLine({ line }: { line: SourceLine }) {
  const sourceReason = useSourceReason();
  const ctx = useContext(Context),
    { t } = useTranslation(),
    location = useLocation(),
    { session } = useAuthentication();
  if (!ctx) return null;
  const source = ctx.readonly
    ? undefined
    : ctx.sources.find((s) => s.id === line.activeSourceLinkId);
  const editable =
    !ctx.readonly &&
    ctx.request.status !== 'cancelled' &&
    line.status === 'active';
  const relevant = (action: string) =>
    action === 'requestGovernance'
      ? line.identificationStatus !== 'identified' &&
        (!source || ['needsInformation', 'invalidated'].includes(source.status))
      : action === 'takeOverSource'
        ? !!source &&
          ['pending', 'needsInformation', 'offered'].includes(source.status) &&
          source.sourceHandlerId !== session?.user.id
        : source?.status === 'offered';
  return (
    <div className='flex min-w-0 flex-col gap-3 border-t pt-4'>
      <h4
        id={`source-line-${line.id}`}
        tabIndex={-1}
        className='font-medium focus-visible:ring-2 focus-visible:ring-ring'
      >
        {t(sourceUi('lineTitle'), { number: line.lineNo })}
      </h4>
      {source ? (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <SourceBadge status={source.status} />
            <span className='text-sm text-muted-foreground'>
              {t(sourceUi('attempt'), { number: source.sourceAttempt })}
            </span>
          </div>
          {source.resolutionSnapshot && (
            <div className='rounded-lg bg-muted p-4'>
              <p className='font-medium'>
                {t(
                  sourceUi(
                    source.status === 'invalidated'
                      ? 'previousCandidate'
                      : source.status === 'applied'
                        ? 'appliedMaterial'
                        : 'candidate',
                  ),
                )}
                : {source.resolutionSnapshot.code} ·{' '}
                {source.resolutionSnapshot.name}
              </p>
              {source.status === 'offered' && (
                <p className='mt-2 text-sm'>{t(sourceUi('candidateHint'))}</p>
              )}
            </div>
          )}
          <p className='text-sm text-muted-foreground'>
            {t(sourceUi('handler'))}:{' '}
            {source.display?.handler ?? t(sourceUi('unavailable'))}
          </p>
          <LongText>
            {sourceReason(source.invalidatedReason || source.reason) || '—'}
          </LongText>
        </>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t(
            sourceUi(
              ctx.readonly
                ? 'readOnlyHint'
                : line.identificationStatus === 'identified'
                  ? 'alreadyIdentified'
                  : 'noSourceHint',
            ),
          )}
        </p>
      )}
      {editable && (
        <div className='flex flex-wrap gap-2'>
          {sourceActions
            .filter(
              (action) =>
                relevant(action) && ctx.capabilities?.actions[action]?.visible,
            )
            .map((action) => {
              const grant = ctx.capabilities!.actions[action],
                enabled = ctx.current && grant.enabled;
              return (
                <div key={action} className='flex min-w-0 flex-col gap-1'>
                  <Button
                    variant='outline'
                    disabled={!enabled}
                    nativeButton={enabled ? false : undefined}
                    render={
                      enabled ? (
                        <Link
                          to={{
                            pathname: `lines/${line.id}/governance/${action}`,
                            search: location.search,
                          }}
                        />
                      ) : undefined
                    }
                  >
                    {t(
                      sourceUi(
                        action === 'requestGovernance' && source
                          ? 'resubmit'
                          : action,
                      ),
                    )}
                  </Button>
                  {!enabled && (
                    <span className='text-xs text-muted-foreground'>
                      {t(
                        sourceUi(
                          ctx.current ? 'notEligible' : 'refreshBeforeAction',
                        ),
                      )}
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      )}
      <SourceHistory
        domain={ctx.domain}
        requestId={ctx.request.id}
        lineId={line.id}
      />
    </div>
  );
}
function SourceHistory({
  domain,
  requestId,
  lineId,
}: {
  domain: DemandDomain;
  requestId: string;
  lineId: string;
}) {
  const { t, i18n } = useTranslation(),
    sourceReason = useSourceReason(),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const query = useDemandQuery<SourcePage>(
    domain,
    `requests/${requestId}/lines/${lineId}/sourceHistory`,
    open,
    { page, pageSize: 10 },
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant='ghost' />}>
        {t(sourceUi('history'))}
      </CollapsibleTrigger>
      <CollapsibleContent className='flex flex-col gap-4 pt-3'>
        {query.error && (
          <SourceError error={query.error} retry={() => void query.refetch()} />
        )}
        {query.isPending && !query.error ? (
          <SourceLoading />
        ) : query.data?.data.length === 0 ? (
          <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <History />
              </EmptyMedia>
              <EmptyTitle>{t(sourceUi('historyEmpty'))}</EmptyTitle>
              <EmptyDescription>
                {t(sourceUi('historyEmptyHint'))}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          query.data?.data.map((row) => (
            <div
              key={row.id}
              className='flex flex-col gap-2 rounded-lg border p-4 text-sm'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <SourceBadge status={row.status} />
                <span>
                  {t(sourceUi('attempt'), { number: row.sourceAttempt })}
                </span>
                <time>
                  {new Date(row.updatedAt).toLocaleString(i18n.language)}
                </time>
              </div>
              <p>
                {row.inputSnapshot.originalName} · {row.inputSnapshot.quantity}{' '}
                {row.inputSnapshot.requestedUnitText}
              </p>
              {row.resolutionSnapshot && (
                <p>
                  {row.resolutionSnapshot.code} · {row.resolutionSnapshot.name}
                </p>
              )}
              <LongText>
                {sourceReason(row.invalidatedReason || row.reason) || '—'}
              </LongText>
            </div>
          ))
        )}
        {!!query.data?.meta.total && (
          <Pagination
            page={page}
            pageSize={10}
            total={query.data.meta.total}
            busy={query.isFetching}
            onPage={setPage}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
