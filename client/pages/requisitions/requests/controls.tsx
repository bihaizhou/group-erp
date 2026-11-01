import {
  DemandReferencePicker,
  type DemandReferencePickerProps,
} from '#components/demand-reference-picker';
import { ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import { StatusBadge } from '#components/status-badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { PeopleSelect } from '../../people/controls.js';
import { ui, useIssueError } from './hooks.js';
import type { State, Conflict } from './model.js';
export function IssueSelect(props: Parameters<typeof PeopleSelect>[0]) {
  return (
    <PeopleSelect
      {...props}
      selectedLabel={
        props.items.find((item) => item.value === props.value)?.label
      }
    />
  );
}
export function Loading({
  kind = 'options',
}: {
  kind?: 'options' | 'table' | 'detail' | 'form';
}) {
  const { t } = useTranslation();
  return (
    <div aria-busy='true' aria-label={t(ui('loading'))} className='grid gap-4'>
      {kind === 'table' ? (
        <div className='overflow-hidden rounded-lg border'>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className='grid grid-cols-4 gap-4 border-b p-4 last:border-b-0'
            >
              {[0, 1, 2, 3].map((column) => (
                <Skeleton
                  key={column}
                  className={row === 0 ? 'h-4 w-3/4' : 'h-5 w-full'}
                />
              ))}
            </div>
          ))}
        </div>
      ) : kind === 'detail' ? (
        <div className='flex flex-col gap-4'>
          {[0, 1, 2, 3, 4, 5].map((field) => (
            <div
              key={field}
              className='grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4'
            >
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-5 w-2/3' />
            </div>
          ))}
        </div>
      ) : kind === 'form' ? (
        <div className='grid gap-6 rounded-lg border p-6 md:grid-cols-2'>
          {[0, 1, 2, 3].map((field) => (
            <div key={field} className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full' />
            </div>
          ))}
        </div>
      ) : (
        [0, 1, 2].map((row) => (
          <div key={row} className='flex items-center gap-2'>
            <Skeleton className='size-4 rounded-full' />
            <Skeleton className='h-4 w-2/3' />
          </div>
        ))
      )}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
  description,
}: {
  error: unknown;
  retry?: () => void;
  description?: string;
}) {
  const { t } = useTranslation(),
    message = useIssueError(),
    { refresh } = useAuthentication(),
    status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <span>{description ?? message(error)}</span>
        {status === 401 ? (
          <Button variant='outline' onClick={() => void refresh()}>
            {t(ui('loginAgain'))}
          </Button>
        ) : ![403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t(ui('retry'))}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function IssueStatus({ state }: { state: State }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        state === 'approved'
          ? 'success'
          : state === 'pending'
            ? 'info'
            : 'neutral'
      }
    >
      {t(ui(state))}
    </StatusBadge>
  );
}
export function Identification({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={value === 'identified' ? 'success' : 'warning'}>
      {t(ui(value === 'identified' ? 'identified' : 'unidentified'))}
    </StatusBadge>
  );
}
export function RefreshButton({
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
            aria-label={t(ui('refresh'))}
            disabled={busy}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={busy ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>{t(ui('refresh'))}</TooltipContent>
    </Tooltip>
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
  onPage: (p: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
      <span aria-live='polite'>
        {t(ui('total'), { total })} · {t(ui('page'), { page })}
      </span>
      <div className='flex gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t(ui('previous'))}
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          {t(ui('next'))}
        </Button>
      </div>
    </div>
  );
}
/** A paged, minimal reference field. The selected reference survives search, pagination and invalidation. */
export function ReferencePicker(
  props: Omit<
    DemandReferencePickerProps,
    | 'domain'
    | 'uiNamespace'
    | 'compact'
    | 'renderError'
    | 'renderLoading'
    | 'renderPagination'
  >,
) {
  return (
    <DemandReferencePicker
      {...props}
      domain='requisitions'
      uiNamespace='requisitions.requestUi'
      compact={true}
      renderError={(error, retry) => (
        <ErrorNotice error={error} retry={retry} />
      )}
      renderLoading={() => <Loading />}
      renderPagination={(props) => <Pagination {...props} />}
    />
  );
}
export function ConflictChoices({
  conflicts,
  choices,
  onChange,
  describe,
}: {
  conflicts: Conflict[];
  choices: Record<string, 'local' | 'server'>;
  onChange: (key: string, choice: 'local' | 'server') => void;
  describe: (value: unknown, label: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className='grid gap-4'>
      {conflicts.map((item, index) => (
        <fieldset
          key={item.key}
          className='flex flex-col gap-4 rounded-lg border p-4'
        >
          <legend className='px-1 text-sm font-medium'>
            {t(ui(item.label))} {index + 1}
          </legend>
          <p className='text-sm text-muted-foreground'>
            {t(ui('originalValue'))}: {describe(item.base, item.label)}
          </p>
          <RadioGroup
            value={choices[item.key] ?? ''}
            onValueChange={(v) => onChange(item.key, v as 'local' | 'server')}
          >
            <Label className='flex items-start gap-2'>
              <RadioGroupItem value='local' />
              <span>
                {t(ui(item.retired ? 'asNewLine' : 'useLocal'))}:{' '}
                {describe(item.local, item.label)}
              </span>
            </Label>
            <Label className='flex items-start gap-2'>
              <RadioGroupItem value='server' />
              <span>
                {t(ui('useServer'))}: {describe(item.server, item.label)}
              </span>
            </Label>
          </RadioGroup>
        </fieldset>
      ))}
    </div>
  );
}
