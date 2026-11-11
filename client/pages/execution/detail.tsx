import { useState } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { FrozenReviewContext } from './review-context.js';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Plus, History, FileCheck2, MoreHorizontal } from 'lucide-react';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '#components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { formatStockQuantity } from '#lib/stock-quantity';
import {
  useExecutionQuery,
  useExecutionCan,
  useReturnFocus,
  ui,
} from './hooks.js';
import {
  Loading,
  Pagination,
  ErrorNotice,
  EmptyState,
  RecordStatus,
  RefreshButton,
  OverflowText,
} from './controls.js';
import {
  pageFor,
  lineFacts,
  isOrder,
  type ExecutionRecord,
  type Capabilities,
  type Page,
  type StoredLine,
} from './model.js';
type QuantityCell = readonly [string, string | undefined];
function quantityCells(
  line: StoredLine,
  order: boolean,
  transfer: boolean,
): QuantityCell[] {
  if (order)
    return [
      ['fulfilledQuantity', line.fulfilledQuantity],
      ['returnedQuantity', line.returnedQuantity],
      ['netExecuted', lineFacts(line).net],
      ['remainingQuantity', lineFacts(line).remaining],
      ['closedQuantity', line.closedQuantity],
    ];
  if (transfer)
    return [
      ['dispatchedQuantity', line.dispatchedQuantity],
      ['receivedQuantity', line.receivedQuantity],
      ['discrepancyQuantity', line.discrepancyQuantity],
      ['transit', lineFacts(line).transit],
      ['remainingQuantity', lineFacts(line).transferRemaining],
    ];
  return [];
}
interface Audit {
  id: string;
  operation: string;
  reason: string;
  createdAt: string;
  actor?: { name: string } | null;
}
interface Version {
  id: string;
  contentVersion: number;
  createdAt: string;
}
import { useFieldAccess } from '../../hooks/use-field-access.js';

export default function ExecutionDetail() {
  const { id: routeId, documentId } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    ownPath = useResolvedPath('.').pathname,
    // The parent detail stays mounted under the execution-document layer, and the
    // router exposes the child's `documentId` to both. Only the layer itself may
    // read it; the document behind it must keep showing its own record.
    documentRoute = /\/documents\/[^/]+$/u.test(ownPath),
    id = documentRoute ? documentId : routeId,
    config = pageFor(ownPath),
    record = useExecutionQuery<{ data: ExecutionRecord }>(
      `${config.api}/${id}`,
      {},
      !!id,
    ),
    caps = useExecutionQuery<{ data: Capabilities }>(
      `${config.api}/${id}/capabilities`,
      {},
      !!id,
    ),
    [linePage, setLinePage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [versionPage, setVersionPage] = useState(1),
    createDocument = useExecutionCan('warehouse.documents', 'create'),
    fieldAccess = useFieldAccess(),
    priceVisible =
      fieldAccess.access('execution.document.line', 'unitPrice') !== 'hidden' &&
      fieldAccess.access('execution.document.line', 'amount') !== 'hidden',
    history = useExecutionQuery<Page<Audit>>(
      `${config.api}/${id}/history`,
      { page: historyPage, pageSize: 20 },
      !!id,
    ),
    versions = useExecutionQuery<Page<Version>>(
      `${config.api}/${id}/versions`,
      { page: versionPage, pageSize: 20 },
      !!id,
    ),
    reserve = useExecutionCan('warehouse.inventory', 'reserve'),
    reverse = useExecutionCan('warehouse.documents', 'reverse'),
    row = record.data?.data,
    terminal =
      record.error instanceof ApiClientError &&
      [401, 403, 404].includes(record.error.status);
  useReturnFocus(ownPath, `${config.page}-detail-refresh`);
  const link = (path: string) => ({ pathname: path, search: location.search }),
    enabled = (action: string) => caps.data?.data.actions[action]?.visible,
    actionButton = (action: string) => (
      <Button
        key={action}
        variant={
          ['submit', 'post', 'start', 'approve'].includes(action)
            ? 'default'
            : 'outline'
        }
        nativeButton={false}
        disabled={!caps.data?.data.actions[action]?.enabled || caps.isFetching}
        render={<Link to={link(`actions/${action}`)} />}
      >
        {t(ui(`actions.${action}`))}
      </Button>
    );
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          {record.isPending ? (
            <Loading kind='detail' />
          ) : record.error && (!row || terminal) ? (
            <ErrorNotice
              error={record.error}
              retry={() => void record.refetch()}
            />
          ) : row ? (
            <>
              <PageHeader
                title={row.code}
                description={
                  row.kind
                    ? t(ui(`kinds.${row.kind}`))
                    : t(ui(`titles.${config.kind}`))
                }
                actions={
                  <>
                    <RefreshButton
                      busy={
                        record.isFetching ||
                        caps.isFetching ||
                        history.isFetching ||
                        versions.isFetching
                      }
                      onClick={() => {
                        void record.refetch();
                        void caps.refetch();
                        void history.refetch();
                        void versions.refetch();
                      }}
                    />
                    {enabled('update') && (
                      <Button
                        variant='outline'
                        disabled={!caps.data?.data.actions.update.enabled}
                        nativeButton={false}
                        render={<Link to={link('edit')} />}
                      >
                        {t(ui('edit'))}
                      </Button>
                    )}
                    {['submit', 'start', 'post', 'approve']
                      .filter(enabled)
                      .map(actionButton)}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant='outline'
                            size='icon'
                            aria-label={t(ui('rowActions'), { name: row.code })}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='w-auto min-w-40'
                      >
                        {['return', 'withdraw', 'revise', 'reassign', 'copy']
                          .filter(enabled)
                          .map((action) => (
                            <DropdownMenuItem
                              key={action}
                              disabled={
                                !caps.data?.data.actions[action].enabled
                              }
                              render={
                                <Link
                                  to={link(
                                    action === 'copy'
                                      ? 'copy'
                                      : `actions/${action}`,
                                  )}
                                />
                              }
                            >
                              {t(ui(`actions.${action}`))}
                            </DropdownMenuItem>
                          ))}
                        {enabled('closeRemainder') && (
                          <DropdownMenuItem
                            disabled={
                              !caps.data?.data.actions.closeRemainder.enabled
                            }
                            render={
                              <Link to={link('actions/closeRemainder')} />
                            }
                          >
                            {t(ui('closeRemainder'))}
                          </DropdownMenuItem>
                        )}
                        {enabled('cancel') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant='destructive'
                              disabled={!caps.data?.data.actions.cancel.enabled}
                              render={<Link to={link('actions/cancel')} />}
                            >
                              {t(ui('actions.cancel'))}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
              {record.error && (
                <ErrorNotice
                  error={record.error}
                  retry={() => void record.refetch()}
                />
              )}
              {caps.error && (
                <ErrorNotice
                  error={caps.error}
                  retry={() => void caps.refetch()}
                />
              )}
              <div className='flex flex-wrap items-center gap-3'>
                <RecordStatus status={row.status} />
                {row.status === 'posted' && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('postedHint'))}
                  </p>
                )}
              </div>
              {config.kind === 'stockCounts' &&
                ['counting', 'pending'].includes(row.status) && (
                  <Alert>
                    <AlertDescription>{t(ui('freezeHint'))}</AlertDescription>
                  </Alert>
                )}
              <Card>
                <CardHeader>
                  <CardTitle>{t(ui('details'))}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className='grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3'>
                    {[
                      ['company', row.display.company?.name],
                      ['warehouse', row.display.warehouse?.name],
                      ...(config.kind === 'stockTransfers'
                        ? [
                            [
                              'destinationWarehouse',
                              row.display.destinationWarehouse?.name,
                            ],
                          ]
                        : []),
                      ...(isOrder(config)
                        ? [
                            [
                              config.kind === 'purchaseOrders'
                                ? 'supplier'
                                : 'customer',
                              row.display.partner?.name,
                            ],
                            ['currency', row.currency],
                            ['deliveryOn', row.deliveryOn],
                            ['deliveryTerms', row.deliveryTerms],
                            [
                              'sourceChannel',
                              t(
                                ui(
                                  `sourceChannel_${row.sourceChannel ?? 'manual'}`,
                                ),
                              ),
                            ],
                          ]
                        : []),
                      ['occurredOn', row.occurredOn],
                      ...(row.baselineAt
                        ? [
                            [
                              'baselineAt',
                              new Date(row.baselineAt).toLocaleString(
                                i18n.language,
                              ),
                            ],
                          ]
                        : []),
                      ...(row.display.issueRequest
                        ? [
                            ['issueRequest', row.display.issueRequest.code],
                            ['recipient', row.display.recipient?.name],
                          ]
                        : []),
                      ['reason', row.reason],
                      ['notes', row.notes],
                      ...(row.initializationReference
                        ? [
                            [
                              'initializationReference',
                              row.initializationReference,
                            ],
                          ]
                        : []),
                      ...(row.lossEvidence
                        ? [['lossEvidence', row.lossEvidence]]
                        : []),
                      ...(row.inspectionEvidence
                        ? [['inspectionEvidence', row.inspectionEvidence]]
                        : []),
                      ...(row.evidence ? [['evidence', row.evidence]] : []),
                      ...(row.productionEvidence
                        ? [
                            [
                              'productionReference',
                              row.productionEvidence.reference,
                            ],
                            ['productionTitle', row.productionEvidence.title],
                            [
                              'productionDescription',
                              row.productionEvidence.description,
                            ],
                          ]
                        : []),
                    ].map(([label, value]) => (
                      <div key={label} className='min-w-0'>
                        <dt className='text-sm text-muted-foreground'>
                          {t(ui(label!))}
                        </dt>
                        <dd className='mt-1 whitespace-pre-wrap break-words text-sm'>
                          {value || '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-baseline justify-between gap-4'>
                    <span>{t(ui('lines'))}</span>
                    {isOrder(config) && row.totalAmount ? (
                      <span className='text-sm font-normal text-muted-foreground'>
                        {t(ui('totalAmount'))}: {row.totalAmount} {row.currency}
                      </span>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className='grid min-w-0 gap-4'>
                  {row.linesRestricted ? (
                    <EmptyState type='restricted' />
                  ) : !row.lines.length ? (
                    <EmptyState
                      type={
                        config.kind === 'stockCounts' ? 'noCount' : 'noLines'
                      }
                    />
                  ) : (
                    <div className='overflow-hidden rounded-lg border'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[
                              'material',
                              ...(config.kind === 'stockCounts'
                                ? [
                                    'baselineQuantity',
                                    'countedQuantity',
                                    'reason',
                                  ]
                                : ['quantity', 'baseQuantity']),
                              ...(isOrder(config)
                                ? [
                                    ...(priceVisible
                                      ? ['unitPrice', 'amount']
                                      : []),
                                    'fulfilledQuantity',
                                    'returnedQuantity',
                                    'netExecuted',
                                    'remainingQuantity',
                                    'closedQuantity',
                                  ]
                                : []),
                              ...(config.kind === 'stockTransfers'
                                ? [
                                    'dispatchedQuantity',
                                    'receivedQuantity',
                                    'discrepancyQuantity',
                                    'transit',
                                    'remainingQuantity',
                                  ]
                                : []),
                              ...(row.kind ? ['quality'] : []),
                            ].map((field) => (
                              <TableHead key={field}>{t(ui(field))}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {row.lines
                            .slice((linePage - 1) * 50, linePage * 50)
                            .map((line) => (
                              <TableRow key={line.id}>
                                <TableCell className='max-w-sm'>
                                  <p className='font-medium'>
                                    {line.materialSnapshot.name ?? '—'}
                                  </p>
                                  <p className='mt-1 text-xs text-muted-foreground'>
                                    {line.materialSnapshot.code} ·{' '}
                                    {Object.values(
                                      line.materialSnapshot.attributeValues ??
                                        {},
                                    ).join(' · ')}
                                  </p>
                                  {line.sourceSnapshot && (
                                    <Link
                                      className='mt-1 block text-xs text-primary underline-offset-4 hover:underline'
                                      to={link(
                                        `related/${line.sourceSnapshot.id}`,
                                      )}
                                    >
                                      {line.sourceSnapshot.code}
                                    </Link>
                                  )}
                                </TableCell>
                                {config.kind === 'stockCounts' ? (
                                  <>
                                    <TableCell className='tabular-nums'>
                                      {formatStockQuantity(
                                        line.baselineQuantity ?? '0',
                                        i18n.language,
                                      )}{' '}
                                      {line.materialSnapshot.baseUnitName}
                                    </TableCell>
                                    <TableCell className='tabular-nums'>
                                      {line.actualQuantity === null ||
                                      line.actualQuantity === undefined
                                        ? '—'
                                        : formatStockQuantity(
                                            line.actualQuantity,
                                            i18n.language,
                                          )}{' '}
                                      {line.materialSnapshot.baseUnitName}
                                    </TableCell>
                                    <TableCell>
                                      <OverflowText
                                        text={line.reason ?? '—'}
                                        className='block max-w-xs truncate'
                                      />
                                    </TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell className='whitespace-nowrap tabular-nums'>
                                      {formatStockQuantity(
                                        line.quantity,
                                        i18n.language,
                                      )}{' '}
                                      {line.materialSnapshot.unitName}
                                    </TableCell>
                                    <TableCell className='whitespace-nowrap tabular-nums'>
                                      {formatStockQuantity(
                                        line.baseQuantity,
                                        i18n.language,
                                      )}{' '}
                                      {line.materialSnapshot.baseUnitName}
                                    </TableCell>
                                  </>
                                )}
                                {isOrder(config) && priceVisible && (
                                  <TableCell className='tabular-nums'>
                                    {line.unitPrice ?? '—'} {row.currency}
                                  </TableCell>
                                )}
                                {isOrder(config) && priceVisible && (
                                  <TableCell className='tabular-nums'>
                                    {line.amount ?? '—'} {row.currency}
                                  </TableCell>
                                )}
                                {quantityCells(
                                  line,
                                  isOrder(config),
                                  config.kind === 'stockTransfers',
                                ).map(([field, value]) => (
                                  <TableCell
                                    key={field}
                                    className='whitespace-nowrap tabular-nums'
                                  >
                                    {value === undefined
                                      ? '—'
                                      : formatStockQuantity(
                                          value,
                                          i18n.language,
                                        )}{' '}
                                    {line.materialSnapshot.baseUnitName}
                                  </TableCell>
                                ))}
                                {row.kind && (
                                  <TableCell>
                                    {t(
                                      ui(
                                        `qualities.${line.quality ?? 'qualified'}`,
                                      ),
                                    )}
                                  </TableCell>
                                )}
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {row.lines.length > 50 && (
                    <Pagination
                      page={linePage}
                      pageSize={50}
                      total={row.lines.length}
                      onPage={setLinePage}
                    />
                  )}
                  {config.kind === 'purchaseOrders' && (
                    <p className='text-sm text-muted-foreground'>
                      {t(ui('demandSource'))}
                      {': '}
                      {row.demandMode === 'temporary'
                        ? `${t(ui('demandTemporary'))}${row.temporaryReason ? ` · ${row.temporaryReason}` : ''}`
                        : row.demandMode === 'request'
                          ? t(ui('demandFromRequest'))
                          : t(ui('demandUnset'))}
                    </p>
                  )}
                  {row.demand && (
                    <section className='grid gap-3'>
                      <h3 className='text-sm font-medium'>
                        {t(ui('demandSource'))}
                      </h3>
                      {row.demand.mode === 'temporary' ? (
                        <p className='text-sm'>
                          {t(ui('demandTemporary'))}
                          {row.demand.temporaryReason
                            ? ` · ${row.demand.temporaryReason}`
                            : ''}
                        </p>
                      ) : row.demand.items.length ? (
                        row.demand.items.map((item) => (
                          <div
                            key={`${item.requestId}:${item.requestLineId}`}
                            className='flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm'
                          >
                            <span>
                              <Link
                                to={`/functions/requisitions/requests/${item.requestId}`}
                                className='text-primary underline-offset-4 hover:underline'
                              >
                                {item.requestCode ?? item.requestId}
                              </Link>
                              {item.materialName
                                ? ` · ${item.materialName}`
                                : ''}
                            </span>
                            <span className='tabular-nums'>
                              {t(ui('demandReceivedOnDocument'), {
                                received: formatStockQuantity(
                                  item.receivedBaseQuantity,
                                  i18n.language,
                                ),
                                allocated: formatStockQuantity(
                                  item.allocatedBaseQuantity,
                                  i18n.language,
                                ),
                              })}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          {t(ui('demandNoSource'))}
                        </p>
                      )}
                    </section>
                  )}
                  {row.allocations && (
                    <section className='grid gap-3'>
                      <h3 className='text-sm font-medium'>
                        {t(ui('allocations'))}
                      </h3>
                      {row.allocations.restricted ? (
                        <EmptyState type='restricted' />
                      ) : (
                        row.allocations.items
                          .filter((item) => item.status === 'active')
                          .map((item) => (
                            <div
                              key={item.id}
                              className='flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm'
                            >
                              <Link
                                to={link(`related/${item.id}`)}
                                className='text-primary underline-offset-4 hover:underline'
                              >
                                {item.source.code} ·{' '}
                                {item.source.materialSnapshot.name}
                              </Link>
                              <span className='tabular-nums'>
                                {formatStockQuantity(
                                  item.baseQuantity,
                                  i18n.language,
                                )}{' '}
                                {item.source.materialSnapshot.baseUnitName}
                              </span>
                            </div>
                          ))
                      )}
                    </section>
                  )}
                  {config.kind === 'salesOrders' &&
                    row.status === 'approved' &&
                    reserve.can && (
                      <div>
                        <Button
                          variant='outline'
                          nativeButton={false}
                          render={<Link to={link('reserve')} />}
                        >
                          {t(ui('reserve'))}
                        </Button>
                      </div>
                    )}
                  {config.kind === 'stockTransfers' &&
                    row.status === 'approved' && (
                      <div className='flex flex-wrap gap-2'>
                        {['dispatch', 'receive', 'discrepancy']
                          .filter(enabled)
                          .map((action) => (
                            <Button
                              key={action}
                              variant='outline'
                              disabled={
                                !caps.data?.data.actions[action].enabled
                              }
                              nativeButton={false}
                              render={<Link to={link(`${action}/new`)} />}
                            >
                              <Plus />
                              {t(ui(`actions.${action}`))}
                            </Button>
                          ))}
                      </div>
                    )}
                  {isOrder(config) &&
                    row.status === 'approved' &&
                    createDocument.can && (
                      <div>
                        <Button
                          variant='outline'
                          nativeButton={false}
                          render={
                            <Link
                              to={link(
                                config.kind === 'purchaseOrders'
                                  ? 'receipts/new'
                                  : 'shipments/new',
                              )}
                            />
                          }
                        >
                          <Plus />
                          {t(
                            ui(
                              `kinds.${config.kind === 'purchaseOrders' ? 'purchaseReceipt' : 'salesShipment'}`,
                            ),
                          )}
                        </Button>
                      </div>
                    )}
                  {row.status === 'posted' &&
                    createDocument.can &&
                    ['purchaseReceipt', 'salesShipment', 'issue'].includes(
                      row.kind ?? '',
                    ) && (
                      <div>
                        <Button
                          variant='outline'
                          nativeButton={false}
                          render={<Link to={link('returns/new')} />}
                        >
                          {t(ui('createReturn'))}
                        </Button>
                      </div>
                    )}
                  {row.status === 'posted' &&
                    row.kind &&
                    row.kind !== 'reversal' &&
                    reverse.can && (
                      <div>
                        <Button
                          variant='outline'
                          nativeButton={false}
                          render={<Link to={link('reversal/new')} />}
                        >
                          {t(ui('actions.reverse'))}
                        </Button>
                      </div>
                    )}
                </CardContent>
              </Card>
              <RelatedDocuments row={row} config={config} />
              <FrozenReviewContext context={row.review} />
              <div className='grid items-start gap-6 lg:grid-cols-2'>
                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <History className='size-4' />
                      {t(ui('history'))}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {history.isPending ? (
                      <Loading />
                    ) : history.error ? (
                      <ErrorNotice
                        error={history.error}
                        retry={() => void history.refetch()}
                      />
                    ) : history.data?.data.length ? (
                      <ol className='space-y-5'>
                        {history.data.data.map((item) => (
                          <li
                            key={item.id}
                            className='border-b pb-4 last:border-b-0 last:pb-0'
                          >
                            <p className='text-sm font-medium'>
                              {t(ui(`actions.${item.operation}`), {
                                defaultValue: t(
                                  ui(
                                    item.operation === 'create'
                                      ? 'saved'
                                      : 'edit',
                                  ),
                                ),
                              })}{' '}
                              · {item.actor?.name ?? '—'}
                            </p>
                            <p className='mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground'>
                              {item.reason || '—'}
                            </p>
                            <time className='mt-1 block text-xs text-muted-foreground'>
                              {new Date(item.createdAt).toLocaleString(
                                i18n.language,
                              )}
                            </time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <EmptyState type='noHistory' />
                    )}
                    {!!history.data?.meta.total && (
                      <Pagination
                        page={historyPage}
                        pageSize={20}
                        total={history.data.meta.total}
                        onPage={setHistoryPage}
                        busy={history.isFetching}
                      />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <FileCheck2 className='size-4' />
                      {t(ui('versions'))}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {versions.isPending ? (
                      <Loading />
                    ) : versions.error ? (
                      <ErrorNotice
                        error={versions.error}
                        retry={() => void versions.refetch()}
                      />
                    ) : versions.data?.data.length ? (
                      <ul className='space-y-3'>
                        {versions.data.data.map((version) => (
                          <li key={version.id}>
                            <Link
                              className='text-sm text-primary underline-offset-4 hover:underline'
                              to={link(`versions/${version.id}`)}
                            >
                              {t(ui('versionNumber'), {
                                version: version.contentVersion,
                              })}
                            </Link>
                            <p className='text-xs text-muted-foreground'>
                              {new Date(version.createdAt).toLocaleString(
                                i18n.language,
                              )}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState type='noVersions' />
                    )}
                    {!!versions.data?.meta.total && (
                      <Pagination
                        page={versionPage}
                        pageSize={20}
                        total={versions.data.meta.total}
                        onPage={setVersionPage}
                        busy={versions.isFetching}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}

function RelatedDocuments({
  row,
  config,
}: {
  row: ExecutionRecord;
  config: import('./model.js').ExecutionPage;
}) {
  const { t } = useTranslation(),
    location = useLocation(),
    read = useExecutionCan('warehouse.documents', 'read'),
    [page, setPage] = useState(1),
    field =
      config.kind === 'purchaseOrders'
        ? 'purchaseOrderId'
        : config.kind === 'salesOrders'
          ? 'salesOrderId'
          : config.kind === 'stockTransfers'
            ? 'transferId'
            : 'originalDocumentId',
    result = useExecutionQuery<Page<ExecutionRecord>>(
      'warehouse/documents',
      { subjectId: row.subjectId, [field]: row.id, page, pageSize: 10 },
      read.can && config.kind !== 'stockCounts',
    );
  if (config.kind === 'stockCounts' || !read.can) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(ui('executionDocuments'))}</CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {result.error ? (
          <ErrorNotice
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : result.isPending ? (
          <Loading />
        ) : !result.data?.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t(ui('noExecutionDocuments'))}
          </p>
        ) : (
          <ul className='grid gap-3'>
            {result.data.data.map((document) => (
              <li
                key={document.id}
                className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm'
              >
                <Link
                  className='text-primary underline-offset-4 hover:underline'
                  to={{
                    pathname: `documents/${document.id}`,
                    search: location.search,
                  }}
                >
                  {document.code} · {t(ui(`kinds.${document.kind}`))}
                </Link>
                <RecordStatus status={document.status} />
              </li>
            ))}
          </ul>
        )}
        {!!result.data?.meta.total && (
          <Pagination
            page={page}
            pageSize={10}
            total={result.data.meta.total}
            onPage={setPage}
            busy={result.isFetching}
          />
        )}
      </CardContent>
    </Card>
  );
}
