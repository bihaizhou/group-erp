import { FeedbackForm } from '#components/feedback-form';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  ApiClientError,
  useApiClient,
  useClientApplication,
  useSubmission,
  useToaster,
} from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import {
  useSettingsLeave,
  useSettingsData,
  useRolePermission,
} from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useAuthorizationClient,
  type AuthorizationOptionsResponse,
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
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
import { PageFieldPermissionEditor } from '#components/field-permission-editor';
import {
  buildFieldPolicies,
  fieldPolicyKey,
  type FieldAccess,
  type FieldPermissionResource,
  type FieldPolicy,
} from '#components/field-permission-policies';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#components/ui/sheet';
import {
  fieldResourcesForPage,
  pageIdFromPermissionRow,
  pagesForFieldResource,
} from './field-permission-pages.js';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import { ConfirmAction, SettingsError, SettingsLoading } from './shared.js';
import { configurePermissionScopes } from './permission-filters.js';
import {
  permissionRowId,
  permissionSections,
  unconfiguredFilter,
  setPermissions,
  setScope,
} from './permissions-model.js';

interface FieldPermissionPageTarget {
  readonly id: string;
  readonly label: string;
  readonly path?: string | undefined;
  readonly resources: readonly string[];
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
  const request = useSettingsData<{ data: PermissionSet }>(
    key
      ? `authorization/permissionSets/${encodeURIComponent(key)}`
      : 'authorization/permissionSets/options',
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
  const options = useSettingsData<{ data: AuthorizationOptionsResponse }>(
    'authorization/permissionSets/options',
  );
  const fieldCatalog = useQuery({
    retry: false,
    queryKey: ['field-policy-catalog'],
    queryFn: ({ signal }) =>
      api.request<{ data: { resources: FieldPermissionResource[] } }>({
        path: 'field-policies/catalog',
        signal,
      }),
  });
  const fieldPolicies = useQuery({
    retry: false,
    enabled: Boolean(key),
    queryKey: ['field-policies', key],
    queryFn: ({ signal }) =>
      api.request<{
        data: { policies: FieldPolicy[]; legacyDefault: boolean };
      }>({
        path: 'field-policies',
        query: { permissionSetKey: key },
        signal,
      }),
  });
  const canCreate = useRolePermission('create');
  const canUpdate = useRolePermission('update');
  const [nameDraft, setNameDraft] = useState<string>();
  const [keyDraft, setKeyDraft] = useState<string>();
  const [grantsDraft, setGrantsDraft] = useState<readonly PermissionGrant[]>();
  const [dirty, setDirty] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<Record<string, FieldAccess>>({});
  const [editingScope, setEditingScope] = useState<string>();
  const [fieldPage, setFieldPage] = useState<FieldPermissionPageTarget>();
  const { session } = useAuthentication();
  const submission = useSubmission({
    scope: `${session?.user.id}:settings:role:${key}`,
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const busy = requestBusy || submission.submitting;
  const fieldDirty = Object.keys(fieldDraft).length > 0;
  const hasChanges = dirty || fieldDirty;
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
  /**
   * The grant ladder stores only explicit grants (visible/write);
   * `hidden` exists client-side as a marker for "explicitly cleared" so the
   * draft can override a legacy set whose default is write. The sentinel row
   * ($default.legacy) marks sets from before the ladder and is never a field.
   */
  const legacyDefault = fieldPolicies.data?.data.legacyDefault ?? false;
  const resolveLevel = (
    access: FieldAccess | undefined,
  ): FieldAccess | undefined => {
    if (access === 'hidden') return undefined;
    // Rows written by the old three-rung editor meant the same as visible;
    // the migration rewrites them, this just guards against stale reads.
    if ((access as unknown as string) === 'readonly') return 'visible';
    return access;
  };
  const fieldBaseline = useMemo(() => {
    const levels: Record<string, FieldAccess> = {};
    for (const policy of fieldPolicies.data?.data.policies ?? []) {
      levels[fieldPolicyKey(policy.resource, policy.field)] = policy.access;
    }
    return levels;
  }, [fieldPolicies.data]);
  const fieldLevel = (
    resource: string,
    field: string,
  ): FieldAccess | undefined => {
    const levelKey = fieldPolicyKey(resource, field);
    const draft = fieldDraft[levelKey];
    if (draft !== undefined) return resolveLevel(draft);
    const baseline = fieldBaseline[levelKey];
    if (baseline !== undefined) return resolveLevel(baseline);
    return legacyDefault ? 'write' : undefined;
  };
  const setFieldLevel = (
    resource: string,
    field: string,
    access: FieldAccess | undefined,
  ) => {
    const levelKey = fieldPolicyKey(resource, field);
    const fallback: FieldAccess | undefined =
      fieldBaseline[levelKey] !== undefined
        ? resolveLevel(fieldBaseline[levelKey])
        : legacyDefault
          ? 'write'
          : undefined;
    const target = resolveLevel(access);
    setFieldDraft((current) => {
      const next = { ...current };
      if (target === undefined) {
        // Clearing a field needs an explicit marker whenever it would
        // otherwise still show from its fallback (the legacy default or a
        // stored grant); otherwise dropping the draft key is enough.
        if (fallback !== undefined) next[levelKey] = 'hidden';
        else delete next[levelKey];
      } else if (target === fallback) {
        delete next[levelKey];
      } else {
        next[levelKey] = target;
      }
      return next;
    });
  };
  const configuredPages = useMemo(() => {
    const resources = new Set<string>();
    for (const policy of fieldPolicies.data?.data.policies ?? []) {
      if (policy.access !== 'write') resources.add(policy.resource);
    }
    const resourceIds = (fieldCatalog.data?.data.resources ?? [])
      .map((resource) => resource.resource)
      .sort((left, right) => right.length - left.length);
    for (const [levelKey, access] of Object.entries(fieldDraft)) {
      if (access !== 'visible') continue;
      const resource = resourceIds.find((id) => levelKey.startsWith(`${id}.`));
      if (resource) resources.add(resource);
    }
    const pages = new Set<string>();
    for (const resource of resources) {
      for (const pageId of pagesForFieldResource(resource)) pages.add(pageId);
    }
    return pages;
  }, [fieldPolicies.data, fieldDraft, fieldCatalog.data]);
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
      const pageIds = new Set<string>();
      for (const section of sections) {
        if (section.id !== 'pages') continue;
        if (section.navigation) {
          const walk = (nodes: readonly PermissionEditorNavigationNode[]) => {
            for (const node of nodes) {
              const pageId = pageIdFromPermissionRow(node.rowId);
              if (pageId) pageIds.add(pageId);
              if (node.children) walk(node.children);
            }
          };
          walk(section.navigation);
        }
        for (const group of section.groups) {
          for (const row of group.rows) {
            const pageId = pageIdFromPermissionRow(row.id);
            if (pageId) pageIds.add(pageId);
          }
        }
      }
      // 页面树的来源是 pagePermissionResources；把未出现在 sections
      // 分组里的页面（仅存在于导航节点的页面）也纳入，确保全部业务页面授权。
      for (const page of pagePermissionResources(
        app.runtime.routes,
        pagePermissionTitles,
        (path) => t('settings.unnamedPage', { path }),
      )) {
        pageIds.add(page.id);
      }
      const pageGrants = [...pageIds].map((pageId) => ({
        id: permissionRowId({ type: 'page', id: pageId }, 'access'),
        enabled: true,
      }));
      const effectiveGrants = pageGrants.length
        ? setPermissions(grants, catalog, pageGrants)
        : grants;
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
        // A newly created role has no field policies at all, which the server
        // still treats as "allow everything". Save explicitly (possibly with
        // an empty list) so the role enters the ladder model where nothing
        // checked really means nothing granted.
        if (fieldDirty || isCreate) {
          await api.request({
            path: 'field-policies',
            method: 'PUT',
            json: {
              permissionSetKey: roleKey,
              policies: buildFieldPolicies(
                fieldCatalog.data?.data.resources ?? [],
                fieldLevel,
              ),
            },
          });
          setFieldDraft({});
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

  /** Labels exactly as the page tree renders them, used for shared-resource notes. */
  const pageLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const pages = pagePermissionResources(
      app.runtime.routes,
      pagePermissionTitles,
      (path) => t('settings.unnamedPage', { path }),
    );
    for (const page of pages) {
      labels.set(
        page.id,
        typeof page.title === 'string'
          ? page.title
          : t(page.title.key, {
              ns: page.title.ns,
              defaultValue: page.title.defaultValue ?? page.title.key,
            }),
      );
    }
    return labels;
  }, [app, t]);

  const sharedPages = useMemo(() => {
    if (!fieldPage) return {};
    return Object.fromEntries(
      fieldPage.resources.map((resource) => [
        resource,
        pagesForFieldResource(resource)
          .filter((pageId) => pageId !== fieldPage.id)
          .map((pageId) => pageLabels.get(pageId) ?? pageId),
      ]),
    );
  }, [fieldPage, pageLabels]);

  const changeFieldLevel = (
    resource: string,
    field: string,
    access: FieldAccess | undefined,
  ) => {
    setFieldLevel(resource, field, access);
  };

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
        <SettingsError error={options.error} retry={options.reload} />
        {error instanceof Error &&
          'status' in error &&
          error.status === 409 && (
            <Button variant='outline' onClick={() => setReloadConfirm(true)}>
              {t('settings.reload')}
            </Button>
          )}
        {(request.loading && !creating) || options.loading ? (
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
                  onNavigationOpen={(node) => {
                    const pageId = pageIdFromPermissionRow(node.rowId);
                    if (!pageId) return;
                    setFieldPage({
                      id: pageId,
                      label: node.label,
                      path: node.path,
                      resources: fieldResourcesForPage(pageId),
                    });
                  }}
                  navigationConfigured={(node) => {
                    const pageId = pageIdFromPermissionRow(node.rowId);
                    return pageId ? configuredPages.has(pageId) : false;
                  }}
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
                    fieldsConfigured: t('fieldPermission.configured'),
                    accessGranted: t('fieldPermission.accessible'),
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
                <div className='sticky bottom-0 flex justify-end gap-2 border-t bg-background py-4 pr-16'>
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => void navigate(closeTo)}
                  >
                    {t('settings.cancel')}
                  </Button>
                  {allowed && (
                    <Button type='submit' disabled={busy || !hasChanges}>
                      {t(busy ? 'settings.saving' : 'settings.save')}
                    </Button>
                  )}
                </div>
              </FeedbackForm>
              {fieldPage && (
                <Sheet
                  open
                  onOpenChange={(open) => {
                    if (!open) setFieldPage(undefined);
                  }}
                >
                  <SheetContent className='data-[side=right]:sm:max-w-4xl gap-0 flex flex-col'>
                    <SheetHeader className='border-b pr-12'>
                      <SheetTitle>
                        {t('fieldPermission.title', {
                          page: fieldPage.label,
                        })}
                      </SheetTitle>
                      <SheetDescription className='space-y-1'>
                        {fieldPage.path && (
                          <code className='block text-xs [overflow-wrap:anywhere]'>
                            {fieldPage.path}
                          </code>
                        )}
                        <span className='block'>
                          {t('fieldPermission.description')}
                        </span>
                      </SheetDescription>
                    </SheetHeader>
                    <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                      <PageFieldPermissionEditor
                        resources={(
                          fieldCatalog.data?.data.resources ?? []
                        ).filter((resource) =>
                          fieldPage.resources.includes(resource.resource),
                        )}
                        levelOf={fieldLevel}
                        onChange={changeFieldLevel}
                        sharedPages={sharedPages}
                        readOnly={!allowed || busy}
                        loading={
                          fieldCatalog.isPending ||
                          (Boolean(key) && fieldPolicies.isPending)
                        }
                        failed={fieldCatalog.isError || fieldPolicies.isError}
                      />
                    </div>
                    <div className='flex flex-wrap items-center justify-between gap-3 border-t p-4'>
                      <span className='text-xs text-muted-foreground'>
                        {t('fieldPermission.stagedHint')}
                      </span>
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => setFieldPage(undefined)}
                      >
                        {t('fieldPermission.done')}
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>
              )}
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
            setFieldDraft({});
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
