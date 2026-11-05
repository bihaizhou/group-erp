import type { ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Building2 } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import {
  PagedReferencePicker,
  type PagedReferenceChoice,
} from '#components/paged-reference-picker';

export interface CompanyChoice extends PagedReferenceChoice {
  id: string;
  code?: string;
  name?: string;
}

export interface CompanyPickerProps {
  /** The module's own authorised company endpoint. */
  queryPath: string;
  value: string;
  onChange: (id: string) => void;
  selected?: CompanyChoice | null;
  disabled?: boolean;
  id?: string;
}

/**
 * One company control for a page or a form. The list is always the caller's
 * business endpoint, so a company that this module cannot use never appears.
 */
export function CompanyPicker({
  queryPath,
  value,
  onChange,
  selected,
  disabled,
  id,
}: CompanyPickerProps) {
  const { t } = useTranslation(),
    ui = (key: string) => `companyScope.${key}`,
    label = t(ui('label'));
  return (
    <PagedReferencePicker<CompanyChoice>
      id={id}
      compact
      queryPath={queryPath}
      queryKeyPrefix='companyScope'
      cachePath={queryPath}
      uiNamespace='companyScope'
      label={label}
      value={value}
      onChange={(next) => onChange(next)}
      selected={selected}
      selectedLabel={(item) =>
        [item.code, item.name].filter(Boolean).join(' · ')
      }
      disabled={disabled}
      renderError={(_error, retry) => (
        <div className='flex flex-col items-start gap-2'>
          <p className='text-sm text-destructive'>{t(ui('loadFailed'))}</p>
          <Button type='button' size='sm' variant='outline' onClick={retry}>
            {t(ui('retry'))}
          </Button>
        </div>
      )}
      renderLoading={() => (
        <div className='flex justify-center p-4'>
          <Spinner aria-label={t(ui('loading'))} />
        </div>
      )}
      renderPagination={({ page, total, pageSize, onPage, busy }) => (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span className='text-xs text-muted-foreground'>
            {t(ui('page'), { page, total })}
          </span>
          <div className='flex gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={busy || page <= 1}
              onClick={() => onPage(page - 1)}
            >
              {t(ui('prev'))}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={busy || page * pageSize >= total}
              onClick={() => onPage(page + 1)}
            >
              {t(ui('next'))}
            </Button>
          </div>
        </div>
      )}
    />
  );
}

export type CompanyEmptyType =
  'loading' | 'chooseCompany' | 'noCompany' | 'invalid';

/** The single empty state every company-scoped page shows. */
export function CompanyEmpty({
  type,
  createCompany,
}: {
  type: CompanyEmptyType;
  createCompany?: ReactNode;
}) {
  const { t } = useTranslation(),
    ui = (key: string) => `companyScope.${key}`;
  if (type === 'loading')
    return (
      <div className='flex min-h-48 items-center justify-center rounded-lg border border-dashed'>
        <Spinner aria-label={t(ui('loading'))} />
      </div>
    );
  const title =
    type === 'chooseCompany'
      ? t(ui('chooseTitle'))
      : type === 'invalid'
        ? t(ui('invalidTitle'))
        : t(ui('noCompanyTitle'));
  const hint =
    type === 'chooseCompany'
      ? t(ui('chooseHint'))
      : type === 'invalid'
        ? t(ui('invalidHint'))
        : t(ui('noCompanyHint'));
  return (
    <Empty className='min-h-48 border border-dashed'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Building2 />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </EmptyHeader>
      {createCompany && <EmptyContent>{createCompany}</EmptyContent>}
    </Empty>
  );
}

/**
 * The company a form belongs to, shown as text. The page is already scoped by
 * CompanyGate, so changing companies is a header action, not a form field.
 */
export function CompanyIdentity({
  company,
  hint,
}: {
  readonly company: { code?: string; name?: string } | null;
  readonly hint?: string;
}) {
  const { t } = useTranslation(),
    ui = (key: string) => `companyScope.${key}`;
  const label = [company?.code, company?.name].filter(Boolean).join(' · ');
  return (
    <div className='flex flex-col gap-2'>
      <span className='text-sm font-medium'>{t(ui('label'))}</span>
      <div className='flex min-h-9 items-center rounded-md border bg-muted/30 px-3 text-sm'>
        {label || '—'}
      </div>
      {hint ? <p className='text-sm text-muted-foreground'>{hint}</p> : null}
    </div>
  );
}
