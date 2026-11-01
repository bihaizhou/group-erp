import { usePartnerConfig } from './partner-domain.js';
import { usePartnerApi as useApiClient } from './partner-domain.js';
import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import {
  ApiClientError,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { randomUuid } from '#lib/random-id';
import { useDiscardConfirm } from '../people/use-discard-confirm.js';
import {
  useAvailability,
  useApplicability,
  useCapabilities,
  useSupplierQuery,
  useSupplierRefresh,
} from './hooks.js';
import { SupplierError, SupplierLoading } from './controls.js';
import type {
  Availability,
  Applicability,
  Identity,
  Choice,
  SupplierSaved,
} from './model.js';
export default function SupplierAction() {
  const { t } = useTranslation(),
    params = useParams(),
    location = useLocation(),
    [search] = useSearchParams();
  const global =
      params.target === 'global' || location.pathname.includes('/directory/'),
    partnerId = params.partnerId ?? '',
    subjectId = search.get('subjectId') ?? '';
  const capabilities = useCapabilities(partnerId, subjectId || undefined),
    allowed =
      capabilities.data?.data[
        global ? 'configureApplicability' : 'updateRelationship'
      ];
  const policy = useApplicability(partnerId, Boolean(global && allowed)),
    availability = useAvailability(
      !global && allowed ? partnerId : undefined,
      subjectId,
    );
  const identity = useSupplierQuery<{ data: Identity }>(
    `supplierScopeIdentities/${partnerId}`,
    {},
    Boolean(global && allowed),
  );
  const company = useSupplierQuery<{ data: Choice }>(
    `supplierCompanies/${subjectId}`,
    {},
    Boolean(!global && allowed && subjectId),
  );
  const row = global ? policy.data?.data : availability.data?.data;
  const key = global
    ? params.transition === 'reactivate'
      ? 'restoreGlobal'
      : 'stopGlobal'
    : params.transition === 'reactivate'
      ? 'restoreCompany'
      : 'stopCompany';
  const error =
    capabilities.error ||
    policy.error ||
    availability.error ||
    identity.error ||
    company.error;
  if (error || !row || !allowed || (global && !identity.data))
    return (
      <RouteDialog title={t(`procurement.${key}`)}>
        {error ? (
          <SupplierError
            error={error}
            retry={() => {
              void capabilities.refetch();
              if (global) {
                void policy.refetch();
                void identity.refetch();
              } else {
                void availability.refetch();
                void company.refetch();
              }
            }}
          />
        ) : capabilities.data && !allowed ? (
          <p>{t('procurement.http403')}</p>
        ) : (
          <SupplierLoading />
        )}
      </RouteDialog>
    );
  return (
    <ActionBody
      key={`${partnerId}-${global}-${params.transition}`}
      row={row}
      global={global}
      transition={params.transition ?? ''}
      name={
        global
          ? (identity.data?.data.name ?? '')
          : (availability.data?.data.identity.name ?? '')
      }
      company={company.data?.data.name ?? ''}
      title={t(`procurement.${key}`)}
      subjectId={subjectId}
      partnerId={partnerId}
    />
  );
}
function ActionBody({
  row: initialRow,
  global,
  transition,
  name,
  company,
  title,
  subjectId,
  partnerId,
}: {
  row: Availability | Applicability;
  global: boolean;
  transition: string;
  name: string;
  company: string;
  title: string;
  subjectId: string;
  partnerId: string;
}) {
  const { t } = useTranslation(),
    { role: partnerRole } = usePartnerConfig(),
    api = useApiClient(),
    location = useLocation(),
    navigate = useNavigate(),
    refresh = useSupplierRefresh(),
    toaster = useToaster(),
    discard = useDiscardConfirm();
  const [row, setRow] = useState(initialRow),
    [reason, setReason] = useState(''),
    [invalid, setInvalid] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const completedRef = useRef(false),
    leavingRef = useRef(false),
    requestRef = useRef({ signature: '', key: randomUuid() });
  const canClose = async () => {
    const allowed =
      completedRef.current ||
      (!busy && (!reason.trim() || (await discard.confirm())));
    if (allowed) leavingRef.current = true;
    return allowed;
  };
  useNavigationGuard(
    () =>
      completedRef.current ||
      leavingRef.current ||
      (!busy && (!reason.trim() || window.confirm(t('people.unsaved')))),
  );
  useEffect(() => {
    if (!reason && !busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [reason, busy]);
  const exit = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { relative: 'route', replace: true },
    );
  const close = async () => {
    if (await canClose()) exit();
  };
  const blocked =
    !global &&
    transition === 'reactivate' &&
    'identity' in row &&
    (row.identity.status !== 'active' || row.supplierStatus !== 'active');
  const available =
    ['deactivate', 'reactivate'].includes(transition) &&
    !blocked &&
    (global
      ? 'status' in row &&
        row.status === (transition === 'deactivate' ? 'active' : 'inactive')
      : 'companyStatus' in row &&
        row.companyStatus ===
          (transition === 'deactivate' ? 'active' : 'inactive'));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !available) return;
    if (!reason.trim()) {
      setInvalid(true);
      document.getElementById('supplier-action-reason')?.focus();
      return;
    }
    const values = {
      version: row.revision,
      reason: reason.trim(),
      ...(!global && 'notes' in row
        ? {
            partnerId,
            subjectId,
            notes: row.notes,
            status: transition === 'deactivate' ? 'inactive' : 'active',
          }
        : {}),
    };
    const signature = JSON.stringify(values);
    if (
      requestRef.current.signature &&
      signature !== requestRef.current.signature
    )
      requestRef.current.key = randomUuid();
    requestRef.current.signature = signature;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: SupplierSaved }>({
        path: global
          ? `procurement/supplierIdentities/${partnerId}/applicability/${transition}`
          : 'procurement/supplierOverrides',
        method: 'POST',
        json: { ...values, requestKey: requestRef.current.key },
      });
      completedRef.current = true;
      void refresh(response.data);
      toaster.show({
        type: 'success',
        title: t('procurement.saved', { name }),
      });
      exit();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 404) void refresh();
    } finally {
      setBusy(false);
    }
  };
  const latest = async () => {
    if (!(await discard.confirm())) return;
    setBusy(true);
    try {
      const latest = await api.request<{ data: Availability | Applicability }>({
        path: global
          ? `procurement/supplierIdentities/${partnerId}/applicability`
          : `procurement/supplierAvailability/${partnerId}`,
        ...(!global ? { query: { subjectId } } : {}),
      });
      setRow(latest.data);
      setReason('');
      setInvalid(false);
      setError(undefined);
      requestRef.current = { signature: '', key: randomUuid() };
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) void close();
        }}
      >
        <AlertDialogContent className='flex flex-col overflow-y-hidden'>
          <AlertDialogHeader className='shrink-0'>
            <AlertDialogTitle>
              {t('procurement.actionTitle', { action: title, name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                global
                  ? 'procurement.globalActionHint'
                  : 'procurement.companyActionHint',
                { name, company },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            id='supplier-action-form'
            noValidate
            onSubmit={(event) => void submit(event)}
            className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto'
          >
            {Boolean(error) && <SupplierError error={error} />}
            {!available && (
              <p className='text-sm text-muted-foreground'>
                {t(
                  blocked
                    ? 'procurement.blockedRestore'
                    : 'procurement.errors.SUPPLIER_ACTION_UNAVAILABLE',
                )}
              </p>
            )}
            {error instanceof ApiClientError &&
              [
                'SUPPLIER_VERSION_CONFLICT',
                'CUSTOMER_VERSION_CONFLICT',
              ].includes(error.reason ?? '') && (
                <Button
                  type='button'
                  variant='outline'
                  disabled={busy}
                  onClick={() => void latest()}
                >
                  {t('procurement.latest')}
                </Button>
              )}
            {partnerRole === 'supplier' && (
              <PurchaseReferenceNotice
                domain='suppliers'
                kind={global ? 'applicability' : 'company'}
                id={partnerId}
                subjectId={global ? undefined : subjectId}
                busy={busy}
              />
            )}
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor='supplier-action-reason'>
                {t('procurement.reason')} *
              </FieldLabel>
              <Textarea
                id='supplier-action-reason'
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (invalid) setInvalid(!e.target.value.trim());
                }}
                aria-required='true'
                aria-invalid={invalid}
                disabled={busy}
              />
              {invalid && <FieldError>{t('procurement.required')}</FieldError>}
            </Field>
          </form>
          <AlertDialogFooter className='shrink-0'>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void close()}
            >
              {t('procurement.cancel')}
            </Button>
            <Button
              type='submit'
              form='supplier-action-form'
              variant={transition === 'deactivate' ? 'destructive' : 'default'}
              disabled={
                busy ||
                !available ||
                (error instanceof ApiClientError &&
                  [401, 403, 404].includes(error.status))
              }
            >
              {t(
                busy
                  ? 'procurement.saving'
                  : transition === 'deactivate'
                    ? 'procurement.deactivate'
                    : 'procurement.reactivate',
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discard.dialog}
    </>
  );
}
