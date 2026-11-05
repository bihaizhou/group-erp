import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { AccessDenied } from '#components/access-denied';
import { textValue } from './model.js';
import { BackButton } from '#components/back-button';
import { useDiscardConfirm } from './use-discard-confirm.js';
import { createPortal } from 'react-dom';
import { PhotoField } from './photo-field.js';
import { ApprovalPreview } from './approval-preview.js';
import { useState, useRef, type FormEvent } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ApiClientError,
  createUuid,
  useApiClient,
  useToaster,
} from '@nocobase/app-client';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  usePeopleCan,
  usePeopleOptions,
  usePeopleRecord,
  usePeopleError,
  usePeopleRefresh,
} from './hooks.js';
import {
  PeopleDate,
  PeopleSelect,
  PeopleLoading,
  PeopleErrorNotice,
} from './controls.js';
import {
  fields,
  repeats,
  topFields,
  isCurrentRow,
  currentEmploymentRow,
  currentPrimaryRow,
  kindFromPath,
  emptyData,
  smallForms,
  type Data,
  type FieldSpec,
  type Options,
  type Row,
  type Value,
} from './model.js';

export default function PeopleFormPage() {
  const location = useLocation(),
    params = useParams(),
    navigate = useNavigate(),
    { t } = useTranslation();
  const kind = kindFromPath(location.pathname),
    id = params.relatedId ?? params.recordId;
  const record = usePeopleRecord(kind, id),
    options = usePeopleOptions(kind),
    canWrite = usePeopleCan(kind);
  const [pending, setPending] = useState(false),
    [dirty, setDirty] = useState(false),
    [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const discard = useDiscardConfirm();
  const title = t(id ? 'people.editRecord' : 'people.newRecord', {
    kind: t(`people.${kind}`),
  });
  const goBack = (force = false) => {
    if (force || !pending)
      void navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
  };
  const requestExit = async (saved = false) => {
    if (pending && !saved) return;
    if (saved || !dirty || (await discard.confirm())) goBack(saved);
  };
  const content = !canWrite ? (
    <AccessDenied title={t('people.forbidden')} />
  ) : record.isError || options.isError ? (
    <PeopleErrorNotice
      error={record.error ?? options.error}
      retry={() => {
        void record.refetch();
        void options.refetch();
      }}
    />
  ) : !options.data || (id && !record.data) ? (
    <PeopleLoading />
  ) : (
    <RecordForm
      key={`${kind}-${id ?? 'new'}-${record.data?.data.version ?? 0}`}
      kind={kind}
      record={record.data?.data}
      options={options.data.data}
      onBusy={setPending}
      onDirty={setDirty}
      exit={(saved) => void requestExit(saved)}
      small={smallForms.includes(kind)}
      footerTarget={footerTarget}
      businessDate={options.data.meta?.businessDate ?? ''}
    />
  );
  if (smallForms.includes(kind))
    return (
      <>
        <RouteDialog
          title={title}
          description={t('people.formDescription')}
          beforeClose={async () =>
            !pending && (!dirty || (await discard.confirm()))
          }
          footer={<div ref={setFooterTarget} />}
        >
          {content}
        </RouteDialog>
        {discard.dialog}
      </>
    );
  return (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <div
          className='contents'
          onClickCapture={(event) => {
            if (pending || dirty) {
              event.preventDefault();
              if (!pending) void requestExit();
            }
          }}
        >
          <BackButton />
        </div>
        <PageHeader title={title} description={t('people.formDescription')} />
        {options.data?.meta ? (
          <p className='text-sm text-muted-foreground'>
            {t('people.businessDateHint', {
              date: options.data.meta.businessDate,
              zone: options.data.meta.timeZone,
            })}
          </p>
        ) : null}
        {content}
        {discard.dialog}
      </PageContainer>
    </RouteChildPage>
  );
}

function RecordForm({
  kind,
  record,
  options,
  onBusy,
  onDirty,
  exit,
  small,
  footerTarget,
  businessDate,
}: {
  kind: ReturnType<typeof kindFromPath>;
  record?: Row;
  options: Options;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  exit: (saved?: boolean) => void;
  small: boolean;
  footerTarget: HTMLElement | null;
  businessDate: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    refresh = usePeopleRefresh(),
    navigate = useNavigate(),
    errorText = usePeopleError();
  const [values, setValues] = useState<Data>(() => {
    const initial: Data = {
      code: record?.code ?? '',
      name: record?.name ?? '',
      subjectId: record?.subjectId ?? null,
      personId: record?.personId ?? null,
      positionId: record?.positionId ?? null,
      ...(record?.data ?? emptyData(kind)),
    };
    // Show the code the server would assign before the first save, so the
    // form never looks like it will submit an empty identifier.
    if (kind === 'changes' && !record)
      initial.code = `CHG-${businessDate.replaceAll('-', '')}-${createUuid()
        .replaceAll('-', '')
        .slice(0, 4)
        .toUpperCase()}`;
    for (const key of Object.keys(repeats[kind] ?? {}))
      initial[key] = ((initial[key] as Data[] | undefined) ?? []).map(
        (row) => ({
          ...row,
          _key: crypto.getRandomValues(new Uint32Array(2)).join('-'),
        }),
      );
    return initial;
  });
  const [reason, setReason] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    busyRef = useRef(false),
    submitAfterSaveRef = useRef(false),
    // The generated name follows the person and type until the user edits it.
    [nameTouched, setNameTouched] = useState(Boolean(record));
  // Person's live employment and primary assignment drive the defaults and
  // the read-only summary shown for exit, regularize and endPartTime.
  const onDate = businessDate;
  const currentEmploymentOf = (personId: string) =>
    currentEmploymentRow(options.employments?.rows ?? [], personId, onDate);
  const currentPrimaryOf = (personId: string) =>
    currentPrimaryRow(options.assignments?.rows ?? [], personId, onDate);
  // A person's current records decide which transaction can follow: nobody
  // employed can only be onboarded, nobody regularized can still be
  // regularized, and a secondary role can only end when one is active.
  const allowedChangeTypes = (personId: string) => {
    if (kind !== 'changes' || !personId) return [] as string[];
    const employments = (options.employments?.rows ?? []).filter(
      (r) => r.personId === personId && isCurrentRow(r, onDate),
    );
    const assignments = (options.assignments?.rows ?? []).filter(
      (r) => r.personId === personId && isCurrentRow(r, onDate),
    );
    if (!employments.length && !assignments.length) return ['entry'];
    if (employments.length !== 1) return [];
    const types: string[] = [];
    if (assignments.some((r) => textValue(r.data.type) === 'primary'))
      types.push('transfer');
    if (!textValue(employments[0].data.regularizedAt)) types.push('regularize');
    types.push('partTime');
    if (assignments.some((r) => textValue(r.data.type) === 'partTime'))
      types.push('endPartTime');
    types.push('exit');
    return types;
  };
  const change = (key: string, value: Value) => {
    onDirty(true);
    if (key === 'name') setNameTouched(true);
    setErrors((v) => ({ ...v, [key]: '' }));
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'targetSubjectId') next.targetPositionId = null;
      if (kind === 'changes' && (key === 'personId' || key === 'type')) {
        // Picking a person carries their current company (and, for a transfer,
        // their current position) over so the same choice is never repeated.
        const personId = textValue(key === 'personId' ? value : next.personId);
        let type = textValue(key === 'type' ? value : next.type);
        if (key === 'personId') {
          const allowed = allowedChangeTypes(personId);
          if (!allowed.includes(type)) {
            type = allowed[0] ?? '';
            next.type = type || null;
          }
        }
        if (!nameTouched) {
          const person = (options.employees?.rows ?? []).find(
            (r) => r.id === personId,
          );
          next.name =
            person && type
              ? `${person.name} · ${t(`people.values.${type}`)}`
              : '';
        }
        if (personId && ['transfer', 'partTime'].includes(type)) {
          if (key === 'personId' || !next.targetSubjectId)
            next.targetSubjectId =
              currentEmploymentOf(personId)?.subjectId ?? null;
          if (
            type === 'transfer' &&
            (key === 'personId' || !next.targetPositionId)
          )
            next.targetPositionId =
              currentPrimaryOf(personId)?.positionId ?? null;
          // A part-time role is always a different position from the primary one.
          if (type === 'partTime') next.targetPositionId = null;
        }
      }
      if (kind === 'evaluations' && (key === 'modelId' || key === 'personId')) {
        const model = options.models?.rows.find((r) => r.id === next.modelId);
        const profile = options.profiles?.rows.find(
          (r) => r.personId === next.personId,
        );
        const common = (options.dimensions?.rows ?? [])
          .filter((r) => r.data.category === 'common')
          .map((r) => ({ dimensionId: r.id }));
        const entries = [
          ...common,
          ...((model?.data.items as Data[] | undefined) ?? []),
          ...((profile?.data.extraItems as Data[] | undefined) ?? []),
        ];
        next.ratings = [
          ...new Map(
            entries.map((item) => [textValue(item.dimensionId), item]),
          ).values(),
        ].map((item) => ({
          dimensionId: item.dimensionId,
          selfScore: null,
          managerScore: null,
          confirmedScore: null,
          evidence: '',
        }));
      }
      return next;
    });
  };
  const renderField = (
    f: FieldSpec,
    source: Data,
    onChange: (key: string, value: Value) => void,
    prefix = '',
  ) => {
    if (f.key === 'accountId' && !options.accounts) return null;
    const key = prefix + f.key,
      id = `people-field-${textValue(key)}`,
      label = t(`people.fields.${f.key}`),
      value = source[f.key];
    let choices = f.choices?.map((v) => ({
      value: v,
      label: t(`people.values.${v}`),
    }));
    if (f.source) {
      let rows = options[f.source]?.rows ?? [];
      if (
        f.source === 'assignments' &&
        kind === 'changes' &&
        textValue(values.type) === 'endPartTime' &&
        values.personId
      ) {
        const personId = textValue(values.personId);
        rows = rows.filter(
          (r) =>
            r.personId === personId &&
            textValue(r.data.type) === 'partTime' &&
            isCurrentRow(r, onDate),
        );
      }
      if (
        f.source === 'orgPositions' &&
        (values.targetSubjectId ||
          (kind === 'workforcePlans' && values.subjectId))
      ) {
        const subject = values.targetSubjectId ?? values.subjectId;
        const units = (options.orgUnits?.rows ?? [])
          .filter((r) => r.subjectId === subject)
          .map((r) => r.id);
        rows = rows.filter((r) =>
          units.includes(textValue((r as unknown as Data).unitId)),
        );
      }
      choices = [
        { value: '', label: t('people.none') },
        ...rows
          .filter(
            (r) =>
              r.status === 'active' ||
              r.id === value ||
              (f.source === 'workforcePlans' && r.status === 'approved'),
          )
          .map((r) => ({ value: r.id, label: `${r.name} · ${r.code}` })),
      ];
    }
    if (f.type === 'boolean')
      choices = [
        { value: 'false', label: t('people.no') },
        { value: 'true', label: t('people.yes') },
      ];
    if (f.key === 'type' && kind === 'changes' && choices) {
      const allowed = allowedChangeTypes(textValue(values.personId));
      choices = choices.filter((choice) =>
        allowed.includes(textValue(choice.value)),
      );
    }
    return (
      <Field
        key={key}
        data-invalid={Boolean(errors[key])}
        className={f.type === 'long' ? 'sm:col-span-2' : undefined}
      >
        <FieldLabel htmlFor={id}>
          {label}
          {f.required ? ' *' : ''}
        </FieldLabel>
        {choices ? (
          <PeopleSelect
            id={id}
            label={label}
            disabled={
              pending ||
              (f.key === 'type' &&
                kind === 'changes' &&
                !textValue(values.personId))
            }
            invalid={Boolean(errors[key])}
            value={
              f.type === 'boolean'
                ? textValue(Boolean(value))
                : textValue(value ?? '')
            }
            items={choices}
            onChange={(v) =>
              onChange(f.key, f.type === 'boolean' ? v === 'true' : v || null)
            }
          />
        ) : f.type === 'date' ? (
          <PeopleDate
            id={id}
            label={label}
            disabled={pending}
            value={textValue(value ?? '')}
            onChange={(v) => onChange(f.key, v || null)}
          />
        ) : f.type === 'long' ? (
          <Textarea
            id={id}
            value={textValue(value ?? '')}
            disabled={pending}
            maxLength={6000}
            aria-invalid={Boolean(errors[key])}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        ) : (
          <Input
            id={id}
            value={textValue(value ?? '')}
            disabled={pending}
            type={f.type === 'number' ? 'number' : 'text'}
            min={f.min}
            max={f.max}
            step={
              f.type === 'number'
                ? kind === 'profiles' && f.key === 'grade'
                  ? 1
                  : 0.1
                : undefined
            }
            maxLength={f.key === 'code' ? 64 : f.key === 'name' ? 200 : 1000}
            aria-invalid={Boolean(errors[key])}
            onChange={(e) =>
              onChange(
                f.key,
                f.type === 'number'
                  ? e.target.value === ''
                    ? null
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        )}
        {f.key === 'type' &&
        kind === 'changes' &&
        !textValue(values.personId) ? (
          <FieldDescription>{t('people.changeTypeHint')}</FieldDescription>
        ) : null}
        {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
      </Field>
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || uploadBusy) return;
    const thenSubmit = submitAfterSaveRef.current;
    submitAfterSaveRef.current = false;
    const invalid: Record<string, string> = {};
    for (const f of [
      { key: 'code', required: kind !== 'changes' },
      { key: 'name', required: kind !== 'changes' },
      ...fields[kind],
    ]) {
      const value = values[f.key];
      if (
        f.required &&
        (value === null ||
          value === undefined ||
          textValue(value).trim() === '')
      )
        invalid[f.key] = t('people.required');
      if (
        f.type === 'number' &&
        value !== null &&
        value !== '' &&
        value !== undefined &&
        (Number(value) < (f.min ?? 0) || Number(value) > (f.max ?? 1e12))
      )
        invalid[f.key] = t('people.invalid');
    }
    if (
      textValue(values.code).trim() &&
      !/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(
        textValue(values.code).trim().toUpperCase(),
      )
    )
      invalid.code = t('people.codeHint');
    if (record && !reason.trim()) invalid.reason = t('people.required');
    if (kind === 'dimensions')
      (values.standards as Value[]).forEach((v, index) => {
        if (!textValue(v).trim())
          invalid[`standards.${index}`] = t('people.required');
      });
    for (const [key, specs] of Object.entries(repeats[kind] ?? {}))
      for (const [index, row] of ((values[key] as Data[]) ?? []).entries())
        for (const spec of specs)
          if (
            spec.required &&
            (row[spec.key] === null ||
              row[spec.key] === undefined ||
              textValue(row[spec.key]).trim() === '')
          )
            invalid[`${textValue(key)}.${index}.${spec.key}`] =
              t('people.required');
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document
        .getElementById(`people-field-${Object.keys(invalid)[0]}`)
        ?.focus();
      return;
    }
    const data = Object.fromEntries(
      Object.entries(values).filter(
        ([key]) => !['code', 'name', ...topFields].includes(key),
      ),
    );
    if (kind === 'changes') {
      // Hidden inputs must not leak stale choices into the transaction.
      const type = textValue(values.type);
      if (['exit', 'regularize', 'endPartTime'].includes(type)) {
        data.targetSubjectId = null;
        data.targetPositionId = null;
      }
      for (const key of ['changeEmployer', 'assignmentId', 'employmentType'])
        if (!showField(key)) delete data[key];
    }
    for (const key of Object.keys(repeats[kind] ?? {}))
      data[key] = ((data[key] as Data[] | undefined) ?? []).map(
        ({ _key, ...row }) => row,
      );
    // Cleared date and reference inputs are empty strings on the wire; the
    // API models them as nullable, so normalize before validating.
    for (const f of fields[kind])
      if ((f.type === 'date' || f.source) && data[f.key] === '')
        data[f.key] = null;
    const code = textValue(values.code).trim().toUpperCase(),
      name = textValue(values.name).trim();
    const json = {
      ...(code ? { code } : {}),
      ...(name ? { name } : {}),
      subjectId: values.subjectId,
      personId: values.personId,
      positionId: values.positionId,
      data,
      ...(record ? { version: record.version, reason } : {}),
    };
    busyRef.current = true;
    setPending(true);
    onBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: Row }>({
        path: `people/${kind}${record ? `/${record.id}` : ''}`,
        method: record ? 'PATCH' : 'POST',
        json,
      });
      await refresh(result.data, kind);
      onDirty(false);
      if (thenSubmit && !record && kind === 'changes') {
        try {
          const fired = await api.request<{ data: Row }>({
            path: `people/${kind}/${result.data.id}/fire`,
            method: 'POST',
            json: {
              transition: 'submit',
              version: result.data.lifecycleVersion,
              requestId: createUuid(),
              reason:
                textValue(data.explanation).trim() ||
                textValue(values.name).trim() ||
                t('people.submitReason'),
            },
          });
          await refresh(fired.data, kind);
          toaster.show({
            type: 'success',
            title: t('people.submitted', { name: fired.data.name }),
          });
          onBusy(false);
          busyRef.current = false;
          exit(true);
          return;
        } catch (e) {
          // The draft is safe; open it so the submit error stays visible.
          toaster.show({
            type: 'warning',
            title: t('people.savedDraftOnly'),
            description: errorText(e),
          });
          onBusy(false);
          busyRef.current = false;
          void navigate(`/functions/personnel/changes/${result.data.id}`, {
            replace: true,
          });
          return;
        }
      }
      toaster.show({
        type: 'success',
        title: t(record ? 'people.saved' : 'people.created', {
          name: result.data.name,
        }),
      });
      onBusy(false);
      busyRef.current = false;
      exit(true);
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError) {
        const violations = (
          e.payload as {
            error?: {
              details?: { fieldViolations?: { field: string }[] }[];
              fieldViolations?: { field: string }[];
            };
          }
        )?.error;
        const list =
          violations?.fieldViolations ??
          violations?.details?.flatMap((d) => d.fieldViolations ?? []) ??
          [];
        if (list.length) {
          const mapping = Object.fromEntries(
            list.map((v) => [
              v.field.replace(/^data\./, ''),
              t('people.fieldInvalid'),
            ]),
          );
          setErrors(mapping);
          document
            .getElementById(`people-field-${Object.keys(mapping)[0]}`)
            ?.focus();
        }
      }
    } finally {
      busyRef.current = false;
      setPending(false);
      onBusy(false);
    }
  };
  const changeType = kind === 'changes' ? textValue(values.type) : '';
  const personId = textValue(values.personId);
  const currentEmployment =
    kind === 'changes' && personId ? currentEmploymentOf(personId) : undefined;
  const currentPrimary =
    kind === 'changes' && personId ? currentPrimaryOf(personId) : undefined;
  const personRow = (options.employees?.rows ?? []).find(
    (r) => r.id === personId,
  );
  const currentSubjectName =
    options.orgSubjects?.rows.find(
      (r) => r.id === (currentEmployment?.subjectId ?? personRow?.subjectId),
    )?.name ?? '—';
  const currentPositionName =
    options.orgPositions?.rows.find((r) => r.id === currentPrimary?.positionId)
      ?.name ?? '—';
  // Only the fields that matter for the chosen transaction stay visible; exit,
  // regularize and endPartTime run from the person's current records, so they
  // never ask for a target company or position.
  const showField = (key: string) => {
    if (kind !== 'changes') return true;
    if (key === 'targetSubjectId' || key === 'targetPositionId')
      return ['entry', 'transfer', 'partTime'].includes(changeType);
    if (key === 'changeEmployer') return changeType === 'transfer';
    if (
      key === 'employmentType' ||
      key === 'probationEnd' ||
      key === 'contractEnd'
    )
      return (
        changeType === 'entry' ||
        (changeType === 'transfer' &&
          (values.changeEmployer === true || values.changeEmployer === 'true'))
      );
    if (key === 'assignmentId') return changeType === 'endPartTime';
    if (key === 'location')
      return ['entry', 'transfer', 'partTime'].includes(changeType);
    return true;
  };
  const actions = (
    <div className='flex justify-end gap-2'>
      <Button
        variant='outline'
        type='button'
        disabled={pending || uploadBusy}
        onClick={() => exit()}
      >
        {t('people.cancel')}
      </Button>
      {!record && kind === 'changes' ? (
        <>
          <Button
            variant='outline'
            type='submit'
            form='people-form'
            disabled={pending || uploadBusy}
            onClick={() => {
              submitAfterSaveRef.current = false;
            }}
          >
            {t(pending ? 'people.saving' : 'people.saveDraft')}
          </Button>
          <Button
            type='submit'
            form='people-form'
            disabled={pending || uploadBusy}
            onClick={() => {
              submitAfterSaveRef.current = true;
            }}
          >
            {t(pending ? 'people.saving' : 'people.saveAndSubmit')}
          </Button>
        </>
      ) : (
        <Button
          type='submit'
          form='people-form'
          disabled={pending || uploadBusy}
        >
          {t(
            pending
              ? 'people.saving'
              : record
                ? 'people.save'
                : 'people.create',
          )}
        </Button>
      )}
    </div>
  );
  return (
    <form
      id='people-form'
      onSubmit={(event) => void submit(event)}
      noValidate
      className='flex flex-col gap-6'
    >
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {errorText(error)}
            {error instanceof ApiClientError && error.status === 409 ? (
              <Button
                variant='outline'
                type='button'
                onClick={() => window.location.reload()}
              >
                {t('people.loadLatest')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {Object.values(options).some((v) => v.truncated) ? (
        <p className='text-sm text-muted-foreground'>
          {t('people.optionCap', { limit: 1000 })}
        </p>
      ) : null}
      <div className='grid gap-4 sm:grid-cols-2'>
        {renderField(
          { key: 'code', required: kind !== 'changes' },
          values,
          change,
        )}
        {renderField(
          { key: 'name', required: kind !== 'changes' },
          values,
          change,
        )}
        {kind === 'changes' ? (
          <p className='text-xs text-muted-foreground sm:col-span-2'>
            {t('people.autoGeneratedHint')}
          </p>
        ) : null}
        {fields[kind]
          .filter((f) => showField(f.key))
          .map((f) => renderField(f, values, change))}
      </div>
      {kind === 'changes' && changeType ? (
        <ApprovalPreview
          type={changeType}
          subjectId={
            textValue(values.targetSubjectId) ||
            currentEmploymentOf(textValue(values.personId))?.subjectId ||
            ''
          }
        />
      ) : null}
      {kind === 'changes' &&
      ['exit', 'regularize', 'endPartTime'].includes(changeType) ? (
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field>
            <FieldLabel>{t('people.currentCompany')}</FieldLabel>
            <p className='pt-2 text-sm'>{currentSubjectName}</p>
          </Field>
          <Field>
            <FieldLabel>{t('people.currentPosition')}</FieldLabel>
            <p className='pt-2 text-sm'>{currentPositionName}</p>
          </Field>
        </div>
      ) : null}
      {kind === 'employees' ? (
        <PhotoField
          value={values.photoId ? textValue(values.photoId) : null}
          onChange={(v) => change('photoId', v)}
          disabled={pending}
          onBusy={(v) => {
            setUploadBusy(v);
            onBusy(v);
          }}
        />
      ) : null}
      {kind === 'profiles' ? (
        <p className='text-sm text-muted-foreground'>{t('people.gradeHint')}</p>
      ) : null}
      {kind === 'dimensions' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('people.standards')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {[1, 2, 3, 4, 5].map((score) => (
              <Field
                key={score}
                data-invalid={Boolean(errors[`standards.${score - 1}`])}
              >
                <FieldLabel htmlFor={`people-field-standards.${score - 1}`}>
                  {t('people.scoreStandard', { score })} *
                </FieldLabel>
                <Textarea
                  id={`people-field-standards.${score - 1}`}
                  value={textValue((values.standards as Value[])[score - 1])}
                  disabled={pending}
                  maxLength={1000}
                  onChange={(e) =>
                    change(
                      'standards',
                      (values.standards as Value[]).map((v, i) =>
                        i === score - 1 ? e.target.value : v,
                      ),
                    )
                  }
                />
                {errors[`standards.${score - 1}`] ? (
                  <FieldError>{errors[`standards.${score - 1}`]}</FieldError>
                ) : null}
              </Field>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {Object.entries(repeats[kind] ?? {}).map(([key, specs]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle>{t(`people.fields.${textValue(key)}`)}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {((values[key] as Data[]) ?? []).map((row, index) => (
              <div
                key={textValue(row._key)}
                className='grid gap-4 rounded-lg border p-4 sm:grid-cols-2'
              >
                {specs.map((f) =>
                  renderField(
                    f,
                    row,
                    (field, value) =>
                      change(
                        key,
                        (values[key] as Data[]).map((r, i) =>
                          i === index ? { ...r, [field]: value } : r,
                        ),
                      ),
                    `${textValue(key)}.${index}.`,
                  ),
                )}
                <Button
                  type='button'
                  variant='outline'
                  disabled={pending}
                  className='w-fit'
                  onClick={() =>
                    change(
                      key,
                      (values[key] as Data[]).filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 />
                  {t('people.removeItem')}
                </Button>
              </div>
            ))}
            <Button
              type='button'
              variant='outline'
              disabled={
                pending ||
                ((values[key] as Data[]) ?? []).length >=
                  (key === 'items' && kind === 'workforcePlans' ? 100 : 24)
              }
              className='w-fit'
              onClick={() =>
                change(key, [
                  ...((values[key] as Data[]) ?? []),
                  newRepeatRow(specs),
                ])
              }
            >
              <Plus />
              {t('people.addItem')}
            </Button>
          </CardContent>
        </Card>
      ))}
      {kind === 'evaluations' ? (
        <div className='rounded-lg border p-4'>
          <p className='text-sm text-muted-foreground'>
            {t('people.evaluationSetup')}
          </p>
          {((values.ratings as Data[]) ?? []).map((row) => (
            <p key={textValue(row.dimensionId)} className='mt-2 text-sm'>
              {options.dimensions?.rows.find((v) => v.id === row.dimensionId)
                ?.name ?? '—'}
            </p>
          ))}
        </div>
      ) : null}
      <PurchaseReferenceNotice
        domain='people'
        kind={kind}
        id={record?.id}
        busy={pending}
      />
      {record ? (
        <Field data-invalid={Boolean(errors.reason)}>
          <FieldLabel htmlFor='people-field-reason'>
            {t('people.fields.reason')} *
          </FieldLabel>
          <Textarea
            id='people-field-reason'
            value={reason}
            disabled={pending}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((v) => ({ ...v, reason: '' }));
            }}
          />
          {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
        </Field>
      ) : null}
      {small
        ? footerTarget
          ? createPortal(actions, footerTarget)
          : null
        : actions}
    </form>
  );
}

function newRepeatRow(specs: FieldSpec[]): Data {
  return {
    _key: crypto.getRandomValues(new Uint32Array(2)).join('-'),
    ...Object.fromEntries(
      specs.map((f) => [
        f.key,
        f.choices
          ? f.choices[0]
          : f.type === 'number'
            ? f.key === 'target'
              ? 3
              : 0
            : f.source
              ? null
              : '',
      ]),
    ),
  };
}
