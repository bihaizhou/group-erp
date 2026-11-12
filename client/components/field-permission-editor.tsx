import { useTranslation } from '@nocobase/i18n/client';
import {
  type FieldAccess,
  type FieldPermissionResource,
} from './field-permission-policies.js';

/**
 * Grant ladder: 可见 ⊂ 写入. The editor renders one checkbox per rung;
 * checking 写入 also checks 可见, unchecking 写入 falls back to 可见.
 * Nothing checked means the field is hidden.
 */
const GRANTS = ['visible', 'write'] as const;
type GrantLevel = (typeof GRANTS)[number];

const rank = (level: FieldAccess | undefined): number =>
  level === 'visible' ? 1 : level === 'write' ? 2 : 0;

const rankOf = (option: GrantLevel): number => (option === 'visible' ? 1 : 2);

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
  /** `undefined` means not granted: the field is hidden for this role. */
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
  const levelLabel = (level: GrantLevel) =>
    t(`fieldPermission.level${level.charAt(0).toUpperCase()}${level.slice(1)}`);
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
              {GRANTS.map((level) => (
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
              const currentRank = rank(level);
              const fieldLabel = field.titleKey
                ? t(field.titleKey)
                : field.label;
              const toggle = (option: GrantLevel, checked: boolean) => {
                if (option === 'write') {
                  onChange(
                    resource.resource,
                    field.field,
                    checked ? 'visible' : 'write',
                  );
                  return;
                }
                onChange(
                  resource.resource,
                  field.field,
                  checked ? undefined : 'visible',
                );
              };
              return (
                <tr key={field.field} className='border-t'>
                  <td className='px-3 py-2'>{fieldLabel}</td>
                  {GRANTS.map((option) => {
                    const checked = currentRank >= rankOf(option);
                    // A field the page can never edit has no write option;
                    // it can only stay hidden or be made visible.
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
                          type='checkbox'
                          className={`size-4 ${
                            disabled
                              ? 'cursor-not-allowed [accent-color:var(--muted-foreground)]'
                              : 'cursor-pointer accent-primary'
                          }`}
                          aria-label={`${fieldLabel} · ${levelLabel(option)}`}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(option, checked)}
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
