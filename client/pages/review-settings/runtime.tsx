import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useHref,
  useLocation,
  useNavigate,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import {
  ApiClientError,
  useApiClient,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AccessDenied } from '#components/access-denied';
import { CompanyPicker } from '#components/company-scope';
import {
  ReviewRuleEditor,
  type ReviewRuleField,
  type ReviewReference,
  type ReviewSelection,
} from '#components/review-rule-editor';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Label } from '#components/ui/label';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Spinner } from '#components/ui/spinner';
import { randomUuid } from '#lib/random-id';

export interface ReviewSettingsData {
  subjectId: string;
  revision: number;
  values: {
    reviewerSelections: ReviewSelection[];
    allowParallelGovernance?: boolean;
    [key: string]: unknown;
  };
  references: (ReviewReference & ReviewSelection)[];
  fields?: { key: string; type: 'reviewers' | 'boolean'; title: string }[];
}

export interface ReviewSettingsDomain {
  key: string;
  apiPath: string;
  companiesPath: string;
  optionsPath: string;
  canResource: string;
  editorId: string;
  ui: (key: string) => string;
  /** Frozen settings are addressed by document kind. */
  kind?: string;
  /** Execution pages use `reviewSubjectId` to keep the reviewed record. */
  subjectParam?: 'subjectId' | 'reviewSubjectId';
  invalidationKey?: readonly unknown[];
}

interface Conflict {
  key: string;
  label: string;
  base: unknown;
  local: unknown;
  server: unknown;
  retired?: boolean;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One request key per unchanged payload; a changed payload gets a new key. */
function useRequestKey() {
  const stateRef = useRef({ signature: '', key: randomUuid() });
  return {
    for: (body: unknown) => {
      const signature = JSON.stringify(body);
      if (
        stateRef.current.signature &&
        stateRef.current.signature !== signature
      )
        stateRef.current.key = randomUuid();
      stateRef.current.signature = signature;
      return stateRef.current.key;
    },
    reset: () => {
      stateRef.current = { signature: '', key: randomUuid() };
    },
  };
}

/** Shared unsaved-changes prompt for every review domain. */
function useConfirm() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<{
    title: string;
    description: string;
    confirm?: string;
  }>();
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      pendingRef.current?.(false);
    },
    [],
  );
  const finish = (ok: boolean) => {
    setPrompt(undefined);
    pendingRef.current?.(ok);
    pendingRef.current = null;
  };
  return {
    ask: (
      title = t('reviewSettings.unsavedTitle'),
      description = t('reviewSettings.unsavedHint'),
      confirm = t('reviewSettings.discard'),
    ) =>
      new Promise<boolean>((resolve) => {
        if (pendingRef.current) {
          resolve(false);
          return;
        }
        pendingRef.current = resolve;
        setPrompt({ title, description, confirm });
      }),
    dialog: (
      <AlertDialog
        open={!!prompt}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{prompt?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {prompt?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant='outline' onClick={() => finish(false)}>
              {t('reviewSettings.keepEditing')}
            </Button>
            <Button variant='destructive' onClick={() => finish(true)}>
              {prompt?.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}

/** The same leave guard the request forms use, with review-settings copy. */
function useLeaveGuard(dirty: boolean, busy: boolean, subtree: string) {
  const confirm = useConfirm(),
    navigate = useNavigate(),
    location = useLocation(),
    base = useHref('/');
  const bypassRef = useRef(false),
    pendingRef = useRef(false);
  const internal = (path: string) =>
    path === subtree || path.startsWith(`${subtree}/`);
  const strip = (url: URL) => {
    const prefix = base.replace(/\/$/, '');
    const pathname =
      prefix &&
      (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
        ? url.pathname.slice(prefix.length) || '/'
        : url.pathname;
    return { pathname, search: url.search, hash: url.hash };
  };
  const leave = async () => !busy && (!dirty || (await confirm.ask()));
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (e: BeforeUnloadEvent) => {
      if (!bypassRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const click = (e: MouseEvent) => {
      if (
        bypassRef.current ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor = (e.target as Element)?.closest?.('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      const target = strip(url);
      if (internal(target.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      if (pendingRef.current || busy) return;
      pendingRef.current = true;
      void leave().then((ok) => {
        pendingRef.current = false;
        if (ok) {
          bypassRef.current = true;
          void navigate(target);
        }
      });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  });
  useNavigationGuard(() => {
    if (bypassRef.current) return true;
    if (busy) return false;
    if (!dirty) return true;
    const target = strip(new URL(window.location.href));
    if (internal(target.pathname) && location.pathname !== subtree) return true;
    if (
      (target.pathname !== location.pathname ||
        target.search !== location.search) &&
      !pendingRef.current
    ) {
      pendingRef.current = true;
      queueMicrotask(
        () =>
          void leave().then((ok) => {
            pendingRef.current = false;
            if (ok) {
              bypassRef.current = true;
              void navigate(target, { replace: true });
            }
          }),
      );
    }
    return false;
  });
  return {
    dialog: confirm.dialog,
    allowNavigation: (fn: () => void) => {
      bypassRef.current = true;
      fn();
      queueMicrotask(() => {
        bypassRef.current = false;
      });
    },
  };
}

function ReviewLoading() {
  return (
    <div aria-busy='true' className='grid min-h-32 place-items-center'>
      <Spinner />
    </div>
  );
}

function ReviewErrorNotice({
  error,
  message,
  retry,
  retryLabel,
}: {
  error: unknown;
  message: (error: unknown) => string;
  retry?: () => void;
  retryLabel: string;
}) {
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <span>{message(error)}</span>
        {retry && (
          <Button variant='outline' onClick={retry}>
            {retryLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ConflictChoices({
  conflicts,
  choices,
  onChange,
  describe,
  ui,
  t,
}: {
  conflicts: Conflict[];
  choices: Record<string, 'local' | 'server'>;
  onChange: (key: string, choice: 'local' | 'server') => void;
  describe: (value: unknown, label: string) => string;
  ui: (key: string) => string;
  t: (key: string) => string;
}) {
  return (
    <div className='grid gap-4'>
      {conflicts.map((item, index) => (
        <fieldset
          key={item.key}
          className='flex flex-col gap-4 rounded-lg border p-4'
        >
          <legend className='px-1 text-sm font-medium'>
            {t(ui(item.label))} {index + 1}
          </legend>
          <p className='text-sm text-muted-foreground'>
            {t(ui('originalValue'))}: {describe(item.base, item.label)}
          </p>
          <RadioGroup
            value={choices[item.key] ?? ''}
            onValueChange={(v) => onChange(item.key, v as 'local' | 'server')}
          >
            <Label className='flex items-start gap-2'>
              <RadioGroupItem value='local' />
              <span>
                {t(ui(item.retired ? 'asNewLine' : 'useLocal'))}:{' '}
                {describe(item.local, item.label)}
              </span>
            </Label>
            <Label className='flex items-start gap-2'>
              <RadioGroupItem value='server' />
              <span>
                {t(ui('useServer'))}: {describe(item.server, item.label)}
              </span>
            </Label>
          </RadioGroup>
        </fieldset>
      ))}
    </div>
  );
}

function SettingsForm({
  initial,
  domain,
  message,
  changeCompany,
}: {
  initial: ReviewSettingsData;
  domain: ReviewSettingsDomain;
  message: (error: unknown) => string;
  changeCompany: (id: string) => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    cache = useQueryClient(),
    permission = useCan({
      resource: { type: 'composite', id: domain.canResource },
      action: 'update',
    }),
    path = useResolvedPath('.').pathname;
  const [baseline, setBaseline] = useState(initial),
    [values, setValues] = useState(initial.values),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState(false),
    [rulesError, setRulesError] = useState<string>(),
    [latest, setLatest] = useState<ReviewSettingsData>(),
    [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({});
  const busyRef = useRef(false),
    request = useRequestKey(),
    confirm = useConfirm(),
    guard = useLeaveGuard(!same(values, baseline.values), busy, path);
  const fields: ReviewRuleField[] = (baseline.fields ?? []).map((field) =>
    field.type === 'reviewers'
      ? {
          kind: 'reviewers',
          key: field.key,
          optionsPath: domain.optionsPath,
        }
      : {
          kind: 'boolean',
          key: field.key,
          label: t(domain.ui('parallel')),
          trueLabel: t(domain.ui('parallelAllowed')),
          falseLabel: t(domain.ui('identificationFirst')),
        },
  );
  const bad =
    !values.reviewerSelections.length ||
    values.reviewerSelections.length > 100 ||
    values.reviewerSelections.some(
      (s) => !s.referenceId || s.group < 1 || s.group > 100,
    );
  const terminal =
    error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current || !permission.can || terminal) return;
    setInvalid(true);
    if (bad) {
      document.getElementById(domain.editorId)?.focus();
      return;
    }
    const body = {
      subjectId: baseline.subjectId,
      ...(domain.kind ? { kind: domain.kind } : {}),
      version: baseline.revision,
      values,
    };
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setRulesError(undefined);
    try {
      const response = await api.request<{ data: ReviewSettingsData }>({
        path: domain.apiPath,
        method: 'PUT',
        json: { ...body, requestKey: request.for(body) },
      });
      setBaseline(response.data);
      setValues(response.data.values);
      setInvalid(false);
      if (domain.invalidationKey)
        void cache.invalidateQueries({ queryKey: domain.invalidationKey });
      toaster.show({ type: 'success', title: t(domain.ui('ruleSaved')) });
    } catch (e) {
      setError(e);
      if (e instanceof ApiClientError && e.status === 400) {
        setRulesError(message(e));
        setTimeout(() => document.getElementById(domain.editorId)?.focus(), 0);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const readLatest = async () => {
    setBusy(true);
    try {
      const response = await api.request<{ data: ReviewSettingsData }>({
        path: domain.apiPath,
        query: {
          subjectId: baseline.subjectId,
          ...(domain.kind ? { kind: domain.kind } : {}),
        },
      });
      setLatest(response.data);
      setChoices({});
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const comparison = (() => {
    if (!latest) return undefined;
    const merged = structuredClone(latest.values),
      conflicts: Conflict[] = [];
    const choose = (key: string, b: unknown, l: unknown, r: unknown) => {
      if (same(l, b)) return r;
      if (same(r, b) || same(l, r)) return l;
      conflicts.push({
        key,
        label: key === 'parallel' ? 'parallel' : 'currentRules',
        base: b,
        local: l,
        server: r,
      });
      return r;
    };
    merged.allowParallelGovernance = choose(
      'parallel',
      baseline.values.allowParallelGovernance,
      values.allowParallelGovernance,
      latest.values.allowParallelGovernance,
    ) as boolean;
    const all = [
      ...new Set(
        [
          ...baseline.values.reviewerSelections,
          ...values.reviewerSelections,
          ...latest.values.reviewerSelections,
        ].map((s) => s.group),
      ),
    ];
    merged.reviewerSelections = all.flatMap(
      (group) =>
        choose(
          `group:${group}`,
          baseline.values.reviewerSelections.filter((s) => s.group === group),
          values.reviewerSelections.filter((s) => s.group === group),
          latest.values.reviewerSelections.filter((s) => s.group === group),
        ) as ReviewSelection[],
    );
    return { merged, conflicts };
  })();
  const apply = () => {
    if (
      !comparison ||
      !latest ||
      comparison.conflicts.some((c) => !choices[c.key])
    )
      return;
    const next = structuredClone(comparison.merged);
    for (const c of comparison.conflicts) {
      const value = choices[c.key] === 'local' ? c.local : c.server;
      if (c.key === 'parallel') next.allowParallelGovernance = value as boolean;
      else {
        const group = Number(c.key.slice(6));
        next.reviewerSelections = [
          ...next.reviewerSelections.filter((s) => s.group !== group),
          ...(value as ReviewSelection[]),
        ];
      }
    }
    setBaseline(latest);
    setValues(next);
    setLatest(undefined);
    setError(undefined);
    request.reset();
  };
  const describe = (v: unknown) =>
    typeof v === 'boolean'
      ? t(domain.ui(v ? 'parallelAllowed' : 'identificationFirst'))
      : Array.isArray(v)
        ? (v as ReviewSelection[])
            .map((s) => {
              const ref = [
                ...baseline.references,
                ...(latest?.references ?? []),
              ].find(
                (r) => r.type === s.type && r.referenceId === s.referenceId,
              );
              return `${t(domain.ui('candidateGroup'), { number: s.group })} · ${t(domain.ui(s.type === 'user' ? 'account' : 'position'))} · ${ref?.name ?? t(domain.ui('unavailable'))}`;
            })
            .join(' ∩ ') || '—'
        : '—';
  const switchCompany = async (id: string) => {
    if (id === baseline.subjectId || busy) return;
    if (!same(values, baseline.values) && !(await confirm.ask())) return;
    guard.allowNavigation(() => changeCompany(id));
  };
  return (
    <div className='max-w-4xl flex flex-col gap-6'>
      <CompanyPicker
        queryPath={domain.companiesPath}
        value={baseline.subjectId}
        disabled={busy}
        onChange={(id) => void switchCompany(id)}
      />
      <form noValidate onSubmit={(e) => void save(e)}>
        <Card>
          <CardHeader>
            <CardTitle>{t(domain.ui('currentRules'))}</CardTitle>
            <CardDescription>
              {t(domain.ui('ruleVersion'), { version: baseline.revision })} ·{' '}
              {t(domain.ui('effectiveHint'))}
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {Boolean(error) && (
              <ReviewErrorNotice
                error={error}
                message={message}
                retryLabel={t('reviewSettings.retry')}
              />
            )}
            {error instanceof ApiClientError && error.status === 409 && (
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => void readLatest()}
              >
                {t(domain.ui('compareLatest'))}
              </Button>
            )}
            {latest && comparison && (
              <div className='flex flex-col gap-4'>
                <p>{t(domain.ui('conflict'))}</p>
                <ConflictChoices
                  conflicts={comparison.conflicts}
                  choices={choices}
                  onChange={(key, value) =>
                    setChoices((old) => ({ ...old, [key]: value }))
                  }
                  describe={describe}
                  ui={domain.ui}
                  t={t}
                />
                <Button
                  type='button'
                  disabled={comparison.conflicts.some((c) => !choices[c.key])}
                  onClick={apply}
                >
                  {t(domain.ui('applyMerge'))}
                </Button>
              </div>
            )}
            <ReviewRuleEditor
              id={domain.editorId}
              fields={fields}
              values={values}
              references={baseline.references}
              subjectId={baseline.subjectId}
              canEdit={permission.can}
              disabled={busy || !!terminal}
              invalid={invalid && bad}
              error={rulesError}
              onChange={(patch) => {
                setRulesError(undefined);
                setValues((old) => ({ ...old, ...patch }));
              }}
            />
          </CardContent>
          {permission.can && (
            <CardFooter className='justify-end'>
              <Button disabled={busy || !!terminal || !!latest} type='submit'>
                {busy && <Spinner />}
                {t(domain.ui('save'))}
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>
      {guard.dialog}
      {confirm.dialog}
    </div>
  );
}

export function ReviewSettingsPanel({
  domain,
  message,
}: {
  domain: ReviewSettingsDomain;
  message: (error: unknown) => string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    [params, setParams] = useSearchParams(),
    subjectId = params.get(domain.subjectParam ?? 'subjectId') ?? '',
    can = useCan({
      resource: { type: 'composite', id: domain.canResource },
      action: 'read',
    });
  const result = useQuery({
    queryKey: ['reviewSettings', domain.key, subjectId],
    enabled: !!subjectId && can.can,
    retry: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      api.request<{ data: ReviewSettingsData }>({
        path: domain.apiPath,
        query: { subjectId, ...(domain.kind ? { kind: domain.kind } : {}) },
        signal,
      }),
  });
  const changeCompany = (id: string) => {
    const next = new URLSearchParams(params);
    const param = domain.subjectParam ?? 'subjectId';
    if (id) next.set(param, id);
    else next.delete(param);
    setParams(next, { replace: true });
  };
  return (
    <div className='max-w-4xl'>
      {can.isPending ? (
        <ReviewLoading />
      ) : !can.can ? (
        <AccessDenied title={t(domain.ui('forbidden'))} />
      ) : result.data ? (
        <SettingsForm
          key={subjectId}
          initial={result.data.data}
          domain={domain}
          message={message}
          changeCompany={changeCompany}
        />
      ) : result.isPending ? (
        <ReviewLoading />
      ) : result.error ? (
        <ReviewErrorNotice
          error={result.error}
          message={message}
          retry={() => void result.refetch()}
          retryLabel={t('reviewSettings.retry')}
        />
      ) : null}
    </div>
  );
}
