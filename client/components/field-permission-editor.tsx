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
 * Field-level access for one permission set. Sits beside the page/action matrix
 * so an administrator decides, in one place, what a role may enter and what it
 * may only read.
 */
export function FieldPermissionEditor({
  permissionSetKey,
  readOnly = false,
}: {
  permissionSetKey: string;
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

  const stored = Object.fromEntries(
    (query.data?.data.policies ?? []).map((policy) => [
      keyOf(policy.resource, policy.field),
      policy.access,
    ]),
  );

  const save = useMutation({
    retry: false,
    mutationFn: () => {
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

  return (
    <section className='space-y-4 rounded-lg border p-4'>
      <div className='space-y-1'>
        <h3 className='text-sm font-medium'>
          {t('settings.fieldPermissions')}
        </h3>
        <p className='text-xs text-muted-foreground'>
          {t('settings.fieldPermissionsHint')}
        </p>
      </div>
      {query.isPending && (
        <p className='text-sm text-muted-foreground'>{t('settings.loading')}</p>
      )}
      {query.error && (
        <p className='text-sm text-destructive'>
          {t('settings.fieldPermissionsLoadFailed')}
        </p>
      )}
      {catalog.error && (
        <p className='text-sm text-destructive'>
          {t('settings.fieldPermissionsLoadFailed')}
        </p>
      )}
      {resources.map((resource) => (
        <FieldPermissionTable
          key={resource.resource}
          resource={resource}
          levelOf={levelOf}
          readOnly={readOnly}
          onChange={setLevel}
        />
      ))}
      <div className='flex items-center gap-3'>
        <Button
          type='button'
          disabled={readOnly || save.isPending || resources.length === 0}
          onClick={() => save.mutate()}
        >
          {t(
            save.isPending
              ? 'settings.saving'
              : 'settings.fieldPermissionsSave',
          )}
        </Button>
        {status === 'saved' && (
          <span className='text-xs text-muted-foreground'>
            {t('settings.fieldPermissionsSaved')}
          </span>
        )}
        {status === 'error' && (
          <span className='text-xs text-destructive'>
            {t('settings.fieldPermissionsSaveFailed')}
          </span>
        )}
      </div>
    </section>
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
