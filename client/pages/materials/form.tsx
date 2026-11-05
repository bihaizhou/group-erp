import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { RouteDialog } from '#components/route-dialog';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import { randomId } from '#lib/random-id';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useDiscardConfirm } from '../people/use-discard-confirm.js';
import {
  kindFromPath,
  fields,
  large,
  governed,
  referenceIds,
  text,
  type Kind,
  type Row,
  type Attribute,
} from './model.js';
import {
  useMaterialCan,
  useMaterialOptions,
  useMaterialRecord,
  useMaterialError,
  useMaterialNameCode,
  useMaterialRefresh,
} from './hooks.js';
import { Loading, ErrorNotice, MaterialSelect } from './controls.js';
import { SimilarNameNotice } from './similar-name-notice.js';

export default function MaterialFormPage({
  kind: fixedKind,
}: { kind?: Kind } = {}) {
  const location = useLocation(),
    params = useParams(),
    navigate = useNavigate(),
    { t } = useTranslation();
  const fromRequest = location.pathname.endsWith('/newSku');
  const kind =
      fixedKind ??
      (fromRequest || params.linkedSkuId
        ? 'skus'
        : kindFromPath(location.pathname)),
    id = fromRequest
      ? undefined
      : (params.linkedSkuId ?? params.recordId ?? params.sourceRequestId);
  const record = useMaterialRecord(kind, id),
    canWrite = useMaterialCan(kind),
    discard = useDiscardConfirm();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const complete = large.includes(kind),
    savedRef = useRef(false);
  useNavigationGuard(
    () =>
      savedRef.current ||
      (!busy && (!dirty || window.confirm(t('materials.unsaved')))),
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  const exit = async (force = false) => {
    if (busy && !force) return;
    if (force || !dirty || (await discard.confirm())) {
      savedRef.current = true;
      await navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
    }
  };
  const title =
    !id && kind === 'skus'
      ? t('materials.createSku')
      : t(id ? 'materials.editRecord' : 'materials.create', {
          kind: t(`materials.kinds.${kind}`),
        });
  const content = !canWrite.can ? (
    <p>{t('materials.http403')}</p>
  ) : record.isError ? (
    <ErrorNotice error={record.error} retry={() => void record.refetch()} />
  ) : id && (!record.data || record.isFetching) ? (
    <Loading />
  ) : (
    <RecordForm
      key={`${kind}-${id ?? 'new'}`}
      kind={kind}
      record={record.data?.data}
      sourceRequestId={fromRequest ? params.sourceRequestId : undefined}
      onBusy={setBusy}
      onDirty={setDirty}
      exit={exit}
      footer={footer}
      reload={() => void record.refetch()}
    />
  );
  return complete ? (
    <RouteChildPage>
      <PageContainer>
        <div
          className='contents'
          onClickCapture={(e) => {
            e.preventDefault();
            void exit();
          }}
        >
          <BackButton />
        </div>
        <PageHeader
          title={title}
          description={t('materials.formDescription')}
        />
        <div className='max-w-2xl'>{content}</div>
        {discard.dialog}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <>
      <RouteDialog
        title={title}
        description={t('materials.formDescription')}
        className={kind === 'tags' ? 'sm:max-w-md' : undefined}
        beforeClose={async () => !busy && (!dirty || (await discard.confirm()))}
        footer={<div ref={setFooter} />}
      >
        {content}
      </RouteDialog>
      {discard.dialog}
    </>
  );
}
function RecordForm({
  kind,
  record,
  sourceRequestId,
  onBusy,
  onDirty,
  exit,
  footer,
  reload,
}: {
  kind: Kind;
  record?: Row;
  sourceRequestId?: string;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  exit: (saved?: boolean) => Promise<void>;
  footer: HTMLDivElement | null;
  reload: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    refresh = useMaterialRefresh(),
    message = useMaterialError();
  const [q, setQ] = useState(''),
    [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState(false),
    [gone, setGone] = useState(false);
  const active = Boolean(
    record && governed.includes(kind) && record.status === 'active',
  );
  const defaults: Record<string, unknown> = {
    name: record?.name ?? '',
    code: record?.code ?? '',
    notes: record?.notes ?? '',
    reason: '',
    attributeValues: record?.attributeValues ?? {},
    fields: record?.fields ?? [],
    ...Object.fromEntries(
      fields[kind].map((spec) => [
        spec.key,
        record?.[spec.key] ??
          (spec.type === 'boolean'
            ? false
            : (spec.choices?.[0] ??
              (spec.key === 'precision'
                ? '0'
                : spec.key === 'variancePercent'
                  ? '3'
                  : spec.key === 'numerator' || spec.key === 'denominator'
                    ? '1'
                    : ''))),
      ]),
    ),
  };
  const [templateRowKeys, setTemplateRowKeys] = useState(() =>
    ((record?.fields ?? []) as Attribute[]).map(() => randomId()),
  );
  const schema = useMemo(
    () =>
      z.record(z.string(), z.unknown()).superRefine((values, ctx) => {
        const issue = (path: string, message: string) =>
          ctx.addIssue({ code: 'custom', path: path.split('.'), message });
        if (!text(values.name).trim()) issue('name', t('materials.required'));
        if (text(values.name).length > 200)
          issue('name', t('materials.maxLength', { max: 200 }));
        if (
          text(values.code) &&
          !/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(text(values.code))
        )
          issue('code', t('materials.codeFormat'));
        if (record && !text(values.reason).trim())
          issue('reason', t('materials.required'));
        for (const spec of fields[kind]) {
          if (
            spec.required &&
            !text(values[spec.key]).trim() &&
            typeof values[spec.key] !== 'boolean'
          )
            issue(spec.key, t('materials.required'));
          if (spec.type === 'number' && !/^\d+$/.test(text(values[spec.key])))
            issue(spec.key, t('materials.integer'));
          if (
            spec.type === 'decimal' &&
            text(values[spec.key]) &&
            !/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(text(values[spec.key]))
          )
            issue(spec.key, t('materials.decimal'));
          if (
            kind === 'unitRules' &&
            spec.key === 'variancePercent' &&
            text(values[spec.key]) &&
            Number(values[spec.key]) > 100
          )
            issue(spec.key, t('materials.varianceRange'));
        }
        if (kind === 'templates') {
          const rows = values.fields as Attribute[];
          for (const [i, attr] of rows.entries()) {
            if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(attr.key))
              issue(`fields.${i}.key`, t('materials.attributeKeyFormat'));
            if (!attr.title.trim())
              issue(`fields.${i}.title`, t('materials.required'));
            if (attr.type === 'option' && !attr.options?.length)
              issue(`fields.${i}.options`, t('materials.required'));
          }
          if (new Set(rows.map((v) => v.key)).size !== rows.length)
            issue('fields', t('materials.duplicateAttribute'));
        }
      }),
    [kind, record, t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const values = useWatch({ control: form.control }),
    busy = form.formState.isSubmitting;
  const selectedIds = referenceIds(values),
    options = useMaterialOptions(kind, q, selectedIds);
  const names = options.data?.data.names?.rows ?? [],
    standard = names.find((v) => v.id === values.materialNameId),
    template = options.data?.data.templates?.rows.find(
      (v) => v.id === standard?.templateId,
    );
  const attrs = (template?.fields ?? []) as Attribute[],
    attrValues = (values.attributeValues ?? {}) as Record<string, string>,
    templateRows = (values.fields ?? []) as Attribute[];
  const suggestedCode = useMaterialNameCode(
      text(values.name),
      kind === 'names' && !record,
    ),
    autoCodeRef = useRef('');
  const suggested = suggestedCode.data?.data.code;
  useEffect(() => {
    if (!suggested) return;
    const current = text(form.getValues('code'));
    // Keep the code in sync with the name only while the field still holds the
    // generated value; once the user edits or clears it, leave it alone.
    if (current !== autoCodeRef.current) return;
    autoCodeRef.current = suggested;
    if (current !== suggested) form.setValue('code', suggested);
  }, [suggested, form, values.code]);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(
    () => onDirty(form.formState.isDirty),
    [form.formState.isDirty, onDirty],
  );
  const errorFor = (path: string) => {
    let current: unknown = form.formState.errors;
    for (const key of path.split('.'))
      current =
        typeof current === 'object' && current !== null
          ? Reflect.get(current, key)
          : undefined;
    return typeof current === 'object' && current !== null
      ? text(Reflect.get(current, 'message'))
      : undefined;
  };
  const set = (key: string, value: unknown) =>
    form.setValue(key, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  const send = form.handleSubmit(
    async (submitted) => {
      setError(undefined);
      try {
        const payload: Record<string, unknown> = {};
        for (const key of [
          'name',
          'code',
          'notes',
          ...fields[kind].map((v) => v.key),
          ...(kind === 'templates'
            ? ['fields']
            : kind === 'skus'
              ? ['attributeValues']
              : []),
        ]) {
          if (active && !['name', 'notes'].includes(key)) continue;
          let value = submitted[key];
          const spec = fields[kind].find((v) => v.key === key);
          if (spec?.type === 'number') value = Number(value);
          if (spec?.type === 'ref' && !value) value = null;
          if (key === 'code' && !value) continue;
          if (key === 'fields')
            value = (value as Attribute[]).map((field) => ({
              ...field,
              ...(field.type === 'option'
                ? {
                    options: (field.options ?? [])
                      .map((option) => option.trim())
                      .filter(Boolean),
                  }
                : {}),
            }));
          payload[key] = value;
        }
        if (record) {
          payload.version = record.version;
          payload.reason = submitted.reason;
        }
        if (sourceRequestId) payload.requestId = sourceRequestId;
        const response = await api.request<{ data: Row }>({
          path: `materials/${kind}${record ? `/${record.id}` : ''}`,
          method: record ? 'PATCH' : 'POST',
          json: payload,
        });
        await refresh(response.data, kind);
        toaster.show({
          type: 'success',
          title: t('materials.saved', { name: response.data.name }),
        });
        onBusy(false);
        await exit(true);
      } catch (e) {
        setError(e);
        if (e instanceof ApiClientError) {
          setConflict(
            Boolean(record) &&
              e.status === 409 &&
              !e.reason?.endsWith('_EXISTS'),
          );
          setGone(e.status === 404);
          const payload = e.payload as {
            error?: {
              fieldViolations?: { field: string }[];
              details?: { fieldViolations?: { field: string }[] }[];
            };
          };
          const violations =
            payload.error?.fieldViolations ??
            payload.error?.details?.flatMap((v) => v.fieldViolations ?? []) ??
            [];
          for (const [i, v] of violations.entries())
            form.setError(
              v.field,
              { message: message(e) },
              { shouldFocus: i === 0 },
            );
        }
      }
    },
    () =>
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('#material-form [aria-invalid=true]')
          ?.focus();
      }),
  );
  const bound = (
    key: string,
    type = 'text',
    required = false,
    disabled = false,
  ) => (
    <Controller
      key={key}
      name={key}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`material-form-${key}`}>
            {t(`materials.fields.${key}`)}
            {required ? (
              <span aria-hidden='true' className='text-destructive'>
                {' '}
                *
              </span>
            ) : null}
          </FieldLabel>
          {type === 'textarea' ? (
            <Textarea
              {...field}
              value={text(field.value)}
              id={`material-form-${key}`}
              disabled={busy || disabled}
              maxLength={key === 'reason' ? 1000 : 6000}
              aria-invalid={fieldState.invalid}
              aria-required={required}
            />
          ) : (
            <Input
              {...field}
              value={text(field.value)}
              id={`material-form-${key}`}
              disabled={busy || disabled}
              inputMode={type === 'number' ? 'numeric' : undefined}
              maxLength={key === 'name' ? 200 : key === 'code' ? 64 : 1000}
              aria-invalid={fieldState.invalid}
              aria-required={required}
            />
          )}
          {key === 'code' ? (
            <FieldDescription>
              {t(
                kind === 'names'
                  ? 'materials.autoCodeName'
                  : 'materials.autoCode',
              )}
            </FieldDescription>
          ) : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
  const buttons = (
    <div className='mt-6 flex flex-wrap justify-end gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={() => void exit()}
      >
        {t('materials.cancel')}
      </Button>
      <Button
        type='submit'
        form='material-form'
        disabled={
          busy || gone || options.isError || options.isPending || conflict
        }
      >
        {t(
          busy
            ? 'materials.saving'
            : record
              ? 'materials.save'
              : 'materials.createAction',
        )}
      </Button>
    </div>
  );
  return (
    <>
      <form
        id='material-form'
        noValidate
        onSubmit={(e) => void send(e)}
        className='flex flex-col gap-6'
      >
        {error ? <ErrorNotice error={error} /> : null}
        {error instanceof ApiClientError &&
        error.reason === 'MATERIAL_IDENTITY_EXISTS' ? (
          <Button
            type='button'
            variant='outline'
            nativeButton={false}
            render={
              <Link
                target='_blank'
                rel='noreferrer'
                to={{
                  pathname: '/functions/warehouse/materials',
                  search: new URLSearchParams({
                    materialNameId: text(values.materialNameId),
                  }).toString(),
                }}
              />
            }
          >
            {t('materials.findExisting')}
          </Button>
        ) : null}

        {conflict ? (
          <Alert>
            <AlertDescription className='flex flex-col gap-2'>
              {t('materials.keepInput')}
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  if (window.confirm(t('materials.reloadConfirm'))) reload();
                }}
              >
                {t('materials.reload')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <FieldSet disabled={busy || gone}>
          <FieldLegend>{t('materials.basic')}</FieldLegend>
          <FieldGroup>
            {bound('name', 'text', true, active && kind === 'references')}
            {kind === 'names' ? (
              <SimilarNameNotice
                name={text(values.name)}
                excludeId={record?.id}
              />
            ) : null}
            {bound('code', 'text', false, Boolean(record))}
            {active ? (
              <p className='text-sm text-muted-foreground'>
                {t(
                  kind === 'references'
                    ? 'materials.mappingLocked'
                    : 'materials.identityLocked',
                )}
              </p>
            ) : null}
            {!active && fields[kind].some((v) => v.type === 'ref') ? (
              <Field>
                <FieldLabel htmlFor='material-option-search'>
                  {t('materials.findRelated')}
                </FieldLabel>
                <Input
                  id='material-option-search'
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  maxLength={200}
                />
                <FieldDescription>
                  {t('materials.relatedHelp')}
                </FieldDescription>
              </Field>
            ) : null}
            {options.isError ? (
              <ErrorNotice
                error={options.error}
                retry={() => void options.refetch()}
              />
            ) : null}
            {options.data &&
            Object.values(options.data.data).some((v) => v.truncated) ? (
              <p className='text-sm text-muted-foreground'>
                {t('materials.optionCap', { limit: 100 })}
              </p>
            ) : null}
            {fields[kind].map((spec) =>
              spec.type === 'select' || spec.type === 'ref' ? (
                <Controller
                  key={spec.key}
                  name={spec.key}
                  control={form.control}
                  render={({ field, fieldState }) => {
                    const source = spec.source ?? text(values.targetKind);
                    let rows = options.data?.data[source]?.rows ?? [];
                    if (spec.key === 'responsiblePositionId') {
                      const units =
                        options.data?.data.orgUnits?.rows.filter(
                          (v) => v.subjectId === values.subjectId,
                        ) ?? [];
                      rows = rows.filter((v) =>
                        units.some((unit) => unit.id === v.unitId),
                      );
                    }
                    const items = [
                      { value: '', label: t('materials.choose') },
                      ...(spec.choices
                        ? spec.choices.map((value) => ({
                            value,
                            label: t(`materials.enums.${value}`),
                          }))
                        : rows
                            .filter(
                              (v) =>
                                v.id !== record?.id &&
                                (v.status === 'active' || v.id === field.value),
                            )
                            .map((v) => ({
                              value: v.id,
                              label: `${v.name} · ${v.code ?? ''}${v.status === 'active' ? '' : ` (${t('materials.unavailable')})`}`,
                            }))),
                    ];
                    if (
                      text(field.value) &&
                      !items.some((v) => v.value === field.value)
                    )
                      items.push({
                        value: text(field.value),
                        label: t('materials.unavailable'),
                      });
                    return (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`material-form-${spec.key}`}>
                          {t(`materials.fields.${spec.key}`)}
                          {spec.required ? (
                            <span
                              aria-hidden='true'
                              className='text-destructive'
                            >
                              {' '}
                              *
                            </span>
                          ) : null}
                        </FieldLabel>
                        <MaterialSelect
                          ref={field.ref}
                          id={`material-form-${spec.key}`}
                          label={t(`materials.fields.${spec.key}`)}
                          value={text(field.value)}
                          items={items}
                          onBlur={field.onBlur}
                          onChange={(value) => {
                            field.onChange(value);
                            if (spec.key === 'targetKind') set('targetId', '');
                            if (spec.key === 'materialNameId')
                              set('attributeValues', {});
                          }}
                          disabled={
                            busy ||
                            active ||
                            (Boolean(record) &&
                              spec.key === 'subjectId' &&
                              kind === 'warehouses')
                          }
                          invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    );
                  }}
                />
              ) : spec.type === 'boolean' ? (
                <Controller
                  key={spec.key}
                  name={spec.key}
                  control={form.control}
                  render={({ field }) => (
                    <Field orientation='horizontal'>
                      <Checkbox
                        ref={field.ref}
                        id={`material-form-${spec.key}`}
                        checked={field.value === true}
                        onCheckedChange={field.onChange}
                        disabled={busy || active}
                      />
                      <FieldLabel htmlFor={`material-form-${spec.key}`}>
                        {t(`materials.fields.${spec.key}`)}
                      </FieldLabel>
                    </Field>
                  )}
                />
              ) : (
                bound(spec.key, spec.type, spec.required, active)
              ),
            )}
            {bound('notes', 'textarea')}
            <PurchaseReferenceNotice
              domain='materials'
              kind={kind}
              id={record?.id}
              busy={busy}
            />
            {record ? bound('reason', 'textarea', true) : null}
          </FieldGroup>
        </FieldSet>
        {kind === 'skus' ? (
          <FieldSet disabled={busy || active}>
            <FieldLegend>{t('materials.attributes')}</FieldLegend>
            <FieldDescription>{t('materials.attributesHelp')}</FieldDescription>
            {attrs.length ? (
              attrs.map((attr) => (
                <Field
                  key={attr.key}
                  data-invalid={Boolean(
                    errorFor(`attributeValues.${attr.key}`),
                  )}
                >
                  <FieldLabel htmlFor={`material-attr-${attr.key}`}>
                    {attr.title}
                    {attr.unit ? ` (${attr.unit})` : ''}
                    {attr.required ? ' *' : ''}
                  </FieldLabel>
                  {attr.type === 'option' ? (
                    <MaterialSelect
                      id={`material-attr-${attr.key}`}
                      ref={form.register(`attributeValues.${attr.key}`).ref}
                      label={attr.title}
                      value={attrValues[attr.key] ?? ''}
                      items={[
                        { value: '', label: t('materials.choose') },
                        ...(attr.options ?? []).map((value) => ({
                          value,
                          label: value,
                        })),
                      ]}
                      onChange={(value) =>
                        set('attributeValues', {
                          ...attrValues,
                          [attr.key]: value,
                        })
                      }
                      disabled={busy || active}
                    />
                  ) : (
                    <Input
                      id={`material-attr-${attr.key}`}
                      {...form.register(`attributeValues.${attr.key}`)}
                      aria-required={attr.required}
                      value={attrValues[attr.key] ?? ''}
                      inputMode={attr.type === 'number' ? 'decimal' : undefined}
                      disabled={busy || active}
                      aria-invalid={Boolean(
                        errorFor(`attributeValues.${attr.key}`),
                      )}
                      onChange={(e) =>
                        set('attributeValues', {
                          ...attrValues,
                          [attr.key]: e.target.value,
                        })
                      }
                    />
                  )}
                  <FieldError>
                    {errorFor(`attributeValues.${attr.key}`)}
                  </FieldError>
                </Field>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('materials.noTemplate')}
              </p>
            )}
            <FieldError>{errorFor('attributeValues')}</FieldError>
          </FieldSet>
        ) : null}
        {kind === 'templates' ? (
          <FieldSet disabled={busy}>
            <FieldLegend>{t('materials.templateFields')}</FieldLegend>
            <FieldDescription>{t('materials.templateHelp')}</FieldDescription>
            {templateRows.map((attr, index) => {
              const change = (key: keyof Attribute, value: unknown) =>
                set(
                  'fields',
                  templateRows.map((v, i) =>
                    i === index ? { ...v, [key]: value } : v,
                  ),
                );
              return (
                <div
                  key={templateRowKeys[index]}
                  className='flex flex-col gap-4 rounded-lg border p-4'
                >
                  <div className='flex items-center justify-between'>
                    <span className='font-medium'>
                      {t('materials.attributeRow', { index: index + 1 })}
                    </span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('materials.removeAttribute', {
                        index: index + 1,
                      })}
                      onClick={() => {
                        setTemplateRowKeys((keys) =>
                          keys.filter((_, i) => i !== index),
                        );
                        set(
                          'fields',
                          templateRows.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {(['key', 'title', 'unit'] as const).map((key) => (
                    <Field
                      key={key}
                      data-invalid={Boolean(errorFor(`fields.${index}.${key}`))}
                    >
                      <FieldLabel htmlFor={`attribute-${index}-${key}`}>
                        {t(`materials.attribute.${key}`)}
                        {key !== 'unit' ? (
                          <span aria-hidden='true' className='text-destructive'>
                            {' '}
                            *
                          </span>
                        ) : null}
                      </FieldLabel>
                      <Input
                        id={`attribute-${index}-${key}`}
                        {...form.register(`fields.${index}.${key}`)}
                        aria-required={key !== 'unit'}
                        value={attr[key] ?? ''}
                        onChange={(e) => change(key, e.target.value)}
                        aria-invalid={Boolean(
                          errorFor(`fields.${index}.${key}`),
                        )}
                      />
                      <FieldError>
                        {errorFor(`fields.${index}.${key}`)}
                      </FieldError>
                    </Field>
                  ))}
                  <Field>
                    <FieldLabel htmlFor={`attribute-${index}-type`}>
                      {t('materials.attribute.type')}
                    </FieldLabel>
                    <MaterialSelect
                      id={`attribute-${index}-type`}
                      label={t('materials.attribute.type')}
                      value={attr.type}
                      items={['text', 'number', 'option'].map((value) => ({
                        value,
                        label: t(`materials.enums.${value}`),
                      }))}
                      onChange={(v) => change('type', v)}
                    />
                  </Field>
                  {(['required', 'identity'] as const).map((key) => (
                    <Field key={key} orientation='horizontal'>
                      <Checkbox
                        id={`attribute-${index}-${key}`}
                        checked={attr[key]}
                        onCheckedChange={(v) => change(key, v)}
                      />
                      <FieldLabel htmlFor={`attribute-${index}-${key}`}>
                        {t(`materials.attribute.${key}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                  {attr.type === 'option' ? (
                    <Field>
                      <FieldLabel htmlFor={`attribute-${index}-options`}>
                        {t('materials.attribute.options')}
                      </FieldLabel>
                      <Textarea
                        id={`attribute-${index}-options`}
                        ref={form.register(`fields.${index}.options`).ref}
                        aria-required
                        aria-invalid={Boolean(
                          errorFor(`fields.${index}.options`),
                        )}
                        value={(attr.options ?? []).join('\n')}
                        onChange={(e) =>
                          change('options', e.target.value.split('\n'))
                        }
                      />
                      <FieldDescription>
                        {t('materials.onePerLine')}
                      </FieldDescription>
                      <FieldError>
                        {errorFor(`fields.${index}.options`)}
                      </FieldError>
                    </Field>
                  ) : null}
                </div>
              );
            })}
            <FieldError>{errorFor('fields')}</FieldError>
            <Button
              type='button'
              variant='outline'
              disabled={templateRows.length >= 50}
              onClick={() => {
                setTemplateRowKeys((keys) => [...keys, randomId()]);
                set('fields', [
                  ...templateRows,
                  {
                    key: '',
                    title: '',
                    type: 'text',
                    required: false,
                    identity: true,
                  },
                ]);
              }}
            >
              <Plus />
              {t('materials.addAttribute')}
            </Button>
          </FieldSet>
        ) : null}
      </form>
      {large.includes(kind)
        ? buttons
        : footer
          ? createPortal(buttons, footer)
          : null}
    </>
  );
}
