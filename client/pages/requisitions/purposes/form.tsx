import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useResolvedPath, useSearchParams } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouteOverlay } from '#components/use-route-overlay';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Spinner } from '#components/ui/spinner';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import { Loading, ErrorNotice, ReferencePicker } from '../requests/controls.js';
import {
  ui,
  useRequestKey,
  useLeaveGuard,
  useConfirm,
} from '../requests/hooks.js';
import {
  purposeUi as pui,
  usePurpose,
  usePurposeCan,
  type Purpose,
} from './model.js';

export default function PurposeForm() {
  const { purposeId, transition } = useParams(),
    { t } = useTranslation(),
    data = usePurpose(purposeId);
  const action =
    transition === 'activate' || transition === 'deactivate'
      ? transition
      : undefined;
  const permission = usePurposeCan(purposeId ? (action ?? 'update') : 'create');
  const identity = `${purposeId ?? 'new'}-${action ?? 'edit'}`;
  const [loaded, setLoaded] = useState<{ identity: string; record: Purpose }>();
  if (loaded && loaded.identity !== identity) setLoaded(undefined);
  if (
    purposeId &&
    loaded?.identity !== identity &&
    data.data &&
    !data.isFetching &&
    !data.error
  )
    setLoaded({ identity, record: data.data.data });
  const initial = loaded?.identity === identity ? loaded.record : undefined;
  if (purposeId && !initial)
    return (
      <RouteDialog title={t(pui(action ?? 'editTitle'))}>
        {data.error ? (
          <ErrorNotice error={data.error} retry={() => void data.refetch()} />
        ) : (
          <Loading kind='form' />
        )}
      </RouteDialog>
    );
  return (
    <PurposeFormBody
      key={identity}
      initial={initial}
      action={action}
      allowed={permission.can && !permission.isPending}
      fetchError={data.error}
    />
  );
}
type Values = Pick<Purpose, 'subjectId' | 'code' | 'name' | 'description'>;
const valuesOf = (p: Purpose): Values => ({
  subjectId: p.subjectId,
  code: p.code,
  name: p.name,
  description: p.description,
});
function PurposeFormBody({
  initial,
  action,
  allowed,
  fetchError,
}: {
  initial?: Purpose;
  action?: 'activate' | 'deactivate';
  allowed: boolean;
  fetchError?: unknown;
}) {
  const { t } = useTranslation(),
    [params] = useSearchParams(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster();
  const [row, setRow] = useState(initial),
    [values, setValues] = useState<Values>(() =>
      initial
        ? valuesOf(initial)
        : {
            subjectId: params.get('subjectId') ?? '',
            code: '',
            name: '',
            description: '',
          },
    );
  const [baseline, setBaseline] = useState(values),
    [reason, setReason] = useState(''),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [latest, setLatest] = useState<Purpose>(),
    [serverErrors, setServerErrors] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({});
  const busyRef = useRef(false),
    request = useRequestKey(),
    confirm = useConfirm();
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline) || !!reason;
  const guard = useLeaveGuard(dirty, busy, useResolvedPath('.').pathname);
  const savedRef = useRef(false),
    [saved, setSaved] = useState(false);
  const labels = {
    subjectId: 'company',
    code: 'code',
    name: 'name',
    description: 'notes',
  };
  const change = (key: keyof Values, value: string) => {
    setValues((old) => ({ ...old, [key]: value }));
    setServerErrors((old) => ({ ...old, [key]: '' }));
    if (key === 'code')
      setError((old: unknown) =>
        old instanceof ApiClientError &&
        old.reason === 'ISSUE_PURPOSE_CODE_DUPLICATE'
          ? undefined
          : old,
      );
  };
  const invalid: Record<string, boolean> = attempted
    ? {
        subjectId: !values.subjectId,
        code: !values.code.trim() || values.code.trim().length > 64,
        name: !values.name.trim() || values.name.trim().length > 200,
        description: values.description.length > 6000,
        reason: !!initial && (!reason.trim() || reason.trim().length > 3000),
      }
    : {};
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || latest || !allowed) return;
    setAttempted(true);
    const bad =
      !values.subjectId ||
      !values.code.trim() ||
      values.code.trim().length > 64 ||
      !values.name.trim() ||
      values.name.trim().length > 200 ||
      values.description.length > 6000 ||
      (initial && (!reason.trim() || reason.trim().length > 3000));
    if (bad) {
      queueMicrotask(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    if (
      action &&
      !(await confirm.ask(
        t(pui('actionTitle'), { action: t(pui(action)), name: row?.name }),
        t(pui(action === 'deactivate' ? 'deactivateHint' : 'activateHint')),
        t(pui(action)),
      ))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: Purpose }>({
        path: row
          ? `requisitions/purposes/${row.id}${action ? `/${action}` : ''}`
          : 'requisitions/purposes',
        method: row && !action ? 'PATCH' : 'POST',
        json: {
          ...(!action ? { content: values } : {}),
          ...(row
            ? {
                version: row.revision,
                lifecycleVersion: row.lifecycleVersion,
                reason,
              }
            : {}),
          requestKey: request.for({
            values: action ? null : values,
            version: row?.revision,
            lifecycleVersion: row?.lifecycleVersion,
            reason,
            action,
          }),
        },
      });
      cache.setQueryData(['issue', `purposes/${result.data.id}`, {}], result);
      await cache.invalidateQueries({
        queryKey: ['issue'],
        refetchType: 'active',
      });
      toast.show({
        type: 'success',
        title: t(pui('saved'), { name: result.data.name }),
      });
      guard.complete();
      savedRef.current = true;
      setSaved(true);
    } catch (e) {
      setError(e);
      if (
        e instanceof ApiClientError &&
        e.reason === 'ISSUE_PURPOSE_CODE_DUPLICATE'
      ) {
        setServerErrors({ code: t(ui('purposeCodeDuplicate')) });
        queueMicrotask(() => document.getElementById('purpose-code')?.focus());
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      const result = await api.request<{ data: Purpose }>({
        path: `requisitions/purposes/${row.id}`,
      });
      setLatest(result.data);
      setChoices({});
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const conflicts = latest
    ? (['code', 'name', 'description'] as const).filter(
        (key) =>
          values[key] !== baseline[key] &&
          latest[key] !== baseline[key] &&
          latest[key] !== values[key],
      )
    : [];
  const apply = () => {
    if (!latest || conflicts.some((key) => !choices[key])) return;
    const next = valuesOf(latest);
    for (const key of ['code', 'name', 'description'] as const)
      if (
        values[key] !== baseline[key] &&
        (!conflicts.includes(key) || choices[key] === 'local')
      )
        next[key] = values[key];
    setValues(next);
    setBaseline(valuesOf(latest));
    setRow(latest);
    setLatest(undefined);
    setError(undefined);
    request.reset();
  };
  const terminal =
    (error instanceof ApiClientError &&
      [401, 403, 404].includes(error.status)) ||
    (fetchError instanceof ApiClientError &&
      [401, 403, 404].includes(fetchError.status));
  const title = action
    ? t(pui('actionTitle'), { action: t(pui(action)), name: row?.name })
    : t(pui(row ? 'editTitle' : 'createTitle'));
  return (
    <>
      <RouteDialog
        title={title}
        className={action ? 'sm:max-w-md' : undefined}
        beforeClose={() => savedRef.current || guard.leave()}
        footer={
          <>
            <PurposeCancel busy={busy} />
            <Button
              type='submit'
              form='issue-purpose-form'
              disabled={busy || !!terminal || !!latest || !allowed}
            >
              {busy && <Spinner />}
              {t(pui(action ?? 'save'))}
            </Button>
          </>
        }
      >
        <CloseWhenSaved saved={saved} />
        <form
          id='issue-purpose-form'
          noValidate
          onSubmit={(event) => void save(event)}
          className='flex flex-col gap-4'
        >
          {!allowed && (
            <Alert>
              <AlertDescription>{t(ui('forbidden'))}</AlertDescription>
            </Alert>
          )}
          {Boolean(fetchError) && <ErrorNotice error={fetchError} />}
          {Boolean(error) && <ErrorNotice error={error} />}
          {error instanceof ApiClientError &&
            error.status === 409 &&
            error.reason !== 'ISSUE_PURPOSE_CODE_DUPLICATE' &&
            row && (
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => void loadLatest()}
              >
                {t(pui('latest'))}
              </Button>
            )}
          {latest && (
            <div className='flex flex-col gap-4 rounded-lg border p-4'>
              <p className='text-sm'>{t(pui('conflict'))}</p>
              {conflicts.map((key) => (
                <Field key={key}>
                  <FieldLabel>{t(pui(labels[key]))}</FieldLabel>
                  <RadioGroup
                    value={choices[key] ?? ''}
                    onValueChange={(value) =>
                      setChoices((old) => ({
                        ...old,
                        [key]: value as 'local' | 'server',
                      }))
                    }
                  >
                    {(['local', 'server'] as const).map((choice) => (
                      <Label key={choice} className='flex items-start gap-2'>
                        <RadioGroupItem value={choice} />
                        <span className='text-sm break-words'>
                          {t(
                            ui(
                              choice === 'local' ? 'localValue' : 'serverValue',
                            ),
                          )}
                          : {choice === 'local' ? values[key] : latest[key]}
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </Field>
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={conflicts.some((key) => !choices[key])}
                onClick={apply}
              >
                {t(ui('applyMerge'))}
              </Button>
            </div>
          )}
          <fieldset
            disabled={busy || !!terminal || !allowed}
            className='contents'
          >
            {action ? (
              <p className='text-sm'>
                {t(
                  pui(
                    action === 'deactivate' ? 'deactivateHint' : 'activateHint',
                  ),
                )}
              </p>
            ) : (
              <>
                <ReferencePicker
                  id='purpose-subjectId'
                  path='purposeCompanies'
                  label={`${t(pui('company'))} *`}
                  disabled={!!row || !allowed}
                  selected={row?.company}
                  value={values.subjectId}
                  error={invalid.subjectId ? t(pui('required')) : undefined}
                  onChange={(id) =>
                    setValues((old) => ({ ...old, subjectId: id }))
                  }
                />
                {(['code', 'name', 'description'] as const).map((key) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`purpose-${key}`}>
                      {t(pui(labels[key]))}
                      {key !== 'description' ? ' *' : ''}
                    </FieldLabel>
                    {key === 'description' ? (
                      <Textarea
                        id={`purpose-${key}`}
                        value={values[key]}
                        aria-invalid={!!invalid[key] || !!serverErrors[key]}
                        onChange={(e) => change(key, e.target.value)}
                        maxLength={6000}
                      />
                    ) : (
                      <Input
                        id={`purpose-${key}`}
                        value={values[key]}
                        aria-invalid={!!invalid[key] || !!serverErrors[key]}
                        onChange={(e) => change(key, e.target.value)}
                        maxLength={key === 'code' ? 64 : 200}
                      />
                    )}
                    {(invalid[key] || serverErrors[key]) && (
                      <FieldError>
                        {serverErrors[key] || t(pui('required'))}
                      </FieldError>
                    )}
                  </Field>
                ))}
              </>
            )}
            {!!initial && (
              <Field>
                <FieldLabel htmlFor='purpose-reason'>
                  {t(pui('reason'))} *
                </FieldLabel>
                <Textarea
                  id='purpose-reason'
                  value={reason}
                  aria-invalid={!!invalid.reason}
                  maxLength={3000}
                  onChange={(e) => setReason(e.target.value)}
                />
                {invalid.reason && (
                  <FieldError>{t(pui('required'))}</FieldError>
                )}
              </Field>
            )}
          </fieldset>
          {action && latest && (
            <Alert>
              <AlertDescription>{t(pui('changedHint'))}</AlertDescription>
            </Alert>
          )}
        </form>
      </RouteDialog>
      {guard.dialog}
      {confirm.dialog}
    </>
  );
}

function PurposeCancel({ busy }: { busy: boolean }) {
  const overlay = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <Button
      variant='outline'
      disabled={busy || overlay.isClosing}
      onClick={() => void overlay.close()}
    >
      {t(pui('cancel'))}
    </Button>
  );
}
function CloseWhenSaved({ saved }: { saved: boolean }) {
  const { close } = useRouteOverlay();
  useEffect(() => {
    if (saved) void close();
  }, [saved, close]);
  return null;
}
