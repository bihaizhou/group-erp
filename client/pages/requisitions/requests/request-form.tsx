import { useDemandAttachmentMetadata } from '#components/demand-attachments/hooks';
import { AccessDenied } from '#components/access-denied';
import type { DemandAttachment } from '#components/demand-attachments/model';
import { DemandAttachments } from '#components/demand-attachments/index';
import { useRef, useState, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
  useSearchParams,
  Outlet,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Plus } from 'lucide-react';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { DatePicker } from '#components/date-picker';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '#components/ui/field';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Spinner } from '#components/ui/spinner';
import { randomUuid } from '#lib/random-id';
import {
  ui,
  useRequest,
  useCapabilities,
  useIssueCan,
  useIssueRefresh,
  useRequestKey,
  useLeaveGuard,
  useConfirm,
} from './hooks.js';
import {
  ReferencePicker,
  ErrorNotice,
  Loading,
  ConflictChoices,
} from './controls.js';
import {
  blankContent,
  requestContent,
  validateContent,
  same,
  newLine,
  compareContent,
  applyContentMerge,
  type Content,
  type IssueRequest,
  type Choice,
  type DemandLine,
  type Preview,
} from './model.js';
import { LineEditor } from './line-editor.js';
type Mode = 'new' | 'edit' | 'copy';
export interface FormContext {
  content: Content;
  setSelection: (
    lineId: string,
    selection: DemandLine['selection'],
    preview: Preview,
  ) => void;
  hints: Record<string, Preview>;
  allowNavigation: (fn: () => void) => void;
}
export default function RequestFormPage() {
  const { t } = useTranslation(),
    { requestId } = useParams(),
    path = useResolvedPath('.').pathname;
  const mode: Mode = path.endsWith('/new')
    ? 'new'
    : path.endsWith('/copy')
      ? 'copy'
      : 'edit';
  const record = useRequest(mode === 'new' ? undefined : requestId),
    cap = useCapabilities(mode === 'new' ? undefined : requestId),
    create = useIssueCan('create');
  const [loaded, setLoaded] = useState<{
    identity: string;
    record: IssueRequest;
  }>();
  const [newOpened, setNewOpened] = useState(false);
  if (mode === 'new' && create.can && !create.isPending && !newOpened)
    setNewOpened(true);
  const identity = `${mode}-${requestId}`;
  if (loaded && loaded.identity !== identity) setLoaded(undefined);
  if (
    mode !== 'new' &&
    loaded?.identity !== identity &&
    record.data &&
    cap.data &&
    !record.isFetching &&
    !cap.isFetching
  )
    setLoaded({ identity, record: record.data.data });
  const ready = loaded?.identity === identity ? loaded.record : undefined;
  const allowed =
    mode === 'new'
      ? create.can
      : cap.data?.data.actions[mode === 'copy' ? 'copy' : 'update']?.visible;
  const title = t(
    ui(
      mode === 'new'
        ? 'createTitle'
        : mode === 'copy'
          ? 'copyTitle'
          : 'editTitle',
    ),
  );
  return (
    <RouteChildPage>
      <PageContainer>
        {mode === 'new' ? (
          newOpened ? (
            <FormBody mode={mode} path={path} />
          ) : create.isPending ? (
            <Loading kind='form' />
          ) : !allowed ? (
            <>
              <BackButton />
              <AccessDenied title={t(ui('forbidden'))} />
            </>
          ) : (
            <FormBody mode={mode} path={path} />
          )
        ) : ready ? (
          <FormBody key={identity} mode={mode} path={path} initial={ready} />
        ) : record.error || cap.error ? (
          <>
            <BackButton />
            <ErrorNotice
              error={record.error ?? cap.error}
              retry={() => {
                void record.refetch();
                void cap.refetch();
              }}
            />
          </>
        ) : (
          <>
            <PageHeader title={title} />
            <Loading kind='form' />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function FormBody({
  mode,
  path,
  initial,
}: {
  mode: Mode;
  path: string;
  initial?: IssueRequest;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    navigate = useNavigate(),
    location = useLocation(),
    [params] = useSearchParams(),
    refresh = useIssueRefresh();
  const initialContent = () => {
    const c = initial
      ? requestContent(initial)
      : blankContent(params.get('subjectId') ?? '');
    if (mode === 'copy') {
      c.lines = c.lines.map((l) => ({ ...l, id: randomUuid() }));
      c.attachments = [];
    }
    return c;
  };
  const [baseline, setBaseline] = useState(initialContent),
    [draft, setDraft] = useState(() => structuredClone(baseline)),
    [row, setRow] = useState(initial),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<unknown>(),
    [serverErrors, setServerErrors] = useState<Record<string, string>>({}),
    [attempted, setAttempted] = useState(false),
    [unitNeedsReselection, setUnitNeedsReselection] = useState(false),
    [latest, setLatest] = useState<IssueRequest>(),
    [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({}),
    [refs, setRefs] = useState<Record<string, Choice | undefined>>({}),
    [hints, setHints] = useState<Record<string, Preview>>(() =>
      Object.fromEntries(
        (initial?.lines ?? [])
          .filter((l) => l.status === 'active')
          .map((line, i) => [
            mode === 'copy' ? (baseline.lines[i]?.id ?? line.id) : line.id,
            line,
          ]),
      ),
    );
  const key = useRequestKey(),
    busyRef = useRef(false),
    confirm = useConfirm();
  const dirty = !same(baseline, draft) || !!reason.trim(),
    guard = useLeaveGuard(dirty, busy || uploading, path);
  const cap = useCapabilities(mode === 'new' ? undefined : initial?.id),
    create = useIssueCan('create');
  const currentCapability =
    cap.data?.data.actions[mode === 'copy' ? 'copy' : 'update'];
  const allowed =
    mode === 'new' ? create.can : !cap.error && !!currentCapability?.enabled;
  const terminal =
    error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const remoteNotDraft = mode === 'edit' && latest && latest.status !== 'draft';
  const companyLocked =
    mode === 'edit' && !!row && (row.reviewRound > 0 || row.lines.length > 0);
  const errors: Record<string, string> = {
    ...serverErrors,
    ...(attempted
      ? validateContent(draft, mode === 'new' ? undefined : reason)
      : {}),
    ...(attempted && unitNeedsReselection
      ? { requestingUnitId: 'requesterUnitMismatch' }
      : {}),
  };
  const fieldError = (name: string) => (
    <>
      {errors[name] && (
        <FieldError>
          {t(ui(errors[name]), {
            field: t(ui(name === 'subjectId' ? 'company' : name)),
          })}
        </FieldError>
      )}
    </>
  );
  const update = <K extends keyof Content>(field: K, value: Content[K]) => {
    setServerErrors((old) =>
      Object.fromEntries(Object.entries(old).filter(([key]) => key !== field)),
    );
    setDraft((old) => ({ ...old, [field]: value }));
  };
  const title = t(
    ui(
      mode === 'new'
        ? 'createTitle'
        : mode === 'copy'
          ? 'copyTitle'
          : 'editTitle',
    ),
  );
  const exit = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { replace: true, relative: 'route' },
    );
  const cancel = async () => {
    if (await guard.leave()) exit();
  };
  const changeCompany = async (value: string, item?: Choice) => {
    if (value === draft.subjectId) return;
    if (
      (draft.requesterEmployeeId ||
        draft.recipientEmployeeId ||
        draft.requestingUnitId ||
        draft.purposeId ||
        draft.lines.length) &&
      !(await confirm.ask(
        t(ui('companyChangeTitle')),
        t(ui('companyChangeHint')),
        t(ui('confirmCompanyChange')),
      ))
    )
      return;
    setRefs({ company: item });
    setUnitNeedsReselection(false);
    setHints({});
    setDraft((old) => ({
      ...blankContent(value),
      usage: old.usage,
      neededOn: old.neededOn,
      notes: old.notes,
      lines: old.lines.map((l) => ({
        ...l,
        selection: {
          kind: 'unknown',
          subjectId: value,
          originalName:
            l.originalName ||
            (l.selection.kind === 'unknown' ? l.selection.originalName : ''),
          originalSpecification:
            l.originalSpecification ||
            (l.selection.kind === 'unknown'
              ? l.selection.originalSpecification
              : ''),
          requestedUnitText:
            l.selection.kind === 'unknown' ? l.selection.requestedUnitText : '',
          quantity: l.selection.quantity,
        },
      })),
    }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || uploading || !allowed || terminal || remoteNotDraft)
      return;
    setAttempted(true);
    const invalid = validateContent(draft, mode === 'new' ? undefined : reason);
    if (unitNeedsReselection)
      invalid.requestingUnitId = 'requesterUnitMismatch';
    if (Object.keys(invalid).length) {
      const first = Object.keys(invalid)[0];
      document
        .getElementById(first.startsWith('line-') ? first : `issue-${first}`)
        ?.focus();
      return;
    }
    const body = {
      content: draft,
      ...(mode !== 'new'
        ? {
            version: row!.revision,
            lifecycleVersion: row!.lifecycleVersion,
            reason: reason.trim(),
          }
        : {}),
    };
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: IssueRequest }>({
        path:
          mode === 'new'
            ? 'requisitions/requests'
            : mode === 'copy'
              ? `requisitions/requests/${row!.id}/copy`
              : `requisitions/requests/${row!.id}`,
        method: mode === 'edit' ? 'PATCH' : 'POST',
        json: { ...body, requestKey: key.for(body) },
      });
      guard.complete();
      void refresh(result.data, mode === 'new' || mode === 'copy');
      toaster.show({
        type: 'success',
        title: t(
          ui(mode === 'copy' ? 'copied' : mode === 'new' ? 'created' : 'saved'),
          { code: result.data.code, sourceCode: row?.code },
        ),
      });
      exit();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 400) {
        const fields: Record<string, string> = {
          ISSUE_PERSON_UNAVAILABLE: 'requesterEmployeeId',
          ISSUE_RECIPIENT_UNAVAILABLE: 'recipientEmployeeId',
          ISSUE_RECIPIENT_DELEGATE_REQUIRED: 'recipientEmployeeId',
          ISSUE_PURPOSE_UNAVAILABLE: 'purposeId',
          ISSUE_PURPOSE_CHANGED: 'purposeId',
          ISSUE_UNIT_UNAVAILABLE: 'requestingUnitId',
          ISSUE_PERSON_UNIT_MISMATCH: 'requestingUnitId',
          ISSUE_DELEGATE_REQUIRED: 'requesterEmployeeId',
          ISSUE_COMPANY_UNAVAILABLE: 'subjectId',
          ISSUE_LINE_UNAVAILABLE: 'lines',
          ISSUE_MATERIAL_CHANGED: 'lines',
          SUPPLY_INVALID_UNIT: 'lines',
          SUPPLY_QUANTITY_PRECISION: 'lines',
          SUPPLY_QUANTITY_OVERFLOW: 'lines',
        };
        const violation = (
          e.payload as { error?: { fieldViolations?: { field: string }[] } }
        )?.error?.fieldViolations?.[0]?.field;
        const match =
          violation && /^lines\.(\d+)\.selection(?:\.(.+))?$/.exec(violation);
        const targetLine = match ? draft.lines[Number(match[1])] : undefined;
        const field = targetLine
          ? `line-${targetLine.id}-${match?.[2] === 'quantity' ? 'quantity' : 'selection'}`
          : e.reason
            ? fields[e.reason]
            : undefined;
        if (field) {
          setServerErrors({
            [field]: e.reason?.includes('PRECISION')
              ? 'precision'
              : e.reason?.includes('OVERFLOW')
                ? 'overflow'
                : 'invalidReference',
          });
          setTimeout(
            () =>
              document
                .getElementById(
                  field.startsWith('line-') ? field : `issue-${field}`,
                )
                ?.focus(),
            0,
          );
        }
      }
      if (e instanceof ApiClientError && [403, 404].includes(e.status))
        void refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      const response = await api.request<{ data: IssueRequest }>({
        path: `requisitions/requests/${row.id}`,
      });
      setLatest(response.data);
      setChoices({});
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const comparison =
    latest && mode === 'edit'
      ? compareContent(
          baseline,
          draft,
          requestContent(latest),
          latest.lines.filter((l) => l.status === 'cancelled').map((l) => l.id),
        )
      : undefined;
  const applyMerge = () => {
    if (
      !latest ||
      !comparison ||
      comparison.conflicts.some((c) => !choices[c.key])
    )
      return;
    setDraft(applyContentMerge(comparison, choices));
    setBaseline(requestContent(latest));
    setRow(latest);
    setLatest(undefined);
    setError(undefined);
    setServerErrors({});
    key.reset();
  };
  const attachmentMetadata = useDemandAttachmentMetadata(
    'requisitions',
    mode === 'edit' ? row?.id : undefined,
    [
      ...(draft.attachments ?? []),
      ...(baseline.attachments ?? []),
      ...(latest?.attachments ?? []),
    ],
  );
  const describe = (value: unknown, label: string): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (label === 'attachments' && Array.isArray(value))
      return value.length
        ? value
            .map((item) => {
              const file = item as DemandAttachment;
              const name =
                attachmentMetadata.data?.data.find(
                  (record) => record.id === file.fileId,
                )?.filename ?? t('demandAttachments.unavailable');
              const index = draft.lines.findIndex(
                  (line) => line.id === file.lineId,
                ),
                stored =
                  latest?.lines.find((line) => line.id === file.lineId) ??
                  row?.lines.find((line) => line.id === file.lineId);
              const number = index >= 0 ? index + 1 : stored?.lineNo;
              const belongs = file.lineId
                ? number
                  ? t(ui('lineTitle'), { number })
                  : t('demandAttachments.unavailableLine')
                : t('demandAttachments.document');
              return `${name} · ${belongs} · ${t(file.shareWithGovernance ? 'demandAttachments.shared' : 'demandAttachments.notShared')}`;
            })
            .join('\n')
        : t('demandAttachments.empty');

    if (typeof value === 'string') {
      if (
        ['company', 'requester', 'recipient', 'unit', 'purpose'].includes(label)
      ) {
        const slot = label as
          'company' | 'requester' | 'recipient' | 'unit' | 'purpose';
        const ref = [
          refs[slot],
          latest?.display[slot],
          row?.display[slot],
        ].find((item) => item?.id === value);
        return ref ? `${ref.code} · ${ref.name}` : t(ui('unavailable'));
      }
      return value;
    }
    if (Array.isArray(value))
      return value
        .map((id, index) => {
          const item =
            draft.lines.find((l) => l.id === id) ??
            latest?.lines.find((l) => l.id === id)?.selectionInput ??
            baseline.lines.find((l) => l.id === id);
          return `${t(ui('lineTitle'), { number: index + 1 })}: ${item ? describe(item, 'lines') : '—'}`;
        })
        .join('\n');
    const line = value as DemandLine,
      s = line.selection;
    const matches = (candidate: DemandLine | undefined) =>
      candidate &&
      s.kind === 'known' &&
      candidate.selection.kind === 'known' &&
      s.skuId === candidate.selection.skuId &&
      s.unitId === candidate.selection.unitId &&
      s.unitRuleId === candidate.selection.unitRuleId;
    const stored = [...(latest?.lines ?? []), ...(row?.lines ?? [])].find(
      (candidate) =>
        candidate.id === line.id && matches(candidate.selectionInput),
    );
    const preview =
      stored ??
      (matches(draft.lines.find((l) => l.id === line.id))
        ? hints[line.id]
        : undefined);
    const name =
      line.originalName ||
      (s.kind === 'unknown'
        ? s.originalName
        : (preview?.materialSnapshot?.name ?? t(ui('known'))));
    return [
      t(ui(s.kind)),
      `${t(ui('originalName'))}: ${name}`,
      `${t(ui('specification'))}: ${line.originalSpecification || (s.kind === 'unknown' ? s.originalSpecification : (preview?.materialSnapshot?.name ?? '—'))}`,
      `${t(ui('quantity'))}: ${s.quantity} ${s.kind === 'unknown' ? s.requestedUnitText : (preview?.materialSnapshot?.unitName ?? '—')}`,
      ...(s.kind === 'known'
        ? [
            `${t(ui('materialCode'))}: ${preview?.materialSnapshot?.code ?? t(ui('unavailable'))}`,
            `${t(ui('packaging'))}: ${preview?.numeratorSnapshot ?? '—'}/${preview?.denominatorSnapshot ?? '—'}`,
          ]
        : []),
      `${t(ui('lineUsage'))}: ${line.usage || '—'}`,
      `${t(ui('lineNotes'))}: ${line.notes || '—'}`,
    ].join('\n');
  };
  const context: FormContext = {
    content: draft,
    hints,
    allowNavigation: guard.allowNavigation,
    setSelection: (id, selection, preview) => {
      setDraft((old) => ({
        ...old,
        lines: old.lines.map((l) => (l.id === id ? { ...l, selection } : l)),
      }));
      setHints((old) => ({ ...old, [id]: preview }));
    },
  };
  const localText = [
    t(ui('company')) +
      ': ' +
      (refs.company?.name ?? row?.display.company?.name ?? ''),
    t(ui('usage')) + ': ' + draft.usage,
    t(ui('neededOn')) + ': ' + (draft.neededOn ?? ''),
    ...draft.lines.map((l, i) => `${i + 1}. ${describe(l, 'lines')}`),
    t('demandAttachments.title') +
      ': ' +
      describe(draft.attachments ?? [], 'attachments'),
    t(ui('notes')) + ': ' + draft.notes,
    t(ui('reason')) + ': ' + reason,
  ].join('\n');
  return (
    <>
      <BackButton />
      <PageHeader title={title} description={t(ui('saveFirstHint'))} />
      <form
        id='issue-request-form'
        className='flex max-w-4xl flex-col gap-6'
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {Boolean(error) && <ErrorNotice error={error} />}
        {cap.error && (
          <ErrorNotice error={cap.error} retry={() => void cap.refetch()} />
        )}{' '}
        {!allowed && (
          <Alert>
            <AlertDescription>
              {t(
                ui(
                  currentCapability?.reason === 'ISSUE_ACTION_UNAVAILABLE'
                    ? 'notDraft'
                    : 'forbidden',
                ),
              )}
            </AlertDescription>
          </Alert>
        )}
        {error instanceof ApiClientError && error.status === 409 && row && (
          <Button
            type='button'
            variant='outline'
            disabled={busy || uploading}
            onClick={() => void loadLatest()}
          >
            {t(ui('compareLatest'))}
          </Button>
        )}
        {latest && (
          <Card>
            <CardHeader>
              <CardTitle>{t(ui('conflict'))}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {remoteNotDraft ? (
                <>
                  <p>{t(ui('remoteNotDraft'))}</p>
                  <Textarea
                    readOnly
                    aria-label={t(ui('localCopy'))}
                    value={localText}
                    rows={8}
                  />
                </>
              ) : mode === 'copy' ? (
                <>
                  <p>{t(ui('copyHint'))}</p>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => {
                      setRow(latest);
                      setLatest(undefined);
                      setError(undefined);
                      key.reset();
                    }}
                  >
                    {t(ui('adoptLatest'))}
                  </Button>
                </>
              ) : (
                comparison && (
                  <>
                    <ConflictChoices
                      conflicts={comparison.conflicts}
                      choices={choices}
                      onChange={(key, value) =>
                        setChoices((old) => ({ ...old, [key]: value }))
                      }
                      describe={describe}
                    />
                    <Button
                      type='button'
                      disabled={comparison.conflicts.some(
                        (c) => !choices[c.key],
                      )}
                      onClick={applyMerge}
                    >
                      {t(ui('applyMerge'))}
                    </Button>
                  </>
                )
              )}
            </CardContent>
          </Card>
        )}
        {terminal && (
          <Textarea
            readOnly
            aria-label={t(ui('localCopy'))}
            value={localText}
            rows={8}
          />
        )}
        <fieldset
          disabled={busy || !allowed || !!terminal || !!remoteNotDraft}
          className='contents'
        >
          <Card>
            <CardHeader>
              <CardTitle>{t(ui('basicInformation'))}</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-2'>
              <div className='md:col-span-2'>
                <ReferencePicker
                  id='issue-subjectId'
                  key={`company-${mode}`}
                  path='requestCompanies'
                  label={`${t(ui('company'))} *`}
                  value={draft.subjectId}
                  selected={refs.company ?? row?.display.company}
                  disabled={companyLocked}
                  onChange={(v, item) => void changeCompany(v, item)}
                />
                {companyLocked && (
                  <p className='mt-2 text-sm text-muted-foreground'>
                    {t(ui('companyLocked'))}
                  </p>
                )}
                {fieldError('subjectId')}
              </div>
              <div className='flex flex-col gap-2'>
                <ReferencePicker
                  id='issue-requesterEmployeeId'
                  error={
                    errors.requesterEmployeeId
                      ? t(ui(errors.requesterEmployeeId))
                      : undefined
                  }
                  key={`person-${draft.subjectId}`}
                  path='requestOptions'
                  query={{ subjectId: draft.subjectId, kind: 'employees' }}
                  label={`${t(ui('requester'))} (${t(ui('requiredToSubmit'))})`}
                  value={draft.requesterEmployeeId ?? ''}
                  selected={refs.requester ?? row?.display.requester}
                  disabled={!draft.subjectId}
                  onChange={(id, item) => {
                    if (
                      id !== draft.requesterEmployeeId &&
                      draft.requestingUnitId
                    )
                      setUnitNeedsReselection(true);
                    update('requesterEmployeeId', id || null);
                    setRefs((old) => ({ ...old, requester: item }));
                  }}
                />
                {unitNeedsReselection && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('reselectUnit'))}
                  </p>
                )}
              </div>
              <ReferencePicker
                id='issue-recipientEmployeeId'
                error={
                  errors.recipientEmployeeId
                    ? t(ui(errors.recipientEmployeeId))
                    : undefined
                }
                key={`recipient-${draft.subjectId}`}
                path='requestOptions'
                query={{ subjectId: draft.subjectId, kind: 'employees' }}
                label={`${t(ui('recipient'))} (${t(ui('requiredToSubmit'))})`}
                value={draft.recipientEmployeeId ?? ''}
                selected={refs.recipient ?? row?.display.recipient}
                disabled={!draft.subjectId}
                onChange={(id, item) => {
                  update('recipientEmployeeId', id || null);
                  setRefs((old) => ({ ...old, recipient: item }));
                }}
              />
              <ReferencePicker
                id='issue-requestingUnitId'
                needsReselection={unitNeedsReselection}
                error={
                  errors.requestingUnitId
                    ? t(ui(errors.requestingUnitId))
                    : undefined
                }
                key={`unit-${draft.subjectId}-${draft.requesterEmployeeId}`}
                path='requestOptions'
                query={{
                  subjectId: draft.subjectId,
                  kind: 'units',
                  ...(draft.requesterEmployeeId
                    ? { requesterEmployeeId: draft.requesterEmployeeId }
                    : {}),
                }}
                label={`${t(ui('unit'))} (${t(ui('requiredToSubmit'))})`}
                value={draft.requestingUnitId ?? ''}
                selected={refs.unit ?? row?.display.unit}
                disabled={!draft.subjectId || !draft.requesterEmployeeId}
                onChange={(id, item) => {
                  setUnitNeedsReselection(false);
                  update('requestingUnitId', id || null);
                  setRefs((old) => ({ ...old, unit: item }));
                }}
              />
              <Field data-invalid={!!errors.usage} className='md:col-span-2'>
                <FieldLabel htmlFor='issue-usage'>
                  {t(ui('usage'))} ({t(ui('requiredToSubmit'))})
                </FieldLabel>
                <Textarea
                  id='issue-usage'
                  value={draft.usage}
                  onChange={(e) => update('usage', e.target.value)}
                  aria-invalid={!!errors.usage}
                />
                {fieldError('usage')}
              </Field>
              <Field>
                <FieldLabel htmlFor='issue-neededOn'>
                  {t(ui('neededOn'))} ({t(ui('requiredToSubmit'))})
                </FieldLabel>
                <DatePicker
                  id='issue-neededOn'
                  value={draft.neededOn ?? ''}
                  onChange={(v) => update('neededOn', v || null)}
                  label={t(ui('neededOn'))}
                />
              </Field>
              <ReferencePicker
                id='issue-purposeId'
                error={errors.purposeId ? t(ui(errors.purposeId)) : undefined}
                key={`purpose-${draft.subjectId}`}
                path='requestPurposeOptions'
                query={{ subjectId: draft.subjectId }}
                label={`${t(ui('purpose'))} (${t(ui('requiredToSubmit'))})`}
                value={draft.purposeId ?? ''}
                selected={refs.purpose ?? row?.display.purpose}
                disabled={!draft.subjectId}
                onChange={(id, item) => {
                  update('purposeId', id || null);
                  setRefs((old) => ({ ...old, purpose: item }));
                }}
              />
              <Field data-invalid={!!errors.notes} className='md:col-span-2'>
                <FieldLabel htmlFor='issue-notes'>{t(ui('notes'))}</FieldLabel>
                <Textarea
                  id='issue-notes'
                  value={draft.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  aria-invalid={!!errors.notes}
                />
                {fieldError('notes')}
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <CardTitle>{t(ui('lines'))}</CardTitle>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!draft.subjectId || draft.lines.length >= 100}
                  title={
                    draft.lines.length >= 100 ? t(ui('lineLimit')) : undefined
                  }
                  id='issue-add-line'
                  onClick={() =>
                    update('lines', [...draft.lines, newLine(draft.subjectId)])
                  }
                >
                  <Plus />
                  {t(ui('addLine'))}
                </Button>
              </div>
              <p className='text-sm text-muted-foreground'>
                {t(ui('lineLimit'))}
              </p>
            </CardHeader>
            <CardContent
              id='issue-lines'
              tabIndex={-1}
              aria-invalid={!!errors.lines}
              className='flex flex-col gap-4 focus-visible:ring-2 focus-visible:ring-ring'
            >
              {draft.lines.map((line, index) => (
                <LineEditor
                  key={line.id}
                  line={line}
                  index={index}
                  preview={hints[line.id]}
                  error={errors[`line-${line.id}`]}
                  errors={errors}
                  saved={!!row?.lines.some((l) => l.id === line.id)}
                  busy={busy}
                  canUp={index > 0}
                  canDown={index + 1 < draft.lines.length}
                  onMove={(direction) => {
                    const lines = [...draft.lines];
                    [lines[index], lines[index + direction]] = [
                      lines[index + direction],
                      lines[index],
                    ];
                    update('lines', lines);
                  }}
                  onChange={(next) =>
                    update(
                      'lines',
                      draft.lines.map((l) => (l.id === line.id ? next : l)),
                    )
                  }
                  onRemove={async () => {
                    if (
                      draft.attachments?.some((file) => file.lineId === line.id)
                    ) {
                      toaster.show({
                        type: 'error',
                        title: t('demandAttachments.lineHasAttachments'),
                      });
                      return;
                    }
                    if (
                      row?.lines.some((l) => l.id === line.id) &&
                      !(await confirm.ask(
                        t(ui('removeTitle'), {
                          code: row.code,
                          number: index + 1,
                        }),
                        t(ui('removeHint')),
                        t(ui('confirmRemove')),
                      ))
                    )
                      return;
                    update(
                      'lines',
                      draft.lines.filter((l) => l.id !== line.id),
                    );
                    queueMicrotask(() =>
                      document.getElementById('issue-add-line')?.focus(),
                    );
                  }}
                  onSelect={() =>
                    guard.allowNavigation(
                      () =>
                        void navigate({
                          pathname: `lines/${line.id}/select`,
                          search: location.search,
                        }),
                    )
                  }
                />
              ))}
              {fieldError('lines')}
            </CardContent>
          </Card>
          <DemandAttachments
            domain='requisitions'
            requestId={mode === 'edit' ? row?.id : undefined}
            value={draft.attachments ?? []}
            lines={draft.lines.map((line, index) => ({
              id: line.id,
              label: `${t(ui('lineTitle'), { number: index + 1 })} · ${line.originalName || (line.selection.kind === 'unknown' ? line.selection.originalName : '')}`,
            }))}
            onChange={(files) => update('attachments', files)}
            onBusyChange={setUploading}
            disabled={busy || !allowed || !!terminal}
          />
          {mode !== 'new' && (
            <Card>
              <CardHeader>
                <CardTitle>{t(ui('saveNoteTitle'))}</CardTitle>
              </CardHeader>
              <CardContent>
                <Field data-invalid={!!errors.reason}>
                  <FieldLabel htmlFor='issue-reason'>
                    {t(ui(mode === 'copy' ? 'copyReason' : 'editReason'))} *
                  </FieldLabel>
                  <Textarea
                    id='issue-reason'
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    aria-required='true'
                    aria-invalid={!!errors.reason}
                  />
                  <FieldDescription>{t(ui('reasonHint'))}</FieldDescription>
                  {fieldError('reason')}
                </Field>
              </CardContent>
            </Card>
          )}
        </fieldset>
        <div className='flex flex-wrap justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={busy || uploading}
            onClick={() => void cancel()}
          >
            {t(ui('cancel'))}
          </Button>
          <Button
            type='submit'
            disabled={
              busy ||
              uploading ||
              !allowed ||
              !!terminal ||
              !!remoteNotDraft ||
              !!latest
            }
          >
            {busy && <Spinner />}
            {t(ui(mode === 'new' ? 'saveDraft' : 'save'))}
          </Button>
        </div>
      </form>
      {guard.dialog}
      {confirm.dialog}
      <Outlet context={context} />
    </>
  );
}
