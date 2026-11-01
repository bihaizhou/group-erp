import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useLocation, useNavigate, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Input } from '#components/ui/input';
import { randomId } from '#lib/random-id';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '#components/ui/field';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { kindFromPath, actionPermission, type Row } from './model.js';
import {
  useMaterialRecord,
  useMaterialOptions,
  useMaterialCan,
  useMaterialRefresh,
} from './hooks.js';
import { Loading, ErrorNotice, MaterialSelect } from './controls.js';
export default function MaterialAction() {
  const location = useLocation(),
    params = useParams(),
    kind = params.linkedSkuId ? 'skus' : kindFromPath(location.pathname),
    transition = params.transition ?? '',
    record = useMaterialRecord(
      kind,
      params.linkedSkuId ?? params.sourceRequestId ?? params.recordId,
    ),
    permission = useMaterialCan(kind, actionPermission(kind, transition));
  return (
    <Action
      key={`${kind}-${params.linkedSkuId ?? params.recordId ?? params.sourceRequestId}-${transition}`}
      kind={kind}
      transition={transition}
      row={record.data?.data}
      error={record.error}
      permitted={permission.can}
      reload={() => record.refetch()}
    />
  );
}
function Action({
  kind,
  transition,
  row,
  error: loadError,
  permitted,
  reload,
}: {
  kind: ReturnType<typeof kindFromPath>;
  transition: string;
  row?: Row;
  error: unknown;
  permitted: boolean;
  reload: () => Promise<unknown>;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    refresh = useMaterialRefresh(),
    location = useLocation(),
    navigate = useNavigate();
  const [reason, setReason] = useState(''),
    [sku, setSku] = useState(''),
    [q, setQ] = useState(''),
    [invalid, setInvalid] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [key] = useState(randomId),
    [conflict, setConflict] = useState(false);
  const completedRef = useRef(false);
  useNavigationGuard(() => completedRef.current || !busy);
  const options = useMaterialOptions(
    kind,
    q,
    sku ? [sku] : [],
    transition === 'resolve',
  );
  const allowed =
    permitted &&
    row?.workflow?.available.some((a) => a.name === transition && a.allowed);
  const exit = () => {
    if (!busy)
      void navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
  };
  useEffect(() => {
    if (!busy) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !row || !allowed || conflict) return;
    if (!reason.trim() || (transition === 'resolve' && !sku)) {
      setInvalid(true);
      document
        .getElementById(
          transition === 'resolve' && !sku
            ? 'material-resolved-sku'
            : 'material-action-reason',
        )
        ?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: Row }>({
        path: `materials/${kind}/${row.id}/${transition}`,
        method: 'POST',
        json: {
          version: row.lifecycleVersion,
          requestKey: key,
          reason,
          ...(transition === 'resolve' ? { resolvedSkuId: sku } : {}),
        },
      });
      await refresh(response.data, kind);
      toaster.show({
        type: 'success',
        title: t('materials.actionSuccess', {
          action: t(`materials.transitions.${transition}`),
          name: row.name,
        }),
      });
      completedRef.current = true;
      await navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  const buttons = (
    <>
      <Button variant='outline' disabled={busy} onClick={exit}>
        {t('materials.cancel')}
      </Button>
      <Button
        form='material-action'
        type='submit'
        variant={
          ['deactivate', 'withdraw'].includes(transition)
            ? 'destructive'
            : 'default'
        }
        disabled={busy || !allowed || conflict}
      >
        {t(busy ? 'materials.saving' : `materials.transitions.${transition}`)}
      </Button>
    </>
  );
  const content = loadError ? (
    <ErrorNotice error={loadError} />
  ) : !row ? (
    <Loading />
  ) : !allowed ? (
    <p>{t('materials.actionUnavailable')}</p>
  ) : (
    <form
      id='material-action'
      noValidate
      onSubmit={(e) => void send(e)}
      className='flex flex-col gap-4'
    >
      {error ? <ErrorNotice error={error} /> : null}
      {conflict ? (
        <Button
          type='button'
          variant='outline'
          onClick={() => void reload().then(() => setConflict(false))}
        >
          {t('materials.reload')}
        </Button>
      ) : null}
      {transition === 'resolve' ? (
        <>
          <Field>
            <FieldLabel htmlFor='material-resolve-search'>
              {t('materials.findRelated')}
            </FieldLabel>
            <Input
              id='material-resolve-search'
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={busy}
            />
          </Field>
          {options.isError ? (
            <ErrorNotice
              error={options.error}
              retry={() => void options.refetch()}
            />
          ) : null}
          <Field data-invalid={invalid && !sku}>
            <FieldLabel htmlFor='material-resolved-sku'>
              {t('materials.fields.resolvedSkuId')} *
            </FieldLabel>
            <MaterialSelect
              id='material-resolved-sku'
              label={t('materials.fields.resolvedSkuId')}
              value={sku}
              onChange={setSku}
              disabled={busy}
              invalid={invalid && !sku}
              items={[
                { value: '', label: t('materials.choose') },
                ...(options.data?.data.skus?.rows ?? [])
                  .filter((v) => v.status === 'active')
                  .map((v) => ({
                    value: v.id,
                    label: `${v.name} · ${v.code}`,
                  })),
              ]}
            />
            <FieldDescription>{t('materials.resolveHelp')}</FieldDescription>
            {invalid && !sku ? (
              <FieldError>{t('materials.required')}</FieldError>
            ) : null}
          </Field>
          {options.data &&
          Object.values(options.data.data).some((v) => v.truncated) ? (
            <p className='text-sm text-muted-foreground'>
              {t('materials.optionCap', { limit: 100 })}
            </p>
          ) : null}
        </>
      ) : null}
      <PurchaseReferenceNotice
        domain='materials'
        kind={kind}
        id={row?.id}
        busy={busy}
      />
      <Field data-invalid={invalid && !reason.trim()}>
        <FieldLabel htmlFor='material-action-reason'>
          {t('materials.fields.reason')} *
        </FieldLabel>
        <Textarea
          id='material-action-reason'
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={invalid && !reason.trim()}
          aria-required
          disabled={busy}
          maxLength={1000}
        />
        {invalid && !reason.trim() ? (
          <FieldError>{t('materials.required')}</FieldError>
        ) : null}
      </Field>
    </form>
  );
  return ['deactivate', 'withdraw'].includes(transition) ? (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) exit();
      }}
    >
      <AlertDialogContent className='flex flex-col overflow-y-hidden'>
        <AlertDialogHeader className='shrink-0'>
          <AlertDialogTitle>
            {t('materials.actionTitle', {
              action: t(`materials.transitions.${transition}`),
              name: row?.name ?? '',
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('materials.actionConsequence')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto'>{content}</div>
        <AlertDialogFooter className='shrink-0'>{buttons}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : (
    <RouteDialog
      title={t('materials.actionTitle', {
        action: t(`materials.transitions.${transition}`),
        name: row?.name ?? '',
      })}
      beforeClose={() => !busy}
      footer={buttons}
    >
      {content}
    </RouteDialog>
  );
}
