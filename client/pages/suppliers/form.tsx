import { usePartnerConfig } from './partner-domain.js';
import { usePartnerApi as useApiClient } from './partner-domain.js';
import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Link,
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
import { AccessDenied } from '#components/access-denied';
import { CompanyEmpty } from '#components/company-scope';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '#components/ui/field';
import { randomUuid } from '#lib/random-id';
import { useDiscardConfirm } from '../people/use-discard-confirm.js';
import {
  useAvailability,
  useIdentity,
  useApplicability,
  useCapabilities,
  useSupplierCan,
  useSupplierQuery,
  useSupplierRefresh,
  useSupplierError,
} from './hooks.js';
import {
  SupplierError,
  SupplierLoading,
  SupplierSelect,
  SupplierStatus,
  ChoicePicker,
} from './controls.js';
import {
  type Availability,
  type Identity,
  type Applicability,
  type Choice,
  type SupplierSaved,
} from './model.js';
import { SupplierHistory } from './history.js';
type Mode = 'new' | 'identity' | 'scope' | 'edit';
type Draft = {
  code: string;
  name: string;
  registrationCode: string;
  notes: string;
  reason: string;
  scopeMode: 'all' | 'selected';
  regionIds: string[];
  subjectIds: string[];
};
function initial(
  _mode: Mode,
  row?: Availability | Identity | Applicability,
): Draft {
  return {
    code: row && 'code' in row ? row.code : '',
    name: row && 'name' in row ? row.name : '',
    registrationCode:
      row && 'registrationCode' in row ? (row.registrationCode ?? '') : '',
    notes: row && 'notes' in row ? row.notes : '',
    reason: '',
    scopeMode: row && 'scopeMode' in row ? row.scopeMode : 'selected',
    regionIds: row && 'regionIds' in row ? row.regionIds : [],
    subjectIds: row && 'subjectIds' in row ? row.subjectIds : [],
  };
}
export default function SupplierForm() {
  const { t } = useTranslation(),
    location = useLocation(),
    { partnerId } = useParams(),
    [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '';
  const mode: Mode = location.pathname.endsWith('/new')
    ? 'new'
    : location.pathname.endsWith('/identity')
      ? 'identity'
      : location.pathname.endsWith('/scope')
        ? 'scope'
        : 'edit';
  const permission = useSupplierCan(
    mode === 'new'
      ? 'create'
      : mode === 'identity'
        ? 'updateIdentity'
        : mode === 'scope'
          ? 'configureApplicability'
          : 'updateRelationship',
  );
  const capabilities = useCapabilities(partnerId, subjectId || undefined);
  const allowed =
    mode === 'new'
      ? permission.can
      : capabilities.data?.data[
          mode === 'edit'
            ? 'updateRelationship'
            : mode === 'identity'
              ? 'updateIdentity'
              : 'configureApplicability'
        ];
  const availability = useAvailability(
    mode === 'edit' && allowed ? partnerId : undefined,
    subjectId,
  );
  const identity = useIdentity(partnerId, mode === 'identity' && allowed);
  const scope = useApplicability(partnerId, mode === 'scope' && allowed);
  const scopeIdentity = useSupplierQuery<{ data: Identity }>(
    `supplierScopeIdentities/${partnerId}`,
    {},
    Boolean(mode === 'scope' && allowed),
  );
  const company = useSupplierQuery<{ data: Choice }>(
    `supplierCompanies/${subjectId}`,
    {},
    Boolean(mode === 'new' && subjectId && allowed),
  );
  const query =
    mode === 'edit' ? availability : mode === 'identity' ? identity : scope;
  const row = query.data?.data,
    error =
      capabilities.error ||
      (mode === 'new' ? company.error : query.error) ||
      (mode === 'scope' ? scopeIdentity.error : undefined);
  const ready =
    mode === 'new'
      ? Boolean(company.data)
      : Boolean(row && (mode !== 'scope' || scopeIdentity.data));
  const title = t(
    `procurement.${mode === 'new' ? 'create' : mode === 'identity' ? 'editIdentity' : mode === 'scope' ? 'editScope' : 'editCompany'}`,
  );
  if (!allowed || !ready || error)
    return (
      <RouteDialog
        title={title}
        className={
          mode === 'edit' || mode === 'identity' ? 'sm:max-w-md' : undefined
        }
      >
        {error ? (
          <SupplierError
            error={error}
            retry={() => {
              void capabilities.refetch();
              if (mode === 'new') void company.refetch();
              else void query.refetch();
              if (mode === 'scope') void scopeIdentity.refetch();
            }}
          />
        ) : mode === 'new' && !subjectId ? (
          <CompanyEmpty type='chooseCompany' />
        ) : (!permission.isPending && !permission.can) ||
          (capabilities.data && !allowed) ? (
          <AccessDenied title={t('procurement.http403')} />
        ) : (
          <SupplierLoading />
        )}
      </RouteDialog>
    );
  return (
    <SupplierFormBody
      key={`${mode}-${partnerId ?? subjectId}`}
      mode={mode}
      row={mode === 'new' ? undefined : row}
      subjectId={subjectId}
      partnerId={partnerId ?? ''}
      title={title}
      name={
        mode === 'scope'
          ? (scopeIdentity.data?.data.name ?? '')
          : mode === 'new'
            ? (company.data?.data.name ?? '')
            : mode === 'edit'
              ? (availability.data?.data.identity.name ?? '')
              : (identity.data?.data.name ?? '')
      }
    />
  );
}
function SupplierFormBody({
  mode,
  row,
  subjectId,
  partnerId,
  title,
  name,
}: {
  mode: Mode;
  row?: Availability | Identity | Applicability;
  subjectId: string;
  partnerId: string;
  title: string;
  name: string;
}) {
  const { t } = useTranslation(),
    { rootPath, role: partnerRole } = usePartnerConfig(),
    api = useApiClient(),
    navigate = useNavigate(),
    location = useLocation(),
    toaster = useToaster(),
    refresh = useSupplierRefresh(),
    message = useSupplierError(),
    discard = useDiscardConfirm();
  const [draft, setDraft] = useState(() => initial(mode, row)),
    [baseline, setBaseline] = useState(() =>
      JSON.stringify(initial(mode, row)),
    ),
    [version, setVersion] = useState(row?.revision ?? 0),
    [companyStatus, setCompanyStatus] = useState<Availability['companyStatus']>(
      row && 'companyStatus' in row ? row.companyStatus : 'active',
    );
  const [attempted, setAttempted] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [loadingLatest, setLoadingLatest] = useState(false);
  const completedRef = useRef(false),
    leavingRef = useRef(false),
    requestRef = useRef({ signature: '', key: randomUuid() });
  const dirty = JSON.stringify(draft) !== baseline;
  const canClose = async () => {
    const allowed =
      completedRef.current ||
      (!busy && !loadingLatest && (!dirty || (await discard.confirm())));
    if (allowed) leavingRef.current = true;
    return allowed;
  };
  useNavigationGuard(
    () =>
      completedRef.current ||
      leavingRef.current ||
      (!busy &&
        !loadingLatest &&
        (!dirty || window.confirm(t('people.unsaved')))),
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  const validate = (v: Draft) => {
    const result: Record<string, string> = {};
    if (mode === 'new' || mode === 'identity') {
      const code = v.code.normalize('NFKC').trim().toUpperCase();
      if (!code) result.code = t('procurement.required');
      else if (code.length > 64 || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(code))
        result.code = t('procurement.invalidCode');
      if (!v.name.trim()) result.name = t('procurement.required');
      else if (v.name.trim().length > 200)
        result.name = t('procurement.maxLength', { count: 200 });
      if (
        v.registrationCode.normalize('NFKC').replace(/\s+/gu, '').length > 128
      )
        result.registrationCode = t('procurement.maxLength', { count: 128 });
    }
    if (mode !== 'new' && !v.reason.trim())
      result.reason = t('procurement.required');
    if (v.reason.trim().length > 1000)
      result.reason = t('procurement.maxLength', { count: 1000 });
    if (v.notes.trim().length > 2000)
      result.notes = t('procurement.maxLength', { count: 2000 });
    if (
      mode === 'scope' &&
      v.scopeMode === 'selected' &&
      !v.regionIds.length &&
      !v.subjectIds.length
    )
      result.scopeMode = t('procurement.requiredScope');
    return result;
  };
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (attempted) setErrors(validate(next));
  };
  const exit = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { relative: 'route', replace: true },
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const invalid = validate(draft);
    setAttempted(true);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`supplier-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    const fields = {
      code: draft.code.normalize('NFKC').trim().toUpperCase(),
      name: draft.name.trim(),
      registrationCode:
        draft.registrationCode
          .normalize('NFKC')
          .toUpperCase()
          .replace(/\s+/gu, '') || null,
    };
    const values =
      mode === 'new'
        ? { ...fields, subjectId, notes: draft.notes.trim() }
        : mode === 'identity'
          ? { ...fields, version, reason: draft.reason.trim() }
          : mode === 'scope'
            ? {
                scopeMode: draft.scopeMode,
                regionIds:
                  draft.scopeMode === 'all' ? [] : [...draft.regionIds].sort(),
                subjectIds:
                  draft.scopeMode === 'all' ? [] : [...draft.subjectIds].sort(),
                version,
                reason: draft.reason.trim(),
              }
            : {
                partnerId,
                subjectId,
                status: companyStatus,
                notes: draft.notes.trim(),
                version,
                reason: draft.reason.trim(),
              };
    const signature = JSON.stringify(values);
    if (
      requestRef.current.signature &&
      requestRef.current.signature !== signature
    )
      requestRef.current.key = randomUuid();
    requestRef.current.signature = signature;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: SupplierSaved }>({
        path:
          mode === 'new'
            ? 'procurement/suppliers'
            : mode === 'identity'
              ? `procurement/supplierIdentities/${partnerId}`
              : mode === 'scope'
                ? `procurement/supplierIdentities/${partnerId}/applicability`
                : 'procurement/supplierOverrides',
        method:
          mode === 'identity' ? 'PATCH' : mode === 'scope' ? 'PUT' : 'POST',
        json: { ...values, requestKey: requestRef.current.key },
      });
      completedRef.current = true;
      void refresh(response.data, mode === 'new');
      toaster.show({
        type: 'success',
        title: t('procurement.saved', {
          name:
            mode === 'new' || mode === 'identity' ? draft.name.trim() : name,
        }),
      });
      exit();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError) {
        if (e.status === 404) void refresh();
        const payload = e.payload as {
          error?: { fieldViolations?: { field: string }[] };
        };
        const fields = payload?.error?.fieldViolations ?? [];
        const known = [
          'code',
          'name',
          'registrationCode',
          'notes',
          'reason',
          'scopeMode',
        ];
        if (fields.some((v) => known.includes(v.field))) {
          setErrors(
            Object.fromEntries(
              fields
                .filter((v) => known.includes(v.field))
                .map((v) => [v.field, message(e)]),
            ),
          );
          document
            .getElementById(
              `supplier-${fields.find((v) => known.includes(v.field))!.field}`,
            )
            ?.focus();
        }
      }
    } finally {
      setBusy(false);
    }
  };
  const latest = async () => {
    if (!(await discard.confirm())) return;
    setLoadingLatest(true);
    try {
      const latest = await api.request<{
        data: Availability | Identity | Applicability;
      }>({
        path:
          mode === 'identity'
            ? `procurement/supplierIdentities/${partnerId}`
            : mode === 'scope'
              ? `procurement/supplierIdentities/${partnerId}/applicability`
              : `procurement/supplierAvailability/${partnerId}`,
        ...(mode === 'edit' ? { query: { subjectId } } : {}),
      });
      const next = initial(mode, latest.data);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setVersion(latest.data.revision);
      if ('companyStatus' in latest.data)
        setCompanyStatus(latest.data.companyStatus);
      setError(undefined);
      setErrors({});
      setAttempted(false);
      requestRef.current = { signature: '', key: randomUuid() };
    } catch (e) {
      setError(e);
    } finally {
      setLoadingLatest(false);
    }
  };
  const refs = useSupplierQuery<{
    data: { regions: Choice[]; companies: Choice[] };
  }>(
    'supplierScopeReferences',
    { regionId: draft.regionIds, subjectId: draft.subjectIds },
    mode === 'scope' &&
      Boolean(draft.regionIds.length || draft.subjectIds.length),
  );
  const field = (
    key: 'code' | 'name' | 'registrationCode' | 'notes' | 'reason',
    required = false,
  ) => (
    <Field data-invalid={Boolean(errors[key])}>
      <FieldLabel htmlFor={`supplier-${key}`}>
        {t(`procurement.${key}`)}
        {required && <span aria-hidden='true'> *</span>}
      </FieldLabel>
      {key === 'notes' || key === 'reason' ? (
        <Textarea
          id={`supplier-${key}`}
          aria-required={required}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `supplier-${key}-error` : undefined}
          value={draft[key]}
          onChange={(e) => change(key, e.target.value)}
          maxLength={key === 'notes' ? 2000 : 1000}
          disabled={busy || loadingLatest}
        />
      ) : (
        <Input
          id={`supplier-${key}`}
          aria-required={required}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `supplier-${key}-error` : undefined}
          value={draft[key]}
          onChange={(e) => change(key, e.target.value)}
          maxLength={key === 'code' ? 64 : key === 'name' ? 200 : 128}
          disabled={busy || loadingLatest}
        />
      )}
      {key === 'reason' && (
        <FieldDescription>{t('procurement.reasonHint')}</FieldDescription>
      )}
      {errors[key] && (
        <FieldError id={`supplier-${key}-error`}>{errors[key]}</FieldError>
      )}
    </Field>
  );
  const directory = location.pathname.includes('/directory/');
  return (
    <>
      <RouteDialog
        title={title}
        description={name}
        className={
          mode === 'edit' || mode === 'identity' ? 'sm:max-w-md' : undefined
        }
        beforeClose={canClose}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy || loadingLatest}
              onClick={() => {
                void canClose().then((allowed) => {
                  if (allowed) exit();
                });
              }}
            >
              {t('procurement.cancel')}
            </Button>
            <Button
              form='supplier-form'
              type='submit'
              disabled={
                busy ||
                loadingLatest ||
                (error instanceof ApiClientError &&
                  [401, 403, 404].includes(error.status))
              }
            >
              {t(
                busy
                  ? 'procurement.saving'
                  : mode === 'new'
                    ? 'procurement.createAction'
                    : 'procurement.save',
              )}
            </Button>
          </>
        }
      >
        <form
          id='supplier-form'
          noValidate
          onSubmit={(event) => void submit(event)}
          className='flex flex-col gap-5'
        >
          {Boolean(error) && <SupplierError error={error} />}
          {error instanceof ApiClientError &&
            ['SUPPLIER_VERSION_CONFLICT', 'CUSTOMER_VERSION_CONFLICT'].includes(
              error.reason ?? '',
            ) && (
              <div className='flex flex-col gap-2'>
                <p className='text-sm text-muted-foreground'>
                  {t('procurement.latestHint')}
                </p>
                <Button
                  type='button'
                  variant='outline'
                  disabled={busy || loadingLatest}
                  onClick={() => void latest()}
                >
                  {t('procurement.latest')}
                </Button>
              </div>
            )}
          {mode === 'new' && (
            <p className='text-sm text-muted-foreground'>
              {t('procurement.createHint')}
            </p>
          )}
          {mode === 'identity' && (
            <p className='text-sm text-muted-foreground'>
              {t('procurement.identityHint')}
            </p>
          )}
          {(mode === 'new' || mode === 'identity') && (
            <>
              {field('code', true)}
              {field('name', true)}
              {field('registrationCode')}
            </>
          )}
          {(mode === 'new' || mode === 'edit') && field('notes')}
          {mode === 'scope' && (
            <>
              <p className='text-sm leading-6 text-muted-foreground'>
                {t('procurement.scopeHint')}
              </p>
              <Field data-invalid={Boolean(errors.scopeMode)}>
                <FieldLabel id='supplier-scope-label'>
                  {t('procurement.scope')} *
                </FieldLabel>
                <div id='supplier-scopeMode' tabIndex={-1}>
                  <SupplierSelect
                    label={t('procurement.scope')}
                    value={draft.scopeMode}
                    disabled={busy || loadingLatest}
                    items={['all', 'selected'].map((value) => ({
                      value,
                      label: t(`procurement.${value}`),
                    }))}
                    onChange={(v) =>
                      change('scopeMode', v as Draft['scopeMode'])
                    }
                  />
                </div>
                {errors.scopeMode && (
                  <FieldError>{errors.scopeMode}</FieldError>
                )}
              </Field>
              {draft.scopeMode === 'selected' && (
                <div className='grid gap-4 sm:grid-cols-2'>
                  <ChoicePicker
                    path='supplierScopeRegions'
                    label={t('procurement.regions')}
                    value={draft.regionIds}
                    selected={refs.data?.data.regions}
                    multiple
                    onChange={(v) => change('regionIds', v)}
                    disabled={busy || loadingLatest}
                  />
                  <ChoicePicker
                    path='supplierScopeCompanies'
                    label={t('procurement.companies')}
                    value={draft.subjectIds}
                    selected={refs.data?.data.companies}
                    multiple
                    onChange={(v) => change('subjectIds', v)}
                    disabled={busy || loadingLatest}
                  />
                </div>
              )}
              {row && 'status' in row && (
                <div className='flex flex-wrap items-center gap-3'>
                  <span className='text-sm'>
                    {t('procurement.supplierStatus')}
                  </span>
                  <SupplierStatus value={row.status} />
                  <Button
                    type='button'
                    disabled={busy || loadingLatest}
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: directory
                            ? `${rootPath}/directory/${partnerId}/global/${row.status === 'active' ? 'deactivate' : 'reactivate'}`
                            : `${rootPath}/${partnerId}/global/${row.status === 'active' ? 'deactivate' : 'reactivate'}`,
                          search: location.search,
                        }}
                      />
                    }
                  >
                    {t(
                      row.status === 'active'
                        ? 'procurement.stopGlobal'
                        : 'procurement.restoreGlobal',
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
          {partnerRole === 'supplier' && (
            <PurchaseReferenceNotice
              domain='suppliers'
              kind={
                mode === 'identity'
                  ? 'identity'
                  : mode === 'scope'
                    ? 'applicability'
                    : 'company'
              }
              id={mode === 'new' ? undefined : partnerId}
              subjectId={mode === 'edit' ? subjectId : undefined}
              busy={busy}
            />
          )}
          {mode !== 'new' && field('reason', true)}
        </form>
        {directory && mode === 'scope' && (
          <div className='mt-6'>
            <SupplierHistory
              title='scopeHistory'
              path={`supplierIdentities/${partnerId}/applicability/history`}
            />
          </div>
        )}
        {directory && mode === 'identity' && (
          <div className='mt-6'>
            <SupplierHistory
              title='identityHistory'
              path={`supplierIdentities/${partnerId}/history`}
            />
          </div>
        )}
      </RouteDialog>
      {discard.dialog}
    </>
  );
}
