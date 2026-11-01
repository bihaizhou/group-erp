import { useRef, useState, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { randomUuid } from '#lib/random-id';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { DatePicker } from '#components/date-picker';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Alert, AlertDescription } from '#components/ui/alert';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import { Spinner } from '#components/ui/spinner';
import {
  useExecutionQuery,
  useExecutionCan,
  useExecutionRefresh,
  useRequestKey,
  useLeaveGuard,
  useDiscard,
  ui,
} from './hooks.js';
import {
  Loading,
  ErrorNotice,
  ReferencePicker,
  StaticSelect,
  EmptyState,
} from './controls.js';
import { LineEditor } from './line-editor.js';
import { compareDraft, applyDraftMerge } from './merge.js';
import {
  pageFor,
  executionPages,
  isOrder,
  isWarehouse,
  blankDraft,
  recordDraft,
  requestContent,
  validateDraft,
  same,
  inboundKinds,
  outboundKinds,
  sourceField,
  type Draft,
  type ExecutionPage,
  type ExecutionRecord,
  type Choice,
  type Source,
  type Capabilities,
  type Page,
  type DocumentKind,
} from './model.js';

export default function ExecutionForm() {
  const location = useLocation(),
    { id: routeId, documentId } = useParams(),
    id = documentId ?? routeId,
    parent = pageFor(useResolvedPath('.').pathname),
    mode = location.pathname.endsWith('/copy')
      ? 'copy'
      : location.pathname.endsWith('/new')
        ? 'new'
        : 'edit',
    nested =
      mode === 'new'
        ? /\/(receipts|shipments|dispatch|receive|discrepancy|reversal|returns)\/new$/u.exec(
            location.pathname,
          )?.[1]
        : undefined,
    sourceRecord = useExecutionQuery<{ data: ExecutionRecord }>(
      `${parent.api}/${id}`,
      {},
      !!id,
    ),
    config = nested
      ? executionPages.find(
          (page) =>
            page.kind ===
            (['receipts', 'receive', 'reversal'].includes(nested) ||
            (nested === 'returns' &&
              sourceRecord.data?.data.kind !== 'purchaseReceipt')
              ? 'inbounds'
              : 'outbounds'),
        )!
      : parent,
    capabilities = useExecutionQuery<{ data: Capabilities }>(
      `${parent.api}/${id}/capabilities`,
      {},
      !!id && mode !== 'new',
    ),
    create = useExecutionCan(config.resource, 'create'),
    clock = useExecutionQuery<Page<Choice>>(
      `${config.api}/companies`,
      { page: 1, pageSize: 1 },
      create.can || !!id,
    ),
    { t } = useTranslation(),
    [opened, setOpened] = useState<{
      identity: string;
      record?: ExecutionRecord;
    }>(),
    identity = `${location.pathname}:${id ?? ''}`;
  if (opened && opened.identity !== identity) setOpened(undefined);
  if (
    !opened &&
    mode === 'new' &&
    create.can &&
    clock.data &&
    !clock.isFetching &&
    (!nested || (sourceRecord.data && !sourceRecord.isFetching))
  )
    setOpened({
      identity,
      record: nested ? sourceRecord.data?.data : undefined,
    });
  if (
    !opened &&
    mode !== 'new' &&
    sourceRecord.data &&
    capabilities.data &&
    !sourceRecord.isFetching &&
    !capabilities.isFetching
  )
    setOpened({ identity, record: sourceRecord.data.data });
  const allowed =
      mode === 'new'
        ? create.can
        : capabilities.data?.data.actions[mode === 'copy' ? 'copy' : 'update']
            ?.enabled,
    title = t(
      ui(
        mode === 'new'
          ? `create.${config.kind}`
          : mode === 'copy'
            ? 'actions.copy'
            : 'edit',
      ),
    );
  return (
    <RouteChildPage>
      <PageContainer>
        {opened?.identity === identity && allowed ? (
          <FormBody
            key={identity}
            config={config}
            mode={mode}
            initial={opened.record}
            nested={nested}
            title={title}
            date={clock.data?.meta.businessDate ?? ''}
          />
        ) : sourceRecord.error || capabilities.error || clock.error ? (
          <>
            <BackButton />
            <ErrorNotice
              error={sourceRecord.error ?? capabilities.error ?? clock.error}
              retry={() => {
                void sourceRecord.refetch();
                void capabilities.refetch();
                void clock.refetch();
              }}
            />
          </>
        ) : create.isPending ||
          sourceRecord.isFetching ||
          capabilities.isFetching ||
          clock.isFetching ||
          (!opened && allowed) ? (
          <Loading kind='form' />
        ) : (
          <>
            <BackButton />
            <EmptyState type='restricted' />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function FormBody({
  config,
  mode,
  initial,
  nested,
  title,
  date,
}: {
  config: ExecutionPage;
  mode: 'new' | 'edit' | 'copy';
  initial?: ExecutionRecord;
  nested?: string;
  title: string;
  date: string;
}) {
  const { t } = useTranslation(),
    location = useLocation(),
    navigate = useNavigate(),
    ownPath = useResolvedPath('.').pathname,
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    refresh = useExecutionRefresh(),
    key = useRequestKey(),
    discard = useDiscard(),
    params = new URLSearchParams(location.search),
    initialDraft = () => {
      if (mode === 'edit' && initial) return recordDraft(initial);
      if (mode === 'copy' && initial) {
        const copy = recordDraft(initial);
        copy.lines =
          config.kind === 'stockCounts'
            ? []
            : copy.lines.map((line) => ({ ...line, id: randomUuid() }));
        return copy;
      }
      const value = blankDraft(
        initial?.subjectId ?? params.get('subjectId') ?? '',
        date,
      );
      value.warehouseId = params.get('warehouseId') ?? '';
      const kinds = config.kind === 'outbounds' ? outboundKinds : inboundKinds;
      value.kind =
        kinds.find((kind) => kind === params.get('kind')) ??
        (config.kind === 'outbounds' ? 'issue' : 'purchaseReceipt');
      if (nested && initial) {
        value.warehouseId =
          nested === 'receive'
            ? (initial.destinationWarehouseId ?? '')
            : initial.warehouseId;
        value.sourceId = initial.id;
        value.kind = (
          {
            receipts: 'purchaseReceipt',
            shipments: 'salesShipment',
            dispatch: 'transferDispatch',
            receive: 'transferReceipt',
            discrepancy: 'transferDiscrepancy',
            reversal: 'reversal',
            returns:
              initial.kind === 'purchaseReceipt'
                ? 'purchaseReturn'
                : initial.kind === 'salesShipment'
                  ? 'salesReturn'
                  : 'issueReturn',
          } as Record<string, DocumentKind>
        )[nested];
      }
      return value;
    },
    [draft, setDraft] = useState<Draft>(initialDraft),
    [baseline, setBaseline] = useState(() => structuredClone(draft)),
    [version, setVersion] = useState(initial),
    [changeReason, setChangeReason] = useState(''),
    [attempted, setAttempted] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [committed, setCommitted] = useState<ExecutionRecord>(),
    [conflicted, setConflicted] = useState(false),
    [merge, setMerge] = useState<{
      record: ExecutionRecord;
      comparison: ReturnType<typeof compareDraft>;
    }>(),
    [choices, setChoices] = useState<Record<string, 'local' | 'latest'>>({}),
    lockRef = useRef(false),
    guard = useLeaveGuard(
      !committed && (!same(draft, baseline) || !!changeReason),
      busy,
      ownPath,
    ),
    source = useExecutionQuery<Page<Source>>(
      `${config.api}/sourceOptions`,
      {
        kind: draft.kind,
        subjectId: draft.subjectId,
        warehouseId: draft.warehouseId,
        sourceId: draft.sourceId,
        page: 1,
        pageSize: 1,
      },
      isWarehouse(config) &&
        !!sourceField[draft.kind] &&
        !!draft.subjectId &&
        !!draft.warehouseId &&
        !!draft.sourceId,
    ),
    company = useExecutionQuery<{ data: Choice }>(
      `${config.api}/companies/${draft.subjectId}`,
      {},
      !!draft.subjectId,
    ),
    warehouse = useExecutionQuery<{ data: Choice }>(
      `${config.api}/warehouses/${draft.warehouseId}`,
      { subjectId: draft.subjectId },
      !!draft.subjectId && !!draft.warehouseId,
    ),
    partner = useExecutionQuery<{ data: Choice }>(
      `${config.api}/partnerOptions/${draft.partnerId}`,
      { subjectId: draft.subjectId },
      isOrder(config) && !!draft.subjectId && !!draft.partnerId,
    ),
    destination = useExecutionQuery<{ data: Choice }>(
      `${config.api}/warehouses/${draft.destinationWarehouseId}`,
      { subjectId: draft.subjectId },
      config.kind === 'stockTransfers' &&
        !!draft.subjectId &&
        !!draft.destinationWarehouseId,
    ),
    selectedSource = source.data?.data[0];
  const update = (next: Draft) => {
      setDraft(next);
      if (attempted)
        setErrors(
          validateDraft(
            config,
            next,
            mode === 'new' ? undefined : changeReason,
          ),
        );
    },
    setField = (field: keyof Draft, value: string) =>
      update({ ...draft, [field]: value }),
    clearDependency = async (
      field: 'subjectId' | 'warehouseId' | 'kind',
      value: string,
    ) => {
      if (draft[field] === value) return;
      if (
        (draft.lines.length || draft.sourceId) &&
        !(await discard.ask(
          t(ui('clearSelectionTitle')),
          t(ui('clearHint')),
          t(ui('clearSelection')),
        ))
      )
        return;
      const next = {
        ...draft,
        [field]: value,
        sourceId: '',
        originalPostingId: '',
        lines: [],
      };
      if (field === 'subjectId') {
        next.warehouseId = '';
        next.destinationWarehouseId = '';
        next.partnerId = '';
      }
      update(next);
    },
    back = { pathname: '..', search: location.search },
    close = () => {
      void guard.leave().then((ok) => {
        if (ok) void navigate(back, { relative: 'route' });
      });
    },
    field = (name: keyof Draft, textarea = false, required = false) => {
      const value = draft[name];
      return (
        <Field data-invalid={!!errors[name]}>
          <FieldLabel htmlFor={name}>
            {t(ui(name))}
            {required ? ' *' : ''}
          </FieldLabel>
          {textarea ? (
            <Textarea
              id={name}
              value={typeof value === 'string' ? value : ''}
              disabled={busy || !!committed}
              maxLength={
                name === 'notes' || name === 'deliveryTerms' ? 6000 : 3000
              }
              aria-invalid={!!errors[name]}
              onChange={(event) => setField(name, event.target.value)}
            />
          ) : (
            <Input
              id={name}
              value={typeof value === 'string' ? value : ''}
              disabled={busy || !!committed}
              maxLength={name === 'currency' ? 3 : 200}
              aria-invalid={!!errors[name]}
              onChange={(event) => setField(name, event.target.value)}
            />
          )}{' '}
          {errors[name] && <FieldError>{t(ui(errors[name]))}</FieldError>}
        </Field>
      );
    };
  const showSaved = async (saved: ExecutionRecord) => {
    cache.setQueryData(['execution', `${config.api}/${saved.id}`, {}], {
      data: saved,
    });
    void refresh();
    guard.complete();
    const target = nested
      ? { pathname: '..', search: location.search }
      : { pathname: `${config.base}/${saved.id}`, search: location.search };
    void navigate(target, { replace: true, relative: 'route' });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lockRef.current || committed || conflicted || merge) return;
    setAttempted(true);
    const validation = validateDraft(
      config,
      draft,
      mode === 'new' ? undefined : changeReason,
    );
    setErrors(validation);
    if (Object.keys(validation).length) {
      requestAnimationFrame(() =>
        document.getElementById(Object.keys(validation)[0])?.focus(),
      );
      return;
    }
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    const content = requestContent(config, {
        ...draft,
        originalPostingId:
          draft.originalPostingId || selectedSource?.postingId || '',
      }),
      body = {
        content,
        ...(mode !== 'new' && version
          ? {
              version: version.revision,
              lifecycleVersion: version.lifecycleVersion,
              reason: changeReason.trim(),
            }
          : {}),
      };
    try {
      const result = await api.request<{ data: ExecutionRecord }>({
        path:
          mode === 'new'
            ? config.api
            : mode === 'copy'
              ? `${config.api}/${version!.id}/copy`
              : `${config.api}/${version!.id}`,
        method: mode === 'edit' ? 'PATCH' : 'POST',
        json: { ...body, requestKey: key.for(body) },
      });
      setCommitted(result.data);
      setBaseline(draft);
      toast.show({ type: 'success', title: t(ui('saved')) });
      try {
        const latest = await api.request<{ data: ExecutionRecord }>({
          path: `${config.api}/${result.data.id}`,
        });
        await showSaved(latest.data);
      } catch (readError) {
        setError(readError);
      }
    } catch (writeError) {
      setError(writeError);
      if (writeError instanceof ApiClientError && writeError.status === 409)
        setConflicted(true);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  const readConflict = async () => {
    if (lockRef.current || !version) return;
    lockRef.current = true;
    setBusy(true);
    try {
      const latest = await api.request<{ data: ExecutionRecord }>({
        path: `${config.api}/${version.id}`,
      });
      if (!['draft', 'counting'].includes(latest.data.status))
        throw new Error('Latest record is not editable');
      setMerge({
        record: latest.data,
        comparison: compareDraft(baseline, draft, recordDraft(latest.data)),
      });
      setChoices({});
      setError(undefined);
    } catch (readError) {
      setError(readError);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton />
      <PageHeader
        title={title}
        description={
          initial && !nested
            ? initial.code
            : t(ui(`descriptions.${config.kind}`))
        }
      />
      {!!error && (
        <ErrorNotice
          error={error}
          committed={!!committed}
          retry={
            committed
              ? () => {
                  if (lockRef.current) return;
                  lockRef.current = true;
                  setBusy(true);
                  void api
                    .request<{ data: ExecutionRecord }>({
                      path: `${config.api}/${committed.id}`,
                    })
                    .then((result) => showSaved(result.data))
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
      {source.error && draft.sourceId && (
        <ErrorNotice error={source.error} retry={() => void source.refetch()} />
      )}
      {draft.sourceId &&
        !source.isPending &&
        !source.error &&
        (!selectedSource || selectedSource.available === false) && (
          <p role='alert' className='text-sm text-destructive'>
            {t(ui('unavailable'))}
          </p>
        )}
      {conflicted && !merge && (
        <div>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void readConflict()}
          >
            {t(ui('readAgain'))}
          </Button>
        </div>
      )}
      {merge && (
        <Card>
          <CardHeader>
            <CardTitle>{t(ui('conflict'))}</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-5'>
            <p className='text-sm text-muted-foreground'>
              {t(ui('mergeHint'))}
            </p>
            {merge.comparison.conflicts.map((conflict, index) => (
              <fieldset
                key={conflict.key}
                className='grid gap-3 rounded-lg border p-4'
              >
                <legend className='px-1 text-sm font-medium'>
                  {t(
                    ui(
                      conflict.field === 'subjectId'
                        ? 'company'
                        : conflict.field === 'partnerId'
                          ? config.kind === 'purchaseOrders'
                            ? 'supplier'
                            : 'customer'
                          : conflict.field === 'sourceId'
                            ? 'source'
                            : conflict.field,
                    ),
                  )}{' '}
                  · {index + 1}
                </legend>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <ConflictValue
                    label={t(ui('local'))}
                    value={conflict.local}
                  />
                  <ConflictValue
                    label={t(ui('latest'))}
                    value={conflict.latest}
                  />
                </div>
                <RadioGroup
                  value={choices[conflict.key] ?? ''}
                  onValueChange={(value) =>
                    setChoices((old) => ({
                      ...old,
                      [conflict.key]: value as 'local' | 'latest',
                    }))
                  }
                >
                  <Label className='flex items-center gap-2'>
                    <RadioGroupItem value='local' />
                    {t(ui('keepLocal'))}
                  </Label>
                  <Label className='flex items-center gap-2'>
                    <RadioGroupItem value='latest' />
                    {t(ui('useLatest'))}
                  </Label>
                </RadioGroup>
              </fieldset>
            ))}
            <div className='flex justify-end'>
              <Button
                type='button'
                variant='outline'
                disabled={
                  busy ||
                  merge.comparison.conflicts.some((item) => !choices[item.key])
                }
                onClick={() => {
                  const latest = recordDraft(merge.record),
                    next = applyDraftMerge(merge.comparison, choices);
                  setBaseline(latest);
                  setVersion(merge.record);
                  setDraft(next);
                  setMerge(undefined);
                  setConflicted(false);
                  setErrors(validateDraft(config, next, changeReason));
                  key.reset();
                  toast.show({
                    type: 'success',
                    title: t(ui('unsavedSelection')),
                  });
                }}
              >
                {t(ui('applyMerge'))}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <form
        noValidate
        className='grid gap-6'
        onSubmit={(event) => void save(event)}
        aria-busy={busy}
      >
        <fieldset disabled={busy || !!committed} className='grid min-w-0 gap-6'>
          <Card>
            <CardHeader>
              <CardTitle>{t(ui('details'))}</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-5 md:grid-cols-2'>
              <ReferencePicker<Choice>
                id='subjectId'
                label={`${t(ui('company'))} *`}
                queryPath={`${config.api}/companies`}
                value={draft.subjectId}
                selected={company.data?.data ?? initial?.display.company}
                disabled={mode === 'edit' || !!nested || busy}
                error={errors.subjectId ? t(ui(errors.subjectId)) : undefined}
                onChange={(value) => void clearDependency('subjectId', value)}
              />
              <ReferencePicker<Choice>
                id='warehouseId'
                label={`${t(ui('warehouse'))} *`}
                queryPath={`${config.api}/warehouses`}
                query={{ subjectId: draft.subjectId }}
                value={draft.warehouseId}
                selected={warehouse.data?.data ?? initial?.display.warehouse}
                disabled={
                  !draft.subjectId ||
                  !!nested ||
                  (mode === 'edit' && config.kind === 'stockCounts') ||
                  busy
                }
                error={
                  errors.warehouseId ? t(ui(errors.warehouseId)) : undefined
                }
                onChange={(value) => void clearDependency('warehouseId', value)}
              />
              {isOrder(config) && (
                <>
                  <ReferencePicker<Choice>
                    id='partnerId'
                    label={`${t(ui(config.kind === 'purchaseOrders' ? 'supplier' : 'customer'))} *`}
                    queryPath={`${config.api}/partnerOptions`}
                    query={{ subjectId: draft.subjectId }}
                    value={draft.partnerId}
                    selected={partner.data?.data ?? initial?.display.partner}
                    disabled={!draft.subjectId || busy}
                    error={
                      errors.partnerId ? t(ui(errors.partnerId)) : undefined
                    }
                    onChange={(value) => setField('partnerId', value)}
                  />
                  {field('currency', false, true)}
                  <Field>
                    <FieldLabel>{t(ui('deliveryOn'))}</FieldLabel>
                    <DatePicker
                      value={draft.deliveryOn}
                      label={t(ui('deliveryOn'))}
                      onChange={(value) => setField('deliveryOn', value)}
                    />
                  </Field>
                  {field('deliveryTerms', true)}
                </>
              )}
              {config.kind === 'stockTransfers' && (
                <ReferencePicker<Choice>
                  id='destinationWarehouseId'
                  label={`${t(ui('destinationWarehouse'))} *`}
                  queryPath={`${config.api}/warehouses`}
                  query={{ subjectId: draft.subjectId }}
                  value={draft.destinationWarehouseId}
                  selected={
                    destination.data?.data ??
                    initial?.display.destinationWarehouse
                  }
                  disabled={!draft.subjectId || busy}
                  error={
                    errors.destinationWarehouseId
                      ? t(ui(errors.destinationWarehouseId))
                      : undefined
                  }
                  isOptionDisabled={(option) => option.id === draft.warehouseId}
                  onChange={(value) =>
                    setField('destinationWarehouseId', value)
                  }
                />
              )}
              <Field data-invalid={!!errors.occurredOn}>
                <FieldLabel>{t(ui('occurredOn'))} *</FieldLabel>
                <DatePicker
                  id='occurredOn'
                  value={draft.occurredOn}
                  label={t(ui('occurredOn'))}
                  disabled={busy}
                  onChange={(value) => setField('occurredOn', value)}
                />
                {errors.occurredOn && (
                  <FieldError>{t(ui(errors.occurredOn))}</FieldError>
                )}
              </Field>
              {isWarehouse(config) && (
                <>
                  <Field>
                    <FieldLabel>{t(ui('sourceType'))}</FieldLabel>
                    <StaticSelect
                      label={t(ui('sourceType'))}
                      selectedLabel={t(ui(`kinds.${draft.kind}`))}
                      value={draft.kind}
                      disabled={mode === 'edit' || !!nested || busy}
                      items={(config.kind === 'inbounds'
                        ? inboundKinds
                        : outboundKinds
                      ).map((value) => ({
                        value,
                        label: t(ui(`kinds.${value}`)),
                      }))}
                      onChange={(value) => void clearDependency('kind', value)}
                    />
                  </Field>
                  {sourceField[draft.kind] && (
                    <ReferencePicker<Source>
                      id='sourceId'
                      label={`${t(ui('source'))} *`}
                      queryPath={`${config.api}/sourceOptions`}
                      query={{
                        subjectId: draft.subjectId,
                        warehouseId: draft.warehouseId,
                        kind: draft.kind,
                      }}
                      value={draft.sourceId}
                      selected={
                        selectedSource ??
                        (initial?.lines[0]?.sourceSnapshot
                          ? {
                              id: initial.lines[0].sourceSnapshot.id,
                              code: initial.lines[0].sourceSnapshot.code,
                              lines: [],
                              subjectId: draft.subjectId,
                              warehouseId: draft.warehouseId,
                              status: '',
                              revision: 0,
                              lifecycleVersion: 0,
                            }
                          : undefined)
                      }
                      selectedLabel={(item) => item.code}
                      isOptionDisabled={(item) => item.available === false}
                      renderOption={(item) => (
                        <span>
                          {item.code}
                          <span className='block text-xs text-muted-foreground'>
                            {t(ui('sourceLines'), { count: item.lines.length })}
                          </span>
                        </span>
                      )}
                      disabled={
                        !draft.subjectId ||
                        !draft.warehouseId ||
                        !!nested ||
                        busy
                      }
                      error={
                        errors.sourceId ? t(ui(errors.sourceId)) : undefined
                      }
                      onChange={(value, item) => {
                        void (async () => {
                          if (
                            draft.lines.length &&
                            !(await discard.ask(
                              t(ui('clearSelectionTitle')),
                              t(ui('clearHint')),
                              t(ui('clearSelection')),
                            ))
                          )
                            return;
                          update({
                            ...draft,
                            sourceId: value,
                            originalPostingId: item?.postingId ?? '',
                            lines: [],
                          });
                        })();
                      }}
                    />
                  )}
                </>
              )}
              {isWarehouse(config) &&
                draft.kind === 'initial' &&
                field('initializationReference', false, true)}
              {isWarehouse(config) &&
                draft.kind === 'loss' &&
                field('lossEvidence', true, true)}
              {isWarehouse(config) &&
                draft.kind === 'qualityTransfer' &&
                field('inspectionEvidence', true, true)}
              {isWarehouse(config) &&
                ['reversal', 'transferDiscrepancy'].includes(draft.kind) &&
                field('evidence', true, true)}
              {isWarehouse(config) &&
                ['productionReceipt', 'productionIssue'].includes(
                  draft.kind,
                ) && (
                  <div className='grid gap-4 rounded-lg border p-4 md:col-span-2 md:grid-cols-2'>
                    {(['reference', 'title', 'description'] as const).map(
                      (name) => (
                        <Field
                          key={name}
                          data-invalid={!!errors[`productionEvidence.${name}`]}
                        >
                          <FieldLabel htmlFor={`productionEvidence.${name}`}>
                            {t(
                              ui(
                                (
                                  {
                                    reference: 'productionReference',
                                    title: 'productionTitle',
                                    description: 'productionDescription',
                                  } as const
                                )[name],
                              ),
                            )}{' '}
                            *
                          </FieldLabel>
                          <Textarea
                            id={`productionEvidence.${name}`}
                            value={draft.productionEvidence[name]}
                            maxLength={name === 'description' ? 6000 : 200}
                            onChange={(event) =>
                              update({
                                ...draft,
                                productionEvidence: {
                                  ...draft.productionEvidence,
                                  [name]: event.target.value,
                                },
                              })
                            }
                          />
                          {errors[`productionEvidence.${name}`] && (
                            <FieldError>
                              {t(ui(errors[`productionEvidence.${name}`]))}
                            </FieldError>
                          )}
                        </Field>
                      ),
                    )}
                    <Field>
                      <FieldLabel>{t(ui('occurredOn'))} *</FieldLabel>
                      <DatePicker
                        value={draft.productionEvidence.occurredOn}
                        label={t(ui('occurredOn'))}
                        onChange={(value) =>
                          update({
                            ...draft,
                            productionEvidence: {
                              ...draft.productionEvidence,
                              occurredOn: value,
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                )}
              {field('reason', true, isWarehouse(config))}
              {field('notes', true)}
            </CardContent>
          </Card>
          {source.error && (
            <ErrorNotice
              error={source.error}
              retry={() => void source.refetch()}
            />
          )}
          {draft.kind !== 'reversal' ? (
            <LineEditor
              config={config}
              apiPath={config.api}
              draft={draft}
              onChange={update}
              initial={mode === 'new' ? undefined : initial}
              source={selectedSource}
              errors={errors}
              busy={busy || !!committed}
              orderId={mode === 'edit' ? initial?.id : undefined}
            />
          ) : (
            <Alert>
              <AlertDescription>{t(ui('reverseHint'))}</AlertDescription>
            </Alert>
          )}
          {isOrder(config) && (
            <p className='text-sm text-muted-foreground'>
              {t(ui('noPriceCalculation'))}
            </p>
          )}
          {mode !== 'new' && (
            <Field data-invalid={!!errors.changeReason}>
              <FieldLabel htmlFor='changeReason'>
                {t(ui('changeReason'))} *
              </FieldLabel>
              <Textarea
                id='changeReason'
                value={changeReason}
                maxLength={3000}
                aria-invalid={!!errors.changeReason}
                onChange={(event) => {
                  setChangeReason(event.target.value);
                  if (attempted)
                    setErrors(validateDraft(config, draft, event.target.value));
                }}
              />
              {errors.changeReason && (
                <FieldError>{t(ui(errors.changeReason))}</FieldError>
              )}
            </Field>
          )}
        </fieldset>
        {!committed && (
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={close}
            >
              {t(ui('cancel'))}
            </Button>
            <Button
              type='submit'
              disabled={
                busy ||
                conflicted ||
                (!!draft.sourceId &&
                  (source.isFetching ||
                    !!source.error ||
                    !selectedSource ||
                    selectedSource.available === false)) ||
                !!merge ||
                (source.isFetching && !!draft.sourceId)
              }
            >
              {busy && <Spinner />}
              {t(ui('save'))}
            </Button>
          </div>
        )}
      </form>
      {guard.dialog}
      {discard.dialog}
    </>
  );
}

function ConflictValue({ label, value }: { label: string; value: unknown }) {
  const { t } = useTranslation();
  const describe = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return t(ui(v ? 'yes' : 'no'));
    if (typeof v === 'string')
      return /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(v)
        ? t(ui('referenceChanged'))
        : v;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(describe).join(' · ') || '—';
    return Object.entries(v as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            'id',
            'subjectId',
            'skuId',
            'unitId',
            'unitRuleId',
            'requestId',
            'requestLineId',
            'requestVersionId',
          ].includes(key),
      )
      .map(
        ([key, val]) =>
          `${t(ui(key === 'selection' ? 'material' : key))}: ${describe(val)}`,
      )
      .join(' · ');
  };
  return (
    <div className='min-w-0 rounded-md bg-muted p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-2 whitespace-pre-wrap break-words text-sm'>
        {describe(value)}
      </p>
    </div>
  );
}
