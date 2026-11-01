import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { StatusBadge } from '#components/status-badge';
import { selectPopupClass } from './model.js';

export function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-label={t('org.loading')} className='flex flex-col gap-4'>
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-24 w-full' />
      <Skeleton className='h-24 w-full' />
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  const status = error instanceof ApiClientError ? error.status : undefined;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col gap-3'>
        <p>
          {t(
            status === 401
              ? 'org.sessionEnded'
              : status === 403
                ? 'org.forbidden'
                : status === 404
                  ? 'org.missing'
                  : 'org.error',
          )}
        </p>
        {status === 401 ? (
          <Link to='/login'>{t('org.signIn')}</Link>
        ) : status !== 403 && status !== 404 && retry ? (
          <Button variant='outline' onClick={retry}>
            {t('org.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function OrgStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={status === 'active' ? 'success' : 'neutral'}>
      {t(status === 'active' ? 'org.active' : 'org.inactive')}
    </StatusBadge>
  );
}
export function OrgSelect({
  value,
  onChange,
  items,
  label,
  id,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  label: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className='w-full'
        aria-label={label}
        aria-invalid={invalid}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={selectPopupClass}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
