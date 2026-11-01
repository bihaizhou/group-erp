import { PurchaseReferenceNotice } from '#components/purchase-reference-notice';
import { textValue } from './model.js';
import { useState, type FormEvent } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { PeopleSelect, PeopleLoading, PeopleErrorNotice } from './controls.js';
import {
  usePeopleCan,
  usePeopleRecord,
  usePeopleRefresh,
  usePeopleError,
  usePeopleOptions,
} from './hooks.js';
import { kindFromPath, type Kind, type Row, type Data } from './model.js';

export function WorkflowActions({ kind, row }: { kind: Kind; row: Row }) {
  const { t } = useTranslation(),
    location = useLocation();
  const canCompanyConfirm = usePeopleCan('workforcePlans', 'companyConfirm');
  const canUpdate = usePeopleCan(kind),
    canReview = usePeopleCan(kind, 'review');
  // A personnel change is approved by the candidates of its current stage, not
  // by everyone holding the review permission, so the server decides there.
  const byCandidate = kind === 'changes';
  const actions = (row.workflow?.available ?? []).filter(
    (a) =>
      a.allowed &&
      (a.name === 'companyConfirm'
        ? canCompanyConfirm
        : ['approve', 'confirm', 'return'].includes(a.name)
          ? byCandidate || canReview
          : a.name === 'withdraw'
            ? byCandidate
            : canUpdate),
  );
  if (!actions.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('people.availableActions')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {actions.map((a) => (
          <Button
            key={a.name}
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: `actions/${a.name}`, search: location.search }}
              />
            }
          >
            {t(`people.transitions.${a.name}`)}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}
export default function WorkflowActionPage() {
  const location = useLocation(),
    params = useParams(),
    kind = kindFromPath(location.pathname);
  const record = usePeopleRecord(kind, params.relatedId ?? params.recordId);
  return record.isError ? (
    <RouteDialog title=''>
      <PeopleErrorNotice
        error={record.error}
        retry={() => void record.refetch()}
      />
    </RouteDialog>
  ) : !record.data ? (
    <RouteDialog title=''>
      <PeopleLoading />
    </RouteDialog>
  ) : (
    <ActionForm
      key={`${record.data.data.id}-${params.transition}`}
      kind={kind}
      row={record.data.data}
      transition={params.transition ?? ''}
    />
  );
}
function ActionForm({
  kind,
  row,
  transition,
}: {
  kind: Kind;
  row: Row;
  transition: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    location = useLocation(),
    navigate = useNavigate(),
    refresh = usePeopleRefresh(),
    errorText = usePeopleError();
  const [reason, setReason] = useState(''),
    [progress, setProgress] = useState(() =>
      textValue(row.data.progress ?? ''),
    ),
    [result, setResult] = useState(() => textValue(row.data.result ?? '')),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldError = (id: string) =>
    fieldErrors[id] ? (
      <FieldError id={`${id}-error`}>{fieldErrors[id]}</FieldError>
    ) : null;
  const scoreField =
    transition === 'selfAssess'
      ? 'selfScore'
      : transition === 'managerAssess'
        ? 'managerScore'
        : 'confirmedScore';
  const [ratings, setRatings] = useState<Data[]>(() =>
    ((row.data.ratings as Data[] | undefined) ?? []).map((r) => ({
      dimensionId: r.dimensionId,
      score: r[scoreField] ?? null,
      evidence: r[`${scoreField}Evidence`] ?? '',
    })),
  );
  const [items, setItems] = useState<Data[]>(() =>
    ((row.data.items as Data[] | undefined) ?? []).map((v) => ({
      positionId: v.positionId,
      approved: v.approved ?? v.requested,
    })),
  );
  const options = usePeopleOptions(kind);
  const [tasks, setTasks] = useState<Data[]>(() =>
    ((row.data.items as Data[] | undefined) ?? []).map((item) => {
      const previous = (
        (row.data.taskResults as Data[] | undefined) ?? []
      ).find((task) => task.positionId === item.positionId);
      return (
        previous ?? {
          positionId: item.positionId,
          owner: item.owner ?? '',
          status: 'pending',
          result: '',
          assignmentIds: [],
        }
      );
    }),
  );
  const planProgress = kind === 'workforcePlans' && transition === 'progress';
  const [key] = useState(requestId);
  const scores =
    kind === 'evaluations' &&
    ['selfAssess', 'managerAssess', 'confirm'].includes(transition);
  const approve = kind === 'workforcePlans' && transition === 'approve';
  const exit = () => {
    if (!pending)
      void navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const errors: Record<string, string> = {};
    if (scores) {
      if (!ratings.some((r) => r.score !== null))
        errors['people-score-0'] = t('people.required');
      ratings.forEach((r, i) => {
        if (r.score !== null && !textValue(r.evidence).trim())
          errors[`people-rating-${i}`] = t('people.required');
      });
    }
    if (approve)
      items.forEach((item, i) => {
        if (
          typeof item.approved !== 'number' ||
          !Number.isInteger(item.approved) ||
          item.approved < 0
        )
          errors[`people-approved-${i}`] = t('people.invalid');
      });
    if (transition === 'complete' && !result.trim())
      errors['people-result'] = t('people.required');
    if (planProgress)
      tasks.forEach((task, i) => {
        if (!textValue(task.owner).trim())
          errors[`task-owner-${i}`] = t('people.required');
        if (task.status === 'completed') {
          if (!textValue(task.result).trim())
            errors[`task-result-${i}`] = t('people.required');
          const item = (row.data.items as Data[]).find(
            (v) => v.positionId === task.positionId,
          )!;
          const baseline = (
            (row.snapshot?.items as Data[] | undefined) ?? []
          ).find((v) => v.positionId === task.positionId);
          if (
            item.approach !== 'develop' &&
            (task.assignmentIds as string[]).length <
              Math.max(
                0,
                Number(item.approved ?? 0) - Number(baseline?.baseline ?? 0),
              )
          )
            errors[`task-assignments-${i}`] = t(
              'people.errors.PEOPLE_TASK_EVIDENCE',
            );
        }
      });
    if (!reason.trim()) errors['people-action-reason'] = t('people.required');
    setFieldErrors(errors);
    setInvalid(Boolean(errors['people-action-reason']));
    if (Object.keys(errors).length) {
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: Row }>({
        path: `people/${kind}/${row.id}/fire`,
        method: 'POST',
        json: {
          transition,
          version: row.lifecycleVersion,
          requestId: key,
          reason,
          input: scores
            ? { ratings }
            : approve
              ? { items }
              : ['progress', 'complete'].includes(transition)
                ? planProgress
                  ? { progress, taskResults: tasks }
                  : { progress, result }
                : {},
        },
      });
      await refresh(response.data, kind);
      toaster.show({
        type: 'success',
        title: t('people.actionSuccess', {
          action: t(`people.transitions.${transition}`),
          name: row.name,
        }),
      });
      void navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError) {
        const payload = e.payload as {
          error?: {
            fieldViolations?: { field: string }[];
            details?: { fieldViolations?: { field: string }[] }[];
          };
        };
        const violations =
          payload?.error?.fieldViolations ??
          payload?.error?.details?.flatMap((d) => d.fieldViolations ?? []) ??
          [];
        const mapped: Record<string, string> = {};
        for (const violation of violations) {
          const key = violation.field;
          const id =
            key === 'reason'
              ? 'people-action-reason'
              : key === 'input.result'
                ? 'people-result'
                : key.startsWith('input.ratings')
                  ? 'people-rating-0'
                  : key.startsWith('input.items')
                    ? 'people-approved-0'
                    : key.startsWith('input.taskResults')
                      ? 'task-assignments-0'
                      : undefined;
          if (id) mapped[id] = errorText(e);
        }
        if (Object.keys(mapped).length) {
          setFieldErrors(mapped);
          document.getElementById(Object.keys(mapped)[0])?.focus();
        }
      }
    } finally {
      setPending(false);
    }
  };
  const actions = (
    <>
      <Button variant='outline' type='button' disabled={pending} onClick={exit}>
        {t('people.cancel')}
      </Button>
      <Button
        type='submit'
        form='people-action-form'
        disabled={pending}
        variant={transition === 'cancel' ? 'destructive' : 'default'}
      >
        {t(pending ? 'people.saving' : `people.transitions.${transition}`)}
      </Button>
    </>
  );
  const content = (
    <form
      id='people-action-form'
      onSubmit={(event) => void submit(event)}
      className='flex flex-col gap-4'
      noValidate
      onChange={(event) => {
        const id = (event.target as HTMLElement).id;
        if (id) setFieldErrors((previous) => ({ ...previous, [id]: '' }));
      }}
    >
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{errorText(error)}</AlertDescription>
        </Alert>
      ) : null}
      {scores ? (
        <>
          <p className='text-sm text-muted-foreground'>
            {t('people.scoreEntryHint')}
          </p>
          {ratings.map((rating, index) => {
            const dimension = (
              (row.snapshot?.dimensions as Data[] | undefined) ?? []
            ).find((v) => v.dimensionId === rating.dimensionId);
            return (
              <div
                key={textValue(rating.dimensionId)}
                className='flex flex-col gap-3 rounded-lg border p-4'
              >
                <p className='text-sm font-medium'>
                  {textValue(dimension?.name ?? '—')}
                </p>
                <PeopleSelect
                  id={`people-score-${index}`}
                  invalid={Boolean(fieldErrors[`people-score-${index}`])}
                  label={t(`people.fields.${scoreField}`)}
                  value={textValue(rating.score ?? '')}
                  onChange={(v) =>
                    setRatings((old) =>
                      old.map((r, i) =>
                        i === index
                          ? { ...r, score: v === '' ? null : Number(v) }
                          : r,
                      ),
                    )
                  }
                  disabled={pending}
                  items={[
                    { value: '', label: t('people.unrated') },
                    ...Array.from({ length: 41 }, (_, i) => ({
                      value: textValue(Math.round((1 + i / 10) * 10) / 10),
                      label: (1 + i / 10).toFixed(1),
                    })),
                  ]}
                />
                {fieldError(`people-score-${index}`)}
                <Field>
                  <FieldLabel htmlFor={`people-rating-${index}`}>
                    {t('people.fields.evidence')}
                  </FieldLabel>
                  <Textarea
                    id={`people-rating-${index}`}
                    value={textValue(rating.evidence)}
                    disabled={pending}
                    maxLength={6000}
                    aria-invalid={Boolean(
                      fieldErrors[`people-rating-${index}`],
                    )}
                    aria-describedby={
                      fieldErrors[`people-rating-${index}`]
                        ? `people-rating-${index}-error`
                        : undefined
                    }
                    onChange={(e) =>
                      setRatings((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, evidence: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  {fieldError(`people-rating-${index}`)}
                </Field>
                {dimension?.standards ? (
                  <div className='flex flex-col gap-1'>
                    {(dimension.standards as string[]).map((standard, i) => (
                      <p
                        key={standard}
                        className='text-xs text-muted-foreground'
                      >
                        {i + 1} · {standard}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}
      {approve
        ? items.map((item, index) => {
            const snapshot = (
              (row.snapshot?.items as Data[] | undefined) ?? []
            ).find((v) => v.positionId === item.positionId);
            return (
              <Field key={textValue(item.positionId)}>
                <FieldLabel htmlFor={`people-approved-${index}`}>
                  {textValue(snapshot?.positionName ?? item.positionId)} ·{' '}
                  {t('people.fields.approved')}
                </FieldLabel>
                <Input
                  id={`people-approved-${index}`}
                  type='number'
                  min={0}
                  step={1}
                  value={textValue(item.approved)}
                  disabled={pending}
                  aria-invalid={Boolean(
                    fieldErrors[`people-approved-${index}`],
                  )}
                  onChange={(e) =>
                    setItems((old) =>
                      old.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              approved:
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                            }
                          : r,
                      ),
                    )
                  }
                />
                {fieldError(`people-approved-${index}`)}
              </Field>
            );
          })
        : null}
      {planProgress
        ? tasks.map((task, index) => {
            const baseline = (
              (row.snapshot?.items as Data[] | undefined) ?? []
            ).find((v) => v.positionId === task.positionId);
            const ids = task.assignmentIds as string[];
            const eligible = (
              options.data?.data.assignments?.rows ?? []
            ).filter(
              (a) =>
                a.positionId === task.positionId &&
                a.data.type === 'primary' &&
                !(
                  (baseline?.baselineAssignmentIds as string[] | undefined) ??
                  []
                ).includes(a.id),
            );
            const change = (key: string, value: import('./model.js').Value) =>
              setTasks((previous) =>
                previous.map((v, i) =>
                  i === index ? { ...v, [key]: value } : v,
                ),
              );
            return (
              <div
                key={textValue(task.positionId)}
                className='flex flex-col gap-3 rounded-lg border p-4'
              >
                <p className='text-sm font-medium'>
                  {textValue(baseline?.positionName ?? task.positionId)}
                </p>
                <Field>
                  <FieldLabel htmlFor={`task-owner-${index}`}>
                    {t('people.fields.owner')} *
                  </FieldLabel>
                  <Input
                    id={`task-owner-${index}`}
                    value={textValue(task.owner)}
                    disabled={pending}
                    onChange={(e) => change('owner', e.target.value)}
                    aria-invalid={Boolean(fieldErrors[`task-owner-${index}`])}
                  />
                  {fieldError(`task-owner-${index}`)}
                </Field>
                <PeopleSelect
                  label={t('people.taskStatus')}
                  disabled={pending}
                  value={textValue(task.status)}
                  onChange={(v) => change('status', v)}
                  items={['pending', 'inProgress', 'completed'].map(
                    (value) => ({
                      value,
                      label: t(`people.states.${textValue(value)}`),
                    }),
                  )}
                />
                <Field>
                  <FieldLabel htmlFor={`task-result-${index}`}>
                    {t('people.fields.result')}
                  </FieldLabel>
                  <Textarea
                    id={`task-result-${index}`}
                    value={textValue(task.result)}
                    disabled={pending}
                    maxLength={6000}
                    onChange={(e) => change('result', e.target.value)}
                    aria-invalid={Boolean(fieldErrors[`task-result-${index}`])}
                  />
                  {fieldError(`task-result-${index}`)}
                </Field>
                <PeopleSelect
                  id={`task-assignments-${index}`}
                  invalid={Boolean(fieldErrors[`task-assignments-${index}`])}
                  label={t('people.linkAssignments')}
                  disabled={pending}
                  value=''
                  onChange={(id) => {
                    if (id && !ids.includes(id))
                      change('assignmentIds', [...ids, id]);
                  }}
                  items={[
                    { value: '', label: t('people.linkAssignments') },
                    ...eligible
                      .filter((a) => !ids.includes(a.id))
                      .map((a) => ({
                        value: a.id,
                        label: `${a.name} · ${a.code}`,
                      })),
                  ]}
                />
                {fieldError(`task-assignments-${index}`)}
                {ids.map((id) => (
                  <Button
                    key={id}
                    type='button'
                    variant='outline'
                    disabled={pending}
                    onClick={() =>
                      change(
                        'assignmentIds',
                        ids.filter((value) => value !== id),
                      )
                    }
                  >
                    {options.data?.data.assignments?.rows.find(
                      (a) => a.id === id,
                    )?.name ?? id}{' '}
                    · {t('people.removeItem')}
                  </Button>
                ))}
              </div>
            );
          })
        : null}
      {['progress', 'complete'].includes(transition) ? (
        <>
          <Field>
            <FieldLabel htmlFor='people-progress'>
              {t('people.fields.progress')}
            </FieldLabel>
            <Textarea
              id='people-progress'
              value={progress}
              disabled={pending}
              maxLength={6000}
              onChange={(e) => setProgress(e.target.value)}
            />
          </Field>
          {kind === 'developmentPlans' ? (
            <Field>
              <FieldLabel htmlFor='people-result'>
                {t('people.fields.result')}
              </FieldLabel>
              <Textarea
                id='people-result'
                aria-invalid={Boolean(fieldErrors['people-result'])}
                value={result}
                disabled={pending}
                maxLength={6000}
                onChange={(e) => setResult(e.target.value)}
              />
              {fieldError('people-result')}
            </Field>
          ) : null}
        </>
      ) : null}
      <PurchaseReferenceNotice
        domain='people'
        kind={kind}
        id={row.id}
        busy={pending}
      />
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor='people-action-reason'>
          {t('people.fields.reason')} *
        </FieldLabel>
        <Textarea
          id='people-action-reason'
          value={reason}
          disabled={pending}
          maxLength={1000}
          aria-invalid={invalid}
          onChange={(e) => {
            setReason(e.target.value);
            setInvalid(false);
          }}
        />
        {invalid ? (
          <p className='text-sm text-destructive'>{t('people.required')}</p>
        ) : null}
      </Field>
    </form>
  );
  if (transition === 'cancel')
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open && !pending) exit();
        }}
      >
        <AlertDialogContent className='flex flex-col overflow-y-hidden'>
          <AlertDialogHeader className='shrink-0'>
            <AlertDialogTitle>
              {t('people.cancelRecord', { name: row.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('people.cancelConsequence')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='min-h-0 flex-1 overflow-y-auto'>{content}</div>
          <AlertDialogFooter className='shrink-0'>{actions}</AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  return (
    <RouteDialog
      title={t('people.actionTitle', {
        action: t(`people.transitions.${transition}`),
        name: row.name,
      })}
      beforeClose={() => !pending}
      footer={actions}
    >
      {content}
    </RouteDialog>
  );
}
