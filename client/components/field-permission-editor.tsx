import { useMutation, useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Button } from '#components/ui/button';

interface CatalogField {
  field: string;
  titleKey?: string;
  label: string;
}

interface CatalogResource {
  resource: string;
  titleKey: string;
  descriptionKey: string;
  fields: CatalogField[];
}

type FieldAccess = 'hidden' | 'readonly' | 'write';

interface PolicyRow {
  resource: string;
  field: string;
  access: FieldAccess;
}

interface PoliciesResponse {
  data: { policies: PolicyRow[] };
}

interface CatalogResponse {
  data: { resources: CatalogResource[] };
}

const LEVELS: readonly FieldAccess[] = ['hidden', 'readonly', 'write'];

const keyOf = (resource: string, field: string) => `${resource}.${field}`;

/**
 * Field-level access for one page of one permission set. The host opens this
 * from the page's row in the permission tree, so the page title and path above
 * the sheet explain why these fields are grouped together.
 */
export function PageFieldPermissionEditor({
  permissionSetKey,
  resourceIds,
  sharedPages = {},
  readOnly = false,
}: {
  permissionSetKey: string;
  resourceIds: readonly string[];
  /** Other pages rendering the same resource; editing here changes them too. */
  sharedPages?: Readonly<Record<string, readonly string[]>>;
  readOnly?: boolean;
}) {
  const api = useApiClient();
  const { t } = useTranslation();
  const [overrides, setOverrides] = useState<Record<string, FieldAccess>>({});
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const query = useQuery({
    retry: false,
    queryKey: ['field-policies', permissionSetKey],
    queryFn: ({ signal }) =>
      api.request<PoliciesResponse>({
        path: 'field-policies',
        query: { permissionSetKey },
        signal,
      }),
  });

  const catalog = useQuery({
    retry: false,
    queryKey: ['field-policy-catalog'],
    queryFn: ({ signal }) =>
      api.request<CatalogResponse>({
        path: 'field-policies/catalog',
        signal,
      }),
  });
  const resources = catalog.data?.data.resources ?? [];
  const visible = resources.filter((resource) =>
    resourceIds.includes(resource.resource),
  );

  const stored = Object.fromEntries(
    (query.data?.data.policies ?? []).map((policy) => [
      keyOf(policy.resource, policy.field),
      policy.access,
    ]),
  );

  const save = useMutation({
    retry: false,
    mutationFn: () => {
      // Send the complete catalog so saving one page cannot erase another
      // page's field policies.
      const policies = resources
        .flatMap((resource) =>
          resource.fields.map((field) => ({
            resource: resource.resource,
            field: field.field,
            access:
              overrides[keyOf(resource.resource, field.field)] ??
              stored[keyOf(resource.resource, field.field)] ??
              'write',
          })),
        )
        .filter((policy) => policy.access !== 'write');
      return api.request<PoliciesResponse>({
        path: 'field-policies',
        method: 'PUT',
        json: { permissionSetKey, policies },
      });
    },
    onSuccess: () => {
      setStatus('saved');
      setOverrides({});
      void query.refetch();
    },
    onError: () => setStatus('error'),
  });

  const levelOf = (resource: string, field: string): FieldAccess =>
    overrides[keyOf(resource, field)] ??
    stored[keyOf(resource, field)] ??
    'write';

  const setLevel = (resource: string, field: string, access: FieldAccess) => {
    setStatus('idle');
    setOverrides((current) => ({
      ...current,
      [keyOf(resource, field)]: access,
    }));
  };

  const loading = query.isPending || catalog.isPending;
  const failed = query.isError || catalog.isError;
  const ready = query.isSuccess && catalog.isSuccess;

  return (
    <div className='space-y-5'>
      {readOnly && (
        <p className='text-xs text-muted-foreground'>
          {t('fieldPermission.readOnly')}
        </p>
      )}
      {loading && (
        <p className='text-sm text-muted-foreground'>
          {t('fieldPermission.loading')}
        </p>
      )}
      {failed && (
        <p className='text-sm text-destructive'>
          {t('fieldPermission.loadFailed')}
        </p>
      )}
      {!loading && !failed && visible.length === 0 && (
        <p className='text-sm text-muted-foreground'>
          {t('fieldPermission.empty')}
        </p>
      )}
      {visible.map((resource) => {
        const others = sharedPages[resource.resource] ?? [];
        return (
          <section key={resource.resource} className='space-y-2'>
            <FieldPermissionTable
              resource={resource}
              levelOf={levelOf}
              readOnly={readOnly}
              onChange={setLevel}
            />
            {others.length > 0 && (
              <p className='text-xs text-muted-foreground'>
                {t('fieldPermission.sharedPages', {
                  pages: others.join(', '),
                })}
              </p>
            )}
          </section>
        );
      })}
      {visible.length > 0 && (
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4'>
          <Button
            type='button'
            disabled={readOnly || !ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {t(
              save.isPending
                ? 'fieldPermission.saving'
                : 'fieldPermission.save',
            )}
          </Button>
          <span className='text-xs text-muted-foreground'>
            {t('fieldPermission.saveHint')}
          </span>
          {status === 'saved' && (
            <span className='text-xs text-muted-foreground'>
              {t('fieldPermission.saved')}
            </span>
          )}
          {status === 'error' && (
            <span className='text-xs text-destructive'>
              {t('fieldPermission.saveFailed')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FieldPermissionTable({
  resource,
  levelOf,
  readOnly,
  onChange,
}: {
  resource: CatalogResource;
  levelOf: (resource: string, field: string) => FieldAccess;
  readOnly: boolean;
  onChange: (resource: string, field: string, access: FieldAccess) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='space-y-2'>
      <div>
        <p className='text-sm font-medium'>{t(resource.titleKey)}</p>
        <p className='text-xs text-muted-foreground'>
          {t(resource.descriptionKey)}
        </p>
      </div>
      <div className='overflow-hidden rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-xs text-muted-foreground'>
            <tr>
              <th className='px-3 py-2 text-left font-medium'>
                {t('settings.fieldPermissionField')}
              </th>
              {LEVELS.map((level) => (
                <th key={level} className='px-3 py-2 text-left font-medium'>
                  {t(`settings.fieldAccess.${level}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resource.fields.map((field) => {
              const level = levelOf(resource.resource, field.field);
              return (
                <tr key={field.field} className='border-t'>
                  <td className='px-3 py-2'>
                    {field.titleKey ? t(field.titleKey) : field.label}
                  </td>
                  {LEVELS.map((option) => (
                    <td key={option} className='px-3 py-2'>
                      <label className='inline-flex cursor-pointer items-center gap-2'>
                        <input
                          type='radio'
                          name={keyOf(resource.resource, field.field)}
                          checked={level === option}
                          disabled={readOnly}
                          onChange={() =>
                            onChange(resource.resource, field.field, option)
                          }
                        />
                        <span className='text-xs text-muted-foreground'>
                          {t(`settings.fieldAccessHint.${option}`)}
                        </span>
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
