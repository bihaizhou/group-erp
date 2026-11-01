import { useRetainedQueryData } from '#hooks/use-retained-query-data';
import { useEffect, useRef, useState } from 'react';
import {
  ApiClientError,
  useApiClient,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHref, useLocation, useNavigate } from 'react-router';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';
import { randomUuid } from '#lib/random-id';
import type { Capabilities, Page, IssueRequest } from './model.js';
export const ui = (key: string) => `requisitions.requestUi.${key}`;
export function useIssueCan(action: string, settings = false) {
  return useCan({
    resource: {
      type: 'composite',
      id: settings ? 'requisitions.settings' : 'requisitions.requests',
    },
    action,
  });
}
export function useIssueQuery<T>(
  path: string,
  query: Record<string, string | number> = {},
  enabled = true,
  previous = false,
) {
  const api = useApiClient(),
    cache = useQueryClient();
  const result = useQuery({
    queryKey: ['issue', path, query],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      api.request<T>({ path: `requisitions/${path}`, query, signal }),
    placeholderData: previous
      ? (old, previousQuery) => {
          const prior = previousQuery?.queryKey[2] as
            Record<string, string | number> | undefined;
          return prior?.subjectId === query.subjectId ? old : undefined;
        }
      : undefined,
  });
  useEffect(() => {
    if (
      result.error instanceof ApiClientError &&
      result.error.status === 404 &&
      /^(requests|purposes)\/[^/]+$/.test(path)
    )
      void cache.invalidateQueries({
        queryKey: ['issue', path.split('/')[0]],
        refetchType: 'active',
      });
  }, [cache, path, result.error, result.errorUpdatedAt]);
  const retained = useRetainedQueryData(
    JSON.stringify([path, query.subjectId, query.kind]),
    result,
    previous && enabled,
  );
  return {
    ...result,
    data: retained.data,
    isStaleFallback: retained.isStaleFallback,
    isPlaceholderData: result.isPlaceholderData || retained.isStaleFallback,
  };
}
export const useRequest = (id?: string) =>
  useIssueQuery<{ data: IssueRequest }>(`requests/${id}`, {}, !!id);
export const useCapabilities = (id?: string) =>
  useIssueQuery<{ data: Capabilities }>(
    `requests/${id}/capabilities`,
    {},
    !!id,
  );
export function useIssueRefresh() {
  const cache = useQueryClient();
  return (saved?: IssueRequest, created = false) => {
    if (saved) {
      const detailKey = ['issue', `requests/${saved.id}`, {}];
      const previous = cache.getQueryData<{ data: IssueRequest }>(
        detailKey,
      )?.data;
      cache.setQueryData(detailKey, { data: saved });
      for (const query of cache
        .getQueryCache()
        .findAll({ queryKey: ['issue', 'requests'] })) {
        const old = query.state.data as Page<IssueRequest> | undefined;
        if (!old) continue;
        const params = query.queryKey[2] as Record<string, string | number>;
        const exists = old.data.some((row) => row.id === saved.id);
        // When the previous page has no evidence of ownership, let the server
        // resolve a mine-only filter rather than inserting someone else's request.
        if (params.mine === 'true' && !exists && !created) continue;
        const term = String(params.q ?? '')
          .normalize('NFKC')
          .toLowerCase();
        const matches = (row: IssueRequest) =>
          params.subjectId === row.subjectId &&
          (!params.status || params.status === row.status) &&
          (!params.identification ||
            params.identification === row.identificationStatus) &&
          (!term ||
            [row.code, row.usage, row.notes].some((v) =>
              v.normalize('NFKC').toLowerCase().includes(term),
            )) &&
          (!params.neededFrom ||
            (!!row.neededOn && row.neededOn >= String(params.neededFrom))) &&
          (!params.neededTo ||
            (!!row.neededOn && row.neededOn <= String(params.neededTo)));
        const nextMatches = matches(saved),
          beforeMatches = created
            ? false
            : previous
              ? matches(previous)
              : exists || nextMatches;
        let data = old.data.flatMap((row) =>
          row.id === saved.id ? (nextMatches ? [saved] : []) : [row],
        );
        const total = Math.max(
          0,
          old.meta.total + Number(nextMatches) - Number(beforeMatches),
        );
        if (
          !exists &&
          nextMatches &&
          old.meta.page === 1 &&
          (!params.orderBy || params.orderBy === '-updatedAt')
        )
          data = [saved, ...data].slice(0, old.meta.pageSize);
        cache.setQueryData(query.queryKey, {
          ...old,
          data,
          meta: { ...old.meta, total },
        });
      }
    }
    return cache.invalidateQueries({
      queryKey: ['issue'],
      refetchType: 'active',
    });
  };
}
export function useIssueError() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (error.reason?.startsWith('SUPPLY_SOURCE_'))
        return t(`materialSources.errors.${error.reason}`, {
          defaultValue: t('materialSources.failed'),
        });
      if (error.reason?.startsWith('SUPPLY_FILE_'))
        return t(`demandAttachments.errors.${error.reason}`, {
          defaultValue: t('demandAttachments.failed'),
        });
      if (error.status === 401) return t(ui('sessionEnded'));
      if (error.status === 403) return t(ui('forbidden'));
      if (error.status === 404) return t(ui('notFound'));
      const map: Record<string, string> = {
        ISSUE_VERSION_CONFLICT: 'conflict',
        CONFIGURATION_CONFLICT: 'conflict',
        ISSUE_REQUIRED: 'fieldsInvalid',
        ISSUE_LINES_REQUIRED: 'fieldsInvalid',
        ISSUE_REVIEWERS_EMPTY: 'noReviewer',
        ISSUE_REVIEW_DENIED: 'notCandidate',
        ISSUE_REVIEWERS_STILL_AVAILABLE: 'reviewStillAvailable',
        ISSUE_MATERIALS_REQUIRED: 'materialsRequired',
        ISSUE_DELEGATE_REQUIRED: 'delegateRequired',
        ISSUE_COMPANY_FROZEN: 'companyLocked',
        ISSUE_COMPANY_HAS_LINES: 'companyLocked',
        ISSUE_PERSON_UNIT_MISMATCH: 'requesterUnitMismatch',
        ISSUE_LINE_RETIRED: 'lineRetired',
        ISSUE_COPY_REQUIRES_CANCELLED: 'copyRequiresCancelled',
        ISSUE_PURPOSE_CHANGED: 'materialChanged',
        ISSUE_RECIPIENT_DELEGATE_REQUIRED: 'delegateRequired',
        ISSUE_PURPOSE_CODE_DUPLICATE: 'purposeCodeDuplicate',
        ISSUE_MATERIAL_CHANGED: 'materialChanged',
        ISSUE_REQUEST_CONFLICT: 'requestKeyConflict',
        CONFIGURATION_REQUEST_REUSED: 'requestKeyConflict',
        SUPPLY_QUANTITY_PRECISION: 'precision',
        SUPPLY_QUANTITY_OVERFLOW: 'overflow',
        SUPPLY_INVALID_UNIT: 'invalidReference',
        BODY_TOO_LARGE: 'tooLarge',
        ISSUE_ACTION_UNAVAILABLE: 'actionUnavailable',
      };
      if (error.reason && map[error.reason]) return t(ui(map[error.reason]));
      if (
        error.reason?.includes('UNAVAILABLE') ||
        error.reason?.includes('REFERENCE')
      )
        return t(ui('invalidReference'));
    }
    return t(ui('requestFailed'));
  };
}
export function useRequestKey() {
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
/** Restore a stable parent focus after a covering page closes, without overriding dialog focus restoration. */
export function useIssueReturnFocus(ownPath: string, targetId: string) {
  const { pathname } = useLocation();
  const previousRef = useRef(pathname);
  useEffect(() => {
    const returning = previousRef.current !== ownPath && pathname === ownPath;
    previousRef.current = pathname;
    if (!returning) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('[inert]'))
        document.getElementById(targetId)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [ownPath, pathname, targetId]);
}
export function useConfirm() {
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
      title = t(ui('unsavedTitle')),
      description = t(ui('unsavedHint')),
      confirm = t(ui('discard')),
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
              {t(ui('keepEditing'))}
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
/** Official synchronous boundary handles POP; capture links to retain their target for the async AlertDialog. */
export function useLeaveGuard(dirty: boolean, busy: boolean, subtree: string) {
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
    complete: () => {
      bypassRef.current = true;
    },
    leave: async () => {
      const ok = await leave();
      if (ok) bypassRef.current = true;
      return ok;
    },
    allowNavigation: (fn: () => void) => {
      bypassRef.current = true;
      fn();
      queueMicrotask(() => {
        bypassRef.current = false;
      });
    },
  };
}
