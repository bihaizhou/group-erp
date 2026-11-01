import { useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { randomUuid } from '#lib/random-id';
import { RouteDialog } from '#components/route-dialog';
import { ActionConfirmation } from '#components/action-confirmation';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import { formatStockQuantity } from '#lib/stock-quantity';
import {
  useExecutionQuery,
  useExecutionCan,
  useExecutionRefresh,
  useRequestKey,
  useLeaveGuard,
  ui,
} from './hooks.js';
import {
  ReferencePicker,
  StaticSelect,
  Loading,
  ErrorNotice,
  EmptyState,
} from './controls.js';
import type { Choice, ExecutionRecord, Source, Page } from './model.js';
import type { InventoryRow } from './inventory.js';
const base = 'warehouse/inventory';
export default function InventoryReservation() {
  const { id, reservationId } = useParams(),
    location = useLocation(),
    ownPath = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    { t, i18n } = useTranslation(),
    api = useApiClient(),
    toast = useToaster(),
    refresh = useExecutionRefresh(),
    request = useRequestKey(),
    release = !!reservationId;
  const can = useExecutionCan(
      'warehouse.inventory',
      release ? 'release' : 'reserve',
    ),
    order = useExecutionQuery<{ data: ExecutionRecord }>(
      `sales/orders/${id}`,
      {},
      !!id && !release,
    ),
    reservation = useExecutionQuery<{ data: InventoryRow }>(
      `${base}/reservations/${reservationId}`,
      {},
      release,
    ),
    params = new URLSearchParams(location.search);
  const [companyId, setCompanyId] = useState(params.get('subjectId') ?? ''),
    [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? ''),
    [kind, setKind] = useState('issue'),
    [selected, setSelected] = useState<Source>(),
    [lineId, setLineId] = useState(''),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState(''),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>(),
    [conflicted, setConflicted] = useState(false),
    [committed, setCommitted] = useState(false),
    [reservationIdentity] = useState(randomUuid),
    lockRef = useRef(false);
  const sourceKind = id ? 'salesShipment' : kind,
    subject =
      reservation.data?.data.subjectId ??
      order.data?.data.subjectId ??
      companyId,
    warehouse =
      reservation.data?.data.warehouseId ??
      order.data?.data.warehouseId ??
      warehouseId,
    sourceId = id ?? selected?.id ?? '';
  const source = useExecutionQuery<Page<Source>>(
      `${base}/sourceOptions`,
      {
        subjectId: subject,
        warehouseId: warehouse,
        kind: sourceKind,
        sourceId,
        page: 1,
        pageSize: 1,
      },
      !release && !!subject && !!warehouse && !!sourceId && can.can,
    ),
    current = source.data?.data[0],
    line = current?.lines.find((value) => value.id === lineId),
    available = release
      ? reservation.data?.data.remainingQuantity
      : line?.remainingQuantity;
  const company = useExecutionQuery<{ data: Choice }>(
      `${base}/companies/${subject}`,
      {},
      !!subject && can.can,
    ),
    warehouseRef = useExecutionQuery<{ data: Choice }>(
      `${base}/warehouses/${warehouse}`,
      { subjectId: subject },
      !!subject && !!warehouse && can.can,
    );
  const guard = useLeaveGuard(
      !committed && !!(selected || lineId || quantity || reason),
      busy,
      ownPath,
    ),
    back = { pathname: '..', search: location.search },
    label = t(ui(release ? 'release' : 'reserve'));
  const finish = async () => {
    if (release)
      await api.request({ path: `${base}/reservations/${reservationId}` });
    else
      await api.request({
        path: base,
        query: {
          subjectId: subject,
          warehouseId: warehouse,
          page: 1,
          pageSize: 1,
        },
      });
    // Close as soon as the write is confirmed: awaiting the refetch keeps the
    // committed dialog on screen while every parent query reloads.
    void refresh();
    guard.complete();
    void navigate(back, { relative: 'route', replace: true });
  };
  const post = async () => {
    if (lockRef.current || committed || conflicted) return false;
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const body = release
        ? {
            quantity,
            version: reservation.data!.data.revision,
            reason: reason.trim(),
          }
        : {
            reservationId: reservationIdentity,
            sourceKind: sourceKind === 'issue' ? 'issue' : 'sales',
            sourceId,
            sourceLineId: lineId,
            warehouseId: warehouse,
            quantity,
            version: current!.revision,
            lifecycleVersion: current!.lifecycleVersion,
            reason: reason.trim(),
          };
      await api.request({
        path: release
          ? `${base}/reservations/${reservationId}/release`
          : `${base}/reservations`,
        method: 'POST',
        json: { ...body, requestKey: request.for(body) },
      });
      setCommitted(true);
      setConfirm(false);
      toast.show({
        type: 'success',
        title: t(ui('actionSucceeded'), { action: label }),
      });
      try {
        await finish();
      } catch (e) {
        setError(e);
      }
      return true;
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 409) {
        setConflicted(true);
        setConfirm(false);
      }
      return false;
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  const valid =
      /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/u.test(quantity) &&
      /[1-9]/u.test(quantity),
    ready = release
      ? !!reservation.data
      : !!current && current.available !== false && !!line;
  const check = () => {
    setAttempted(true);
    if (!ready || !valid || !reason.trim()) {
      document
        .getElementById(
          !valid
            ? 'reservation-quantity'
            : !reason.trim()
              ? 'reservation-reason'
              : 'reservation-source',
        )
        ?.focus();
      return;
    }
    setConfirm(true);
  };
  const loadError =
    order.error ??
    reservation.error ??
    company.error ??
    warehouseRef.error ??
    source.error;
  return (
    <>
      <RouteDialog
        title={label}
        description={t(ui(release ? 'releaseHint' : 'reservationHint'))}
        closeTo={back}
        beforeClose={() => !lockRef.current && guard.leave()}
        footer={
          !committed && (
            <>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() =>
                  void guard.leave().then((ok) => {
                    if (ok) void navigate(back, { relative: 'route' });
                  })
                }
              >
                {t(ui('cancel'))}
              </Button>
              <Button
                disabled={
                  !can.can ||
                  busy ||
                  !ready ||
                  conflicted ||
                  source.isFetching ||
                  reservation.isFetching
                }
                onClick={check}
              >
                {busy && <Spinner />}
                {label}
              </Button>
            </>
          )
        }
      >
        {can.isPending ||
        (order.isPending && !!id) ||
        (release && reservation.isPending) ? (
          <Loading kind='form' />
        ) : !can.can ? (
          <EmptyState type='restricted' />
        ) : (
          <div className='grid gap-5'>
            {loadError && (
              <ErrorNotice
                error={loadError}
                retry={() => {
                  void order.refetch();
                  if (release) void reservation.refetch();
                  if (sourceId && !release) void source.refetch();
                }}
              />
            )}
            {!!error && (
              <ErrorNotice
                error={error}
                committed={committed}
                retry={
                  committed
                    ? () => {
                        if (lockRef.current) return;
                        lockRef.current = true;
                        setBusy(true);
                        void finish()
                          .catch(setError)
                          .finally(() => {
                            lockRef.current = false;
                            setBusy(false);
                          });
                      }
                    : undefined
                }
              />
            )}
            {conflicted && (
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void (release ? reservation.refetch() : source.refetch())
                    .then((result) => {
                      if (!result.error) {
                        setConflicted(false);
                        setError(undefined);
                        request.reset();
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {t(ui('readAgain'))}
              </Button>
            )}
            {!committed && (
              <>
                {id || release ? (
                  <dl className='grid gap-3 text-sm'>
                    <div>
                      <dt className='text-muted-foreground'>
                        {t(ui('company'))}
                      </dt>
                      <dd>
                        {company.data?.data.name ??
                          order.data?.data.display.company?.name ??
                          '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>
                        {t(ui('warehouse'))}
                      </dt>
                      <dd>
                        {warehouseRef.data?.data.name ??
                          order.data?.data.display.warehouse?.name ??
                          '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>
                        {t(ui('source'))}
                      </dt>
                      <dd>
                        {order.data?.data.code ??
                          reservation.data?.data.source?.code ??
                          t(ui('restricted'))}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <>
                    <ReferencePicker<Choice>
                      label={t(ui('company'))}
                      queryPath={`${base}/companies`}
                      value={companyId}
                      selected={company.data?.data}
                      disabled={busy}
                      onChange={(value) => {
                        setCompanyId(value);
                        setWarehouseId('');
                        setSelected(undefined);
                        setLineId('');
                        setQuantity('');
                      }}
                    />
                    <ReferencePicker<Choice>
                      label={t(ui('warehouse'))}
                      queryPath={`${base}/warehouses`}
                      query={{ subjectId: subject }}
                      value={warehouseId}
                      selected={warehouseRef.data?.data}
                      disabled={busy || !subject}
                      onChange={(value) => {
                        setWarehouseId(value);
                        setSelected(undefined);
                        setLineId('');
                        setQuantity('');
                      }}
                    />
                    <Field>
                      <FieldLabel>{t(ui('sourceType'))}</FieldLabel>
                      <StaticSelect
                        label={t(ui('sourceType'))}
                        value={kind}
                        items={['issue', 'salesShipment'].map((value) => ({
                          value,
                          label: t(ui(`kinds.${value}`)),
                        }))}
                        disabled={busy}
                        onChange={(value) => {
                          setKind(value);
                          setSelected(undefined);
                          setLineId('');
                          setQuantity('');
                        }}
                      />
                    </Field>
                    <ReferencePicker<Source>
                      id='reservation-source'
                      label={t(ui('source'))}
                      queryPath={`${base}/sourceOptions`}
                      query={{
                        subjectId: subject,
                        warehouseId: warehouse,
                        kind: sourceKind,
                      }}
                      value={selected?.id ?? ''}
                      selected={current ?? selected}
                      disabled={busy || !subject || !warehouse}
                      selectedLabel={(value) => value.code}
                      isOptionDisabled={(value) => value.available === false}
                      onChange={(_value, item) => {
                        setSelected(item);
                        setLineId('');
                        setQuantity('');
                      }}
                    />
                  </>
                )}
                {!release && (
                  <Field>
                    <FieldLabel>{t(ui('material'))} *</FieldLabel>
                    <StaticSelect
                      label={t(ui('material'))}
                      value={lineId}
                      items={(current?.lines ?? []).map((value) => ({
                        value: value.id,
                        label: `${value.materialSnapshot.code} · ${value.materialSnapshot.name}`,
                      }))}
                      disabled={busy || !current}
                      onChange={(value) => {
                        setLineId(value);
                        setQuantity('');
                      }}
                    />
                  </Field>
                )}
                {release && (
                  <p className='text-sm font-medium'>
                    {reservation.data?.data.material?.name} ·{' '}
                    {reservation.data?.data.material?.code}
                  </p>
                )}
                {available !== undefined && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('remainingQuantity'))}:{' '}
                    {formatStockQuantity(available, i18n.language)}{' '}
                    {release
                      ? reservation.data?.data.material?.baseUnitName
                      : line?.materialSnapshot.baseUnitName}
                  </p>
                )}
                <Field data-invalid={attempted && !valid}>
                  <FieldLabel htmlFor='reservation-quantity'>
                    {t(ui('baseQuantity'))} *
                  </FieldLabel>
                  <Input
                    id='reservation-quantity'
                    inputMode='decimal'
                    value={quantity}
                    disabled={busy}
                    aria-invalid={attempted && !valid}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  {attempted && !valid && (
                    <FieldError>{t(ui('quantityInvalid'))}</FieldError>
                  )}
                </Field>
                <Field data-invalid={attempted && !reason.trim()}>
                  <FieldLabel htmlFor='reservation-reason'>
                    {t(ui('reason'))} *
                  </FieldLabel>
                  <Textarea
                    id='reservation-reason'
                    value={reason}
                    maxLength={3000}
                    disabled={busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  {attempted && !reason.trim() && (
                    <FieldError>{t(ui('required'))}</FieldError>
                  )}
                </Field>
              </>
            )}
          </div>
        )}
      </RouteDialog>
      <ActionConfirmation
        open={confirm}
        onOpenChange={setConfirm}
        title={t(ui('confirmAction'), {
          action: label,
          name: current?.code ?? reservation.data?.data.source?.code ?? '',
        })}
        description={`${formatStockQuantity(quantity || '0', i18n.language)} ${line?.materialSnapshot.baseUnitName ?? reservation.data?.data.material?.baseUnitName ?? ''} · ${warehouseRef.data?.data.name ?? ''}`}
        confirmLabel={label}
        onConfirm={post}
      />
      {guard.dialog}
    </>
  );
}
