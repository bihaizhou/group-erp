import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { StatusBadge } from '#components/status-badge';
import type { HseOption } from './model.js';
import { nativeSelectClass } from '#components/native-controls';

export function HseLoading() {
  const { t } = useTranslation();
  return (
    <div className='flex items-center gap-2 py-10 text-sm text-muted-foreground'>
      <Spinner />
      {t('hse.loading')}
    </div>
  );
}

export function HseErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm'>
      <span>
        {t('hse.loadFailed')}
        {error instanceof Error ? `：${error.message}` : ''}
      </span>
      <Button variant='outline' size='sm' onClick={retry}>
        {t('hse.retry')}
      </Button>
    </div>
  );
}

export function HseRefresh({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button variant='outline' onClick={onClick} disabled={busy}>
      <RefreshCw className={busy ? 'animate-spin' : ''} />
      {t('hse.refresh')}
    </Button>
  );
}

const tones: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = {
  reported: 'info',
  investigating: 'warning',
  rectifying: 'warning',
  open: 'info',
  verifying: 'warning',
  closed: 'success',
  active: 'success',
  expiring: 'warning',
  expired: 'warning',
  revoked: 'neutral',
};

export function HseStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={tones[status] ?? 'neutral'}>
      {t(`hse.status.${status}`)}
    </StatusBadge>
  );
}

export function HseSelect({
  value,
  onChange,
  options,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: HseOption[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      className={`${nativeSelectClass} ${className}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder ? <option value=''>{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
