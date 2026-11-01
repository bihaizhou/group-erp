import { useRetainedQueryData } from '#hooks/use-retained-query-data';
import { Spinner } from '#components/ui/spinner';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import { FieldError } from '#components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#components/ui/popover';

export interface PagedReferenceChoice {
  id: string;
  code?: string;
  name?: string;
  availability?: string;
}
export interface PagedReferencePickerProps<
  T extends PagedReferenceChoice = PagedReferenceChoice,
> {
  queryPath: string;
  queryKeyPrefix?: string;
  cachePath?: string;
  selectedLabel?: (item: T) => ReactNode;
  renderOption?: (item: T) => ReactNode;
  isOptionDisabled?: (item: T) => boolean;
  uiNamespace: string;
  compact?: boolean;
  query?: Record<string, string | number>;
  label: string;
  value: string;
  onChange: (id: string, item?: T) => void;
  selected?: T | null;
  error?: string;
  needsReselection?: boolean;
  disabled?: boolean;
  id?: string;
  renderError: (error: unknown, retry: () => void) => ReactNode;
  renderLoading: () => ReactNode;
  renderPagination: (props: {
    page: number;
    total: number;
    pageSize: number;
    onPage: (page: number) => void;
    busy: boolean;
  }) => ReactNode;
}
/** Company-bound search/pagination is shared; each caller supplies its own business endpoint and copy. */
export function PagedReferencePicker<T extends PagedReferenceChoice>({
  queryPath,
  queryKeyPrefix = queryPath,
  cachePath = queryPath,
  selectedLabel,
  renderOption,
  isOptionDisabled,
  uiNamespace,
  compact = false,
  query = {},
  label,
  value,
  onChange,
  selected,
  error,
  needsReselection,
  disabled,
  id,
  renderError,
  renderLoading,
  renderPagination,
}: PagedReferencePickerProps<T>) {
  const { t } = useTranslation(),
    api = useApiClient();
  const [text, setText] = useState(''),
    [composing, setComposing] = useState(false),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [retained, setRetained] = useState<T>(),
    [open, setOpen] = useState(false);
  const ui = (key: string) => `${uiNamespace}.${key}`;
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [text, composing]);
  const scopeKey = JSON.stringify([queryPath, query]);
  const [seenScope, setSeenScope] = useState(scopeKey);
  if (seenScope !== scopeKey) {
    setSeenScope(scopeKey);
    setRetained(undefined);
    setPage(1);
  }
  const params = { ...query, q, page, pageSize: 10 };
  const fetched = useQuery<{ data: T[]; meta: { total: number } }>({
    queryKey: [queryKeyPrefix, cachePath, params],
    enabled: !disabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    placeholderData: (old, previousQuery) => {
      const prior = previousQuery?.queryKey[2] as typeof params | undefined;
      // A new subject, reference type or dependency must never inherit old choices.
      return prior &&
        Object.keys(query).every(
          (key) => prior[key as keyof typeof prior] === query[key],
        )
        ? old
        : undefined;
    },
    queryFn: ({ signal }) =>
      api.request<{ data: T[]; meta: { total: number } }>({
        path: queryPath,
        query: params,
        signal,
      }),
  });
  const retainedResults = useRetainedQueryData(
    JSON.stringify([queryPath, query]),
    fetched,
    !disabled,
  );
  const result = {
    ...fetched,
    data: retainedResults.data,
    isPlaceholderData:
      fetched.isPlaceholderData || retainedResults.isStaleFallback,
  };
  const terminal =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  const choice =
    selected?.id === value
      ? selected
      : retained?.id === value
        ? retained
        : result.data?.data.find((v) => v.id === value);
  const select = (next: string) => {
    const item = result.data?.data.find((v) => v.id === next);
    if (!item || isOptionDisabled?.(item) || result.isPlaceholderData) return;
    setRetained(item);
    onChange(next, item);
    setOpen(false);
  };
  const options = (
    <div className='flex min-w-0 flex-col gap-4' aria-busy={result.isFetching}>
      <Input
        aria-label={`${label} · ${t(ui('searchReference'))}`}
        placeholder={t(ui('searchReference'))}
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setText(e.currentTarget.value);
          setComposing(false);
        }}
      />
      {Boolean(result.error && result.data && !terminal) &&
        renderError(result.error, () => void result.refetch())}
      {result.isFetching && result.data && (
        <Spinner aria-label={t(ui('loading'))} />
      )}
      {retainedResults.isStaleFallback && (
        <p className='text-sm text-muted-foreground'>
          {t(ui('previousResults'))}
        </p>
      )}
      {result.error && (!result.data || terminal) ? (
        renderError(result.error, () => void result.refetch())
      ) : result.isPending ? (
        renderLoading()
      ) : (
        <>
          <RadioGroup
            aria-label={label}
            disabled={result.isPlaceholderData}
            value={needsReselection ? '' : value}
            onValueChange={select}
          >
            {result.data?.data.map((item) => (
              <Label key={item.id} className='flex items-start gap-2 leading-5'>
                <RadioGroupItem
                  value={item.id}
                  disabled={isOptionDisabled?.(item)}
                />
                <span className='break-words'>
                  {renderOption
                    ? renderOption(item)
                    : [item.code, item.name].filter(Boolean).join(' · ')}
                </span>
              </Label>
            ))}
          </RadioGroup>
          {!result.data?.data.length && (
            <p className='text-sm text-muted-foreground'>
              {t(ui('noReferenceOptions'))}
            </p>
          )}
          {renderPagination({
            page,
            total: result.data?.meta.total ?? 0,
            pageSize: 10,
            onPage: setPage,
            busy: result.isFetching,
          })}
        </>
      )}
      {compact && value && (
        <Button
          variant='ghost'
          type='button'
          size='sm'
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
        >
          {t(ui('clearSelection'))}
        </Button>
      )}
    </div>
  );
  return (
    <fieldset
      id={compact ? undefined : id}
      tabIndex={compact ? undefined : -1}
      aria-invalid={compact ? undefined : !!error}
      disabled={disabled}
      className={
        compact
          ? 'flex w-full min-w-0 max-w-xl flex-col gap-2'
          : 'min-w-0 flex flex-col gap-4 rounded-lg border p-4'
      }
    >
      <legend
        className={
          compact ? 'mb-2 text-sm font-medium' : 'px-1 text-sm font-medium'
        }
      >
        {label}
      </legend>
      {compact ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type='button'
                variant='outline'
                disabled={disabled}
                aria-invalid={!!error}
                className='w-full justify-between font-normal'
              />
            }
          >
            <span className='truncate'>
              {value
                ? choice
                  ? selectedLabel
                    ? selectedLabel(choice)
                    : [choice.name, choice.code].filter(Boolean).join(' · ')
                  : t(ui('unavailable'))
                : t(ui('chooseReference'))}
            </span>
            <ChevronsUpDown />
          </PopoverTrigger>
          <PopoverContent
            align='start'
            className='w-auto min-w-(--anchor-width) max-w-sm'
          >
            {options}
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {value && (
            <div className='flex items-center justify-between gap-2 text-sm'>
              <span className='min-w-0 break-words'>
                {t(ui('currentSelection'))}:{' '}
                {choice
                  ? selectedLabel
                    ? selectedLabel(choice)
                    : [choice.code, choice.name].filter(Boolean).join(' · ')
                  : t(ui('unavailable'))}
                {choice?.availability && choice.availability !== 'active'
                  ? ` (${t(ui('unavailable'))})`
                  : ''}
              </span>
              {!disabled && (
                <Button
                  variant='ghost'
                  type='button'
                  size='sm'
                  onClick={() => onChange('')}
                >
                  {t(ui('clearSelection'))}
                </Button>
              )}
            </div>
          )}
          {!disabled && options}
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
    </fieldset>
  );
}
