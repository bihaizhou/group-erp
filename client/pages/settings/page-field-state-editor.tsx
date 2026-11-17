import { type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from 'cn';

import { fieldLabelOf } from '#components/field-label';
import type {
  CatalogField,
  FieldPermissionResource,
} from '#components/field-permission-policies';

import {
  stateOfValue,
  type PageFieldState,
  type PageFieldStateValue,
} from './page-field-state.js';

interface PageFieldStateEditorProps {
  resources: readonly FieldPermissionResource[];
  stateOf: (resource: string, field: string) => PageFieldStateValue;
  onChange: (resource: string, field: string, state: PageFieldState) => void;
  /** Field keys (resource.field) that can never be hidden (必填). */
  lockedFields?: ReadonlySet<string> | undefined;
  /** Field keys that can never be read-only (e.g. required fields on create pages). */
  readonlyForbiddenFields?: ReadonlySet<string> | undefined;
  /** Field keys that can never be editable (server computes them). */
  neverWritableFields?: ReadonlySet<string> | undefined;
  modifiedOf?: (resource: string, field: string) => boolean;
  readOnly?: boolean;
}

const STATE_DOT_CLASS: Readonly<Record<PageFieldState, string>> = {
  editable: 'bg-success-bright',
  readonly: 'bg-warning-bright',
  hidden: 'bg-muted-foreground',
};

function StateButton({
  state,
  current,
  disabled,
  children,
  onClick,
  title,
}: {
  state: PageFieldState;
  current: PageFieldState;
  disabled: boolean;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type='button'
      aria-pressed={current === state}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-7 min-w-14 shrink-0 items-center justify-center gap-1 rounded-l-none border-y border-r px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none select-none',
        'first:rounded-l-[min(var(--radius-md),12px)] first:border-l',
        'last:rounded-r-[min(var(--radius-md),12px)]',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        current === state
          ? 'bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          STATE_DOT_CLASS[state],
          current === state && 'bg-primary-foreground',
        )}
      />
      {children}
    </button>
  );
}

export function PageFieldStateEditor({
  resources,
  stateOf,
  onChange,
  lockedFields,
  readonlyForbiddenFields,
  neverWritableFields,
  modifiedOf,
  readOnly = false,
}: PageFieldStateEditorProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      data-slot='page-field-state-editor'
      className='grid min-w-0 gap-1 py-1'
    >
      <div
        aria-hidden
        className='flex min-w-0 items-center gap-4 px-3 text-xs font-medium text-muted-foreground'
      >
        <span className='w-28 shrink-0'>{t('pageFieldPermission.field')}</span>
        <span>{t('pageFieldPermission.permission')}</span>
      </div>
      {resources.map((resource) =>
        resource.fields.map((field: CatalogField) => {
          const key = `${resource.resource}.${field.field}`;
          const value = stateOf(resource.resource, field.field);
          const current = stateOfValue(value);
          const locked = lockedFields?.has(key) ?? false;
          const neverWritable = neverWritableFields?.has(key) ?? false;
          const modified = modifiedOf?.(resource.resource, field.field) ?? false;
          const hiddenDisabled = readOnly || locked;
          const readonlyDisabled =
            readOnly || (readonlyForbiddenFields?.has(key) ?? false);
          const editableDisabled = readOnly || neverWritable;
          const label = fieldLabelOf(
            {
              resource: resource.resource,
              field: field.field,
              label: field.label,
              titleKey: field.titleKey,
            },
            t,
          );
          return (
            <div
              key={key}
              data-slot='page-field-state-row'
              className={cn(
                'flex min-w-0 items-center justify-between gap-4 rounded-[min(var(--radius-md),12px)] border px-3 py-2',
                modified
                  ? 'border-primarysoft/60 bg-primarysoft/60'
                  : 'border-border bg-background dark:border-input',
              )}
            >
              <span className='flex w-28 shrink-0 items-center gap-2'>
                <span className='truncate text-sm'>{label}</span>
                {locked && (
                  <span className='shrink-0 rounded-[min(var(--radius-md),10px)] bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
                    {t('pageFieldPermission.required')}
                  </span>
                )}
              </span>
              <div className='flex min-w-0 flex-1 items-center justify-between gap-3'>
                <div
                  role='group'
                  aria-label={label}
                  className='flex shrink-0 items-center'
                >
                  <StateButton
                    state='editable'
                    current={current}
                    disabled={editableDisabled}
                    title={label}
                    onClick={() =>
                      onChange(resource.resource, field.field, 'editable')
                    }
                  >
                    {t('pageFieldPermission.editable')}
                  </StateButton>
                  <StateButton
                    state='readonly'
                    current={current}
                    disabled={readonlyDisabled}
                    title={label}
                    onClick={() =>
                      onChange(resource.resource, field.field, 'readonly')
                    }
                  >
                    {t('pageFieldPermission.readonly')}
                  </StateButton>
                  <StateButton
                    state='hidden'
                    current={current}
                    disabled={hiddenDisabled}
                    title={label}
                    onClick={() =>
                      onChange(resource.resource, field.field, 'hidden')
                    }
                  >
                    {t('pageFieldPermission.hidden')}
                  </StateButton>
                </div>
                {modified && (
                  <span className='w-24 shrink-0 text-right text-xs text-primary'>
                    {t('pageFieldPermission.modifiedRecently')}
                  </span>
                )}
              </div>
            </div>
          );
        }),
      )}
    </div>
  );
}
