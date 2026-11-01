import { useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { ActionConfirmation } from '#components/action-confirmation';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Input } from '#components/ui/input';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import { formatStockQuantity } from '#lib/stock-quantity';
import {
  useExecutionQuery,
  useExecutionRefresh,
  useRequestKey,
  useLeaveGuard,
  ui,
} from './hooks.js';
import { Loading, ErrorNotice, EmptyState } from './controls.js';
import { pageFor, type ExecutionRecord, type Capabilities } from './model.js';
export default function ExecutionAction() {
  const { id: routeId, documentId, action = '' } = useParams(),
    id = documentId ?? routeId,
    location = useLocation(),
    navigate = useNavigate(),
    ownPath = useResolvedPath('.').pathname,
    config = pageFor(ownPath),
    { t, i18n } = useTranslation(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    refresh = useExecutionRefresh(),
    key = useRequestKey(),
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
    [reason, setReason] = useState(''),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [conflicted, setConflicted] = useState(false),
    [quantityError, setQuantityError] = useState(false),
    [error, setError] = useState<unknown>(),
    [committed, setCommitted] = useState(false),
    lockRef = useRef(false),
    guard = useLeaveGuard(
      !committed && !!(reason || Object.keys(quantities).length),
      busy,
      ownPath,
    ),
    row = record.data?.data,
    cap = caps.data?.data.actions[action],
    allowed = cap?.visible && cap.enabled,
    back = { pathname: '..', search: location.search },
    actionLabel = t(ui(`actions.${action}`)),
    danger = ['cancel', 'closeRemainder'].includes(action);
  const completeRead = async () => {
    const latest = await api.request<{ data: ExecutionRecord }>({
      path: `${config.api}/${id}`,
    });
    cache.setQueryData(['execution', `${config.api}/${id}`, {}], latest);
    void refresh();
    guard.complete();
    void navigate(back, { replace: true, relative: 'route' });
  };
  const post = async () => {
    if (
      lockRef.current ||
      !row ||
      !allowed ||
      record.isFetching ||
      caps.isFetching ||
      committed ||
      conflicted
    )
      return false;
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    const body = {
      version: row.revision,
      lifecycleVersion: row.lifecycleVersion,
      reason: reason.trim(),
      ...(action === 'closeRemainder'
        ? {
            lines: Object.entries(quantities)
              .filter(([, quantity]) => quantity.trim())
              .map(([lineId, quantity]) => ({ lineId, quantity })),
          }
        : {}),
    };
    try {
      const result = await api.request<{
        data: Partial<ExecutionRecord> & { id: string };
      }>({
        path: `${config.api}/${id}/${action}`,
        method: 'POST',
        json: { ...body, requestKey: key.for(body) },
      });
      setCommitted(true);
      setConfirm(false);
      cache.setQueryData<{ data: ExecutionRecord }>(
        ['execution', `${config.api}/${id}`, {}],
        (old) => (old ? { data: { ...old.data, ...result.data } } : undefined),
      );
      toast.show({
        type: 'success',
        title: t(ui('actionSucceeded'), { action: actionLabel }),
      });
      try {
        await completeRead();
      } catch (readError) {
        setError(readError);
      }
      return true;
    } catch (writeError) {
      setError(writeError);
      if (writeError instanceof ApiClientError && writeError.status === 409) {
        setConflicted(true);
        setConfirm(false);
      }
      return false;
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  const validate = () => {
    setAttempted(true);
    if (!reason.trim()) {
      document.getElementById('execution-action-reason')?.focus();
      return;
    }
    if (action === 'closeRemainder') {
      const values = Object.values(quantities).filter((v) => v.trim());
      const invalid =
        !values.length ||
        values.some(
          (value) =>
            !/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/u.test(value) ||
            !/[1-9]/u.test(value),
        );
      setQuantityError(invalid);
      if (invalid) {
        document
          .querySelector<HTMLInputElement>('[id^=execution-close-]')
          ?.focus();
        return;
      }
    }
    setConfirm(true);
  };
  return (
    <>
      <RouteDialog
        title={row ? `${actionLabel} · ${row.code}` : actionLabel}
        description={row?.display.warehouse?.name ?? t(ui('loading'))}
        beforeClose={() => !lockRef.current && guard.leave()}
        closeTo={back}
        footer={
          !committed &&
          row && (
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
                variant={danger ? 'destructive' : 'default'}
                disabled={
                  busy ||
                  !allowed ||
                  conflicted ||
                  record.isFetching ||
                  caps.isFetching
                }
                onClick={validate}
              >
                {busy && <Spinner />}
                {actionLabel}
              </Button>
            </>
          )
        }
      >
        {record.isPending || caps.isPending ? (
          <Loading kind='form' />
        ) : record.error || caps.error ? (
          <ErrorNotice
            error={record.error ?? caps.error}
            retry={() => {
              void record.refetch();
              void caps.refetch();
            }}
          />
        ) : !row || !cap?.visible ? (
          <EmptyState type='restricted' />
        ) : (
          <div className='flex flex-col gap-5'>
            {!allowed && !committed && (
              <p className='text-sm text-muted-foreground'>
                {t(
                  ui(
                    cap?.reason === 'STOCK_REVIEWERS_STILL_AVAILABLE'
                      ? 'reviewersAvailable'
                      : 'actionUnavailable',
                  ),
                )}
              </p>
            )}
            {!!error && (
              <ErrorNotice
                error={error}
                committed={committed}
                retry={
                  committed || conflicted
                    ? () => {
                        if (lockRef.current) return;
                        lockRef.current = true;
                        setBusy(true);
                        void completeRead()
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
                  void Promise.all([record.refetch(), caps.refetch()])
                    .then(([r, c]) => {
                      if (!r.error && !c.error) {
                        setConflicted(false);
                        setError(undefined);
                        key.reset();
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {t(ui('readAgain'))}
              </Button>
            )}
            {quantityError && (
              <FieldError>{t(ui('quantityInvalid'))}</FieldError>
            )}
            {!committed && (
              <>
                {action === 'closeRemainder' &&
                  row.lines.map((line) => (
                    <Field key={line.id}>
                      <FieldLabel htmlFor={`execution-close-${line.id}`}>
                        {line.materialSnapshot.name} · {t(ui('baseQuantity'))}:{' '}
                        {formatStockQuantity(line.baseQuantity, i18n.language)}{' '}
                        {line.materialSnapshot.baseUnitName}
                      </FieldLabel>
                      <Input
                        id={`execution-close-${line.id}`}
                        inputMode='decimal'
                        value={quantities[line.id] ?? ''}
                        disabled={busy}
                        onChange={(event) =>
                          setQuantities((old) => ({
                            ...old,
                            [line.id]: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  ))}
                <Field data-invalid={attempted && !reason.trim()}>
                  <FieldLabel htmlFor='execution-action-reason'>
                    {t(ui('reason'))} *
                  </FieldLabel>
                  <Textarea
                    id='execution-action-reason'
                    value={reason}
                    disabled={busy || !allowed}
                    maxLength={3000}
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
          action: actionLabel,
          name: row?.code ?? '',
        })}
        description={
          action === 'start'
            ? t(ui('countStartHint'), {
                name: row?.code,
                warehouse: row?.display.warehouse?.name,
              })
            : t(ui('actionHint'), { warehouse: row?.display.warehouse?.name })
        }
        confirmLabel={actionLabel}
        destructive={danger}
        onConfirm={post}
      />
      {guard.dialog}
    </>
  );
}
