import { DemandAttachments } from '#components/demand-attachments/index';
import {
  DemandGovernance,
  DemandGovernanceLine,
} from '#components/demand-governance/index';
import { useState } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { LongText } from '#components/long-text';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { formatStockQuantity } from '#lib/stock-quantity';
import { ReviewAudit } from '#components/review-audit';
import {
  ui,
  useRequest,
  useCapabilities,
  usePurchaseQuery,
  usePurchaseRefresh,
  usePurchaseError,
  usePurchaseReturnFocus,
  useProgress,
} from '../hooks.js';
import {
  Loading,
  ErrorNotice,
  PurchaseStatus,
  Identification,
  RefreshButton,
  Pagination,
} from '../controls.js';
import {
  transitions,
  type Page,
  type Audit,
  type PurchaseRequest,
  type StoredLine,
  type Submission,
  type Action,
} from '../model.js';
export interface DetailContext {
  recordId: string;
  readonly: boolean;
}
export default function RequestDetail() {
  const { t } = useTranslation(),
    { requestId, relatedId } = useParams(),
    ownPath = useResolvedPath('.').pathname,
    related = ownPath.includes('/related/'),
    location = useLocation(),
    message = usePurchaseError(),
    refresh = usePurchaseRefresh();
  const source = useRequest(requestId),
    linked =
      !related ||
      !!source.data?.data.display.relatedRequests.some(
        (r) => r.id === relatedId,
      ),
    id = related ? relatedId : requestId;
  usePurchaseReturnFocus(ownPath, `purchase-detail-title-${id}`);
  const data = useRequest(linked ? id : undefined),
    caps = useCapabilities(!related ? id : undefined),
    row = data.data?.data;
  const terminal =
    data.error instanceof ApiClientError &&
    [401, 403, 404].includes(data.error.status);
  const error = data.error ?? source.error ?? caps.error;
  const actionKey = (action: string) =>
    action === 'update'
      ? 'edit'
      : action === 'cancel'
        ? 'cancelRequest'
        : action;
  const capsFor = (action: Action) => {
    const cap = caps.data?.data.actions[action];
    const current =
      !!row &&
      caps.data?.data.recordRevision === row.revision &&
      caps.data?.data.lifecycleVersion === row.lifecycleVersion;
    const enabled = !caps.error && !!cap?.enabled && current;
    const hint =
      cap?.visible && !enabled
        ? !current && caps.isFetching
          ? t(ui('loading'))
          : cap.reason && current
            ? message(
                new ApiClientError('Unavailable', {
                  status: 400,
                  reason: cap.reason,
                  method: 'GET',
                  url: '/procurement/requests',
                }),
              )
            : t(ui('conflict'))
        : undefined;
    return { cap, enabled, hint };
  };
  const operation = (action: Action) => {
    const { cap, enabled, hint } = capsFor(action);
    if (!cap?.visible) return null;
    const href =
      action === 'update'
        ? 'edit'
        : action === 'copy'
          ? 'copy'
          : `actions/${action}`;
    return (
      <div key={action} className='flex min-w-0 flex-col gap-1'>
        <Button
          disabled={!enabled}
          title={hint}
          variant={
            enabled && (action === 'submit' || action === 'approve')
              ? 'default'
              : 'outline'
          }
          nativeButton={enabled ? false : undefined}
          render={
            enabled ? (
              <Link to={{ pathname: href, search: location.search }} />
            ) : undefined
          }
        >
          {t(ui(actionKey(action)))}
        </Button>
      </div>
    );
  };
  const actionHints =
    related || caps.isFetching || caps.error
      ? []
      : [
          ...new Set(
            (['update', ...transitions, 'copy'] as Action[])
              .map((action) => capsFor(action).hint)
              .filter((hint): hint is string => !!hint),
          ),
        ];
  const title = row ? `${t(ui('title'))} ${row.code}` : t(ui('title'));
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={
            <span
              id={`purchase-detail-title-${id}`}
              tabIndex={-1}
              className='focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]'
            >
              {title}
            </span>
          }
          actions={
            row && !terminal ? (
              <RefreshButton
                busy={data.isFetching || caps.isFetching}
                onClick={() => void refresh()}
              />
            ) : undefined
          }
        />
        {error && (
          <ErrorNotice
            error={error}
            retry={() => {
              void data.refetch();
              void source.refetch();
            }}
          />
        )}
        {related && !linked && source.data ? (
          <p>{t(ui('relatedUnavailable'))}</p>
        ) : !row && !error ? (
          <Loading kind='detail' />
        ) : row && !terminal ? (
          <div className='flex flex-col gap-6'>
            {!related && (
              <div className='grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                {(['update', ...transitions, 'copy'] as Action[]).map(
                  operation,
                )}
              </div>
            )}
            {actionHints.length > 0 && (
              <ul className='flex flex-col gap-1 text-xs text-muted-foreground'>
                {actionHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            )}
            <div className='flex flex-wrap items-center gap-3'>
              <PurchaseStatus state={row.status} />
              <Identification value={row.identificationStatus} />
            </div>
            {related && (
              <p className='text-sm text-muted-foreground'>
                {t(ui('relatedReadOnly'))}
              </p>
            )}
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>{t(ui('detail'))}</h2>
              <RequestInformation row={row} />
            </section>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>{t(ui('lines'))}</h2>
              <DemandGovernance
                domain='procurement'
                request={row}
                readonly={related}
              >
                <DemandLines lines={row.lines} />
              </DemandGovernance>
            </section>
            {!related && <RequestProgress row={row} />}
            <DemandAttachments
              domain='procurement'
              requestId={row.id}
              value={row.attachments ?? []}
              lines={row.lines.map((line) => ({
                id: line.id,
                label: t(ui('lineTitle'), { number: line.lineNo }),
              }))}
            />
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>{t(ui('submission'))}</h2>
              {row.versions.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  {t(ui('noSubmission'))}
                </p>
              ) : (
                <div className='flex flex-col gap-4'>
                  {row.versions.map((version) => (
                    <div
                      key={version.id}
                      className='flex flex-col gap-4 rounded-lg border p-4'
                    >
                      <Link
                        className='text-primary underline underline-offset-4'
                        to={{
                          pathname: `versions/${version.id}`,
                          search: location.search,
                        }}
                      >
                        {t(ui('viewVersion'))} {version.contentVersion}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <ReviewAudit
              tasks={row.reviewTasks}
              accounts={row.display.accounts}
              versionNumber={(versionId) =>
                row.versions.find((version) => version.id === versionId)
                  ?.contentVersion
              }
              ruleRevision={(versionId) => {
                const sources = row.versions.find(
                  (version) => version.id === versionId,
                )?.payload?.parameterSnapshot?.sources;
                return sources
                  ? Object.values(sources)[0]?.revision
                  : undefined;
              }}
            />
            <History requestId={row.id} recent={row.recentHistory} />
          </div>
        ) : null}
      </PageContainer>
      <Outlet
        context={
          { recordId: id ?? '', readonly: related } satisfies DetailContext
        }
      />
    </RouteChildPage>
  );
}
export function RequestInformation({
  row,
  snapshot,
}: {
  row: PurchaseRequest;
  snapshot?: Submission;
}) {
  const { t, i18n } = useTranslation(),
    head = snapshot?.payload.head ?? row,
    refs = snapshot
      ? {
          company: snapshot.payload.company,
          requester: snapshot.payload.requester,
          unit: snapshot.payload.unit,
          supplier: undefined,
        }
      : row.display;
  return (
    <dl className='flex flex-col gap-4'>
      {[
        ['company', refs.company?.name],
        ['requester', refs.requester?.name],
        ['unit', refs.unit?.name],
        [
          'businessDate',
          head.businessDate
            ? new Date(`${head.businessDate}T12:00:00`).toLocaleDateString(
                i18n.language,
              )
            : '',
        ],
        [
          'sourceChannel',
          t(ui(`sourceChannel_${head.sourceChannel ?? 'manual'}`)),
        ],
        [
          'neededOn',
          head.neededOn
            ? new Date(`${head.neededOn}T12:00:00`).toLocaleDateString(
                i18n.language,
              )
            : '',
        ],
        [
          'supplier',
          snapshot
            ? (
                head.supplierSnapshot as
                  { identity?: { name?: string } } | undefined
              )?.identity?.name
            : row.display.supplier?.name,
        ],
        ['usage', head.usage],
        ['notes', head.notes],
      ].map(([key, value]) => (
        <div
          key={key}
          className='grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4'
        >
          <dt className='text-sm text-muted-foreground'>{t(ui(key!))}</dt>
          <dd className='text-sm break-words'>
            {value ? (
              <LongText>{String(value)}</LongText>
            ) : snapshot &&
              (['company', 'requester', 'unit'].includes(key!) ||
                (key === 'supplier' && head.suggestedSupplierId)) ? (
              t(ui('nameNotRecorded'))
            ) : (
              '—'
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function DemandLines({ lines }: { lines: StoredLine[] }) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-4'>
      {lines.map((line, i) => (
        <div
          key={line.id}
          className='flex flex-col gap-4 rounded-lg border p-4'
        >
          <div className='flex flex-wrap gap-2'>
            <h3 className='font-medium'>
              {t(ui('lineTitle'), { number: i + 1 })}
            </h3>
            {line.status === 'cancelled' ? (
              <span className='text-sm text-muted-foreground'>
                {t(ui('lineCancelled'))}
              </span>
            ) : (
              <Identification value={line.identificationStatus} />
            )}
          </div>
          <dl className='flex flex-col gap-4 text-sm'>
            {[
              ['materialCode', line.materialSnapshot?.code],
              ['standardName', line.materialSnapshot?.standardName],
              [
                'specification',
                line.materialSnapshot?.name ?? line.originalSpecification,
              ],
              ['originalName', line.originalName],
              ['quantity', line.requestedQuantity],
              [
                'requestedUnit',
                line.materialSnapshot?.unitName ?? line.requestedUnitText,
              ],
              [
                'packaging',
                line.numeratorSnapshot
                  ? `${line.numeratorSnapshot}/${line.denominatorSnapshot}`
                  : '',
              ],
              [
                'baseQuantity',
                line.baseQuantity
                  ? `${line.baseQuantity} ${line.materialSnapshot?.baseUnitName ?? ''}`
                  : '',
              ],
              ['lineUsage', line.usage],
              ['lineNotes', line.notes],
            ].map(([key, value]) => (
              <div
                key={key}
                className='grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4'
              >
                <dt className='text-muted-foreground'>{t(ui(key!))}</dt>
                <dd>{value ? <LongText>{value}</LongText> : '—'}</dd>
              </div>
            ))}
          </dl>
          <DemandGovernanceLine line={line} />
        </div>
      ))}
    </div>
  );
}
function History({
  requestId,
  recent,
}: {
  requestId: string;
  recent?: Audit[];
}) {
  const { t, i18n } = useTranslation(),
    [page, setPage] = useState(1),
    result = usePurchaseQuery<Page<Audit>>(`requests/${requestId}/history`, {
      page,
      pageSize: 20,
    });
  const fresh =
    page === 1 &&
    recent?.[0] &&
    !result.data?.data.some((a) => a.id === recent[0].id)
      ? recent
      : [];
  const rows = [...(fresh ?? []), ...(result.data?.data ?? [])].slice(0, 20);
  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-base font-medium'>{t(ui('history'))}</h2>
      {result.error ? (
        <ErrorNotice error={result.error} retry={() => void result.refetch()} />
      ) : result.isPending ? (
        <Loading kind='detail' />
      ) : !rows.length ? (
        <p className='text-sm text-muted-foreground'>{t(ui('noHistory'))}</p>
      ) : (
        <>
          <div className='flex flex-col gap-4'>
            {rows.map((item) => (
              <div
                key={item.id}
                className='flex flex-col gap-2 rounded-lg border p-4 text-sm'
              >
                <p className='font-medium'>
                  {t(
                    ui(
                      item.operation === 'create'
                        ? 'createTitle'
                        : item.operation === 'copy'
                          ? 'copiedAudit'
                          : item.operation === 'update'
                            ? 'edit'
                            : item.operation === 'cancel'
                              ? 'cancelRequest'
                              : item.operation,
                    ),
                  )}{' '}
                  · {item.actor?.name ?? t(ui('unavailable'))} ·{' '}
                  {new Date(item.createdAt).toLocaleString(i18n.language)}
                </p>
                <LongText>
                  {item.reason === 'create' ? '—' : item.reason}
                </LongText>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            total={(result.data?.meta.total ?? 0) + (fresh?.length ?? 0)}
            onPage={setPage}
            busy={result.isFetching}
          />
        </>
      )}
    </section>
  );
}

function RequestProgress({ row }: { row: PurchaseRequest }) {
  const { t, i18n } = useTranslation(),
    progress = useProgress(row.id),
    data = progress.data?.data,
    byLine = new Map((data?.lines ?? []).map((line) => [line.lineId, line]));
  if (progress.isPending) return null;
  if (!data) return null;
  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-base font-medium'>{t(ui('progress'))}</h2>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(ui('material'))}</TableHead>
              <TableHead className='text-right'>
                {t(ui('requestedQuantity'))}
              </TableHead>
              <TableHead className='text-right'>
                {t(ui('orderedQuantity'))}
              </TableHead>
              <TableHead className='text-right'>
                {t(ui('receivedQuantity'))}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.lines.map((line) => {
              const item = byLine.get(line.id),
                unit = line.materialSnapshot?.baseUnitName ?? '';
              return (
                <TableRow key={line.id}>
                  <TableCell>
                    {line.materialSnapshot?.name ?? line.originalName}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatStockQuantity(
                      item?.baseQuantity ?? line.baseQuantity ?? '0',
                      i18n.language,
                    )}{' '}
                    {unit}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatStockQuantity(
                      item?.orderedBaseQuantity ?? '0',
                      i18n.language,
                    )}{' '}
                    {unit}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatStockQuantity(
                      item?.receivedBaseQuantity ?? '0',
                      i18n.language,
                    )}{' '}
                    {unit}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className='text-sm text-muted-foreground'>
        {t(ui('progressTotals'), {
          ordered: formatStockQuantity(
            data.totals.orderedBaseQuantity,
            i18n.language,
          ),
          received: formatStockQuantity(
            data.totals.receivedBaseQuantity,
            i18n.language,
          ),
        })}
      </p>
    </section>
  );
}
