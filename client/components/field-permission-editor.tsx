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
  /** `undefined` means not configured: the field follows the page default. */
  levelOf: (resource: string, field: string) => FieldAccess | undefined;
  onChange: (
    resource: string,
    field: string,
    access: FieldAccess | undefined,
  ) => void;
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
  levelOf: (resource: string, field: string) => FieldAccess | undefined;
  readOnly: boolean;
  onChange: (
    resource: string,
    field: string,
    access: FieldAccess | undefined,
  ) => void;
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
              const fieldLabel = field.titleKey
                ? t(field.titleKey)
                : field.label;
              return (
                <tr key={field.field} className='border-t'>
                  <td className='px-3 py-2'>{fieldLabel}</td>
                  {LEVELS.map((option) => {
                    const checked = level === option;
                    // A field the page can never edit has no write option;
                    // it can only be hidden or forced read-only.
                    const disabled =
                      readOnly ||
                      (option === 'write' && field.writable === false);
                    return (
                      <td
                        key={option}
                        className={`px-2 py-2 text-center ${
                          disabled ? 'bg-muted/40' : ''
                        }`}
                      >
                        <input
                          type='radio'
                          className={`size-4 ${
                            disabled
                              ? 'cursor-not-allowed [accent-color:var(--muted-foreground)]'
                              : 'cursor-pointer accent-primary'
                          }`}
                          name={fieldPolicyKey(resource.resource, field.field)}
                          aria-label={`${fieldLabel} · ${levelLabel(option)}`}
                          checked={checked}
                          disabled={disabled}
                          onChange={() =>
                            onChange(resource.resource, field.field, option)
                          }
                          onClick={() => {
                            // Clicking the selected level clears it back to
                            // "not configured" (page default).
                            if (checked && !disabled) {
                              onChange(
                                resource.resource,
                                field.field,
                                undefined,
                              );
                            }
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
