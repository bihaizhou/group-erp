import { useTranslation } from '@nocobase/i18n/client';
import {
  fieldPolicyKey,
  type FieldAccess,
  type FieldPermissionResource,
} from './field-permission-policies.js';

const LEVELS: readonly FieldAccess[] = ['hidden', 'readonly', 'write'];

/**
 * Field-level access for one page of one permission set. Fully controlled: the
 * role form owns the draft and saves it together with the page permissions, so
 * a new role can configure fields before it exists and one save applies all.
 */
export function PageFieldPermissionEditor({
  resources,
  levelOf,
  onChange,
  sharedPages = {},
  readOnly = false,
  loading = false,
  failed = false,
}: {
  resources: readonly FieldPermissionResource[];
  levelOf: (resource: string, field: string) => FieldAccess;
  onChange: (resource: string, field: string, access: FieldAccess) => void;
  /** Other pages rendering the same resource; editing here changes them too. */
  sharedPages?: Readonly<Record<string, readonly string[]>>;
  readOnly?: boolean;
  loading?: boolean;
  failed?: boolean;
}) {
  const { t } = useTranslation();

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
      {!loading && !failed && resources.length === 0 && (
        <p className='text-sm text-muted-foreground'>
          {t('fieldPermission.empty')}
        </p>
      )}
      {!loading &&
        !failed &&
        resources.map((resource) => {
          const others = sharedPages[resource.resource] ?? [];
          return (
            <section key={resource.resource} className='space-y-2'>
              <FieldPermissionTable
                resource={resource}
                levelOf={levelOf}
                readOnly={readOnly}
                onChange={onChange}
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
    </div>
  );
}

function FieldPermissionTable({
  resource,
  levelOf,
  readOnly,
  onChange,
}: {
  resource: FieldPermissionResource;
  levelOf: (resource: string, field: string) => FieldAccess;
  readOnly: boolean;
  onChange: (resource: string, field: string, access: FieldAccess) => void;
}) {
  const { t } = useTranslation();
  const levelLabel = (level: FieldAccess) => t(`settings.fieldAccess.${level}`);
  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>{t(resource.titleKey)}</p>
      <div className='overflow-hidden rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-xs text-muted-foreground'>
            <tr>
              <th className='px-3 py-2 text-left font-medium'>
                {t('settings.fieldPermissionField')}
              </th>
              {LEVELS.map((level) => (
                <th
                  key={level}
                  className='w-20 px-2 py-2 text-center font-medium'
                >
                  {levelLabel(level)}
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
                    <td key={option} className='px-2 py-2 text-center'>
                      <input
                        type='radio'
                        className='size-4 cursor-pointer accent-primary'
                        name={fieldPolicyKey(resource.resource, field.field)}
                        aria-label={`${field.titleKey ? t(field.titleKey) : field.label} · ${levelLabel(option)}`}
                        checked={level === option}
                        disabled={readOnly}
                        onChange={() =>
                          onChange(resource.resource, field.field, option)
                        }
                      />
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
