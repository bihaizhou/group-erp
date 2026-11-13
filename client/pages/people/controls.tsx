import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { DatePicker } from '#components/date-picker';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { usePeopleError } from './hooks.js';

export function PeopleSelect({
  value,
  onChange,
  items,
  label,
  id,
  disabled,
  invalid,
  selectedLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  label: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  selectedLabel?: string;
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
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        <SelectGroup>
          {items.map((v) => (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function PeopleDate(props: Parameters<typeof DatePicker>[0]) {
  const { t } = useTranslation();
  return <DatePicker {...props} placeholder={t('people.chooseDate')} />;
}
export function PeopleLoading() {
  const { t } = useTranslation();
  return (
    <div aria-label={t('people.loading')} className='flex flex-col gap-4'>
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-32 w-full' />
      <Skeleton className='h-32 w-full' />
    </div>
  );
}
export function PeopleErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation(),
    message = usePeopleError();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <p>{message(error)}</p>
        {status === 401 ? (
          <Link to='/login'>{t('people.signIn')}</Link>
        ) : ![403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t('people.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function PeopleRefresh({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='outline'
            size='icon'
            aria-label={t('people.refresh')}
            disabled={busy}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>{t('people.refresh')}</TooltipContent>
    </Tooltip>
  );
}
