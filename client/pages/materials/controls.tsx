import { useEffect, useRef, useState, type Ref } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Skeleton } from '#components/ui/skeleton';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useMaterialError } from './hooks.js';
export function MaterialSelect({
  id,
  label,
  value,
  items,
  onChange,
  onBlur,
  disabled,
  invalid,
  ref,
}: {
  id?: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const choices =
    value && !items.some((item) => item.value === value)
      ? [...items, { value, label: t('materials.unavailable') }]
      : items;
  return (
    <Select
      items={choices}
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        onBlur={onBlur}
        className='w-full'
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        <SelectGroup>
          {choices.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function Loading({
  variant = 'form',
}: { variant?: 'list' | 'detail' | 'form' | 'history' } = {}) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t('materials.loading')}
      aria-busy='true'
      className='flex flex-col gap-4'
    >
      {variant === 'list' ? (
        <div className='flex flex-col gap-4 rounded-lg border p-4'>
          {['header', 'row-a', 'row-b', 'row-c', 'row-d', 'row-e'].map(
            (row) => (
              <div key={row} className='grid grid-cols-4 gap-6'>
                {['name', 'code', 'state', 'date'].map((column) => (
                  <Skeleton key={column} className='h-4 w-full' />
                ))}
              </div>
            ),
          )}
        </div>
      ) : variant === 'detail' ? (
        <div className='rounded-lg border p-4'>
          <Skeleton className='mb-6 h-5 w-32' />
          <div className='grid gap-6 sm:grid-cols-2'>
            {['name', 'code', 'relation', 'state'].map((field) => (
              <div key={field} className='flex flex-col gap-2'>
                <Skeleton className='h-3 w-20' />
                <Skeleton className='h-4 w-40' />
              </div>
            ))}
          </div>
        </div>
      ) : variant === 'history' ? (
        ['history-a', 'history-b', 'history-c'].map((row) => (
          <div key={row} className='flex flex-col gap-3 rounded-lg border p-4'>
            <Skeleton className='h-5 w-1/2' />
            <Skeleton className='h-3 w-1/3' />
            <Skeleton className='h-4 w-full' />
          </div>
        ))
      ) : (
        ['field-a', 'field-b', 'field-c', 'field-d'].map((field) => (
          <div key={field} className='flex flex-col gap-2'>
            <Skeleton className='h-3 w-24' />
            <Skeleton className='h-8 w-full' />
          </div>
        ))
      )}
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
  const { t } = useTranslation(),
    message = useMaterialError(),
    status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <p>{message(error)}</p>
        {status === 401 ? (
          <Link to='/login'>{t('materials.signIn')}</Link>
        ) : ![403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t('materials.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function Refresh({
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
            aria-label={t('materials.refresh')}
            disabled={busy}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>{t('materials.refresh')}</TooltipContent>
    </Tooltip>
  );
}

export function OverflowText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = textRef.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={textRef}
      className={className}
      title={overflow ? text : undefined}
    >
      {text}
    </span>
  );
}
