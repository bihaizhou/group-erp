import { useTranslation } from '@nocobase/i18n/client';
import type { FieldPermissionResource } from '#components/field-permission-policies';

/**
 * Two-state editor: render the field on this page, or do not. Writing is
 * deliberately absent here; it belongs to the resource-level field policy.
 */
export function PageFieldVisibilityEditor({
  resources,
  visibleOf,
  onChange,
  lockedFields = new Set<string>(),
  readOnly = false,
  loading = false,
  failed = false,
}: {
  resources: readonly FieldPermissionResource[];
  visibleOf: (resource: string, field: string) => boolean;
  onChange: (resource: string, field: string, visible: boolean) => void;
  /** Required fields stay rendered; hiding them would make the form unsendable. */
  lockedFields?: ReadonlySet<string>;
  readOnly?: boolean;
  loading?: boolean;
  failed?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className='space-y-5'>
      {readOnly && (
        <p className='text-xs text-muted-foreground'>
          {t('pageFieldVisibility.readOnly')}
        </p>
      )}
      {loading && (
        <p className='text-sm text-muted-foreground'>
          {t('pageFieldVisibility.loading')}
        </p>
      )}
      {failed && (
        <p className='text-sm text-destructive'>
          {t('pageFieldVisibility.loadFailed')}
        </p>
      )}
      {!loading && !failed && resources.length === 0 && (
        <p className='text-sm text-muted-foreground'>
          {t('pageFieldVisibility.empty')}
        </p>
      )}
      {!loading &&
        !failed &&
        resources.map((resource) => (
          <section key={resource.resource} className='space-y-2'>
            <p className='text-sm font-medium'>{t(resource.titleKey)}</p>
            <div className='overflow-hidden rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/40 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-3 py-2 text-left font-medium'>
                      {t('settings.fieldPermissionField')}
                    </th>
                    <th className='w-24 px-2 py-2 text-center font-medium'>
                      {t('pageFieldVisibility.show')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resource.fields.map((field) => {
                    const visible = visibleOf(resource.resource, field.field);
                    const locked = lockedFields.has(
                      `${resource.resource}.${field.field}`,
                    );
                    return (
                      <tr key={field.field} className='border-t'>
                        <td className='px-3 py-2'>
                          {field.titleKey
                            ? t(field.titleKey)
                            : field.label || field.field}
                        </td>
                        <td className='px-2 py-2 text-center'>
                          {locked ? (
                            <span
                              className='text-xs text-muted-foreground'
                              title={t('pageFieldVisibility.requiredField')}
                            >
                              {t('pageFieldVisibility.requiredBadge')}
                            </span>
                          ) : (
                            <input
                              type='checkbox'
                              className='size-4 accent-primary'
                              aria-label={t('pageFieldVisibility.showField', {
                                field: field.titleKey
                                  ? t(field.titleKey)
                                  : field.label || field.field,
                              })}
                              checked={visible}
                              disabled={readOnly}
                              onChange={(event) =>
                                onChange(
                                  resource.resource,
                                  field.field,
                                  event.target.checked,
                                )
                              }
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}
