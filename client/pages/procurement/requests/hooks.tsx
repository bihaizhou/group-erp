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
import type {
  Capabilities,
  Page,
  PurchaseIdentity,
  PurchaseRequest,
} from './model.js';
export const ui = (key: string) => `procurement.requestUi.${key}`;
export function usePurchaseCan(action: string, settings = false) {
  return useCan({
    resource: {
      type: 'composite',
      id: settings ? 'procurement.settings' : 'procurement.requests',
    },
    action,
  });
}
export function usePurchaseQuery<T>(
  path: string,
  query: Record<string, string | number> = {},
  enabled = true,
  previous = false,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['purchase', path, query],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      api.request<T>({ path: `procurement/${path}`, query, signal }),
    placeholderData: previous
      ? (old, previousQuery) => {
          const prior = previousQuery?.queryKey[2] as
            Record<string, string | number> | undefined;
          return prior?.subjectId === query.subjectId ? old : undefined;
        }
      : undefined,
  });
}
export const useRequest = (id?: string) =>
  usePurchaseQuery<{ data: PurchaseRequest }>(`requests/${id}`, {}, !!id);
export const usePurchaseIdentity = (enabled = true) =>
  usePurchaseQuery<{ data: PurchaseIdentity }>('requestIdentity', {}, enabled);
export const useCapabilities = (id?: string) =>
  usePurchaseQuery<{ data: Capabilities }>(
    `requests/${id}/capabilities`,
    {},
    !!id,
  );
export function usePurchaseRefresh() {
  const cache = useQueryClient();
  return (saved?: PurchaseRequest, created = false) => {
    if (saved) {
      const detailKey = ['purchase', `requests/${saved.id}`, {}];
      const previous = cache.getQueryData<{ data: PurchaseRequest }>(
        detailKey,
      )?.data;
      cache.setQueryData(detailKey, { data: saved });
      for (const query of cache
        .getQueryCache()
        .findAll({ queryKey: ['purchase', 'requests'] })) {
        const old = query.state.data as Page<PurchaseRequest> | undefined;
        if (!old) continue;
        const params = query.queryKey[2] as Record<string, string | number>;
        const exists = old.data.some((row) => row.id === saved.id);
        // When the previous page has no evidence of ownership, let the server
        // resolve a mine-only filter rather than inserting someone else's request.
        if (params.mine === 'true' && !exists && !created) continue;
        const term = String(params.q ?? '')
          .normalize('NFKC')
          .toLowerCase();
        const matches = (row: PurchaseRequest) =>
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
      queryKey: ['purchase'],
      refetchType: 'active',
    });
  };
}
export function usePurchaseError() {
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
        PURCHASE_VERSION_CONFLICT: 'conflict',
        CONFIGURATION_CONFLICT: 'conflict',
        PURCHASE_REQUIRED: 'fieldsInvalid',
        PURCHASE_LINES_REQUIRED: 'fieldsInvalid',
        PURCHASE_REVIEWERS_EMPTY: 'noReviewer',
        PURCHASE_REVIEW_DENIED: 'notCandidate',
        PURCHASE_REVIEWERS_STILL_AVAILABLE: 'reviewStillAvailable',
        PURCHASE_MATERIALS_REQUIRED: 'materialsRequired',
        PURCHASE_DELEGATE_REQUIRED: 'delegateRequired',
        PURCHASE_EMPLOYMENT_REQUIRED: 'noEmploymentHint',
        PURCHASE_REFERENCE_TOO_BROAD: 'tooLarge',
        PURCHASE_COMPANY_FROZEN: 'companyLocked',
        PURCHASE_COMPANY_HAS_LINES: 'companyLocked',
        PURCHASE_PERSON_UNIT_MISMATCH: 'requesterUnitMismatch',
        PURCHASE_LINE_RETIRED: 'lineRetired',
        PURCHASE_COPY_REQUIRES_CANCELLED: 'copyRequiresCancelled',
        PURCHASE_SUPPLIER_CHANGED: 'materialChanged',
        PURCHASE_MATERIAL_CHANGED: 'materialChanged',
        PURCHASE_REQUEST_CONFLICT: 'requestKeyConflict',
        CONFIGURATION_REQUEST_REUSED: 'requestKeyConflict',
        SUPPLY_REFERENCE_NOT_REQUESTABLE: 'referenceNotRequestable',
        SUPPLY_QUANTITY_PRECISION: 'precision',
        SUPPLY_QUANTITY_OVERFLOW: 'overflow',
        SUPPLY_INVALID_UNIT: 'invalidReference',
        BODY_TOO_LARGE: 'tooLarge',
        PURCHASE_ACTION_UNAVAILABLE: 'actionUnavailable',
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
export function usePurchaseReturnFocus(ownPath: string, targetId: string) {
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
