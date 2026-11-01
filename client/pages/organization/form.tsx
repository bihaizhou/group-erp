import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useOptions, useRecord, useOrgError } from './hooks.js';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useRef, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useLocation, useNavigate } from 'react-router';
import { CalendarIcon } from 'lucide-react';
import { enUS, zhCN } from 'date-fns/locale';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Calendar } from '#components/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#components/ui/popover';
import { useOrgKind } from './context.js';
import {
  fields,
  sectionForField,
  isSmall,
  type OrgKind,
  type OrgRecord,
  type OrgOptions,
  type Field as OrgField,
} from './model.js';
import { codePrefix, initialCode, reparentCode } from './code.js';
import { OrgSelect, ErrorNotice, Loading } from './shared.js';

export default function OrganizationFormPage() {
  const kind = useOrgKind();
  const { recordId } = useParams();
  const { t } = useTranslation();
  const record = useRecord(kind, recordId);
  const options = useOptions();
  const submittingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const canWrite = useCan({
    resource: { type: 'settings', id: 'organization' },
    action: 'update',
  });
  const title = t(recordId ? 'org.editTitle' : 'org.new', {
    kind: t(`org.${kind}`),
  });
  const content = !canWrite.can ? (
    canWrite.isPending ? (
      <Loading />
    ) : (
      <ErrorNotice
        error={new ApiClientError('', { status: 403, method: 'GET', url: '' })}
      />
    )
  ) : options.isError ? (
    <ErrorNotice error={options.error} retry={() => void options.refetch()} />
  ) : record.isError ? (
    <ErrorNotice error={record.error} retry={() => void record.refetch()} />
  ) : !options.data || (recordId && (!record.data || record.isFetching)) ? (
    <Loading />
  ) : (
    <FormContent
      key={`${kind}:${recordId ?? 'new'}:${record.data?.data.version ?? 0}`}
      kind={kind}
      record={record.data?.data}
      options={options.data.data}
      onBusy={(value) => {
        submittingRef.current = value;
        setBusy(value);
      }}
      small={isSmall(kind)}
      footerTarget={footerTarget}
    />
  );
  if (isSmall(kind))
    return (
      <RouteDialog
        title={title}
        beforeClose={() => !submittingRef.current}
        footer={
          <div
            ref={setFooterTarget}
            className='flex w-full justify-end gap-2'
          />
        }
      >
        {content}
      </RouteDialog>
    );
  return (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <div data-org-back inert={busy}>
          <BackButton />
        </div>
        <PageHeader title={title} description={t('org.reasonHint')} />
        {content}
      </PageContainer>
    </RouteChildPage>
  );
}

function FormContent(props: {
  kind: OrgKind;
  record?: OrgRecord;
  options: OrgOptions;
  onBusy: (value: boolean) => void;
  small: boolean;
  footerTarget: HTMLDivElement | null;
}) {
  return props.small ? <DialogForm {...props} /> : <RecordForm {...props} />;
}
function DialogForm(props: Parameters<typeof RecordForm>[0]) {
  const { close } = useRouteOverlay();
  return <RecordForm {...props} close={() => void close()} />;
}
function RecordForm({
  kind,
  record,
  options,
  onBusy,
  close,
  footerTarget,
}: {
  kind: OrgKind;
  record?: OrgRecord;
  options: OrgOptions;
  onBusy: (value: boolean) => void;
  small: boolean;
  footerTarget: HTMLDivElement | null;
  close?: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const cache = useQueryClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const errorText = useOrgError();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial = Object.fromEntries(
      fields[kind].map((f) => [
        f.key,
        String(
          record?.[f.key] ?? (f.type === 'number' ? 0 : (f.choices?.[0] ?? '')),
        ),
      ]),
    );
    return record
      ? initial
      : { ...initial, code: initialCode(kind, initial, options) };
  });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);
  const prefix = codePrefix(kind, values, options);
  const recordValues = record
    ? Object.fromEntries(
        fields[kind].map((f) => [f.key, String(record[f.key] ?? '')]),
      )
    : undefined;
  const originalPrefix = recordValues
    ? codePrefix(kind, recordValues, options)
    : '';
  const followsOriginal =
    !record ||
    (originalPrefix !== '' &&
      String(record.code)
        .trim()
        .toUpperCase()
        .startsWith(`${originalPrefix}-`));
  const codeUsesPrefix =
    Boolean(prefix) &&
    values.code.trim().toUpperCase().startsWith(`${prefix}-`);
  const exit = () => {
    if (!busyRef.current) {
      if (close) close();
      else {
        void navigate(
          { pathname: '..', search: location.search },
          { replace: true },
        );
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>('input[type="text"]')
              ?.focus(),
          0,
        );
      }
    }
  };
  const required = (field: OrgField) =>
    Boolean(
      field.required ||
      (kind === 'subjects' &&
        values.type === 'company' &&
        ['sectorId', 'regionId'].includes(field.key)),
    );
  const change = (key: string, value: string) => {
    setValues((v) => {
      const next: Record<string, string> = {
        ...v,
        [key]: value,
        ...(key === 'subjectId'
          ? { parentId: '', leaderPositionId: '' }
          : key === 'unitId'
            ? { reportsToId: '' }
            : key === 'sourceKind'
              ? { sourceId: '' }
              : key === 'targetKind'
                ? { targetId: '' }
                : {}),
      };
      if (['parentId', 'subjectId', 'unitId'].includes(key)) {
        const code = reparentCode(kind, v, next, options);
        if (code !== undefined) next.code = code;
      }
      return next;
    });
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      if (['parentId', 'subjectId', 'unitId'].includes(key)) delete next.code;
      return next;
    });
  };
  const items = (field: OrgField) => {
    if (field.choices)
      return field.choices.map((value) => ({
        value,
        label: t(
          ['sourceKind', 'targetKind'].includes(field.key)
            ? `org.${value}`
            : `org.types.${value}`,
        ),
      }));
    const targetKind =
      field.relation ??
      (field.key === 'sourceId'
        ? values.sourceKind
        : field.key === 'targetId'
          ? values.targetKind
          : undefined);
    if (!targetKind) return null;
    const rows = (options[targetKind]?.rows ?? []).filter((row) => {
      if (row.status !== 'active' && row.id !== values[field.key]) return false;
      if (targetKind === kind && row.id === record?.id) return false;
      if (kind === 'units' && field.key === 'parentId')
        return row.subjectId === values.subjectId;
      if (field.key === 'leaderPositionId') return row.unitId === record?.id;
      if (field.key === 'reportsToId') {
        const selectedUnit = options.units.rows.find(
          (r) => r.id === values.unitId,
        );
        return (
          options.units.rows.find((r) => r.id === row.unitId)?.subjectId ===
          selectedUnit?.subjectId
        );
      }
      return true;
    });
    return [
      { value: '', label: t('org.none') },
      ...rows.map((row) => ({
        value: row.id,
        label: `${row.name} · ${row.code}`,
      })),
    ];
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const invalid: Record<string, string> = {};
    for (const field of fields[kind]) {
      if (required(field) && !values[field.key]?.trim())
        invalid[field.key] = t('org.required');
      if (
        field.type === 'number' &&
        (!Number.isInteger(Number(values[field.key])) ||
          Number(values[field.key]) < 0)
      )
        invalid[field.key] = t('org.invalid');
    }
    const code = values.code.trim().toUpperCase();
    if (code && !/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(code))
      invalid.code = t('org.invalid');
    else if (code && prefix) {
      if (!code.startsWith(`${prefix}-`)) {
        if (followsOriginal)
          invalid.code = t('org.codePrefixRequired', { prefix });
      } else if (code === `${prefix}-`) invalid.code = t('org.required');
    }
    if (record && !reason.trim()) invalid.reason = t('org.required');
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`org-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    const json = Object.fromEntries(
      fields[kind].map((field) => [
        field.key,
        field.type === 'number'
          ? Number(values[field.key])
          : field.key === 'code'
            ? values.code.trim().toUpperCase()
            : values[field.key]?.trim() || null,
      ]),
    );
    if (record)
      Object.assign(json, { version: record.version, reason: reason.trim() });
    busyRef.current = true;
    setPending(true);
    onBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: OrgRecord }>({
        path: `organization/${kind}${record ? `/${record.id}` : ''}`,
        method: record ? 'PATCH' : 'POST',
        json,
      });
      cache.setQueryData(['org', kind, result.data.id], result);
      void cache.invalidateQueries({ queryKey: ['org-list'] });
      void cache.invalidateQueries({ queryKey: ['org-options'] });
      void cache.invalidateQueries({ queryKey: ['org-history'] });
      toaster.show({
        type: 'success',
        title: t(record ? 'org.saved' : 'org.created', {
          name: result.data.name,
        }),
      });
      busyRef.current = false;
      onBusy(false);
      exit();
    } catch (e) {
      const violations =
        e instanceof ApiClientError
          ? (e.payload as { error?: { fieldViolations?: { field: string }[] } })
              ?.error?.fieldViolations
          : undefined;
      if (violations?.length) {
        setErrors(
          Object.fromEntries(violations.map((v) => [v.field, errorText(e)])),
        );
        document.getElementById(`org-${violations[0].field}`)?.focus();
      } else setError(e);
      if (e instanceof ApiClientError && e.status === 404) {
        void cache.invalidateQueries({ queryKey: ['org-list'] });
        void cache.invalidateQueries({ queryKey: ['org', kind, record?.id] });
      }
    } finally {
      busyRef.current = false;
      setPending(false);
      onBusy(false);
    }
  };
  const actions = (
    <>
      <Button type='button' variant='outline' onClick={exit} disabled={pending}>
        {t('org.cancel')}
      </Button>
      <Button type='submit' form='org-record-form' disabled={pending}>
        {pending ? t('org.loading') : t(record ? 'org.save' : 'org.create')}
      </Button>
    </>
  );
  return (
    <form
      id='org-record-form'
      onSubmit={(event) => void submit(event)}
      noValidate
      className='flex flex-col gap-6'
    >
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{errorText(error)}</AlertDescription>
        </Alert>
      ) : null}
      {Object.values(options).some((v) => v.truncated) ? (
        <p className='text-sm text-muted-foreground'>
          {t('org.cap', { limit: 1000 })}
        </p>
      ) : null}
      <div
        className={
          isSmall(kind) ? 'flex flex-col gap-4' : 'grid gap-4 sm:grid-cols-2'
        }
      >
        {fields[kind].map((field, index) => {
          const choices = items(field);
          const fieldId = `org-${field.key}`;
          const section = sectionForField(field);
          const heading =
            !isSmall(kind) &&
            (index === 0 ||
              section !== sectionForField(fields[kind][index - 1]));
          return (
            <div key={field.key} className='contents'>
              {heading ? (
                <h2 className='text-base font-semibold sm:col-span-2'>
                  {t(`org.${section}`)}
                </h2>
              ) : null}
              <Field
                key={field.key}
                data-invalid={Boolean(errors[field.key])}
                className={
                  field.type === 'textarea' ? 'sm:col-span-2' : undefined
                }
              >
                <FieldLabel htmlFor={fieldId}>
                  {t(`org.fields.${field.key}`)}
                  {required(field) ? ' *' : ''}
                </FieldLabel>
                {choices ? (
                  <OrgSelect
                    id={fieldId}
                    label={t(`org.fields.${field.key}`)}
                    value={values[field.key]}
                    items={choices}
                    disabled={pending}
                    invalid={Boolean(errors[field.key])}
                    onChange={(value) => change(field.key, value)}
                  />
                ) : field.type === 'textarea' ? (
                  <Textarea
                    id={fieldId}
                    value={values[field.key]}
                    onChange={(e) => change(field.key, e.target.value)}
                    disabled={pending}
                    maxLength={6000}
                    aria-invalid={Boolean(errors[field.key])}
                  />
                ) : field.type === 'date' ? (
                  <DateField
                    id={fieldId}
                    value={values[field.key]}
                    label={t(`org.fields.${field.key}`)}
                    disabled={pending}
                    onChange={(value) => change(field.key, value)}
                  />
                ) : (
                  <>
                    <Input
                      id={fieldId}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={values[field.key]}
                      onChange={(e) => change(field.key, e.target.value)}
                      disabled={pending}
                      aria-invalid={Boolean(errors[field.key])}
                      maxLength={
                        field.key === 'code'
                          ? 64
                          : field.key === 'name'
                            ? 200
                            : 100
                      }
                      min={0}
                      autoFocus={field.key === 'name'}
                    />
                    {field.key === 'code' &&
                    prefix &&
                    (!record || codeUsesPrefix) ? (
                      <p className='text-xs text-muted-foreground'>
                        {t('org.codePrefixHint', { prefix })}
                      </p>
                    ) : null}
                  </>
                )}
                {errors[field.key] ? (
                  <FieldError>{errors[field.key]}</FieldError>
                ) : null}
              </Field>
            </div>
          );
        })}
      </div>
      <PurchaseReferenceNotice
        domain='organization'
        kind={kind}
        id={record?.id}
        busy={pending}
      />
      {record ? (
        <Field data-invalid={Boolean(errors.reason)}>
          <FieldLabel htmlFor='org-reason'>
            {t('org.fields.reason')} *
          </FieldLabel>
          <Textarea
            id='org-reason'
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((v) => ({ ...v, reason: '' }));
            }}
            disabled={pending}
            maxLength={1000}
          />
          {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
        </Field>
      ) : null}
      {isSmall(kind) ? (
        footerTarget ? (
          createPortal(actions, footerTarget)
        ) : null
      ) : (
        <div className='flex justify-end gap-2'>{actions}</div>
      )}
      <p className='text-xs text-muted-foreground'>{t('erp.boundary')}</p>
    </form>
  );
}

function DateField({
  id,
  value,
  label,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            className='w-full justify-start'
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <CalendarIcon />
        {date ? date.toLocaleDateString(i18n.language) : t('org.none')}
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar
          mode='single'
          selected={date}
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          onSelect={(next) => {
            onChange(
              next
                ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
                : '',
            );
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
