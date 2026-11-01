import { usePartnerConfig } from './partner-domain.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Checkbox } from '#components/ui/checkbox';
import { Label } from '#components/ui/label';
import { Alert, AlertDescription } from '#components/ui/alert';
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
import { useSupplierError, useSupplierQuery } from './hooks.js';
import { type Choice, type Page, type Status } from './model.js';
export function SupplierStatus({ value }: { value: Status }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={value === 'active' ? 'success' : 'neutral'}>
      {t(`procurement.${value}`)}
    </StatusBadge>
  );
}
export function SupplierLoading() {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t('procurement.loading')}
      aria-busy='true'
      className='grid gap-4'
    >
      {[1, 2, 3, 4].map((v) => (
        <Skeleton key={v} className='h-10 w-full' />
      ))}
    </div>
  );
}
export function SupplierError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation(),
    { rootPath } = usePartnerConfig(),
    message = useSupplierError();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <p>{message(error)}</p>
        {status === 401 ? (
          <Link to='/login'>{t('procurement.signIn')}</Link>
        ) : [403, 404].includes(status) ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to={rootPath} />}
          >
            {t('procurement.backToList')}
          </Button>
        ) : retry ? (
          <Button variant='outline' onClick={retry}>
            {t('procurement.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function SupplierSelect({
  label,
  value,
  items,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className='w-full'>
        <SelectValue />
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
export function Pagination({
  page,
  total,
  pageSize = 20,
  onPage,
  busy,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
      <span className='text-muted-foreground' aria-live='polite'>
        {t('procurement.pagination', { page, total })}
      </span>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('procurement.previous')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={busy || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          {t('procurement.next')}
        </Button>
      </div>
    </div>
  );
}
// Paged pickers retain selections from every page. Saved inactive references
// are resolved separately; a search result never replaces the selected ids.
export function ChoicePicker({
  path,
  label,
  value,
  onChange,
  selected = [],
  multiple = false,
  disabled = false,
}: {
  path: string;
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  selected?: Choice[];
  multiple?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation(),
    [text, setText] = useState(''),
    [composing, setComposing] = useState(false),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, composing]);
  const data = useSupplierQuery<Page<Choice>>(path, { q, page, pageSize: 10 });
  const [known, setKnown] = useState<Choice[]>(() => data.data?.data ?? []);
  const [seen, setSeen] = useState(data.data);
  if (data.data !== seen) {
    setSeen(data.data);
    if (data.data) {
      const incoming = data.data.data;
      setKnown((old) =>
        Array.from(
          new Map([...old, ...incoming].map((v) => [v.id, v])).values(),
        ),
      );
    }
  }
  const choices = new Map([...known, ...selected].map((v) => [v.id, v]));
  const toggle = (id: string, checked: boolean) =>
    onChange(
      multiple
        ? checked
          ? [...new Set([...value, id])]
          : value.filter((v) => v !== id)
        : checked
          ? [id]
          : [],
    );
  return (
    <fieldset
      disabled={disabled}
      className='min-w-0 flex flex-col gap-3 rounded-lg border p-3'
    >
      <legend className='px-1 text-sm font-medium'>{label}</legend>
      <Input
        aria-label={label}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setText(e.currentTarget.value);
          setComposing(false);
        }}
      />
      {value.length > 0 && (
        <div className='flex flex-col gap-1'>
          {value.map((id) => {
            const item = choices.get(id);
            const name = item
              ? `${item.code} · ${item.name}${item.status === 'inactive' ? ` (${t('procurement.inactive')})` : ''}`
              : `${t('procurement.unavailable')} (${id})`;
            return (
              <Button
                key={id}
                disabled={disabled}
                type='button'
                variant='secondary'
                size='sm'
                className='h-auto max-w-full justify-between gap-3 whitespace-normal py-1 text-left break-words'
                aria-label={t('procurement.remove', { name })}
                onClick={() => toggle(id, false)}
              >
                {name}
                <span aria-hidden='true'>×</span>
              </Button>
            );
          })}
        </div>
      )}
      {data.isPending ? (
        <SupplierLoading />
      ) : data.error ? (
        <SupplierError error={data.error} retry={() => void data.refetch()} />
      ) : (
        <div className='flex flex-col gap-2'>
          {!data.data?.data.length && (
            <p className='text-sm text-muted-foreground'>
              {t('procurement.noChoices')}
            </p>
          )}
          {data.data?.data.map((item) => (
            <Label key={item.id} className='flex items-start gap-2 leading-5'>
              <Checkbox
                disabled={
                  disabled ||
                  (multiple && value.length >= 500 && !value.includes(item.id))
                }
                checked={value.includes(item.id)}
                onCheckedChange={(checked) => toggle(item.id, Boolean(checked))}
              />
              <span className='min-w-0 break-words'>
                {item.code} · {item.name}
              </span>
            </Label>
          ))}
          <Pagination
            page={page}
            total={data.data?.meta.total ?? 0}
            pageSize={10}
            onPage={setPage}
            busy={data.isFetching || disabled}
          />
        </div>
      )}
    </fieldset>
  );
}
