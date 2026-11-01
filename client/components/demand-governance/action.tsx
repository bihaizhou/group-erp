import { SourceLoading, SourceError } from './controls.js';
import { useRef, useState, useEffect, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Spinner } from '#components/ui/spinner';
import { LongText } from '#components/long-text';
import { PeopleSelect } from '#pages/people/controls';
// The existing demand interaction helpers handle request keys and nested route
// navigation consistently in both business domains; they carry no record grants.
import {
  useConfirm,
  useLeaveGuard,
  useRequestKey,
} from '#pages/procurement/requests/hooks';
import { sourceUi, demandPrefix, useDemandQuery, useSources } from './hooks.js';
import {
  sourceActions,
  type SourceAction,
  type DemandDomain,
  type Demand,
  type Source,
  type SourceCapabilities,
  type Candidate,
} from './model.js';

export function DemandSourceAction({ domain }: { domain: DemandDomain }) {
  const { requestId, lineId, sourceAction } = useParams();
  return (
    <SourceActionLoader
      key={`${domain}:${requestId}:${lineId}:${sourceAction}`}
      domain={domain}
    />
  );
}
function SourceActionLoader({ domain }: { domain: DemandDomain }) {
  const { requestId, lineId, sourceAction } = useParams(),
    { t } = useTranslation();
  const record = useDemandQuery<{ data: Demand }>(
      domain,
      `requests/${requestId}`,
      !!requestId,
      {},
      true,
    ),
    sources = useSources(domain, requestId ?? '', true),
    caps = useDemandQuery<{ data: SourceCapabilities }>(
      domain,
      `requests/${requestId}/capabilities`,
      !!requestId,
      {},
      true,
    );
  const [initial, setInitial] = useState<{ row: Demand; source?: Source }>();
  const [opened, setOpened] = useState(false);
  const recordRefresh = record.refetch,
    sourceRefresh = sources.refetch,
    capabilityRefresh = caps.refetch;
  // One fresh opening read shared with the mounted detail. Adding the form's
  // observers must not start a second round of the same parent queries.
  useEffect(() => {
    let active = true;
    void Promise.all([
      recordRefresh({ cancelRefetch: false }),
      sourceRefresh({ cancelRefetch: false }),
      capabilityRefresh({ cancelRefetch: false }),
    ]).then(() => {
      if (active) setOpened(true);
    });
    return () => {
      active = false;
    };
  }, [recordRefresh, sourceRefresh, capabilityRefresh]);
  const valid = sourceActions.includes(sourceAction as SourceAction);
  if (
    !initial &&
    opened &&
    record.data &&
    sources.data &&
    caps.data &&
    !record.isFetching &&
    !sources.isFetching &&
    !caps.isFetching
  )
    setInitial({
      row: record.data.data,
      source: sources.data.data.find(
        (s) =>
          s.purchaseRequestLineId === lineId ||
          s.materialIssueRequestLineId === lineId,
      ),
    });
  const error = record.error ?? sources.error ?? caps.error;
  if (!initial || !valid)
    return (
      <RouteDialog title={t(sourceUi('title'))}>
        {error ? (
          <SourceError
            error={error}
            retry={() => {
              void record.refetch();
              void sources.refetch();
              void caps.refetch();
            }}
          />
        ) : !valid ? (
          <p>{t(sourceUi('notEligible'))}</p>
        ) : (
          <SourceLoading />
        )}
      </RouteDialog>
    );
  return (
    <SourceActionForm
      key={`${requestId}-${lineId}-${sourceAction}`}
      domain={domain}
      initial={initial}
      readError={record.error ?? sources.error}
      retryRead={() => {
        void Promise.all([
          recordRefresh({ cancelRefetch: false }),
          sourceRefresh({ cancelRefetch: false }),
          capabilityRefresh({ cancelRefetch: false }),
        ]);
      }}
      lineId={lineId ?? ''}
      action={sourceAction as SourceAction}
    />
  );
}
function SourceActionForm({
  domain,
  initial,
  lineId,
  action,
  readError,
  retryRead,
}: {
  domain: DemandDomain;
  initial: { row: Demand; source?: Source };
  lineId: string;
  action: SourceAction;
  readError?: unknown;
  retryRead: () => void;
}) {
  const { t } = useTranslation(),
    { session } = useAuthentication(),
    api = useApiClient(),
    cache = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation(),
    path = useResolvedPath('.').pathname,
    toast = useToaster(),
    confirmation = useConfirm(),
    key = useRequestKey();
  const [basis, setBasis] = useState(initial),
    [reason, setReason] = useState(''),
    [rule, setRule] = useState('base'),
    [invalid, setInvalid] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [conflicted, setConflicted] = useState(false),
    [latest, setLatest] = useState<typeof initial>(),
    [completed, setCompleted] = useState<Source>();
  const busyRef = useRef(false),
    guard = useLeaveGuard(!!reason.trim(), busy, path),
    line = basis.row.lines.find((l) => l.id === lineId),
    source = basis.source;
  const caps = useDemandQuery<{ data: SourceCapabilities }>(
      domain,
      `requests/${basis.row.id}/capabilities`,
      true,
      {},
      true,
    ),
    cap = caps.data?.data.actions[action];
  const sameVersion =
    caps.data?.data.recordRevision === basis.row.revision &&
    caps.data.data.lifecycleVersion === basis.row.lifecycleVersion;
  const material = useDemandQuery<{ data: Candidate }>(
    domain,
    `requestMaterialOptions/${source?.proposedSkuId}`,
    action === 'confirmMaterial' && !!source?.proposedSkuId,
    { subjectId: basis.row.subjectId },
  );
  const candidate = material.data?.data,
    pack = candidate?.packages?.find((p) => p.id === rule);
  const selection = {
    kind: 'known',
    subjectId: basis.row.subjectId,
    skuId: source?.proposedSkuId ?? '',
    unitId:
      rule === 'base' ? (candidate?.baseUnitId ?? '') : (pack?.unitId ?? ''),
    quantity: line?.requestedQuantity ?? '',
    ...(rule === 'base' ? {} : { unitRuleId: rule }),
  };
  const preview = useQuery({
    queryKey: [
      demandPrefix(domain),
      'source-confirm-preview',
      selection,
      source?.revision,
    ],
    enabled:
      action === 'confirmMaterial' &&
      !!selection.unitId &&
      !!line &&
      !material.error &&
      !material.isFetching,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{
        data: {
          baseQuantity: string;
          materialSnapshot: { baseUnitName: string };
        };
      }>({
        path: `${domain}/requestMaterialSelections`,
        method: 'POST',
        json: selection,
        signal,
      }),
  });
  const failure = error ?? readError;
  const terminal =
    failure instanceof ApiClientError &&
    [401, 403, 404].includes(failure.status);
  const label = t(
    sourceUi(action === 'requestGovernance' && source ? 'resubmit' : action),
  );
  const title = t(sourceUi('actionTitle'), {
    action: label,
    code: basis.row.code,
    number: line?.lineNo ?? '—',
  });
  const sourceEligible =
    action === 'requestGovernance'
      ? line?.identificationStatus !== 'identified' &&
        (!source || ['invalidated', 'needsInformation'].includes(source.status))
      : action === 'takeOverSource'
        ? !!source &&
          ['pending', 'needsInformation', 'offered'].includes(source.status) &&
          source.sourceHandlerId !== session?.user.id
        : source?.status === 'offered';
  const canSubmit =
    !readError &&
    sourceEligible &&
    !!line &&
    !!cap?.enabled &&
    sameVersion &&
    !caps.error &&
    !caps.isFetching &&
    !terminal &&
    !conflicted &&
    !completed &&
    (action !== 'confirmMaterial' ||
      (!!preview.data &&
        !preview.error &&
        !preview.isFetching &&
        !material.isFetching &&
        !material.error));
  const back = () => {
    guard.complete();
    void navigate(
      { pathname: '..', search: location.search },
      { relative: 'route', replace: true },
    );
    requestAnimationFrame(() =>
      document.getElementById(`source-line-${lineId}`)?.focus(),
    );
  };
  const reload = async () => {
    const [record, result] = await Promise.all([
      api.request<{ data: Demand }>({
        path: `${domain}/requests/${basis.row.id}`,
      }),
      api.request<{ data: Source[] }>({
        path: `${domain}/requests/${basis.row.id}/sources`,
      }),
    ]);
    return {
      row: record.data,
      source: result.data.find(
        (s) =>
          s.purchaseRequestLineId === lineId ||
          s.materialIssueRequestLineId === lineId,
      ),
      sources: result.data,
    };
  };
  const finish = async () => {
    try {
      const latest = await reload();
      cache.setQueryData(
        [demandPrefix(domain), `requests/${basis.row.id}`, {}],
        { data: latest.row },
      );
      cache.setQueryData(
        [demandPrefix(domain), `requests/${basis.row.id}/sources`, {}],
        { data: latest.sources },
      );
      void cache.invalidateQueries({
        queryKey: [demandPrefix(domain)],
        refetchType: 'active',
      });
      void cache.invalidateQueries({ queryKey: ['material-list'] });
      toast.show({
        type: 'success',
        title: t(sourceUi('done'), {
          action: label,
          code: latest.row.code,
          number: line?.lineNo,
        }),
      });
      back();
    } catch (e) {
      setError(e);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current || !canSubmit) return;
    setInvalid(true);
    if (!reason.trim() || reason.trim().length > 3000) {
      document.getElementById('source-action-reason')?.focus();
      return;
    }
    if (
      (action !== 'requestGovernance' || source) &&
      !(await confirmation.ask(
        title,
        t(
          sourceUi(
            action === 'confirmMaterial'
              ? 'confirmHint'
              : action === 'rejectMaterial'
                ? 'rejectHint'
                : action === 'takeOverSource'
                  ? 'takeOverHint'
                  : 'resubmitHint',
          ),
        ),
        label,
      ))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    const values = {
      version: basis.row.revision,
      lifecycleVersion: basis.row.lifecycleVersion,
      lineVersion: line.revision,
      inputRevision: line.inputRevision,
      reason: reason.trim(),
      ...(action === 'requestGovernance'
        ? {
            retry: !!source,
            ...(source ? { sourceVersion: source.revision } : {}),
          }
        : { sourceId: source?.id, sourceVersion: source?.revision }),
      ...(action === 'confirmMaterial'
        ? {
            unitId: selection.unitId,
            unitRuleId: rule === 'base' ? null : rule,
          }
        : {}),
    };
    try {
      const saved = await api.request<{ data: Source }>({
        path: `${domain}/requests/${basis.row.id}/lines/${lineId}/${action}`,
        method: 'POST',
        json: { ...values, requestKey: key.for(values) },
      });
      setCompleted(saved.data);
      cache.setQueryData<{ data: Source[] }>(
        [demandPrefix(domain), `requests/${basis.row.id}/sources`, {}],
        (old) => ({
          data: [
            ...(old?.data ?? []).filter(
              (s) =>
                s.purchaseRequestLineId !== lineId &&
                s.materialIssueRequestLineId !== lineId,
            ),
            saved.data,
          ],
        }),
      );
      await finish();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 409) setConflicted(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setLatest(await reload());
      await caps.refetch();
    } catch (e) {
      setError(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <RouteDialog
        title={title}
        description={t(sourceUi('actionDescription'))}
        className={action === 'confirmMaterial' ? undefined : 'sm:max-w-md'}
        beforeClose={() => {
          if (busy) return false;
          if (completed) {
            guard.complete();
            return true;
          }
          return guard.leave();
        }}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                void (completed ? Promise.resolve(true) : guard.leave()).then(
                  (ok) => {
                    if (ok) back();
                  },
                )
              }
            >
              {t(sourceUi('cancel'))}
            </Button>
            {completed ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void finish().finally(() => setBusy(false));
                }}
              >
                {busy && <Spinner />}
                {t(sourceUi('loadResult'))}
              </Button>
            ) : (
              <Button
                form='source-action-form'
                type='submit'
                disabled={busy || !canSubmit}
              >
                {busy && <Spinner />}
                {label}
              </Button>
            )}
          </>
        }
      >
        <form
          id='source-action-form'
          onSubmit={(e) => void submit(e)}
          className='flex flex-col gap-4'
        >
          {completed && (
            <Alert>
              <AlertDescription>
                {t(sourceUi('completedRefresh'))}
              </AlertDescription>
            </Alert>
          )}
          {Boolean(failure) && (
            <SourceError
              error={failure}
              message={completed ? t(sourceUi('resultReadFailed')) : undefined}
              retry={!completed && readError ? retryRead : undefined}
            />
          )}
          {caps.error && (
            <SourceError error={caps.error} retry={() => void caps.refetch()} />
          )}
          {(!cap?.enabled || !sourceEligible) && caps.data && (
            <p className='text-sm text-muted-foreground'>
              {t(sourceUi('notEligible'))}
            </p>
          )}
          {!line ? (
            <p>{t(sourceUi('missingLine'))}</p>
          ) : (
            <>
              <div className='flex flex-col gap-2 rounded-lg border p-4 text-sm'>
                <p className='font-medium'>{line.originalName}</p>
                <LongText>{line.originalSpecification}</LongText>
                <p>
                  {line.requestedQuantity} {line.requestedUnitText}
                </p>
                {source?.display?.handler && (
                  <p>
                    {t(sourceUi('handler'))}: {source.display.handler}
                  </p>
                )}
              </div>
              {action === 'confirmMaterial' && (
                <>
                  <p className='text-sm'>{t(sourceUi('confirmHint'))}</p>
                  {material.error && (
                    <SourceError
                      error={material.error}
                      retry={() => void material.refetch()}
                    />
                  )}
                  {material.isPending ? (
                    <SourceLoading />
                  ) : (
                    candidate && (
                      <>
                        <p className='font-medium'>
                          {candidate.code} · {candidate.name}
                        </p>
                        <Field>
                          <FieldLabel htmlFor='source-confirm-unit'>
                            {t(sourceUi('unit'))} *
                          </FieldLabel>
                          <PeopleSelect
                            id='source-confirm-unit'
                            label={t(sourceUi('unit'))}
                            value={rule}
                            disabled={busy || !!completed}
                            items={[
                              {
                                value: 'base',
                                label: `${candidate.baseUnitName ?? '—'} · 1/1`,
                              },
                              ...(candidate.packages ?? []).map((p) => ({
                                value: p.id,
                                label: `${p.name} · ${p.unitName} · ${p.numerator}/${p.denominator} ${candidate.baseUnitName ?? ''}`,
                              })),
                            ]}
                            onChange={setRule}
                          />
                        </Field>
                        {preview.error ? (
                          <SourceError
                            error={preview.error}
                            retry={() => void preview.refetch()}
                          />
                        ) : (
                          <p role='status'>
                            {t(sourceUi('baseQuantity'))}:{' '}
                            {preview.isFetching
                              ? t(sourceUi('loading'))
                              : `${preview.data?.data.baseQuantity ?? '—'} ${preview.data?.data.materialSnapshot.baseUnitName ?? ''}`}
                          </p>
                        )}
                      </>
                    )
                  )}
                </>
              )}
              <Field
                data-invalid={
                  invalid && (!reason.trim() || reason.trim().length > 3000)
                }
              >
                <FieldLabel htmlFor='source-action-reason'>
                  {t(sourceUi('reason'))} *
                </FieldLabel>
                <Textarea
                  id='source-action-reason'
                  value={reason}
                  disabled={busy || !!completed}
                  aria-invalid={
                    invalid && (!reason.trim() || reason.trim().length > 3000)
                  }
                  aria-describedby='source-reason-error'
                  maxLength={3000}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setInvalid(false);
                  }}
                />
                <FieldError id='source-reason-error'>
                  {invalid && (!reason.trim() || reason.trim().length > 3000)
                    ? t(sourceUi('reasonInvalid'))
                    : null}
                </FieldError>
              </Field>
            </>
          )}
          {conflicted && !completed && (
            <div className='flex flex-col gap-3'>
              <p>{t(sourceUi('conflictHint'))}</p>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void loadLatest()}
              >
                {t(sourceUi('readLatest'))}
              </Button>
              {latest && (
                <div className='flex flex-col gap-3 rounded-lg border p-4'>
                  <p>{t(sourceUi('latestHint'))}</p>
                  <p>
                    {latest.row.lines.find((l) => l.id === lineId)
                      ?.originalName ?? t(sourceUi('missingLine'))}
                  </p>
                  {latest.source && (
                    <p>{t(sourceUi(`states.${latest.source.status}`))}</p>
                  )}
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => {
                      setBasis(latest);
                      setLatest(undefined);
                      setConflicted(false);
                      setError(undefined);
                      setRule('base');
                      key.reset();
                    }}
                  >
                    {t(sourceUi('useLatest'))}
                  </Button>
                </div>
              )}
            </div>
          )}
        </form>
      </RouteDialog>
      {guard.dialog}
      {confirmation.dialog}
    </>
  );
}
