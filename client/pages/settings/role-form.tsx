import { FeedbackForm } from '#components/feedback-form';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  ApiClientError,
  useApiClient,
  useClientApplication,
  useSubmission,
  useToaster,
} from '@nocobase/app-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useSettingsLeave,
  useSettingsData,
  useRolePermission,
} from './hooks.js';
import { useAuthorizationOptions } from './authorization-options.js';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useAuthorizationClient,
  type LocalizedText,
  type PermissionGrant,
  type PermissionSet,
} from '@nocobase/app-plugin-authorization/client';
import {
  permissionNavigationSections,
  pagePermissionResources,
} from './page-permissions.js';
import { pagePermissionTitles } from './page-permission-titles.js';
import {
  permissionScopeVisible,
  permissionWorkspaceCatalog,
} from './permission-workspace.js';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useResolvedPath,
} from 'react-router';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  PermissionEditor,
  type PermissionEditorNavigationNode,
} from '#components/permission-editor';
import {
  pageFieldVisibilityBaseKey,
  pageFieldVisibilityRequiredFields as PAGE_REQUIRED_FIELDS,
} from './page-field-visibility-pages.js';
import {
  collectPageDisplays,
  pageFieldResourcesForTarget,
  type PageDisplayTarget,
} from './page-settings.js';
import {
  fieldPolicyKey,
  type FieldPermissionResource,
  type FieldPolicy,
} from '#components/field-permission-policies';
import { PageFieldStateEditor } from './page-field-state-editor.js';
import {
  valueOfState,
  type PageFieldState,
  type PageFieldStateValue,
} from './page-field-state.js';
import {
  pageIdFromPermissionRow,
} from './field-permission-pages.js';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#components/ui/popover';
import { CheckIcon, CopyIcon, MousePointerClickIcon } from 'lucide-react';
import { ConfirmAction, SettingsError, SettingsLoading } from './shared.js';
import { configurePermissionScopes } from './permission-filters.js';
import {
  permissionSections,
  unconfiguredFilter,
  isReadOnlyGrants,
  setPermissions,
  setScope,
} from './permissions-model.js';

/** One page's staged field settings; keys are `resource.field`. */
interface PageFieldDraft {
  readonly fields: Readonly<Record<string, PageFieldStateValue>>;
}

const DEFAULT_STATE: Readonly<PageFieldStateValue> = {
  visible: true,
  writable: true,
};

const HIDDEN_STATE: Readonly<PageFieldStateValue> = {
  visible: false,
  writable: false,
};

const READONLY_STATE: Readonly<PageFieldStateValue> = {
  visible: true,
  writable: false,
};

/** Every pageKey below a navigation node (the node itself plus its leaves). */
function pageKeysOfFamily(node: PermissionEditorNavigationNode): string[] {
  const keys = node.pageKey ? [node.pageKey] : [];
  const walk = (children: readonly PermissionEditorNavigationNode[]): void => {
    for (const child of children) {
      if (child.hint && child.pageKey) keys.push(child.pageKey);
      walk(child.children ?? []);
    }
  };
  walk(node.children ?? []);
  return keys;
}

function RoleEditor(): ReactElement {
  const { key } = useParams();
  const creating = !key;
  const { t } = useTranslation();
  const app = useClientApplication();
  const api = useApiClient();
  const authz = useAuthorizationClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const parent = useOutletContext<{ reload: () => void }>();
  // Creating a role needs no record: `options` already loads the same endpoint.
  // Keeping this hook idle avoids two simultaneous GETs on one path.
  const request = useSettingsData<{ data: PermissionSet }>(
    `authorization/permissionSets/${encodeURIComponent(key ?? '')}`,
    { active: Boolean(key) },
  );
  const missingRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (
      request.error instanceof ApiClientError &&
      request.error.status === 404 &&
      missingRef.current !== request.error
    ) {
      missingRef.current = request.error;
      parent.reload();
    }
  }, [request.error, parent]);
  const options = useAuthorizationOptions();
  const fieldCatalog = useQuery({
    retry: false,
    queryKey: ['field-policy-catalog'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: ({ signal }) =>
      api.request<{ data: { resources: FieldPermissionResource[] } }>({
        path: 'field-policies/catalog',
        signal,
      }),
  });
  const canCreate = useRolePermission('create');
  const canUpdate = useRolePermission('update');
  const [nameDraft, setNameDraft] = useState<string>();
  const [keyDraft, setKeyDraft] = useState<string>();
  const [grantsDraft, setGrantsDraft] = useState<readonly PermissionGrant[]>();
  const [dirty, setDirty] = useState(false);
  const [editingScope, setEditingScope] = useState<string>();
  const [selectedPageKey, setSelectedPageKey] = useState<string>();
  const [pageDrafts, setPageDrafts] = useState<Record<string, PageFieldDraft>>(
    {},
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copySelection, setCopySelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const queryClient = useQueryClient();
  const { session } = useAuthentication();
  const submission = useSubmission({
    scope: `${session?.user.id}:settings:role:${key}`,
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const busy = requestBusy || submission.submitting;
  const pageDirtyKeys = new Set(Object.keys(pageDrafts));
  const pageFieldDirty = pageDirtyKeys.size > 0;
  const stagedCount = Object.values(pageDrafts).reduce(
    (sum, draft) => sum + Object.keys(draft.fields).length,
    0,
  );
  const hasChanges = dirty || pageFieldDirty;
  const leave = useSettingsLeave(hasChanges, busy);
  const [error, setError] = useState<unknown>();

  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [keyConflict, setKeyConflict] = useState(false);
  const text = (value: LocalizedText): string =>
    typeof value === 'string'
      ? value
      : t(value.key, {
          ns: value.ns,
          defaultValue: value.defaultValue ?? value.key,
        });
  const initial = !creating ? request.data?.data : undefined;
  const name = nameDraft ?? (initial ? text(initial.title ?? initial.key) : '');
  const roleKey = keyDraft ?? initial?.key ?? '';
  const grants = grantsDraft ?? initial?.grants ?? [];
  // A role whose grants only read data (e.g. 资产集团只读) starts with
  // read-only fields; otherwise every unconfigured field stays editable.
  const readOnlyRole = isReadOnlyGrants(grants);
  const defaultFieldState = readOnlyRole ? READONLY_STATE : DEFAULT_STATE;
  const catalog = useMemo(() => {
    if (!options.data) return undefined;
    const pages = pagePermissionResources(
      app.runtime.routes,
      pagePermissionTitles,
      (path) => t('settings.unnamedPage', { path }),
    );
    return permissionWorkspaceCatalog(
      options.data.data,
      app.runtime.routes,
      pages,
    );
  }, [options.data, app, t]);
  const allowed = creating
    ? canCreate
    : canUpdate &&
      (!request.data?.data.protection ||
        request.data.data.protection.allow.includes('update'));
  const closeTo = {
    pathname: useResolvedPath('..').pathname,
    search: location.search,
  };
  const originalRevisionRef = useRef<string | undefined>(undefined);
  const createdKeyRef = useRef<string | undefined>(undefined);
  const sections = catalog
    ? configurePermissionScopes(
        permissionNavigationSections(
          permissionSections(catalog, grants, text, permissionScopeVisible),
          app.runtime.routes,
          pagePermissionTitles,
          (path) => t('settings.unnamedPage', { path }),
          text,
        ),
        catalog,
        grants,
        (key, fallback) => t(key, { defaultValue: fallback ?? key }),
        editingScope,
        setEditingScope,
        (id, value) => {
          setGrantsDraft((current) => setScope(current ?? grants, id, value));
          setDirty(true);
        },
        !allowed || busy,
      ).map((section) => {
        if (section.id === 'pages') {
          return {
            ...section,
            title: t('permissionGuide.pages'),
            description: t('permissionGuide.pageHint'),
          };
        }
        if (section.id === 'configuration') {
          return {
            ...section,
            title: t('permissionGuide.admin'),
            description: t('permissionGuide.adminHint'),
          };
        }
        return section;
      })
    : [];

  /** Every page (top-level and inherited routes) addressable by pageKey. */
  const allTargets = new Map<string, PageDisplayTarget>();
  for (const section of sections) {
    for (const node of section.navigation ?? []) {
      for (const target of collectPageDisplays(node, {
        list: t('permissionGuide.listPage'),
        page: t('pageFieldVisibility.pageTab'),
        new: t('permissionGuide.newPage'),
        edit: t('permissionGuide.editPage'),
        detail: t('permissionGuide.detailPage'),
      })) {
        allTargets.set(target.pageKey, target);
      }
    }
  }
  const selectedTarget = selectedPageKey
    ? allTargets.get(selectedPageKey)
    : undefined;
  /** Which pages of this role already have saved field settings. */
  const pageConfigs = useQuery({
    retry: false,
    enabled: Boolean(key),
    queryKey: ['page-field-visibility-pages', key],
    queryFn: ({ signal }) =>
      api.request<{
        data: { pages: { pageKey: string; configured: boolean }[] };
      }>({
        path: 'page-field-visibility/pages',
        query: { permissionSetKey: key ?? '' },
        signal,
      }),
  });
  const configuredPageKeys = new Set(
    (pageConfigs.data?.data.pages ?? [])
      .filter((page) => page.configured)
      .map((page) => page.pageKey),
  );
  /**
   * Legacy resource-level field policies (the old 字段权限 editor). Until a
   * page has its own saved rows, the panel mirrors them so what the editor
   * shows matches what the server enforces for that page; saving a page
   * materializes its rows and the server rebuilds the resource-level union.
   */
  const fieldPolicies = useQuery({
    retry: false,
    enabled: Boolean(key),
    queryKey: ['field-policies', key],
    queryFn: ({ signal }) =>
      api.request<{
        data: { policies: FieldPolicy[]; legacyDefault: boolean };
      }>({
        path: 'field-policies',
        query: { permissionSetKey: key ?? '' },
        signal,
      }),
  });
  const legacyStates = Object.fromEntries(
    (fieldPolicies.data?.data.policies ?? []).map((policy) => [
      fieldPolicyKey(policy.resource, policy.field),
      {
        visible: policy.access !== 'hidden',
        writable: policy.access === 'write',
      } satisfies PageFieldStateValue,
    ]),
  );
  const legacyDefault = fieldPolicies.data?.data.legacyDefault ?? true;
  const pageFieldVisibility = useQuery({
    retry: false,
    queryKey: [
      'page-field-visibility',
      key,
      selectedTarget?.pageKey,
      selectedTarget?.fallbackPageKey,
    ],
    enabled: Boolean(key && selectedTarget),
    queryFn: ({ signal }) =>
      api.request<{
        data: {
          mode: 'independent' | 'inherit' | 'override';
          configured: boolean;
          inheritedFrom?: string;
          fields: {
            resource: string;
            field: string;
            visible: boolean;
            writable: boolean;
          }[];
        };
      }>({
        path: 'page-field-visibility',
        query: {
          permissionSetKey: key ?? '',
          pageKey: selectedTarget?.pageKey ?? '',
          ...(selectedTarget?.fallbackPageKey
            ? { fallbackPageKey: selectedTarget.fallbackPageKey }
            : {}),
        },
        signal,
      }),
  });
  /** Saved rows of the selected page (already resolved against its fallback). */
  const savedStates = Object.fromEntries(
    (pageFieldVisibility.data?.data.fields ?? []).map((row) => [
      fieldPolicyKey(row.resource, row.field),
      {
        visible: row.visible,
        writable: row.writable ?? row.visible,
      } satisfies PageFieldStateValue,
    ]),
  );
  const activeDraft = selectedPageKey
    ? pageDrafts[selectedPageKey]
    : undefined;
  const catalogResources = fieldCatalog.data?.data.resources ?? [];
  const pageFieldResources = selectedTarget
    ? pageFieldResourcesForTarget(selectedTarget, catalogResources)
    : [];
  const pageFieldBaseKey = pageFieldVisibilityBaseKey(
    selectedTarget?.pageKey,
  );
  const lockedFields = new Set(
    PAGE_REQUIRED_FIELDS[pageFieldBaseKey ?? ''] ?? [],
  );
  const createPage = selectedTarget?.pageKey.endsWith('-new') ?? false;
  const readonlyForbiddenFields = createPage ? lockedFields : undefined;
  const neverWritableFields = new Set(
    pageFieldResources.flatMap((resource) =>
      resource.fields
        .filter((field) => field.writable === false)
        .map((field) => fieldPolicyKey(resource.resource, field.field)),
    ),
  );
  const baselineOf = (fieldKey: string): PageFieldStateValue => {
    const value =
      savedStates[fieldKey] ??
      legacyStates[fieldKey] ??
      (legacyDefault ? defaultFieldState : HIDDEN_STATE);
    // Fields the catalogue marks as never writable (computed overview
    // numbers…) can only be visible or hidden, so show them as read-only
    // instead of offering an "editable" state the server will reject.
    return value.visible && neverWritableFields.has(fieldKey)
      ? { ...value, writable: false }
      : value;
  };
  const stateOf = (resource: string, field: string): PageFieldStateValue =>
    activeDraft?.fields[fieldPolicyKey(resource, field)] ??
    baselineOf(fieldPolicyKey(resource, field));
  const modifiedOf = (resource: string, field: string): boolean => {
    const fieldKey = fieldPolicyKey(resource, field);
    const draft = activeDraft?.fields[fieldKey];
    if (!draft) return false;
    const baseline = baselineOf(fieldKey);
    return (
      draft.visible !== baseline.visible || draft.writable !== baseline.writable
    );
  };
  const fieldSignature = (target: PageDisplayTarget) =>
    pageFieldResourcesForTarget(target, catalogResources)
      .flatMap((resource) =>
        resource.fields.map((field) =>
          fieldPolicyKey(resource.resource, field.field),
        ),
      )
      .sort()
      .join('|');
  const selectedSignature = selectedTarget
    ? fieldSignature(selectedTarget)
    : '';
  const copyCandidates = [...allTargets.values()].filter(
    (target) =>
      target.pageKey !== selectedTarget?.pageKey &&
      selectedSignature.length > 0 &&
      fieldSignature(target) === selectedSignature,
  );

  const selectPage = (node: PermissionEditorNavigationNode) => {
    const pageKey =
      node.pageKey ?? pageIdFromPermissionRow(node.rowId) ?? undefined;
    setSelectedPageKey(pageKey);
  };

  const changePageState = (
    resource: string,
    field: string,
    state: PageFieldState,
  ) => {
    if (!selectedTarget || !selectedPageKey) return;
    const fieldKey = fieldPolicyKey(resource, field);
    setPageDrafts((current) => {
      const existing = current[selectedPageKey]?.fields ?? Object.fromEntries(
        pageFieldResources.flatMap((item) =>
          item.fields.map((entry) => {
            const entryKey = fieldPolicyKey(item.resource, entry.field);
            return [
              entryKey,
              baselineOf(entryKey),
            ] as const;
          }),
        ),
      );
      const next: Record<string, PageFieldStateValue> = {
        ...existing,
        [fieldKey]: valueOfState(state),
      };
      const pruned = Object.fromEntries(
        Object.entries(next).filter(([entryKey, value]) => {
          const baseline = baselineOf(entryKey);
          return (
            value.visible !== baseline.visible ||
            value.writable !== baseline.writable
          );
        }),
      );
      const rest = { ...current };
      if (Object.keys(pruned).length === 0) delete rest[selectedPageKey];
      else rest[selectedPageKey] = { fields: pruned };
      return rest;
    });
  };

  const applyCopy = async () => {
    if (!selectedTarget) return;
    setCopyBusy(true);
    try {
      const sourceStates: Record<string, PageFieldStateValue> = {};
      for (const resource of pageFieldResources) {
        for (const field of resource.fields) {
          sourceStates[fieldPolicyKey(resource.resource, field.field)] =
            stateOf(resource.resource, field.field);
        }
      }
      const targets = copyCandidates.filter((target) =>
        copySelection.has(target.pageKey),
      );
      const fetched = key
        ? await Promise.all(
            targets.map((target) =>
              api.request<{
                data: {
                  configured: boolean;
                  fields: {
                    resource: string;
                    field: string;
                    visible: boolean;
                    writable: boolean;
                  }[];
                };
              }>({
                path: 'page-field-visibility',
                query: {
                  permissionSetKey: key,
                  pageKey: target.pageKey,
                  ...(target.fallbackPageKey
                    ? { fallbackPageKey: target.fallbackPageKey }
                    : {}),
                },
              }),
            ),
          )
        : [];
      setPageDrafts((current) => {
        const next = { ...current };
        targets.forEach((target, index) => {
          const targetSaved = Object.fromEntries(
            (fetched[index]?.data.fields ?? []).map((row) => [
              fieldPolicyKey(row.resource, row.field),
              {
                visible: row.visible,
                writable: row.writable ?? row.visible,
              } satisfies PageFieldStateValue,
            ]),
          );
          const resources = pageFieldResourcesForTarget(
            target,
            catalogResources,
          );
          const fields: Record<string, PageFieldStateValue> = {};
          for (const resource of resources) {
            for (const field of resource.fields) {
              const fieldKey = fieldPolicyKey(resource.resource, field.field);
              fields[fieldKey] =
                sourceStates[fieldKey] ??
                targetSaved[fieldKey] ??
                defaultFieldState;
            }
          }
          const pruned = Object.fromEntries(
            Object.entries(fields).filter(([fieldKey, value]) => {
              const baseline =
                targetSaved[fieldKey] ??
                legacyStates[fieldKey] ??
                (legacyDefault ? defaultFieldState : HIDDEN_STATE);
              return (
                value.visible !== baseline.visible ||
                value.writable !== baseline.writable
              );
            }),
          );
          if (Object.keys(pruned).length > 0) {
            next[target.pageKey] = { fields: pruned };
          }
        });
        return next;
      });
      toaster.show({
        type: 'success',
        title: t('pageFieldPermission.copied', { count: targets.length }),
      });
    } catch (next) {
      setError(next);
    } finally {
      setCopyBusy(false);
      setCopyOpen(false);
      setCopySelection(new Set());
    }
  };

  const navigationFamilyDirty = (node: PermissionEditorNavigationNode) =>
    pageKeysOfFamily(node).some((pageKey) => pageDirtyKeys.has(pageKey));
  const navigationFamilyConfigured = (node: PermissionEditorNavigationNode) =>
    pageKeysOfFamily(node).some((pageKey) => configuredPageKeys.has(pageKey));
  const advancedPageKeys = new Set(
    [...allTargets.values()]
      .filter((target) => target.advanced)
      .map((target) => target.pageKey),
  );
  const disabledPageKeys = fieldCatalog.isSuccess
    ? new Set(
        [...allTargets.values()]
          .filter(
            (target) =>
              pageFieldResourcesForTarget(target, catalogResources).length ===
              0,
          )
          .map((target) => target.pageKey),
      )
    : new Set<string>();

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    return (async () => {
      event.preventDefault();
      if (options.error || !catalog || (!creating && request.error)) return;
      setSubmitted(true);
      if (!name.trim() || !roleKey.trim()) {
        form.querySelector<HTMLInputElement>('input:invalid')?.focus();
        return;
      }
      // 页面权限以用户在页面树里的勾选为准；未勾选的页面不能因为“补全
      // 清单”而被自动授权，否则保存任何角色都会获得全部页面。
      const effectiveGrants = grants;
      const incomplete = unconfiguredFilter(effectiveGrants);
      if (incomplete) {
        setEditingScope(incomplete);
        return;
      }
      setEditingScope(undefined);
      setRequestBusy(true);
      setError(undefined);
      setKeyConflict(false);
      try {
        const targetKey = createdKeyRef.current ?? key;
        const isCreate = !targetKey;
        originalRevisionRef.current ??= request.data?.data.revision;
        const input = {
          key: roleKey,
          title:
            !isCreate && initial && nameDraft === undefined
              ? initial.title
              : name.trim(),
          grants: effectiveGrants,
          ...(!isCreate && request.data?.data.revision
            ? { expectedRevision: originalRevisionRef.current }
            : {}),
        };
        const saved = await submission.run(
          { key: targetKey, creating: isCreate, input },
          (idempotencyKey) =>
            isCreate
              ? authz.createPermissionSet(input, idempotencyKey)
              : authz.updatePermissionSet(
                  targetKey ?? roleKey,
                  input,
                  idempotencyKey,
                ),
        );
        if (!saved) return;
        if (isCreate) createdKeyRef.current = roleKey;
        if (pageFieldDirty) {
          await savePageDrafts(roleKey);
        }
        setDirty(false);
        parent.reload();
        toaster.show({ type: 'success', title: t('settings.saved', { name }) });
        leave.allow();
        void navigate(closeTo, { replace: true });
      } catch (next) {
        if (
          creating &&
          next instanceof Error &&
          'status' in next &&
          next.status === 409
        ) {
          setKeyConflict(true);
          document.getElementById('role-key')?.focus();
        } else setError(next);
      } finally {
        setRequestBusy(false);
      }
    })();
  };

  const savePageDrafts = async (permissionSetKey: string) => {
    for (const [pageKey, draft] of Object.entries(pageDrafts)) {
      const target = allTargets.get(pageKey);
      if (!target) continue;
      const resources = pageFieldResourcesForTarget(target, catalogResources);
      const baseKey = pageFieldVisibilityBaseKey(pageKey) ?? pageKey;
      const required = new Set(PAGE_REQUIRED_FIELDS[baseKey] ?? []);
      const targetCreate = pageKey.endsWith('-new');
      const fields = resources.flatMap((resource) =>
        resource.fields.map((field) => {
          const fieldKey = fieldPolicyKey(resource.resource, field.field);
          const value = draft.fields[fieldKey] ?? defaultFieldState;
          return {
            resource: resource.resource,
            field: field.field,
            visible: required.has(fieldKey) ? true : value.visible,
            writable:
              field.writable === false
                ? false
                : required.has(fieldKey) && targetCreate
                  ? true
                  : value.writable,
          };
        }),
      );
      await api.request({
        path: 'page-field-visibility',
        method: 'PUT',
        json: {
          permissionSetKey,
          pageKey,
          ...(target.fallbackPageKey
            ? { fallbackPageKey: target.fallbackPageKey }
            : {}),
          mode: 'override',
          fields,
        },
      });
    }
    await queryClient.invalidateQueries({
      queryKey: ['page-field-visibility', permissionSetKey],
    });
    await queryClient.invalidateQueries({
      queryKey: ['page-field-visibility-pages', permissionSetKey],
    });
    setPageDrafts({});
  };

  const pagePanelHeader = selectedTarget ? (
    <div className='min-w-0'>
      <h2 className='text-sm font-medium'>{selectedTarget.label}</h2>
      {selectedTarget.path && (
        <code className='block text-xs text-muted-foreground [overflow-wrap:anywhere]'>
          {selectedTarget.path}
        </code>
      )}
    </div>
  ) : null;

  const pagePanel = (
    <div
      data-slot='page-field-panel'
      className='flex min-h-[min(62dvh,46rem)] flex-col rounded-lg border bg-card p-4'
    >
      {!selectedTarget ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center'>
          <MousePointerClickIcon
            aria-hidden
            className='size-5 text-muted-foreground/70'
          />
          <p className='max-w-64 text-sm text-muted-foreground'>
            {t('pageFieldPermission.selectPageHint')}
          </p>
        </div>
      ) : (
        <>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            {pagePanelHeader}
            {allowed && pageFieldResources.length > 0 && (
              <Popover open={copyOpen} onOpenChange={setCopyOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='shrink-0 gap-1'
                      disabled={copyBusy || copyCandidates.length === 0}
                      title={
                        copyCandidates.length === 0
                          ? t('pageFieldPermission.copyNoCandidates')
                          : undefined
                      }
                    />
                  }
                >
                  <CopyIcon className='size-3.5' />
                  {t('pageFieldPermission.copyToPages')}
                </PopoverTrigger>
                <PopoverContent align='end' className='max-h-80 w-72'>
                  <PopoverHeader>
                    <PopoverTitle>
                      {t('pageFieldPermission.copyToPages')}
                    </PopoverTitle>
                    <p className='text-xs text-muted-foreground'>
                      {t('pageFieldPermission.copyHint')}
                    </p>
                  </PopoverHeader>
                  <div className='grid gap-0.5 overflow-y-auto'>
                    {copyCandidates.map((target) => {
                      const checked = copySelection.has(target.pageKey);
                      return (
                        <button
                          key={target.pageKey}
                          type='button'
                          role='checkbox'
                          aria-checked={checked}
                          className='flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted'
                          onClick={() =>
                            setCopySelection((current) => {
                              const next = new Set(current);
                              if (checked) next.delete(target.pageKey);
                              else next.add(target.pageKey);
                              return next;
                            })
                          }
                        >
                          <span
                            aria-hidden
                            className='flex size-4 shrink-0 items-center justify-center rounded-[min(var(--radius-md),10px)] border'
                          >
                            {checked && <CheckIcon className='size-3' />}
                          </span>
                          <span className='min-w-0 truncate'>
                            {target.tabLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className='flex justify-end'>
                    <Button
                      type='button'
                      size='sm'
                      disabled={copyBusy || copySelection.size === 0}
                      onClick={() => void applyCopy()}
                    >
                      {t('pageFieldPermission.copyConfirm')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
          {selectedTarget.merged && (
            <p className='mb-2 mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground'>
              {t('pageFieldPermission.sharedEntry')}
            </p>
          )}
          <p className='mb-3 mt-1 text-xs leading-5 text-muted-foreground'>
            {t('pageFieldPermission.description')}
          </p>
          {readOnlyRole && (
            <p className='mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground'>
              {t('pageFieldPermission.readOnlyRoleHint')}
            </p>
          )}
          {fieldCatalog.isError ||
          pageFieldVisibility.isError ||
          fieldPolicies.isError ? (
            <SettingsError
              error={
                fieldCatalog.error ??
                pageFieldVisibility.error ??
                fieldPolicies.error
              }
              retry={() => {
                void fieldCatalog.refetch();
                void pageFieldVisibility.refetch();
                void fieldPolicies.refetch();
              }}
              inline
            />
          ) : fieldCatalog.isPending ||
            (Boolean(key && selectedTarget) && pageFieldVisibility.isPending) ||
            (Boolean(key) && fieldPolicies.isPending) ? (
            <SettingsLoading />
          ) : pageFieldResources.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('pageFieldPermission.empty')}
            </p>
          ) : (
            <PageFieldStateEditor
              resources={pageFieldResources}
              stateOf={stateOf}
              onChange={changePageState}
              lockedFields={lockedFields}
              readonlyForbiddenFields={readonlyForbiddenFields}
              neverWritableFields={neverWritableFields}
              modifiedOf={modifiedOf}
              readOnlyRole={readOnlyRole}
              readOnly={!allowed || busy}
            />
          )}
          <p className='mt-3 text-xs text-muted-foreground'>
            {t('pageFieldPermission.footnote')}
          </p>
        </>
      )}
    </div>
  );

  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={closeTo}>{t('settings.roles')}</BackButton>
        <PageHeader
          title={t(creating ? 'settings.newRole' : 'settings.editRole')}
          description={t('permissionGuide.rolesDescription')}
          actions={
            hasChanges ? (
              <Badge variant='secondary'>{t('settings.unsaved')}</Badge>
            ) : undefined
          }
        />
        <SettingsError error={request.error} retry={request.reload} />
        <SettingsError error={options.error} retry={() => void options.refetch()} />
        {error instanceof Error &&
          'status' in error &&
          error.status === 409 && (
            <Button variant='outline' onClick={() => setReloadConfirm(true)}>
              {t('settings.reload')}
            </Button>
          )}
        {(request.loading && !creating) || options.isPending ? (
          <SettingsLoading />
        ) : (
          !request.error &&
          !options.error && (
            <>
              <FeedbackForm
                submitting={busy}
                error={error}
                errorContent={<SettingsError error={error} inline />}
                onSubmit={(event) => void save(event)}
                noValidate
                className='flex flex-col gap-6'
              >
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='role-key'>{t('settings.key')} *</Label>
                    <Input
                      id='role-key'
                      name='key'
                      required
                      value={roleKey}
                      disabled={!creating || !allowed || busy}
                      aria-invalid={
                        keyConflict || (submitted && !roleKey.trim())
                      }
                      aria-errormessage={
                        keyConflict || (submitted && !roleKey.trim())
                          ? 'role-key-error'
                          : undefined
                      }
                      onChange={(event) => {
                        setKeyConflict(false);
                        setKeyDraft(event.target.value);
                        setDirty(true);
                      }}
                    />
                    {(keyConflict || (submitted && !roleKey.trim())) && (
                      <p
                        id='role-key-error'
                        className='text-xs text-destructive'
                      >
                        {t(
                          keyConflict
                            ? 'settings.keyConflict'
                            : 'settings.required',
                        )}
                      </p>
                    )}
                  </div>
                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='role-name'>
                      {t('settings.roleName')} *
                    </Label>
                    <Input
                      id='role-name'
                      name='title'
                      required
                      value={name}
                      disabled={!allowed || busy}
                      aria-invalid={submitted && !name.trim()}
                      aria-errormessage={
                        submitted && !name.trim()
                          ? 'role-name-error'
                          : undefined
                      }
                      onChange={(event) => {
                        setNameDraft(event.target.value);
                        setDirty(true);
                      }}
                    />
                    {submitted && !name.trim() && (
                      <p
                        id='role-name-error'
                        className='text-xs text-destructive'
                      >
                        {t('settings.required')}
                      </p>
                    )}
                  </div>
                </div>
                {request.data?.data.protection && (
                  <p className='text-sm text-muted-foreground'>
                    {t('settings.protectedHint')}
                  </p>
                )}
                <p className='text-xs text-muted-foreground'>
                  {t('permissionGuide.saveHint')}
                </p>
                <PermissionEditor
                  sections={sections}
                  readOnly={!allowed || busy}
                  onPageSelect={selectPage}
                  selectedPageKey={selectedPageKey}
                  navigationConfigured={navigationFamilyConfigured}
                  navigationDirty={navigationFamilyDirty}
                  pageDirtyKeys={pageDirtyKeys}
                  pageConfiguredKeys={configuredPageKeys}
                  advancedPageKeys={advancedPageKeys}
                  pageDisabledKeys={disabledPageKeys}
                  pagePanel={pagePanel}
                  pageLabel={(node) =>
                    allTargets.get(node.pageKey ?? '')?.tabLabel ?? node.label
                  }
                  labels={{
                    dataRanges: (count) => t('settings.dataRanges', { count }),
                    scopeExplanation: t('settings.scopeExplanation'),
                    scopeHintFor: (name) =>
                      t('settings.scopeHintFor', { name }),
                    levelFor: (name) => t('settings.levelFor', { name }),
                    search: t('settings.permissionSearch'),
                    enabledOnly: t('settings.enabledOnly'),
                    granted: t('settings.permissionGranted'),
                    ungranted: t('settings.permissionUngranted'),
                    selectAll: t('settings.permissionAll'),
                    authorizationStatus: t('settings.permissionStatus'),
                    clearSearch: t('settings.permissionClearSearch'),
                    collapseAll: t('settings.permissionCollapseAll'),
                    expandAll: t('settings.permissionExpandAll'),
                    summary: (enabled, total) =>
                      t('settings.permissionSummary', { enabled, total }),
                    clear: t('settings.clear'),
                    empty: t('settings.noPermissions'),
                    emptyDescription: t('settings.permissionEmptyHint'),
                    readOnly: t('settings.permissionReadOnlyHint'),
                    managedPermission: t('settings.permissionManagedHint'),
                    noResults: t('settings.noResults'),
                    navigation: t('settings.permissionCategories'),
                    expandGroup: (name) =>
                      t('settings.expandPermissionGroup', { name }),
                    collapseGroup: (name) =>
                      t('settings.collapsePermissionGroup', { name }),
                    openPage: (name) =>
                      t('fieldPermission.openFor', { page: name }),
                    configure: t('permissionGuide.configure'),
                    fieldsConfigured: t('fieldPermission.configured'),
                    accessGranted: t('fieldPermission.accessible'),
                    pageUnsaved: t('pageFieldVisibility.pageUnsaved'),
                    pageNoFields: t('permissionGuide.pageNoFields'),
                    morePages: (count) =>
                      t('permissionGuide.morePages', { count }),
                    listPage: t('permissionGuide.listPage'),
                  }}
                  onEnabledChange={(id, enabled) => {
                    if (!catalog) return;
                    setGrantsDraft((current) =>
                      setPermissions(current ?? grants, catalog, [
                        { id, enabled },
                      ]),
                    );
                    setDirty(true);
                  }}
                  onLevelChange={(id, value) => {
                    if (value === 'customFilter') {
                      setEditingScope(id);
                      return;
                    }
                    setGrantsDraft((current) =>
                      setScope(current ?? grants, id, value),
                    );
                    setDirty(true);
                  }}
                />
                <div className='sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-background py-4 pr-16'>
                  <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                    {pageFieldDirty && (
                      <span
                        aria-hidden
                        className='size-2 shrink-0 rounded-full bg-primary'
                      />
                    )}
                    {pageFieldDirty
                      ? t('pageFieldVisibility.unsavedHint', {
                          count: stagedCount,
                        })
                      : t('permissionGuide.saveHint')}
                  </span>
                  <div className='flex justify-end gap-2'>
                    <Button
                      variant='outline'
                      disabled={busy}
                      onClick={() => setReloadConfirm(true)}
                    >
                      {t('settings.discard')}
                    </Button>
                    {allowed && (
                      <Button type='submit' disabled={busy || !hasChanges}>
                        {t(busy ? 'settings.saving' : 'settings.save')}
                      </Button>
                    )}
                  </div>
                </div>
              </FeedbackForm>
            </>
          )
        )}
        {leave.dialog}
        <ConfirmAction
          open={reloadConfirm}
          title={t('settings.discardTitle')}
          description={t('settings.discardHint')}
          busy={false}
          onCancel={() => setReloadConfirm(false)}
          onConfirm={() => {
            setNameDraft(undefined);
            setKeyDraft(undefined);
            setGrantsDraft(undefined);
            setPageDrafts({});
            setSelectedPageKey(undefined);
            setDirty(false);
            setError(undefined);
            setReloadConfirm(false);
            request.reload();
          }}
        />
      </PageContainer>
    </RouteChildPage>
  );
}

export default function RoleForm(): ReactElement {
  const { key } = useParams();
  return <RoleEditor key={key ?? '$new'} />;
}
