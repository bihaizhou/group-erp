import { useRef, useState, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import { LongText } from '#components/long-text';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '#components/ui/collapsible';
import {
  ui,
  useRequest,
  useCapabilities,
  useIssueRefresh,
  useRequestKey,
  useLeaveGuard,
  useConfirm,
} from '../hooks.js';
import { ErrorNotice, Loading, IssueStatus } from '../controls.js';
import { transitions, type Transition, type IssueRequest } from '../model.js';
import { DemandLines } from './index.js';
export default function IssueAction() {
  const { requestId, transition } = useParams(),
    { t } = useTranslation(),
    record = useRequest(requestId),
    caps = useCapabilities(requestId);
  const [ready, setReady] = useState<IssueRequest>();
  if (
    !ready &&
    record.data &&
    !record.isFetching &&
    caps.data &&
    !caps.isFetching
  )
    setReady(record.data.data);
  const valid = transitions.includes(transition as Transition);
  if (!valid || record.error || caps.error || !ready)
    return (
      <RouteDialog
        title={t(
          ui(
            valid
              ? transition === 'cancel'
                ? 'cancelRequest'
                : transition!
              : 'actionUnavailable',
          ),
        )}
      >
        {record.error || caps.error ? (
          <ErrorNotice
            error={record.error ?? caps.error}
            retry={() => {
              void record.refetch();
              void caps.refetch();
            }}
          />
        ) : !valid ? (
          <p>{t(ui('actionUnavailable'))}</p>
        ) : (
          <Loading />
        )}
      </RouteDialog>
    );
  return (
    <ActionBody
      key={`${requestId}-${transition}`}
      initial={ready}
      transition={transition as Transition}
    />
  );
}
function ActionBody({
  initial,
  transition,
}: {
  initial: IssueRequest;
  transition: Transition;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    navigate = useNavigate(),
    location = useLocation(),
    path = useResolvedPath('.').pathname,
    toaster = useToaster(),
    refresh = useIssueRefresh(),
    key = useRequestKey(),
    confirm = useConfirm();
  const [row, setRow] = useState(initial),
    [reason, setReason] = useState(''),
    [invalid, setInvalid] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [latest, setLatest] = useState<IssueRequest>();
  const busyRef = useRef(false),
    guard = useLeaveGuard(!!reason.trim(), busy, path),
    cap = useCapabilities(initial.id),
    allowed = cap.data?.data.actions[transition];
  const sameVersion =
    cap.data?.data.recordRevision === row.revision &&
    cap.data?.data.lifecycleVersion === row.lifecycleVersion;
  const terminal =
    error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const title = t(
      ui(`${transition === 'cancel' ? 'cancelRequest' : transition}Title`),
      { code: row.code },
    ),
    snapshot = row.versions.find((v) => v.id === row.submittedVersionId);
  const back = () =>
    void navigate(
      { pathname: '..', search: location.search },
      { relative: 'route', replace: true },
    );
  const close = async () => {
    if (await guard.leave()) back();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      busyRef.current ||
      !allowed?.enabled ||
      !!cap.error ||
      !sameVersion ||
      terminal ||
      latest
    )
      return;
    setInvalid(true);
    if (!reason.trim() || reason.trim().length > 3000) {
      document.getElementById('issue-action-reason')?.focus();
      return;
    }
    if (
      ['return', 'withdraw', 'revise', 'cancel'].includes(transition) &&
      !(await confirm.ask(
        title,
        t(ui('invalidateHint')),
        t(
          ui(
            `confirm${transition === 'cancel' ? 'CancelRequest' : transition[0].toUpperCase() + transition.slice(1)}`,
          ),
        ),
      ))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    const values = {
      version: row.revision,
      lifecycleVersion: row.lifecycleVersion,
      reason: reason.trim(),
    };
    try {
      const response = await api.request<{ data: IssueRequest }>({
        path: `requisitions/requests/${row.id}/${transition}`,
        method: 'POST',
        json: { ...values, requestKey: key.for(values) },
      });
      guard.complete();
      void refresh(response.data);
      toaster.show({
        type: 'success',
        title: t(
          ui(`${transition === 'cancel' ? 'cancelRequest' : transition}Done`),
          { code: row.code },
        ),
      });
      back();
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && [403, 404].includes(e.status))
        void refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      const response = await api.request<{ data: IssueRequest }>({
        path: `requisitions/requests/${row.id}`,
      });
      setLatest(response.data);
      await cap.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <RouteDialog
        title={title}
        className='sm:max-w-md'
        beforeClose={() => guard.leave()}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void close()}
            >
              {t(ui('cancel'))}
            </Button>
            <Button
              form='issue-action-form'
              type='submit'
              disabled={
                busy ||
                !allowed?.enabled ||
                !sameVersion ||
                !!terminal ||
                !!latest
              }
            >
              {busy && <Spinner />}
              {t(ui(transition === 'cancel' ? 'cancelRequest' : transition))}
            </Button>
          </>
        }
      >
        <form
          id='issue-action-form'
          className='flex flex-col gap-4'
          noValidate
          onSubmit={(e) => void submit(e)}
        >
          <IssueStatus state={row.status} />
          <p className='text-sm'>
            {row.code} · {row.display.requester?.name ?? t(ui('unavailable'))}
          </p>
          <LongText>{snapshot?.payload.head.usage ?? row.usage}</LongText>
          {snapshot && (
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant='outline' type='button' />}
              >
                {t(ui('version'))} {snapshot.contentVersion}
              </CollapsibleTrigger>
              <CollapsibleContent className='mt-3'>
                <DemandLines lines={snapshot.payload.lines} />
              </CollapsibleContent>
            </Collapsible>
          )}
          {transition === 'reassign' && (
            <p className='text-sm text-muted-foreground'>
              {t(ui('reassignHint'))}
            </p>
          )}
          {Boolean(error) && <ErrorNotice error={error} />}
          {cap.error && (
            <ErrorNotice error={cap.error} retry={() => void cap.refetch()} />
          )}{' '}
          {(!sameVersion ||
            (error instanceof ApiClientError && error.status === 409)) && (
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => void load()}
            >
              {t(ui('compareLatest'))}
            </Button>
          )}
          {latest && (
            <div className='flex flex-col gap-4 rounded-lg border p-4'>
              <p>{t(ui('conflict'))}</p>
              <p>
                {latest.code} · {t(ui(latest.status))}
              </p>
              <LongText>
                {latest.versions.find((v) => v.id === latest.submittedVersionId)
                  ?.payload.head.usage ?? latest.usage}
              </LongText>
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
            </div>
          )}
          {!allowed?.enabled && (
            <p className='text-sm text-muted-foreground'>
              {t(ui('actionUnavailable'))}
            </p>
          )}
          <Field
            data-invalid={
              invalid && (!reason.trim() || reason.trim().length > 3000)
            }
          >
            <FieldLabel htmlFor='issue-action-reason'>
              {t(ui('actionReason'))} *
            </FieldLabel>
            <Textarea
              id='issue-action-reason'
              value={reason}
              disabled={busy || !!terminal}
              aria-required='true'
              aria-invalid={
                invalid && (!reason.trim() || reason.trim().length > 3000)
              }
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldDescription>{t(ui('reasonHint'))}</FieldDescription>
            {invalid && (!reason.trim() || reason.trim().length > 3000) && (
              <FieldError>{t(ui('reasonLength'))}</FieldError>
            )}
          </Field>
        </form>
      </RouteDialog>
      {guard.dialog}
      {confirm.dialog}
    </>
  );
}
